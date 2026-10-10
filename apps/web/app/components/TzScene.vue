<script setup lang="ts">
/**
 * Lienzo WebGL único de la app (TresJS): circuito 3D, cámara de mapa y etiquetas. Gestiona además la
 * disponibilidad de WebGL 2 y la pérdida/recuperación del contexto.
 */
import type { TresContext } from '@tresjs/core'
import type { PerspectiveCamera, WebGLRenderer } from 'three'
import { MapControls } from 'three/examples/jsm/controls/MapControls.js'
import { token } from '~/design/tokens'
import { QualityGovernor } from '~/engine/perf/QualityGovernor'
import { cornerAnchor } from '~/engine/track/circuit'
import { frameCircuit } from '~/engine/track/framing'
import { sceneStats } from '~/replay/debug'
import { getRuntime } from '~/stores/playback'
import { useSessionStore } from '~/stores/session'
import { useSettingsStore } from '~/stores/settings'
import type { SceneLabel } from './TzSceneLabels.vue'

const { t } = useI18n()
const session = useSessionStore()
const settings = useSettingsStore()

const supported = ref<boolean | null>(null)
const lost = ref(false)
const canvasKey = ref(0)
let canvasEl: HTMLCanvasElement | null = null
let ctx: TresContext | null = null
let controls: MapControls | null = null
/** Los controles, para el rig de cámara (que los desactiva al seguir a un coche). */
const controlsRef = shallowRef<MapControls | null>(null)

const data = session.data!
const rt = getRuntime()!
const model = rt.circuit
const flat = data.manifest.channels.elevation === 'flat'
const yScale = computed(() => (flat ? 1 : settings.elevationScale))
/**
 * Array estable: TresCanvas vuelve a evaluar su slot por su cuenta, y un literal nuevo en cada
 * evaluación haría que Tres invalidara (y renderizara) la escena sin motivo, también en pausa.
 */
const groupScale = computed<[number, number, number]>(() => [1, yScale.value, 1])
const zMid = (model.zRange[0] + model.zRange[1]) / 2

// Cámara de mapa: mirando al centro desde el sur, inclinada 55°, con todo el trazado en cuadro.
const SCENE_BG = token('--tz-scene-bg')

/**
 * Resolución de render adaptativa: el gobernador baja el DPR si el p95 de los frames con reproducción
 * pasa de 33 ms y lo recupera con margen. `?governor=off` lo desactiva (medidas con DPR nativo).
 */
const route = useRoute()
const governorOn = route.query.governor !== 'off'
const governor = new QualityGovernor(import.meta.client ? window.devicePixelRatio : 1)
const dpr = ref(governor.dpr)
const FOV = 35
const TILT_DEG = 55
const frame = (aspect: number, bottomInset: number) =>
  frameCircuit({ radius: model.radius, y: zMid, fovDeg: FOV, aspect, tiltDeg: TILT_DEG, bottomInset })
const initial = frame(16 / 9, 0.2)
const distance = initial.distance
const cameraPosition = initial.position
const camera = shallowRef<PerspectiveCamera | null>(null)

/**
 * Fracción inferior del lienzo que tapan los controles y, en tablet vertical, los paneles (la página
 * lo indica con `--replay-panels-bottom: 1`; en escritorio van a los lados y no cuentan).
 */
function bottomInset(canvas: HTMLCanvasElement): number {
  const c = canvas.getBoundingClientRect()
  const stage = document.querySelector<HTMLElement>('.tz-replay__stage')
  const panelsBottom = !!stage && getComputedStyle(stage).getPropertyValue('--replay-panels-bottom').trim() === '1'
  const selector = panelsBottom ? '[data-testid="replay-dock"], .tz-replay__stage > *' : '[data-testid="replay-dock"]'
  let top = c.bottom
  for (const el of document.querySelectorAll(selector)) {
    const r = el.getBoundingClientRect()
    if (r.height > 0) top = Math.min(top, r.top)
  }
  return Math.min(0.6, Math.max(0, (c.bottom - top) / c.height))
}

const TRACK_HALF_WIDTH = 7
const LABEL_OFFSET = TRACK_HALF_WIDTH + 16
const cornerLabels: SceneLabel[] = model.corners.map((c) => {
  const a = cornerAnchor(model, c)
  // La etiqueta va por fuera de la curva: el centro de giro queda al lado contrario.
  const before = model.centerline.sample(c.s - 25, { x: 0, y: 0, z: 0, tx: 1, ty: 0 })
  const after = model.centerline.sample(c.s + 25, { x: 0, y: 0, z: 0, tx: 1, ty: 0 })
  const turnLeft = before.tx * after.ty - before.ty * after.tx > 0
  const sign = turnLeft ? -1 : 1 // normal izquierda = (−ty, tx)
  const x = a.x + sign * -a.ty * LABEL_OFFSET
  const y = a.y + sign * a.tx * LABEL_OFFSET
  return { id: c.label, text: c.label, x, y: flat ? 0 : a.z, z: -y }
})
const labels = ref<{ update: (c: PerspectiveCamera, w: number, h: number, k: number) => void } | null>(null)
const carLabels = ref<{
  update: (c: PerspectiveCamera, w: number, h: number, k: number, flat: boolean) => void
} | null>(null)

function hasWebGL2(): boolean {
  try {
    const probe = document.createElement('canvas')
    const gl = probe.getContext('webgl2')
    if (!gl) return false
    gl.getExtension('WEBGL_lose_context')?.loseContext() // libera el contexto de prueba
    return true
  } catch {
    return false
  }
}

function onLost(event: Event) {
  event.preventDefault() // permite que el navegador lo restaure
  lost.value = true
}

function onRestored() {
  lost.value = false
  ctx?.renderer.invalidate()
}

/**
 * Encuadre de la vista general: al montar y, mientras el usuario no haya movido la cámara ni siga a un coche,
 * cada vez que cambia el tamaño del lienzo (girar la tablet, redimensionar la ventana).
 */
let resizeObserver: ResizeObserver | null = null
let lastSize = ''
let interacting = false
let userMoved = false

function frameOverview(cam: PerspectiveCamera, el: HTMLCanvasElement) {
  const f = frame(el.clientWidth / Math.max(1, el.clientHeight), bottomInset(el))
  cam.position.set(...f.position)
  cam.lookAt(...f.target)
  if (controls) {
    controls.target.set(...f.target)
    controls.update()
  }
}

function onResize() {
  const cam = camera.value
  if (!canvasEl || !cam || !controls) return
  const size = `${canvasEl.clientWidth}x${canvasEl.clientHeight}`
  if (size === lastSize) return
  lastSize = size
  // `enabled` es false mientras la cámara sigue a un coche (TzCameraRig).
  if (userMoved || !controls.enabled) return
  frameOverview(cam, canvasEl)
  ctx?.renderer.invalidate()
}

function detach() {
  resizeObserver?.disconnect()
  resizeObserver = null
  canvasEl?.removeEventListener('webglcontextlost', onLost)
  canvasEl?.removeEventListener('webglcontextrestored', onRestored)
  controls?.dispose()
  controls = null
  controlsRef.value = null
  canvasEl = null
}

function onReady(context: TresContext) {
  detach()
  ctx = context
  canvasEl = context.renderer.instance.domElement as HTMLCanvasElement
  canvasEl.addEventListener('webglcontextlost', onLost)
  canvasEl.addEventListener('webglcontextrestored', onRestored)
  // Modo on-demand: el runtime pide un frame en cada tick con reproducción y tras cada seek.
  getRuntime()?.setInvalidate(() => context.renderer.invalidate())
  const cam = camera.value
  if (cam) {
    controls = new MapControls(cam, canvasEl)
    controls.maxPolarAngle = (80 * Math.PI) / 180
    controls.minDistance = 80
    controls.maxDistance = distance * 3
    controls.screenSpacePanning = false
    frameOverview(cam, canvasEl)
    // Solo cuenta como «movida a mano» si la cámara cambia durante un gesto (un clic para elegir coche, no).
    controls.addEventListener('start', () => (interacting = true))
    controls.addEventListener('end', () => (interacting = false))
    controls.addEventListener('change', () => {
      if (interacting) userMoved = true
      context.renderer.invalidate()
    })
    controlsRef.value = controls
    lastSize = `${canvasEl.clientWidth}x${canvasEl.clientHeight}`
    resizeObserver = new ResizeObserver(onResize)
    resizeObserver.observe(canvasEl)
  }
  sceneStats.pitLaneLengthM = model.pitlane?.length ?? 0
  sceneStats.pitSamplesLengthM = model.meta.quality?.pitSamplesLengthM ?? 0
  sceneStats.corners = cornerLabels.length
  sceneStats.dpr = dpr.value
  const gl = (context.renderer.instance as WebGLRenderer).getContext()
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  sceneStats.gpu = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER))
  context.renderer.invalidate()
}

function onRender() {
  sceneStats.renders++
  const info = (ctx?.renderer.instance as WebGLRenderer | undefined)?.info.render
  if (info) {
    sceneStats.drawCalls = info.calls
    sceneStats.triangles = info.triangles
  }
  const cam = camera.value
  if (cam && canvasEl) {
    labels.value?.update(cam, canvasEl.clientWidth, canvasEl.clientHeight, yScale.value)
    carLabels.value?.update(cam, canvasEl.clientWidth, canvasEl.clientHeight, yScale.value, flat)
  }
  if (!sceneStats.ready) sceneStats.ready = true
}

function onError() {
  supported.value = false
}

/** Recuperación manual: un lienzo nuevo con un contexto nuevo. */
function remount() {
  detach()
  lost.value = false
  sceneStats.ready = false
  canvasKey.value++
}

watch(
  () => settings.separation,
  (on) => getRuntime()?.setSeparation(on),
  { immediate: true },
)

watch(yScale, (k) => {
  sceneStats.elevationScale = k
  ctx?.renderer.invalidate()
})

let offFrames: (() => void) | null = null
let lastFrameAt = 0

onMounted(() => {
  offFrames = rt.onFrame(() => {
    const now = performance.now()
    if (governorOn && rt.clock.playing && lastFrameAt > 0) {
      const next = governor.frame(now - lastFrameAt)
      if (next !== null) {
        dpr.value = next
        sceneStats.dpr = next
        sceneStats.dprChanges = governor.changes.length
      }
    }
    lastFrameAt = rt.clock.playing ? now : 0
  })
  settings.hydrate()
  sceneStats.elevationScale = yScale.value
  sceneStats.ready = false
  supported.value = hasWebGL2()
})
onBeforeUnmount(() => {
  offFrames?.()
  detach()
  sceneStats.ready = false
  getRuntime()?.setInvalidate(null)
})
</script>

<template>
  <div class="tz-scene" data-testid="scene" :data-webgl="supported === null ? 'pending' : supported ? 'yes' : 'no'">
    <TresCanvas
      v-if="supported"
      :key="canvasKey"
      :clear-color="SCENE_BG"
      render-mode="on-demand"
      :dpr="dpr"
      :antialias="true"
      @ready="onReady"
      @render="onRender"
      @error="onError"
    >
      <TresPerspectiveCamera ref="camera" :position="cameraPosition" :fov="FOV" :near="2" :far="distance * 6" />
      <TzCameraRig :controls="controlsRef" :y-scale="yScale" :flat="flat" @invalidate="ctx?.renderer.invalidate()" />
      <TresGroup :scale="groupScale">
        <TzTrack :model="model" :flat="flat" />
        <TzTrackFlags :model="model" :flat="flat" />
        <TzCars :y-scale="yScale" :flat="flat" />
      </TresGroup>
    </TresCanvas>

    <TzSceneLabels v-if="supported" ref="labels" :labels="cornerLabels" kind="corner" />
    <TzCarLabels v-if="supported" ref="carLabels" :states="rt.model.states" :offsets="rt.offsets" />

    <Teleport defer to="#tz-scene-tools">
      <TzSceneTools v-if="supported" :flat="flat" :estimated="data.manifest.quality.estimated" />
    </Teleport>

    <div v-if="supported === false" class="tz-scene__notice" role="alert" data-testid="webgl-unsupported">
      <p class="tz-scene__title">{{ t('scene.noWebgl') }}</p>
      <p class="tz-scene__hint">{{ t('scene.noWebglHint') }}</p>
    </div>

    <div v-if="lost" class="tz-scene__notice" role="alert" data-testid="webgl-lost">
      <p class="tz-scene__title">{{ t('scene.contextLost') }}</p>
      <p class="tz-scene__hint">{{ t('scene.contextLostHint') }}</p>
      <button type="button" class="tz-button" data-testid="webgl-recover" @click="remount">
        {{ t('scene.recover') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.tz-scene {
  position: absolute;
  inset: 0;
  z-index: var(--tz-z-canvas);
}

/* Arriba, bajo la cabecera del replay: el dock de controles ocupa la parte inferior. */
.tz-scene__notice {
  position: absolute;
  left: 50%;
  top: 72px;
  transform: translateX(-50%);
  width: min(480px, calc(100% - 2 * var(--tz-space-6)));
  padding: var(--tz-space-4) var(--tz-space-6);
  border: 1px solid var(--tz-border-strong);
  border-radius: var(--tz-radius-lg);
  background: var(--tz-overlay);
  box-shadow: var(--tz-shadow-panel);
}

.tz-scene__title {
  margin: 0 0 var(--tz-space-1);
  font-weight: var(--tz-weight-semibold);
}

.tz-scene__hint {
  margin: 0 0 var(--tz-space-3);
  color: var(--tz-text-muted);
  font-size: var(--tz-text-sm);
}
</style>
