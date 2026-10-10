<script setup lang="ts">
/**
 * Lienzo WebGL único de la app (TresJS): circuito 3D, cámara de mapa y etiquetas. Gestiona además la
 * disponibilidad de WebGL 2 y la pérdida/recuperación del contexto.
 */
import type { TresContext } from '@tresjs/core'
import type { PerspectiveCamera } from 'three'
import { MapControls } from 'three/examples/jsm/controls/MapControls.js'
import { cornerAnchor } from '~/engine/track/circuit'
import { frameCircuit } from '~/engine/track/framing'
import { sceneStats } from '~/replay/debug'
import { getRuntime } from '~/stores/playback'
import { useSessionStore } from '~/stores/session'
import { ELEVATION_SCALES, useSettingsStore } from '~/stores/settings'
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
const FOV = 35
const TILT_DEG = 55
const frame = (aspect: number, bottomInset: number) =>
  frameCircuit({ radius: model.radius, y: zMid, fovDeg: FOV, aspect, tiltDeg: TILT_DEG, bottomInset })
const initial = frame(16 / 9, 0.2)
const distance = initial.distance
const cameraPosition = initial.position
const camera = shallowRef<PerspectiveCamera | null>(null)

/** Fracción inferior del lienzo que tapan los controles del replay. */
function bottomInset(canvas: HTMLCanvasElement): number {
  const dock = document.querySelector('[data-testid="replay-dock"]')
  if (!dock) return 0
  const c = canvas.getBoundingClientRect()
  const d = dock.getBoundingClientRect()
  return Math.min(0.45, Math.max(0, (c.bottom - d.top) / c.height))
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

function detach() {
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
    const f = frame(canvasEl.clientWidth / Math.max(1, canvasEl.clientHeight), bottomInset(canvasEl))
    cam.position.set(...f.position)
    cam.lookAt(...f.target)
    controls = new MapControls(cam, canvasEl)
    controls.target.set(...f.target)
    controls.maxPolarAngle = (80 * Math.PI) / 180
    controls.minDistance = 80
    controls.maxDistance = distance * 3
    controls.screenSpacePanning = false
    controls.addEventListener('change', () => context.renderer.invalidate())
    controls.update()
    controlsRef.value = controls
  }
  sceneStats.pitLaneLengthM = model.pitlane?.length ?? 0
  sceneStats.pitSamplesLengthM = model.meta.quality?.pitSamplesLengthM ?? 0
  sceneStats.corners = cornerLabels.length
  context.renderer.invalidate()
}

function onRender() {
  sceneStats.renders++
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

watch(yScale, (k) => {
  sceneStats.elevationScale = k
  ctx?.renderer.invalidate()
})

onMounted(() => {
  settings.hydrate()
  sceneStats.elevationScale = yScale.value
  sceneStats.ready = false
  supported.value = hasWebGL2()
})
onBeforeUnmount(() => {
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
      clear-color="#0a0c0f"
      render-mode="on-demand"
      :dpr="[1, 2]"
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
    <TzCarLabels v-if="supported" ref="carLabels" :states="rt.model.states" />

    <div v-if="supported" class="tz-scene__tools" data-testid="scene-tools">
      <div class="tz-scene__elev" role="group" :aria-label="t('scene.elevation')">
        <span class="tz-scene__elev-label">{{ t('scene.elevation') }}</span>
        <button
          v-for="k in ELEVATION_SCALES"
          :key="k"
          type="button"
          class="tz-scene__elev-btn tz-tabular"
          :aria-pressed="yScale === k"
          :disabled="flat"
          :data-testid="`elevation-${k}`"
          @click="settings.setElevationScale(k)"
        >
          ×{{ k }}
        </button>
      </div>
      <TzEstimated v-if="!flat && yScale !== 1" :hint="t('scene.exaggerationHint')">
        {{ t('scene.exaggeration', { k: yScale }) }}
      </TzEstimated>
      <span v-if="flat" class="tz-scene__flat" :title="t('scene.flatHint')">{{ t('scene.flat') }}</span>
    </div>

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

.tz-scene__tools {
  position: absolute;
  top: 72px;
  right: var(--tz-space-6);
  display: flex;
  align-items: center;
  gap: var(--tz-space-2);
}

.tz-scene__elev {
  display: inline-flex;
  align-items: center;
  gap: var(--tz-space-1);
  padding: 2px;
  border: 1px solid var(--tz-border);
  border-radius: var(--tz-radius-md);
  background: var(--tz-overlay);
}

.tz-scene__elev-label {
  padding: 0 var(--tz-space-2);
  font-size: var(--tz-text-xs);
  color: var(--tz-text-muted);
}

.tz-scene__elev-btn {
  min-width: 30px;
  height: 26px;
  border: 1px solid transparent;
  border-radius: var(--tz-radius-sm);
  background: transparent;
  font-size: var(--tz-text-xs);
  font-weight: var(--tz-weight-semibold);
  cursor: pointer;
  transition: background-color var(--tz-dur-fast) var(--tz-ease-standard);
}

.tz-scene__elev-btn[aria-pressed='true'] {
  border-color: var(--tz-accent);
  background: var(--tz-accent-soft);
  color: var(--tz-accent-strong);
}

.tz-scene__elev-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.tz-scene__flat {
  font-size: var(--tz-text-xs);
  color: var(--tz-text-muted);
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
