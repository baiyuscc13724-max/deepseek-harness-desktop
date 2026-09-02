const assert = require('node:assert/strict')
const { app, BrowserWindow } = require('electron')
const { readFileSync } = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..', '..')
const renderer = readFileSync(path.join(root, 'renderer', 'app.js'), 'utf8')

function extract(startText, endText) {
  const start = renderer.indexOf(startText)
  const end = renderer.indexOf(endText, start)
  assert.ok(start >= 0 && end > start, `source boundary ${startText}`)
  return renderer.slice(start, end)
}

const requestSource = extract('  const request =', '\n  const createTextNode =')
const compactSource = extract('  const mobileEntryCompactForWidth =', '\n  const mobileEntryPortalPlacement =')
const placementSource = extract('  const mobileEntryPortalPlacement =', '\n  let mobileEntryLayoutWidth')
const activateSource = extract('  const activateMobileEntry =', '\n  const mountMobileEntry =')
const entryCss = extract('    #harness-desktop-mobile-sync-entry {', '    #harness-desktop-git-row {')
  .split('\n')
  .map(line => line.startsWith('    ') ? line.slice(4) : line)
  .join('\n')

const waitFor = async (read, predicate, timeoutMs = 3000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await read()
    if (predicate(value)) return value
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error('Timed out waiting for the mobile-sync guest bridge.')
}

async function main() {
  await app.whenReady()
  const window = new BrowserWindow({
    show: false,
    width: 1460,
    height: 930,
    useContentSize: true,
    skipTaskbar: true,
    webPreferences: { webviewTag: true }
  })
  try {
    const guestHtml = `<!doctype html>
      <html><head><meta charset="utf-8"><style>
        html,body{width:100%;height:100%;margin:0;overflow:hidden;font-family:sans-serif}
        #sidebar{position:fixed;left:0;top:0;width:279px;height:930px;background:#edf7f5}
        #settings-host{position:absolute;left:14px;right:14px;bottom:10px;height:42px}
        #settings{width:100%;height:42px;border:0;background:transparent;text-align:left}
        ${entryCss}
      </style></head><body>
        <aside id="sidebar"><div id="settings-host"><button id="settings">设置</button></div></aside>
        <div id="harness-desktop-mobile-sync-tooltip" hidden><strong>手机与远程同步</strong></div>
      </body></html>`
    const guestUrl = `data:text/html;charset=utf-8,${encodeURIComponent(guestHtml)}`
    const parentHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body,#runtimeView{width:100%;height:100%;margin:0}
      #mobileSyncOverlay{position:fixed;z-index:22;inset:0;background:rgba(0,0,0,.25)}
      #mobileSyncOverlay.hidden{display:none}
    </style></head><body>
      <webview id="runtimeView" src="${guestUrl.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"></webview>
      <section id="mobileSyncOverlay" class="hidden" aria-hidden="true"><div role="dialog">手机与远程同步</div></section>
    </body></html>`
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(parentHtml)}`)

    await window.webContents.executeJavaScript(`new Promise(resolve => {
      const view = document.querySelector('#runtimeView');
      window.__mobileSyncOpened = 0;
      view.addEventListener('will-navigate', event => {
        const target = new URL(event.url);
        if (target.protocol !== 'harness-desktop:' || target.hostname !== 'open-mobile-sync') return;
        event.preventDefault();
        window.__mobileSyncOpened += 1;
        const overlay = document.querySelector('#mobileSyncOverlay');
        overlay.classList.remove('hidden');
        overlay.setAttribute('aria-hidden', 'false');
      });
      if (view.getURL()) resolve();
      else view.addEventListener('dom-ready', resolve, { once:true });
    })`, true)

    const guestInstallScript = `(() => {
      ${requestSource}
      ${compactSource}
      ${placementSource}
      ${activateSource}
      const host = document.querySelector('#settings-host');
      const settings = document.querySelector('#settings');
      host.addEventListener('click', event => {
        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);
      const entry = document.createElement('button');
      entry.id = 'harness-desktop-mobile-sync-entry';
      entry.type = 'button';
      entry.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="5" y="2.5" width="10" height="15"/></svg><span class="hd-mobile-entry-label">手机同步</span><span class="hd-mobile-entry-dot"></span>';
      entry.addEventListener('click', activateMobileEntry, true);
      document.body.append(entry);
      const hostRect = host.getBoundingClientRect();
      const triggerRect = settings.getBoundingClientRect();
      const placement = mobileEntryPortalPlacement({ left:hostRect.left, right:hostRect.right, width:hostRect.width }, triggerRect, innerWidth, true);
      entry.dataset.hdMobileCompact = String(placement.compact);
      entry.style.left = placement.left + 'px';
      entry.style.top = placement.top + 'px';
      const before = entry.getBoundingClientRect();
      const hit = document.elementFromPoint(before.left + before.width / 2, before.top + before.height / 2);
      host.innerHTML = '<button id="settings-replaced">设置</button>';
      return {
        parentIsBody: entry.parentElement === document.body,
        unique: document.querySelectorAll('#harness-desktop-mobile-sync-entry').length,
        hitIsEntry: hit === entry,
        visibleLabel: entry.querySelector('.hd-mobile-entry-label')?.textContent || '',
        before: { left:before.left, top:before.top, width:before.width, height:before.height }
      };
    })()`
    const installResult = await window.webContents.executeJavaScript(
      `document.querySelector('#runtimeView').executeJavaScript(${JSON.stringify(guestInstallScript)}, true)`,
      true
    )

    assert.equal(installResult.parentIsBody, true)
    assert.equal(installResult.unique, 1)
    assert.equal(installResult.hitIsEntry, true)
    assert.equal(installResult.visibleLabel, '手机同步')
    assert.equal(installResult.before.width, 112)
    assert.equal(installResult.before.height, 42)
    assert.ok(installResult.before.left >= 0 && installResult.before.left + installResult.before.width <= 1460)
    assert.ok(installResult.before.top >= 0 && installResult.before.top + installResult.before.height <= 930)

    const readParentState = () => window.webContents.executeJavaScript(`(() => {
      const overlay = document.querySelector('#mobileSyncOverlay');
      return { opened:window.__mobileSyncOpened, overlayHidden:overlay.classList.contains('hidden'), ariaHidden:overlay.getAttribute('aria-hidden') };
    })()`, true)
    const clickGuestEntry = () => window.webContents.executeJavaScript(
      `document.querySelector('#runtimeView').executeJavaScript("document.querySelector('#harness-desktop-mobile-sync-entry').click()", true)`,
      true
    )

    await clickGuestEntry()
    await waitFor(readParentState, state => state.opened === 1)
    await clickGuestEntry()
    const result = await waitFor(readParentState, state => state.opened === 2)
    const guestUrlAfter = await window.webContents.executeJavaScript("document.querySelector('#runtimeView').getURL()", true)

    assert.equal(result.overlayHidden, false)
    assert.equal(result.ariaHidden, 'false')
    assert.equal(guestUrlAfter, guestUrl)
    process.stdout.write(`${JSON.stringify({ ...installResult, ...result, guestUrlPreserved: guestUrlAfter === guestUrl })}\n`)
  } finally {
    window.destroy()
    app.quit()
  }
}

main().catch(error => {
  console.error(error)
  app.exit(1)
})
