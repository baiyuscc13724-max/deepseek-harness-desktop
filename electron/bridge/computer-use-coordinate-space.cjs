'use strict'

const SCREENSHOT_COORDINATE_SPACE = 'screenshot-pixels'

function positiveDimension(value, fallback = 1) {
  const number = Math.floor(Number(value))
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function coordinateError(x, y, width, height, minimumY) {
  const point = `(${Number.isFinite(x) ? x : 'invalid'}, ${Number.isFinite(y) ? y : 'invalid'})`
  const bounds = minimumY > 0 ? `0 ≤ x < ${width}，${minimumY} ≤ y < ${height}` : `0 ≤ x < ${width}，0 ≤ y < ${height}`
  return Object.assign(new Error(`操作坐标 ${point} 超出最新 Computer Use 截图的可控区域（${bounds}）。x/y 必须直接使用 screenshot 返回的 width/height 像素坐标；不要按 sourceWidth/sourceHeight、显示器分辨率或附件预览尺寸预先换算，宿主会自动映射。`), {
    code: 'computer-use-coordinate-out-of-bounds',
    coordinateSpace: SCREENSHOT_COORDINATE_SPACE,
    inputBounds: { xMin: 0, yMin: minimumY, xMaxExclusive: width, yMaxExclusive: height },
    x: Number.isFinite(x) ? x : null,
    y: Number.isFinite(y) ? y : null
  })
}

function mapComputerUseScreenshotPoint(parameters = {}, surface = {}, options = {}) {
  const width = positiveDimension(surface.width)
  const height = positiveDimension(surface.height)
  const sourceWidth = positiveDimension(options.sourceWidth, width)
  const sourceHeight = positiveDimension(options.sourceHeight, height)
  const minimumY = Math.max(0, Math.min(height - 1, Math.ceil(Number(options.minimumY) || 0)))
  const x = Math.round(Number(parameters.x))
  const y = Math.round(Number(parameters.y))
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < minimumY || x >= width || y >= height) {
    throw coordinateError(x, y, width, height, minimumY)
  }
  const sourceX = Math.max(0, Math.min(sourceWidth - 1, Math.round(x * sourceWidth / width)))
  const sourceY = Math.max(0, Math.min(sourceHeight - 1, Math.round(y * sourceHeight / height)))
  return { x, y, sourceX, sourceY, coordinateSpace: SCREENSHOT_COORDINATE_SPACE }
}

module.exports = { SCREENSHOT_COORDINATE_SPACE, coordinateError, mapComputerUseScreenshotPoint }
