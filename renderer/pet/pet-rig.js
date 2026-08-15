(function exposeMaidWhaleRig(globalObject) {
  'use strict'

  const { rigPose } = globalObject.MaidWhaleRigMotion
  const DISPLAY_SCALE = .72

  class MaidWhaleRig {
    constructor({ host, manifestUrl }) {
      this.host = host
      this.manifestUrl = new URL(manifestUrl, window.location.href)
      this.app = null
      this.root = null
      this.bones = {}
      this.action = 'idle'
      this.facing = 1
      this.startedAt = performance.now()
      this.lastPose = rigPose('idle', 0)
    }

    async load() {
      this.host.dataset.rigStage = 'manifest-loading'
      const response = await fetch(this.manifestUrl)
      if (!response.ok) throw new Error(`骨骼资源加载失败（HTTP ${response.status}）`)
      const manifest = await response.json()
      this.host.dataset.rigStage = 'renderer-starting'
      const PIXI = globalObject.PIXI
      this.app = new PIXI.Application()
      await this.app.init({
        width: 270,
        height: 320,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(2.5, Math.max(1, window.devicePixelRatio || 1))
      })
      this.app.canvas.className = 'pet-canvas'
      this.host.replaceChildren(this.app.canvas)
      this.host.dataset.rigStage = 'textures-loading'
      const textureEntries = await Promise.all(Object.entries(manifest.parts).map(async ([name, item]) => {
        const url = new URL(item.file, this.manifestUrl).href
        const imageResponse = await fetch(url)
        if (!imageResponse.ok) throw new Error(`骨骼部件加载失败：${name}（HTTP ${imageResponse.status}）`)
        const bitmap = await createImageBitmap(await imageResponse.blob())
        return [name, PIXI.Texture.from(bitmap), item]
      }))
      this.host.dataset.rigStage = 'skeleton-building'
      this.textures = Object.fromEntries(textureEntries.map(([name, texture, item]) => [name, { texture, item }]))
      this.buildSkeleton()
      this.host.dataset.rigStage = 'ready'
      this.app.ticker.add(ticker => this.update(ticker.deltaMS / 1000))
      return this
    }

    makeBone(name, parent, x, y, zIndex = 0) {
      const bone = new PIXI.Container()
      bone.label = name
      bone.position.set(x, y)
      bone.zIndex = zIndex
      parent.addChild(bone)
      parent.sortableChildren = true
      this.bones[name] = bone
      return bone
    }

    attach(partName, bone, { width, anchorX = .5, anchorY = .5, x = 0, y = 0, zIndex = 0 } = {}) {
      const source = this.textures[partName]
      const sprite = new PIXI.Sprite(source.texture)
      sprite.label = partName
      sprite.anchor.set(anchorX, anchorY)
      sprite.position.set(x, y)
      if (width) sprite.scale.set(width / source.item.width)
      sprite.zIndex = zIndex
      bone.addChild(sprite)
      bone.sortableChildren = true
      return sprite
    }

    buildSkeleton() {
      const PIXI = globalObject.PIXI
      this.root = new PIXI.Container()
      this.root.position.set(135, 274)
      this.root.scale.set(DISPLAY_SCALE)
      this.app.stage.addChild(this.root)

      const torso = this.makeBone('torso', this.root, 0, -126, 10)
      const hair = this.makeBone('hair', torso, 0, -62, -50)

      const tailBase = this.makeBone('tailBase', torso, 48, 62, -35)
      this.attach('tail-base', tailBase, { width: 82, anchorX: .08, anchorY: .5, x: -2 })
      const tailTip = this.makeBone('tailTip', tailBase, 70, 20, -36)
      this.attach('tail-tip', tailTip, { width: 56, anchorX: .63, anchorY: .55 })

      const legLeft = this.makeBone('legLeft', this.root, -22, -72, -5)
      this.attach('leg-left', legLeft, { width: 53, anchorY: .04 })
      const legRight = this.makeBone('legRight', this.root, 22, -72, -4)
      this.attach('leg-right', legRight, { width: 53, anchorY: .04 })

      this.attach('torso', torso, { width: 136, anchorY: .22, y: -6, zIndex: 0 })

      const armLeftUpper = this.makeBone('armLeftUpper', torso, -43, -34, 5)
      this.attach('arm-left-upper', armLeftUpper, { width: 46, anchorX: .78, anchorY: .12, y: 4 })
      const armLeftLower = this.makeBone('armLeftLower', armLeftUpper, 0, 50, -1)
      this.attach('arm-left-lower', armLeftLower, { width: 39, anchorX: .72, anchorY: .1, y: 2 })

      const armRightUpper = this.makeBone('armRightUpper', torso, 43, -34, 5)
      this.attach('arm-right-upper', armRightUpper, { width: 46, anchorX: .28, anchorY: .12, y: 4 })
      const armRightLower = this.makeBone('armRightLower', armRightUpper, 0, 50, -1)
      this.attach('arm-right-lower', armRightLower, { width: 39, anchorX: .35, anchorY: .1, y: 2 })

      this.attach('skirt-front', torso, { width: 150, anchorY: .17, y: 50, zIndex: 20 })
      const head = this.makeBone('head', torso, 0, -15, 30)
      this.attach('head', head, { width: 171, anchorY: .68 })
      this.attach('headdress', head, { width: 128, anchorY: .7, y: -60, zIndex: 2 })

      this.shadow = new PIXI.Graphics()
        .ellipse(0, 0, 66, 8)
        .fill({ color: 0x0d2844, alpha: .2 })
      this.shadow.position.set(135, 288)
      this.app.stage.addChildAt(this.shadow, 0)
    }

    setAction(action, meta = {}) {
      this.action = action || 'idle'
      if (meta.direction) this.facing = meta.direction < 0 ? -1 : 1
      this.startedAt = performance.now()
    }

    update(deltaSeconds) {
      if (!this.root) return
      const seconds = (performance.now() - this.startedAt) / 1000
      const target = rigPose(this.action, seconds)
      const blend = Math.min(1, deltaSeconds * 10)
      const mix = (key, fallback = 0) => {
        const current = Number(this.lastPose[key] ?? fallback)
        return current + (Number(target[key] ?? fallback) - current) * blend
      }
      const next = {}
      for (const key of Object.keys(target)) next[key] = mix(key, target[key])
      this.lastPose = next

      this.root.y = 274 + next.rootY
      this.root.rotation = next.rootRotation
      this.root.scale.set(DISPLAY_SCALE * this.facing * next.rootScaleX, DISPLAY_SCALE * next.rootScaleY)
      this.bones.torso.rotation = next.torsoRotation
      this.bones.head.rotation = next.headRotation
      this.bones.hair.rotation = next.hairRotation
      this.bones.armLeftUpper.rotation = next.armLeftUpper
      this.bones.armLeftLower.rotation = next.armLeftLower
      this.bones.armRightUpper.rotation = next.armRightUpper
      this.bones.armRightLower.rotation = next.armRightLower
      this.bones.legLeft.rotation = next.legLeft
      this.bones.legRight.rotation = next.legRight
      this.bones.tailBase.rotation = next.tailBase
      this.bones.tailTip.rotation = next.tailTip
      this.shadow.scale.x = .9 + Math.min(1, Math.abs(next.rootY) / 18) * -.25
      this.shadow.alpha = this.action === 'fall' || this.action === 'drag' ? .07 : .2
    }
  }

  globalObject.MaidWhaleRig = { MaidWhaleRig }
})(window)
