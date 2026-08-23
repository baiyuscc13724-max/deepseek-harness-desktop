'use strict'

const DARK_TITLEBAR_SYMBOL_COLOR = '#f4f7ff'
const LIGHT_TITLEBAR_SYMBOL_COLOR = '#202124'

function resolveTitleBarSymbolColor(mode, shouldUseDarkColors = false) {
  const normalizedMode = String(mode || '').trim().toLowerCase()
  if (normalizedMode === 'dark') return DARK_TITLEBAR_SYMBOL_COLOR
  if (normalizedMode === 'light') return LIGHT_TITLEBAR_SYMBOL_COLOR
  return shouldUseDarkColors === true
    ? DARK_TITLEBAR_SYMBOL_COLOR
    : LIGHT_TITLEBAR_SYMBOL_COLOR
}

module.exports = {
  DARK_TITLEBAR_SYMBOL_COLOR,
  LIGHT_TITLEBAR_SYMBOL_COLOR,
  resolveTitleBarSymbolColor
}
