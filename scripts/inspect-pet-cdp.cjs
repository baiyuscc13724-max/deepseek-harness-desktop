const WebSocket = require('ws')
const fs = require('node:fs')
const path = require('node:path')

async function main() {
  const forcedAction = process.argv.find(argument => argument.startsWith('--action='))?.split('=')[1] || null
  const pages = await (await fetch('http://127.0.0.1:9227/json')).json()
  const page = pages.find(candidate => candidate.title === '女仆鲸')
  if (!page) throw new Error('pet target missing')
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.once('error', reject)
    socket.once('open', resolve)
  })
  if (process.argv.includes('--reload')) {
    socket.send(JSON.stringify({ id: 0, method: 'Page.reload', params: { ignoreCache: true } }))
    await new Promise(resolve => setTimeout(resolve, 1500))
  }
  const result = await new Promise((resolve, reject) => {
    socket.once('error', reject)
    socket.on('message', raw => {
      const message = JSON.parse(raw)
      if (message.id === 1) resolve(message)
    })
    socket.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: {
        expression: `(async () => {
          let moduleResult = null
          if (!document.querySelector('#rigHost')?.dataset.rigStage) {
            try {
              await import('./pet.js')
              moduleResult = { ok: true }
            } catch (error) {
              moduleResult = { ok: false, error: error?.stack || error?.message || String(error) }
            }
          }
          const debugRig = window.__maidWhaleRig
          if (debugRig && ${JSON.stringify(forcedAction)}) {
            debugRig.setAction(${JSON.stringify(forcedAction)}, { direction: 1, immediate: true })
            await new Promise(resolve => setTimeout(resolve, 180))
          }
          const debugMesh = debugRig?.model?.getObjectByProperty('isMesh', true)
          debugMesh?.geometry?.computeBoundingBox()
          const debugMaterial = Array.isArray(debugMesh?.material) ? debugMesh.material[0] : debugMesh?.material
          const debugWorld = debugMesh ? debugMesh.position.clone() : null
          if (debugMesh && debugWorld) debugMesh.getWorldPosition(debugWorld)
          const debugProjected = debugWorld?.clone().project(debugRig.camera)
          const debugPixels = []
          if (debugRig?.renderer) {
            debugRig.renderer.render(debugRig.scene, debugRig.camera)
            const gl = debugRig.renderer.getContext()
            const pixel = new Uint8Array(4)
            for (const [x, y] of [[135, 160], [90, 160], [180, 160], [135, 100], [135, 220]]) {
              gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
              debugPixels.push([x, y, ...pixel])
            }
          }
          return JSON.stringify({
            stage: document.querySelector('#rigHost')?.dataset.rigStage,
            error: document.querySelector('#rigHost')?.dataset.rigError,
            action: document.querySelector('#rigHost')?.dataset.rigAction,
            canvas: document.querySelector('canvas')?.toDataURL().slice(0, 64),
            canvasData: ${process.argv.includes('--save-canvas') ? "document.querySelector('canvas')?.toDataURL()" : 'null'},
            childCount: document.querySelector('#rigHost')?.childElementCount,
            resources: performance.getEntriesByType('resource').map(entry => entry.name),
            debug: debugRig ? {
              cameraPosition: debugRig.camera?.position?.toArray(),
              cameraUp: debugRig.camera?.up?.toArray(),
              modelPosition: debugRig.model?.position?.toArray(),
              modelScale: debugRig.model?.scale?.toArray(),
              renderInfo: debugRig.renderer?.info?.render,
              pixels: debugPixels,
              meshVisible: debugMesh?.visible,
              meshCount: debugRig.model?.getObjectsByProperty('isMesh', true)?.length,
              meshType: debugMesh?.type,
              meshWorld: debugWorld?.toArray(),
              meshProjected: debugProjected?.toArray(),
              geometryBounds: debugMesh?.geometry?.boundingBox ? {
                min: debugMesh.geometry.boundingBox.min.toArray(),
                max: debugMesh.geometry.boundingBox.max.toArray()
              } : null,
              materialOpacity: debugMaterial?.opacity,
              materialColor: debugMaterial?.color?.getHexString(),
              mapSize: debugMaterial?.map?.image ? [debugMaterial.map.image.width, debugMaterial.map.image.height] : null
            } : null,
            moduleResult
          })
        })()`,
        returnByValue: true,
        awaitPromise: true
      }
    }))
  })
  socket.close()
  if (process.argv.includes('--save-canvas')) {
    const payload = JSON.parse(result.result.result.value)
    const encoded = payload.canvasData?.split(',')[1]
    if (encoded) {
      const output = path.join(__dirname, '..', '..', '.runtime-pet-test', 'pet-canvas.png')
      fs.writeFileSync(output, Buffer.from(encoded, 'base64'))
      payload.canvasData = output
      result.result.result.value = JSON.stringify(payload)
    }
  }
  console.log(JSON.stringify(result, null, 2))
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
