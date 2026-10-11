<script setup lang="ts">
/**
 * Lienzo WebGL único de la app (TresJS): circuito 3D, cámara de mapa y etiquetas. Gestiona además la
 * disponibilidad de WebGL 2 y la pérdida/recuperación del contexto.
 */
import type { TresContext } from '@tresjs/core'
import { type PerspectiveCamera, Vector3, type WebGLRenderer } from 'three'
import { MapControls } from 'three/examples/jsm/controls/MapControls.js'
import { provideSceneFrames } from '~/composables/useSceneFrame'
import { useSceneGestures } from '~/composables/useSceneGestures'
import { token } from '~/design/tokens'
import { QualityGovernor } from '~/engine/perf/QualityGovernor'
import { cornerAnchor } from '~/engine/track/circuit'
import { type Fit, fitCircuit, frameCircuit, type Insets } from '~/engine/track/framing'
import { mapHalfWidth, MIN_TRACK_PX } from '~/engine/track/mapWidth'
import { TRACK_WIDTH_M } from '~/engine/track/ribbon'
import { registerSceneStat, sceneProbe, sceneStats, type TrackScreenSample } from '~/replay/debug'
import { SCENE_LAYERS } from '~/slots/scene-layers'
import { LAYOUT_SETTLED_EVENT, RESIZING_ATTR } from '~/stores/layout'
import { getRuntime, usePlaybackStore } from '~/stores/playback'
import { useSessionStore } from '~/stores/session'
import { useSettingsStore } from '~/stores/settings'
import type { SceneLabel } from './TzSceneLabels.vue'

const { t } = useI18n()
const session = useSessionStore()
const settings = useSettingsStore()
const playback = usePlaybackStore()

const supported = ref<boolean | null>(null)
const lost = ref(false)
const canvasKey = ref(0)
let canvasEl: HTMLCanvasElement | null = null
let ctx: TresContext | null = null
/**
 * Preparación de la escena (`useSceneFrame`): pista, banderas, coches y capas se registran aquí, y un solo gancho en el
 * bucle de cada lienzo los llama solo antes de cada render (nada en pausa ni con la escena tapada).
 */
const sceneFrames = provideSceneFrames()
let offSceneFrames: (() => void) | null = null
const offLoopStat = registerSceneStat('loop', () => ({ ...sceneFrames.stats }))
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
/** `?car=wedge`: coches siempre como cuña (para comparar en el bench con el modelo detallado). */
const carDetail = route.query.car !== 'wedge'
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
 * Elementos de la interfaz cuyo tamaño, si cambia, obliga a reencuadrar. La barra de arriba no: cambia de
 * alto durante la reproducción (los avisos de estado de pista entran y salen) y la cámara saltaría; su alto
 * se mide igualmente en cada encuadre, y la holgura de arriba absorbe esas variaciones.
 */
const INSET_SOURCES =
  '[data-testid="replay-dock"], [data-testid="leaderboard"], .tz-replay__stage > *, .tz-replay__side > *'
const FRAME_PAD_TOP_PX = 36
const FRAME_PAD_PX = 18

/**
 * Fracciones del lienzo que tapa la interfaz: la barra de arriba, los controles de abajo y los paneles (a los
 * lados en escritorio; abajo en tablet vertical, que la página indica con `--replay-panels-bottom: 1`).
 */
function insets(canvas: HTMLCanvasElement): Insets {
  const c = canvas.getBoundingClientRect()
  const out: Insets = { left: 0, right: 0, top: 0, bottom: 0 }
  if (c.width <= 0 || c.height <= 0) return out
  const stage = document.querySelector<HTMLElement>('.tz-replay__stage')
  const panelsBottom = !!stage && getComputedStyle(stage).getPropertyValue('--replay-panels-bottom').trim() === '1'
  const each = (selector: string, fn: (r: DOMRect) => void) => {
    for (const el of document.querySelectorAll(selector)) {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) fn(r)
    }
  }
  // Arriba: la cabecera y, si las hay, las etiquetas «Estimado» de la escena, que flotan justo debajo de ella.
  each('.tz-replay__bar, [data-testid="scene-tools"], [data-testid="scene-estimated"]', (r) => (out.top = Math.max(out.top, (r.bottom - c.top) / c.height)))
  each('[data-testid="replay-dock"]', (r) => (out.bottom = Math.max(out.bottom, (c.bottom - r.top) / c.height)))
  if (panelsBottom) {
    each('.tz-replay__stage > *', (r) => (out.bottom = Math.max(out.bottom, (c.bottom - r.top) / c.height)))
  } else {
    each('[data-testid="leaderboard"]', (r) => (out.left = Math.max(out.left, (r.right - c.left) / c.width)))
    each('.tz-replay__side > *', (r) => (out.right = Math.max(out.right, (c.right - r.left) / c.width)))
  }
  // Holgura en píxeles: las siglas van por encima de los coches y las curvas numeradas, por fuera de la pista.
  out.top += FRAME_PAD_TOP_PX / c.height
  out.bottom += FRAME_PAD_PX / c.height
  out.left += FRAME_PAD_PX / c.width
  out.right += FRAME_PAD_PX / c.width
  return out
}

/** Eje de la pista cada ~20 m, en ejes de three: lo que tiene que caber en el encuadre. */
const footprint = (() => {
  const path = model.centerline
  const step = Math.max(1, Math.round(path.count / 400))
  const out: number[] = []
  const p = { x: 0, y: 0, z: 0 }
  for (let i = 0; i < path.count; i += step) {
    path.vertex(i, p)
    out.push(p.x, flat ? 0 : p.z, -p.y)
  }
  return new Float32Array(out)
})()

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
  invalidate()
}

/** Pide un frame, salvo con la escena tapada (`rt.setSceneHidden`): al destaparla, el runtime pide uno. */
function invalidate() {
  if (!rt.sceneHidden) ctx?.renderer.invalidate()
}

/**
 * Encuadre de la vista general: al montar y, mientras el usuario no haya movido la cámara ni siga a un coche,
 * cada vez que cambia el tamaño del lienzo (girar la tablet, redimensionar la ventana).
 */
let resizeObserver: ResizeObserver | null = null
let lastSize = ''
let interacting = false
let userMoved = false
/** El lienzo o los paneles cambiaron mientras la cámara seguía a un coche: la vista general guardada ya no vale. */
let staleOverview = false

/** Encuadre de la vista general para el tamaño actual; ajusta los límites de cámara y controles para que quepa. */
function fitOverview(cam: PerspectiveCamera, el: HTMLCanvasElement): Fit {
  const f = fitCircuit({
    points: footprint,
    groundY: flat ? 0 : zMid,
    fovDeg: FOV,
    aspect: el.clientWidth / Math.max(1, el.clientHeight),
    tiltDeg: TILT_DEG,
    insets: insets(el),
  })
  sceneStats.framing = { box: f.box, free: f.free }
  // Si no, controls.update() recortaría la distancia (y el circuito se saldría del hueco) o lo cortaría el far.
  if (controls) controls.maxDistance = Math.max(controls.maxDistance, f.distance * 1.5)
  if (cam.far < f.distance * 3) {
    cam.far = f.distance * 3
    cam.updateProjectionMatrix()
  }
  staleOverview = false
  return f
}

function frameOverview(cam: PerspectiveCamera, el: HTMLCanvasElement) {
  const f = fitOverview(cam, el)
  cam.position.set(...f.position)
  cam.lookAt(...f.target)
  if (controls) {
    controls.target.set(...f.target)
    controls.update()
  }
}

/**
 * Para el rig, al volver de seguir a un coche: la vista general recalculada si el lienzo o los paneles
 * cambiaron mientras tanto (y el usuario no la había movido a mano); si no, null (vuelve a la guardada).
 */
function refreshOverview(): { position: Vector3; target: Vector3 } | null {
  const cam = camera.value
  if (!staleOverview || userMoved || !cam || !canvasEl) return null
  const f = fitOverview(cam, canvasEl)
  return { position: new Vector3(...f.position), target: new Vector3(...f.target) }
}

/** El rig ha vuelto a la vista general: si algo cambió durante la vuelta, se reencuadra ya. */
function onOverview() {
  const cam = camera.value
  if (staleOverview && !userMoved && cam && canvasEl) {
    frameOverview(cam, canvasEl)
    invalidate()
  }
}

/** Lo que determina el encuadre: tamaño del lienzo y huecos laterales e inferior (redondeados, sin temblores). */
function layoutKey(el: HTMLCanvasElement): string {
  const i = insets(el)
  const r = (v: number) => Math.round(v * 200)
  return `${el.clientWidth}x${el.clientHeight}|${r(i.left)},${r(i.right)},${r(i.bottom)}`
}

/**
 * El lienzo o los paneles han cambiado de tamaño (p. ej. la clasificación se llena después del primer encuadre). Mientras
 * se arrastra el asa de un panel (ítem 15, `RESIZING_ATTR`), no: se reencuadra una vez al soltarla
 * (`LAYOUT_SETTLED_EVENT`), no en cada frame del arrastre.
 */
function onResize() {
  const cam = camera.value
  if (!canvasEl || !cam || !controls) return
  if (document.querySelector(`[${RESIZING_ATTR}]`)) return
  const key = layoutKey(canvasEl)
  if (key === lastSize) return
  lastSize = key
  if (userMoved) return
  // `enabled` es false mientras la cámara sigue a un coche (TzCameraRig): se reencuadra al volver.
  if (!controls.enabled) {
    staleOverview = true
    return
  }
  frameOverview(cam, canvasEl)
  invalidate()
}

/** Sonda para los e2e: el eje de la pista en pantalla y la anchura con la que debería dibujarse ahí. */
const pitPoints = (() => {
  const pit = model.pitlane
  if (!pit) return new Float32Array(0)
  const out = new Float32Array(pit.count * 2)
  const p = { x: 0, y: 0, z: 0 }
  for (let i = 0; i < pit.count; i++) {
    pit.vertex(i, p)
    out[i * 2] = p.x
    out[i * 2 + 1] = p.y
  }
  return out
})()
function trackScreen(stepM: number): TrackScreenSample[] {
  const cam = camera.value
  if (!cam || !canvasEl) return []
  const rect = canvasEl.getBoundingClientRect()
  const k = yScale.value
  const path = model.centerline
  const p = { x: 0, y: 0, z: 0, tx: 1, ty: 0 }
  const c = new Vector3()
  const a = new Vector3()
  const b = new Vector3()
  const out: TrackScreenSample[] = []
  const at = (v: Vector3, x: number, y: number, z: number) => v.set(x, (flat ? 0 : z) * k, -y)
  for (let s = 0; s < path.length; s += Math.max(1, stepM)) {
    path.sample(s, p)
    const depth = -at(c, p.x, p.y, p.z).applyMatrix4(cam.matrixWorldInverse).z
    if (depth <= cam.near) continue
    at(c, p.x, p.y, p.z).project(cam)
    at(a, p.x - p.ty, p.y + p.tx, p.z).project(cam)
    at(b, p.x + p.ty, p.y - p.tx, p.z).project(cam)
    const dx = ((a.x - b.x) / 2) * rect.width
    const dy = (-(a.y - b.y) / 2) * rect.height
    const len = Math.hypot(dx, dy)
    const pxPerM = len / 2
    const frontal = (0.5 * rect.height * cam.projectionMatrix.elements[5]!) / depth
    let nearPit = false
    for (let i = 0; i < pitPoints.length && !nearPit; i += 2) nearPit = Math.hypot(pitPoints[i]! - p.x, pitPoints[i + 1]! - p.y) < 40
    out.push({
      s,
      wx: p.x,
      wy: p.y,
      x: rect.left + ((c.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - c.y) / 2) * rect.height,
      nx: dx / (len || 1),
      ny: dy / (len || 1),
      expectedPx: 2 * mapHalfWidth(TRACK_WIDTH_M / 2, MIN_TRACK_PX, pxPerM, frontal) * pxPerM,
      realPx: TRACK_WIDTH_M * pxPerM,
      frontalPx: TRACK_WIDTH_M * frontal,
      nearPit,
    })
  }
  return out
}

/**
 * Zoom de la cámara de seguimiento: rueda o pellizco con dos dedos (con la vista general, el zoom es el de
 * los controles del mapa). Solo cuando el rig ya gobierna la cámara (desactiva los controles al empezar a
 * seguir; mientras espera a ver el coche, la rueda sigue siendo la del mapa). Escucha en la raíz de la
 * escena: también sobre las siglas, que están encima del lienzo. La distancia se guarda en las preferencias.
 * El pellizco llega por los gestos de la escena (ítem 17, D43), que lo distinguen de los dos dedos que mueven el reloj.
 */
const sceneEl = ref<HTMLElement | null>(null)
const following = () => playback.following && controls?.enabled === false
function zoomFollow(distance: number) {
  settings.setFollowDistance(distance)
  invalidate()
}
function onWheel(e: WheelEvent) {
  if (!following()) return
  e.preventDefault()
  const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
  zoomFollow(settings.followDistance * Math.exp(dy * 0.0015))
}

/**
 * Gestos táctiles (ítem 17, D43): dos dedos en horizontal mueven el reloj (con la tarjeta de la vista previa del
 * timeline encima de la escena), el pellizco es el zoom y el doble toque sobre un coche lo sigue.
 */
const { hud: scrubHud } = useSceneGestures({
  root: sceneEl,
  follow: { active: following, distance: () => settings.followDistance, zoom: zoomFollow },
})

function detach() {
  offSceneFrames?.()
  offSceneFrames = null
  resizeObserver?.disconnect()
  resizeObserver = null
  window.removeEventListener(LAYOUT_SETTLED_EVENT, onResize)
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
  offSceneFrames = sceneFrames.attach(context)
  // TresCanvas monta siempre su muestreo para las devtools de TresJS (también en producción): en cada frame recorre la
  // escena entera para estimar la memoria, aunque no haya nada que pintar. Sin su mensajero, ese bucle no hace nada.
  if (!import.meta.dev) Reflect.deleteProperty(window, '__TRES__DEVTOOLS__')
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
      invalidate()
    })
    controlsRef.value = controls
    lastSize = layoutKey(canvasEl)
    resizeObserver = new ResizeObserver(onResize)
    resizeObserver.observe(canvasEl)
    for (const el of document.querySelectorAll(INSET_SOURCES)) resizeObserver.observe(el)
    window.addEventListener(LAYOUT_SETTLED_EVENT, onResize)
  }
  sceneProbe.trackScreen = trackScreen
  sceneStats.pitLaneLengthM = model.pitlane?.length ?? 0
  sceneStats.pitSamplesLengthM = model.meta.quality?.pitSamplesLengthM ?? 0
  sceneStats.corners = cornerLabels.length
  sceneStats.dpr = dpr.value
  const gl = (context.renderer.instance as WebGLRenderer).getContext()
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  sceneStats.gpu = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER))
  invalidate()
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
  invalidate()
})

let offFrames: (() => void) | null = null
let lastFrameAt = 0

onMounted(() => {
  offFrames = rt.onFrame(() => {
    const now = performance.now()
    // Con la escena tapada no se renderiza: esos frames no dicen nada de lo que cuesta pintarla.
    const measuring = rt.clock.playing && !rt.sceneHidden
    if (governorOn && measuring && lastFrameAt > 0) {
      const next = governor.frame(now - lastFrameAt)
      if (next !== null) {
        dpr.value = next
        sceneStats.dpr = next
        sceneStats.dprChanges = governor.changes.length
      }
    }
    lastFrameAt = measuring ? now : 0
  })
  settings.hydrate()
  sceneEl.value?.addEventListener('wheel', onWheel, { passive: false })
  sceneStats.elevationScale = yScale.value
  sceneStats.ready = false
  supported.value = hasWebGL2()
})
onBeforeUnmount(() => {
  offFrames?.()
  offLoopStat()
  sceneEl.value?.removeEventListener('wheel', onWheel)
  sceneProbe.trackScreen = null
  detach()
  sceneStats.ready = false
  getRuntime()?.setInvalidate(null)
})
</script>

<template>
  <div ref="sceneEl" class="tz-scene" data-testid="scene" :data-webgl="supported === null ? 'pending' : supported ? 'yes' : 'no'">
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
      <TzCameraRig
        :controls="controlsRef"
        :y-scale="yScale"
        :flat="flat"
        :refresh-overview="refreshOverview"
        @invalidate="invalidate"
        @overview="onOverview"
      />
      <TresGroup :scale="groupScale">
        <TzTrack :model="model" :flat="flat" />
        <TzTrackFlags :model="model" :flat="flat" />
        <TzCars :y-scale="yScale" :flat="flat" :detail="carDetail" />
        <!-- Capas de components/scene-layers/ (D29), en orden de renderOrder; la lista es una constante del módulo. -->
        <component
          :is="layer.component"
          v-for="layer in SCENE_LAYERS"
          :key="layer.name"
          :model="model"
          :flat="flat"
          :y-scale="yScale"
        />
      </TresGroup>
    </TresCanvas>

    <TzSceneLabels v-if="supported" ref="labels" :labels="cornerLabels" kind="corner" />
    <TzCarLabels v-if="supported" ref="carLabels" :states="rt.model.states" :offsets="rt.offsets" />
    <TzGestureHud v-if="supported && scrubHud" :hud="scrubHud" />

    <Teleport defer to="#tz-scene-tools">
      <TzSceneTools v-if="supported" :flat="flat" :estimated="data.manifest.quality.estimated" />
    </Teleport>

    <div v-if="supported === false" class="tz-scene__notice" role="alert" data-testid="webgl-unsupported">
      <p class="tz-scene__title"><TzIcon name="webgl" />{{ t('scene.noWebgl') }}</p>
      <p class="tz-scene__hint">{{ t('scene.noWebglHint') }}</p>
    </div>

    <div v-if="lost" class="tz-scene__notice" role="alert" data-testid="webgl-lost">
      <p class="tz-scene__title"><TzIcon name="alert" />{{ t('scene.contextLost') }}</p>
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
  /*
   * Todo el subárbol (lienzo y siglas): la página no se desplaza ni hace zoom con los dedos (tampoco con el doble toque
   * de Safari); los gestos son de la escena (ítem 17). `touch-action` no se hereda, pero el navegador aplica la
   * intersección con la de los antepasados.
   */
  touch-action: none;
}

/* Arriba, bajo la cabecera del replay (una fila, D44): el dock de controles ocupa la parte inferior. */
.tz-scene__notice {
  position: absolute;
  left: 50%;
  top: calc(var(--tz-space-12) + var(--tz-space-4));
  transform: translateX(-50%);
  width: min(480px, calc(100% - 2 * var(--tz-space-6)));
  padding: var(--tz-space-4) var(--tz-space-6);
  border: 1px solid var(--tz-border-strong);
  border-radius: var(--tz-radius-lg);
  background: var(--tz-overlay);
  box-shadow: var(--tz-shadow-panel);
}

/* El icono acompaña al texto del aviso, nunca lo sustituye (D30). */
.tz-scene__title {
  display: flex;
  align-items: flex-start;
  gap: var(--tz-space-2);
  margin: 0 0 var(--tz-space-1);
  font-weight: var(--tz-weight-semibold);
}

.tz-scene__hint {
  margin: 0 0 var(--tz-space-3);
  color: var(--tz-text-muted);
  font-size: var(--tz-text-sm);
}
</style>
