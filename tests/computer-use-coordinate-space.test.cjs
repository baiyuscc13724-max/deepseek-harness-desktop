'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  SCREENSHOT_COORDINATE_SPACE,
  mapComputerUseScreenshotPoint
} = require('../electron/bridge/computer-use-coordinate-space.cjs')

const screenshot = { width: 1280, height: 815 }
const mapping = { sourceWidth: 1920, sourceHeight: 1222, minimumY: 24 }

test('maps latest screenshot pixels to source pixels exactly once', () => {
  const point = mapComputerUseScreenshotPoint({ x: 640, y: 407 }, screenshot, mapping)
  assert.deepEqual(point, {
    x: 640,
    y: 407,
    sourceX: 960,
    sourceY: Math.round(407 * 1222 / 815),
    coordinateSpace: SCREENSHOT_COORDINATE_SPACE
  })
})

test('accepts the last controllable screenshot pixel and stays inside source bounds', () => {
  const point = mapComputerUseScreenshotPoint({ x: 1279, y: 814 }, screenshot, mapping)
  assert.equal(point.x, 1279)
  assert.equal(point.y, 814)
  assert.ok(point.sourceX >= 0 && point.sourceX < mapping.sourceWidth)
  assert.ok(point.sourceY >= 0 && point.sourceY < mapping.sourceHeight)
})

test('rejects pre-scaled source coordinates with actionable screenshot-space details', () => {
  assert.throws(
    () => mapComputerUseScreenshotPoint({ x: 1919, y: 1000 }, screenshot, mapping),
    error => {
      assert.equal(error.code, 'computer-use-coordinate-out-of-bounds')
      assert.equal(error.coordinateSpace, SCREENSHOT_COORDINATE_SPACE)
      assert.deepEqual(error.inputBounds, { xMin: 0, yMin: 24, xMaxExclusive: 1280, yMaxExclusive: 815 })
      assert.match(error.message, /screenshot 返回的 width\/height 像素坐标/u)
      assert.match(error.message, /不要按 sourceWidth\/sourceHeight/u)
      return true
    }
  )
})

test('preserves the Harness title-bar safety boundary in screenshot coordinates', () => {
  assert.throws(
    () => mapComputerUseScreenshotPoint({ x: 100, y: 23 }, screenshot, mapping),
    error => error.code === 'computer-use-coordinate-out-of-bounds' && error.inputBounds.yMin === 24
  )
  assert.equal(mapComputerUseScreenshotPoint({ x: 100, y: 24 }, screenshot, mapping).y, 24)
})
