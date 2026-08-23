const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const guest = readFileSync(path.join(root, 'renderer', 'theme-integration.js'), 'utf8')
const readableBackdropSource = guest.slice(guest.indexOf('const readableBackdrop'), guest.indexOf('const customThemeValues'))
const readableBackdrop = Function(`${readableBackdropSource}\nreturn readableBackdrop`)()

const parseColor = color => {
  const hex = /^#([0-9a-f]{6})$/i.exec(color)
  if (hex) return [0, 2, 4].map(offset => Number.parseInt(hex[1].slice(offset, offset + 2), 16))
  const rgba = /^rgba\((\d+),(\d+),(\d+),(\d*\.\d+|\d+)\)$/.exec(color)
  if (rgba) return { rgb: rgba.slice(1, 4).map(Number), opacity: Number(rgba[4]) }
  throw new Error(`Unsupported test color: ${color}`)
}

const linearChannel = value => {
  const normalized = value / 255
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
}
const luminance = color => color.reduce((total, value, index) => total + linearChannel(value) * [0.2126, 0.7152, 0.0722][index], 0)
const contrastRatio = (left, right) => {
  const values = [luminance(left), luminance(right)].sort((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}
const brighten = (color, brightness) => color.map(value => Math.min(255, value * brightness / 100))
const composite = (foreground, background, opacity) => foreground.map((value, index) => value * opacity + background[index] * (1 - opacity))

test('custom wallpapers derive a lightweight contrast surface from the semantic text color', () => {
  assert.match(guest, /const readableBackdrop = \(text, strength, minimum, maximum, brightness = 100\) =>/)
  assert.match(guest, /const darkContrast = contrast\(rgb, darkBackdrop\)/)
  assert.match(guest, /const lightContrast = contrast\(rgb, lightBackdrop\)/)
  assert.match(guest, /const darkBackdropWins = darkContrast >= lightContrast/)
  assert.match(guest, /const maximumContrast = Math\.max\(darkContrast, lightContrast\)/)
  assert.match(guest, /if \(maximumContrast < targetContrast\) return `rgba\(\$\{backdrop\},0\.99\)`/)
  assert.match(guest, /const brightnessBoost = Math\.min\(\.10, Math\.max\(0, \(brightness - 100\) \/ 40\) \* \.10\)/)
  assert.match(guest, /'--hd-theme-readable-scrim-strong': readableBackdrop\(text, custom\.readabilityStrength, \.46, \.72, custom\.wallpaperBrightness\)/)
  assert.match(guest, /'--hd-theme-readable-scrim-soft': readableBackdrop\(text, custom\.readabilityStrength, \.24, \.50, custom\.wallpaperBrightness\)/)
  assert.match(guest, /'--dsw-alias-label-secondary': hexWithOpacity\(text, \.78 \+ readability \* \.16\)/)
  assert.match(guest, /'--dsw-alias-label-tertiary': hexWithOpacity\(text, \.57 \+ readability \* \.28\)/)
})

test('soft scrim keeps ordinary bright and dark text above 4.5:1 at wallpaper brightness 100 and 140', () => {
  const cases = [
    { name: 'bright text', text: '#f4f7ff', wallpaper: [255, 255, 255] },
    { name: 'dark text', text: '#171b29', wallpaper: [0, 0, 0] }
  ]
  for (const entry of cases) {
    for (const brightness of [100, 140]) {
      const scrim = parseColor(readableBackdrop(entry.text, 72, 0.24, 0.50, brightness))
      const renderedBackground = composite(scrim.rgb, brighten(entry.wallpaper, brightness), scrim.opacity)
      const ratio = contrastRatio(parseColor(entry.text), renderedBackground)
      assert.ok(ratio >= 4.5, `${entry.name} at ${brightness}% only reached ${ratio.toFixed(3)}:1`)
    }
  }
})

test('soft scrim chooses the higher-contrast extreme for middle gray and colored custom text', () => {
  const customTextColors = ['#767676', '#959595', '#ff0000', '#7f4fff', '#008060', '#b05020', '#4385ff']
  for (const text of customTextColors) {
    const textRgb = parseColor(text)
    const maximumContrast = Math.max(contrastRatio(textRgb, [0, 0, 0]), contrastRatio(textRgb, [255, 255, 255]))
    assert.ok(maximumContrast >= 4.5, `${text} cannot reach the ordinary-text contrast target`)
    for (const brightness of [100, 140]) {
      const scrim = parseColor(readableBackdrop(text, 72, 0.24, 0.50, brightness))
      const worstWallpaper = scrim.rgb[0] < 128 ? [255, 255, 255] : [0, 0, 0]
      const renderedBackground = composite(scrim.rgb, brighten(worstWallpaper, brightness), scrim.opacity)
      const ratio = contrastRatio(textRgb, renderedBackground)
      assert.ok(ratio >= 4.5, `${text} at ${brightness}% only reached ${ratio.toFixed(3)}:1`)
    }
  }
})

test('default secondary and tertiary text remain readable on their worst wallpaper pixels', () => {
  const readability = 0.72
  const semanticOpacities = [0.78 + readability * 0.16, 0.57 + readability * 0.28]
  for (const text of ['#f4f7ff', '#171b29']) {
    const textRgb = parseColor(text)
    for (const brightness of [100, 140]) {
      const scrim = parseColor(readableBackdrop(text, 72, 0.24, 0.50, brightness))
      const worstWallpaper = scrim.rgb[0] < 128 ? [255, 255, 255] : [0, 0, 0]
      const renderedBackground = composite(scrim.rgb, brighten(worstWallpaper, brightness), scrim.opacity)
      for (const opacity of semanticOpacities) {
        const renderedText = composite(textRgb, renderedBackground, opacity)
        const ratio = contrastRatio(renderedText, renderedBackground)
        assert.ok(ratio >= 4.5, `${text} at ${brightness}% and ${opacity.toFixed(3)} opacity only reached ${ratio.toFixed(3)}:1`)
      }
    }
  }
})

test('brightness compensation increases protection without hiding the wallpaper completely', () => {
  for (const text of ['#f4f7ff', '#171b29']) {
    const normal = parseColor(readableBackdrop(text, 72, 0.24, 0.50, 100)).opacity
    const boosted = parseColor(readableBackdrop(text, 72, 0.24, 0.50, 140)).opacity
    assert.ok(boosted > normal)
    assert.ok(boosted <= 0.99)
    assert.ok(boosted < 1)
  }
})

test('custom wallpaper workbench protects conversation chrome, content, composer and inline code', () => {
  assert.match(guest, /html\[data-hd-theme="custom"\] \[data-hd-surface="conversation"\] \{\s*background:\s*linear-gradient\(to bottom,var\(--hd-theme-readable-scrim-strong\) 0,transparent 92px/u)
  assert.match(guest, /linear-gradient\(var\(--hd-theme-readable-scrim-soft\),var\(--hd-theme-readable-scrim-soft\)\) !important/u)
  assert.doesNotMatch(guest, /linear-gradient\(to right,transparent 0,var\(--hd-theme-readable-scrim-soft\)/u)
  assert.match(guest, /html\[data-hd-theme="custom"\] \[data-composer-card="true"\] \{\s*background:linear-gradient\(var\(--hd-theme-readable-surface\)/u)
  assert.match(guest, /html\[data-hd-theme="custom"\] \[data-hd-surface="conversation"\] :not\(pre\) > code/u)
  assert.match(guest, /background:var\(--hd-theme-readable-chip\) !important/u)
  assert.match(guest, /html\[data-hd-theme="custom"\] \[data-hd-surface="conversation"\] a \{/u)
})

test('wallpaper readability avoids per-pixel sampling and extra conversation blur', () => {
  assert.doesNotMatch(readableBackdropSource, /canvas|getImageData|requestAnimationFrame|MutationObserver/)

  const conversationRule = guest.match(/html\[data-hd-theme="custom"\] \[data-hd-surface="conversation"\] \{([\s\S]*?)\n      \}/u)?.[1] || ''
  assert.doesNotMatch(conversationRule, /backdrop-filter|filter:|mix-blend-mode/)
})
