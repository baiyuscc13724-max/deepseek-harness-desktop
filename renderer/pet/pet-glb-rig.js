import * as THREE from './vendor/three/three.module.min.js'
import { GLTFLoader } from './vendor/three/addons/loaders/GLTFLoader.js'

const ACTION_CLIPS = Object.freeze({
  idle: 'Idle',
  working: 'Idle',
  'needs-input': 'Idle',
  blocked: 'Idle',
  ready: 'Celebrate',
  celebrating: 'Celebrate',
  sleeping: 'Idle',
  hungry: 'Idle',
  wave: 'Celebrate',
  feeding: 'EatTOK',
  walk: 'Walk',
  drag: 'Drag',
  fall: 'Fall',
  land: 'Idle'
})

const ONCE_CLIPS = new Set(['Celebrate', 'EatTOK', 'Fall'])

export class MaidWhaleGLBRig {
  constructor({ host, modelUrl }) {
    this.host = host
    this.modelUrl = modelUrl
    this.renderer = null
    this.camera = null
    this.scene = null
    this.model = null
    this.mixer = null
    this.clock = new THREE.Clock()
    this.actions = new Map()
    this.currentAction = null
    this.currentClip = null
    this.baseScale = 1
    this.direction = 1
    this.frameHandle = null
  }

  async load() {
    const width = Math.max(1, this.host.clientWidth || 270)
    const height = Math.max(1, this.host.clientHeight || 320)
    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setSize(width, height, false)
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.18
    this.renderer.domElement.className = 'pet-canvas pet-glb-canvas'
    this.renderer.domElement.setAttribute('aria-hidden', 'true')
    this.host.replaceChildren(this.renderer.domElement)

    this.scene = new THREE.Scene()
    this.scene.add(new THREE.HemisphereLight(0xf5fbff, 0x26335d, 2.2))
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.75))
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.6)
    keyLight.position.set(-3, 4, 6)
    this.scene.add(keyLight)
    const aspect = width / height
    this.camera = new THREE.OrthographicCamera(-1.7 * aspect, 1.7 * aspect, 1.7, -1.7, 0.01, 100)
    // Blender's glTF exporter converts the authored Z-up puppet to glTF Y-up.
    this.camera.position.set(0, 0, 6)
    this.camera.lookAt(0, 0, 0)

    const gltf = await new GLTFLoader().loadAsync(this.modelUrl)
    this.model = gltf.scene
    this.model.traverse(object => {
      if (!object.isMesh) return
      object.frustumCulled = false
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of materials) {
        material.transparent = material.opacity < 1
        material.depthWrite = true
        material.side = THREE.FrontSide
        material.needsUpdate = true
      }
    })
    this.scene.add(this.model)
    this.#fitModel()

    this.mixer = new THREE.AnimationMixer(this.model)
    for (const clip of gltf.animations) this.actions.set(clip.name, this.mixer.clipAction(clip))
    this.mixer.addEventListener('finished', event => {
      if (event.action !== this.currentAction) return
      this.setAction('idle', { direction: this.direction, immediate: false })
    })
    this.setAction('idle', { immediate: true })
    this.host.dataset.rigStage = 'ready'
    this.host.dataset.rigFormat = 'glb-3d-skeleton'
    if (new URLSearchParams(window.location.search).has('rigAction')) window.__maidWhaleRig = this
    this.#renderFrame()
    return this
  }

  #fitModel() {
    const bounds = new THREE.Box3().setFromObject(this.model)
    const size = bounds.getSize(new THREE.Vector3())
    const center = bounds.getCenter(new THREE.Vector3())
    const targetHeight = 2.95
    this.baseScale = targetHeight / Math.max(0.001, size.y)
    this.model.scale.setScalar(this.baseScale)
    this.model.position.set(-center.x * this.baseScale, -center.y * this.baseScale - 0.04, -center.z * this.baseScale)
  }

  #renderFrame = () => {
    if (!this.renderer?.domElement.isConnected) return
    this.mixer?.update(Math.min(0.05, this.clock.getDelta()))
    this.renderer.render(this.scene, this.camera)
    this.frameHandle = requestAnimationFrame(this.#renderFrame)
  }

  setAction(name, { direction = this.direction, immediate = false } = {}) {
    this.direction = direction < 0 ? -1 : 1
    const clipName = ACTION_CLIPS[name] || 'Idle'
    if (this.model) {
      this.model.scale.setScalar(Math.abs(this.baseScale))
      this.model.rotation.y = clipName === 'Walk'
        ? (this.direction > 0 ? -Math.PI / 2 : Math.PI / 2)
        : 0
    }
    const nextAction = this.actions.get(clipName) || this.actions.values().next().value
    if (!nextAction || (nextAction === this.currentAction && clipName === this.currentClip)) return

    const previous = this.currentAction
    nextAction.reset()
    if (ONCE_CLIPS.has(clipName)) {
      nextAction.setLoop(THREE.LoopOnce, 1)
      nextAction.clampWhenFinished = true
    } else {
      nextAction.setLoop(THREE.LoopRepeat, Infinity)
      nextAction.clampWhenFinished = false
    }
    nextAction.enabled = true
    nextAction.setEffectiveWeight(1)
    nextAction.play()
    if (previous && previous !== nextAction) {
      if (immediate) previous.stop()
      else previous.crossFadeTo(nextAction, 0.16, false)
    }
    this.currentAction = nextAction
    this.currentClip = clipName
    this.host.dataset.rigAction = clipName
  }
}
