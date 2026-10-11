<script setup lang="ts">
/**
 * Estelas (ítem 7): los últimos segundos de cada coche visible, como una cinta fina que se desvanece hacia la cola.
 * Los puntos salen de `engine/replay/trail.ts` antes de cada render (`useSceneFrame`; sin historial, sin reactividad): el
 * mismo modelo de movimiento y la misma pose que el coche (`carPose`, con su separación visual si está activa), así que
 * la punta es el coche y la estela va sobre la línea central como él. Se corta en los huecos de posición. Solo se
 * recalcula y se sube a la GPU si cambió lo que dibuja (frame del runtime, modo, coche elegido o escala de altura): la
 * cámara no cuenta (la anchura de mapa va en el shader), así que girar o acercar el mapa en pausa no sube nada.
 *
 * Color del equipo (manifest) o de la última velocidad medida de hace ≤ 2 s en cada punto (sin interpolar; gris sin
 * muestra), con los tokens `--tz-trail-*`. Una sola malla para todos los coches (1 draw call), con color y opacidad
 * por vértice, anchura «de mapa» (2,5 m de cerca y un mínimo en pantalla de lejos), sin niebla y sin escribir
 * profundidad. Apagada, no se dibuja (0 draw calls) ni calcula nada.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Mesh,
  MeshBasicMaterial,
  SRGBColorSpace,
} from 'three'
import { useMapWidth } from '~/composables/useMapWidth'
import { useSceneFrame } from '~/composables/useSceneFrame'
import { token } from '~/design/tokens'
import { carPose } from '~/engine/replay/carPose'
import { pitSpan } from '~/engine/replay/place'
import {
  latestSample,
  newTrailScratch,
  sampleTrail,
  speedFraction,
  TRAIL_HEAD_ALPHA,
  TRAIL_HEAD_ALPHA_SELECTED,
  TRAIL_POINTS,
  TRAIL_SPAN_MS,
  TRAIL_STRIDE,
  trailAlpha,
} from '~/engine/replay/trail'
import type { CircuitModel } from '~/engine/track/circuit'
import { Telemetry } from '~/engine/telemetry/telemetry'
import { registerSceneStat } from '~/replay/debug'
import { getRuntime, usePlaybackStore } from '~/stores/playback'
import { type TrailMode, useTrailsStore } from '~/stores/trails'

const props = defineProps<{ model: CircuitModel; flat: boolean; yScale: number }>()

const rt = getRuntime()!
const playback = usePlaybackStore()
const trails = useTrailsStore()
trails.hydrate()

const states = rt.model.states
const tracks = rt.model.tracks
const offsets = rt.offsets
const N = states.length
const K = TRAIL_POINTS
const span = pitSpan(props.model)

/** Semianchura real de la estela (m) y anchura mínima en pantalla (px), como la pista con su `mapWidth`. */
const HALF_WIDTH_M = 1.25
const MIN_TRAIL_PX = 3
/** Elevación sobre la pista (m), como los coches: poca, el polygonOffset hace el resto. */
const LIFT_M = 0.02

// Búferes de toda la escena: 2 vértices por punto (izquierdo y derecho) y 2 triángulos entre dos puntos seguidos.
const VERTS = N * K * 2
const position = new Float32Array(VERTS * 3)
const mapCenter = new Float32Array(VERTS * 3)
const mapNormal = new Float32Array(VERTS * 3)
const color = new Float32Array(VERTS * 4)
const index = VERTS > 0xffff ? new Uint32Array(N * (K - 1) * 6) : new Uint16Array(N * (K - 1) * 6)
const dynamic = (array: Float32Array | Uint16Array | Uint32Array, size: number) =>
  new BufferAttribute(array, size).setUsage(DynamicDrawUsage)
const attrs = {
  position: dynamic(position, 3),
  mapCenter: dynamic(mapCenter, 3),
  mapNormal: dynamic(mapNormal, 3),
  color: dynamic(color, 4),
}
const attrList = Object.values(attrs)
const geometry = new BufferGeometry()
for (const [name, attr] of Object.entries(attrs)) geometry.setAttribute(name, attr)
const indexAttr = dynamic(index, 1)
geometry.setIndex(indexAttr)
geometry.setDrawRange(0, 0)

const mapWidth = useMapWidth()
const material = mapWidth(
  new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    // Transparente y de doble cara, three.js la pintaría en dos pasadas (caras traseras y luego delanteras), dos draw
    // calls. Es una cinta plana: no hay caras que ordenar, así que basta una (1 draw call, como dice sceneStats.trails).
    forceSinglePass: true,
    toneMapped: false,
    fog: false,
    // Coplanaria con la pista: siempre por encima (más que las banderas de sector, −2).
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  }),
  HALF_WIDTH_M,
  MIN_TRAIL_PX,
)
const mesh = new Mesh(geometry, material)
mesh.renderOrder = renderOrder
mesh.frustumCulled = false
mesh.visible = false

/** Colores lineales (los que espera three por vértice). */
const teamColor = states.map((st) => new Color(st.driver?.color ?? token('--tz-team-unknown')))
const NO_SAMPLE = new Color(token('--tz-trail-nodata'))
/**
 * Rampa de velocidad lenta → media → rápida, mezclada en sRGB como el degradado CSS de la leyenda, en una tabla
 * de 65 colores (se elige el más cercano: es solo el color de un valor medido, no un valor nuevo).
 */
const RAMP_STEPS = 64
const RAMP = (() => {
  const stops = (['--tz-trail-slow', '--tz-trail-mid', '--tz-trail-fast'] as const).map((n) =>
    new Color(token(n)).getRGB({ r: 0, g: 0, b: 0 }, SRGBColorSpace),
  )
  return Array.from({ length: RAMP_STEPS + 1 }, (_, i) => {
    const f = (i / RAMP_STEPS) * (stops.length - 1)
    const k = Math.min(stops.length - 2, Math.floor(f))
    const u = f - k
    const a = stops[k]!
    const b = stops[k + 1]!
    return new Color().setRGB(a.r + u * (b.r - a.r), a.g + u * (b.g - a.g), a.b + u * (b.b - a.b), SRGBColorSpace)
  })
})()

/** Velocidad medida de cada coche (vistas sin copia del layout `car`) y su cursor de búsqueda. */
const telemetry = new Telemetry(rt.session.car)
const speedSeries = states.map((st) => telemetry.seriesOf(st.car))
const speedCursors = states.map(() => ({ i: 0 }))

const scratch = states.map(() => newTrailScratch())
const buf = new Float64Array(K * TRAIL_STRIDE)
const input = { x: 0, y: 0, z: 0, heading: 0 }
const pose = { x: 0, y: 0, z: 0 }
/** Punta de cada estela dibujada (canónica, sin separación), para la sonda de los e2e. */
const heads = new Float64Array(N * 2)
const headShown = new Uint8Array(N)

/** Lo que pintó el último render (sceneStats.trails); `computes`: veces que se recalculó y subió la malla. */
const stats = { mode: 'off' as TrailMode, cars: 0, points: 0, noSample: 0, triangles: 0, drawCalls: 0, computes: 0 }
const offStat = registerSceneStat('trails', () => ({
  ...stats,
  fogged: material.fog,
  pointsPerCar: K,
  spanMs: TRAIL_SPAN_MS,
  heads: states.flatMap((st, i) => (headShown[i] ? [{ car: st.car, x: heads[i * 2]!, y: heads[i * 2 + 1]! }] : [])),
}))

/** Instante del último frame del runtime: el del modelo que dibujan los coches (no el del reloj tras un seek). */
let frameMs = rt.clock.timeMs
const offFrame = rt.onFrame((t) => (frameMs = t))

let mode: TrailMode = trails.mode
watch(
  () => trails.mode,
  (m) => {
    mode = m
    rt.requestFrame()
  },
)

/** Publica lo pintado sin reservar memoria por frame. */
function report(cars: number, points: number, noSample: number, indices: number) {
  stats.mode = mode
  stats.cars = cars
  stats.points = points
  stats.noSample = noSample
  stats.triangles = indices / 3
  stats.drawCalls = indices > 0 ? 1 : 0
}

/**
 * Lo que determina la malla dibujada: el frame del runtime (instante, posiciones, visibilidad y separación de los coches
 * solo cambian con uno nuevo), el modo, el coche elegido (su punta es más opaca) y la escala de altura (la elevación).
 * `drawnFrame` −1: nada dibujado.
 */
let drawnFrame = -1
let drawnMode: TrailMode = 'off'
let drawnSelected: string | null = null
let drawnScale = 0

function clear() {
  drawnFrame = -1
  mesh.visible = false
  geometry.setDrawRange(0, 0)
  headShown.fill(0)
  report(0, 0, 0, 0)
}

function upload(vertices: number, indices: number) {
  for (const attr of attrList) {
    attr.clearUpdateRanges()
    attr.addUpdateRange(0, vertices * attr.itemSize)
    attr.needsUpdate = true
  }
  indexAttr.clearUpdateRanges()
  indexAttr.addUpdateRange(0, indices)
  indexAttr.needsUpdate = true
}

useSceneFrame(() => {
  if (mode === 'off') {
    if (mesh.visible || stats.mode !== 'off') clear()
    return
  }
  const selected = playback.selectedCar
  if (rt.frames === drawnFrame && mode === drawnMode && selected === drawnSelected && props.yScale === drawnScale) return
  drawnFrame = rt.frames
  drawnMode = mode
  drawnSelected = selected
  drawnScale = props.yScale
  stats.computes++
  const t = frameMs
  const lift = LIFT_M / Math.max(1e-3, props.yScale)
  let v = 0
  let ix = 0
  let cars = 0
  let points = 0
  let noSample = 0
  headShown.fill(0)
  for (let i = 0; i < N; i++) {
    const st = states[i]!
    if (!st.visible) continue
    const n = sampleTrail(props.model, tracks[i]!, t, buf, scratch[i]!, undefined, span)
    if (n < 2) continue
    const head = selected === st.car ? TRAIL_HEAD_ALPHA_SELECTED : TRAIL_HEAD_ALPHA
    const series = mode === 'speed' ? speedSeries[i] : null
    const offset = offsets[i]!
    for (let k = 0; k < n; k++) {
      const o = k * TRAIL_STRIDE
      input.x = buf[o]!
      input.y = buf[o + 1]!
      input.z = buf[o + 2]!
      input.heading = buf[o + 3]!
      const tk = buf[o + 4]!
      carPose(input, offset, props.flat, pose)
      // Normal izquierda en planta: canónica (−sin h, cos h) → three (−sin h, 0, −cos h).
      const nx = -Math.sin(input.heading)
      const nz = -Math.cos(input.heading)
      const y = pose.y + lift
      let c = teamColor[i]!
      if (mode === 'speed') {
        const j = series ? latestSample(series.t, tk, speedCursors[i]!) : -1
        if (j < 0) {
          c = NO_SAMPLE
          noSample++
        } else c = RAMP[Math.round(speedFraction(series!.speed[j]!) * RAMP_STEPS)]!
      }
      const alpha = trailAlpha((t - tk) / TRAIL_SPAN_MS, head)
      for (let side = 0; side < 2; side++) {
        const sgn = side === 0 ? 1 : -1
        const p = (v + side) * 3
        position[p] = pose.x + sgn * nx * HALF_WIDTH_M
        position[p + 1] = y
        position[p + 2] = pose.z + sgn * nz * HALF_WIDTH_M
        mapCenter[p] = pose.x
        mapCenter[p + 1] = y
        mapCenter[p + 2] = pose.z
        mapNormal[p] = sgn * nx
        mapNormal[p + 1] = 0
        mapNormal[p + 2] = sgn * nz
        const q = (v + side) * 4
        color[q] = c.r
        color[q + 1] = c.g
        color[q + 2] = c.b
        color[q + 3] = alpha
      }
      if (k > 0) {
        // Cuadrilátero entre el punto anterior (v − 2, v − 1) y este (v, v + 1).
        index[ix++] = v - 2
        index[ix++] = v - 1
        index[ix++] = v
        index[ix++] = v - 1
        index[ix++] = v + 1
        index[ix++] = v
      }
      v += 2
    }
    const h = (n - 1) * TRAIL_STRIDE
    heads[i * 2] = buf[h]!
    heads[i * 2 + 1] = buf[h + 1]!
    headShown[i] = 1
    cars++
    points += n
  }
  geometry.setDrawRange(0, ix)
  mesh.visible = ix > 0
  if (ix > 0) upload(v, ix)
  report(cars, points, noSample, ix)
})

onBeforeUnmount(() => {
  offFrame()
  offStat()
  geometry.dispose()
  material.dispose()
})
</script>

<script lang="ts">
/** Orden de pintado (plan §3): después de la meta (3) y antes que los coches (10/11). */
export const renderOrder = 4
</script>

<template>
  <primitive :object="mesh" />
</template>
