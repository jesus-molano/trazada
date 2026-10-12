<script setup lang="ts">
/**
 * Coche fantasma de la comparación (ítem 1, D31): mientras se comparan dos pilotos con el fantasma activado, el coche
 * B se dibuja translúcido donde estaba en su vuelta de referencia cuando llevaba el mismo tiempo de vuelta que lleva
 * ahora A. Es su posición REAL desplazada en el tiempo (engine/compare/ghost.ts), colocada con las mismas reglas que
 * los coches (`placeSample`, pit lane incluido) y sin separación visual. Con un hueco de posición (más de 2 s sin
 * señal) no se dibuja: el panel lo dice («sin dato»).
 *
 * La geometría de los coches (cuña de lejos, monoplaza genérico de cerca, con el mismo cambio de nivel de detalle),
 * con el color de B en la comparación (`--tz-compare-b`, no el del equipo: no se confunde con el coche de verdad) y la
 * opacidad de `--tz-ghost-opacity`. Dos mallas sueltas y solo una visible: 1 draw call (0 sin fantasma). Sin niebla,
 * sin escribir profundidad y después de los coches (renderOrder 12): un coche de verdad delante lo tapa. No recibe
 * clics (su raycast no hace nada): un clic sobre él llega al coche de debajo. Lee la comparación antes de cada render
 * (`useSceneFrame`), sin reactividad: el cálculo del frame lo comparte con el panel (`rt.ext(COMPARE_EXT)`, memoizado).
 */
import { useTres } from '@tresjs/core'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  MeshBasicMaterial,
  type PerspectiveCamera,
  Vector3,
} from 'three'
import { token } from '~/design/tokens'
import { buildCar, CAR_DIM, CAR_PARTS, type CarPart } from '~/engine/car/carGeometry'
import { carSizeScale, nextDetail, screenLengthPx } from '~/engine/car/carLod'
import { buildWedge } from '~/engine/car/wedgeGeometry'
import { COMPARE_EXT, createCompare } from '~/engine/compare/session'
import { useSceneFrame } from '~/composables/useSceneFrame'
import { carPose } from '~/engine/replay/carPose'
import { newPlaceScratch, pitSpan, placeSample } from '~/engine/replay/place'
import type { CircuitModel } from '~/engine/track/circuit'
import { registerSceneStat } from '~/replay/debug'
import { useCompareStore } from '~/stores/compare'
import { getRuntime, usePlaybackStore } from '~/stores/playback'

const props = defineProps<{ model: CircuitModel; flat: boolean; yScale: number }>()

const rt = getRuntime()!
const playback = usePlaybackStore()
const compare = useCompareStore()
compare.hydrate()
const engine = rt.ext(COMPARE_EXT, createCompare)
const span = pitSpan(props.model)

/** Elevación sobre la pista (m), como los coches. */
const LIFT_M = 0.02
/** Longitud del coche (m) para el nivel de detalle, la del monoplaza. */
const CAR_LENGTH_M = CAR_DIM.noseX - CAR_DIM.tailX

const ghostColor = new Color(token('--tz-compare-b'))
const NEUTRAL: Partial<Record<CarPart, Color>> = {
  carbon: new Color(token('--tz-car-carbon')),
  dark: new Color(token('--tz-car-dark')),
  tyre: new Color(token('--tz-car-tyre')),
  rim: new Color(token('--tz-car-rim')),
  halo: new Color(token('--tz-car-halo')),
  helmet: new Color(token('--tz-car-helmet')),
}

/** Geometría con su sombreado horneado × el color de cada vértice (lineal, como espera three). */
function shadedGeometry(positions: Float32Array, shade: Float32Array, colorOf: (i: number) => Color): BufferGeometry {
  const colors = new Float32Array(shade.length * 3)
  const c = new Color()
  for (let i = 0; i < shade.length; i++) c.copy(colorOf(i)).multiplyScalar(shade[i]!).toArray(colors, i * 3)
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(positions, 3))
  g.setAttribute('color', new BufferAttribute(colors, 3))
  return g
}

const wedgeSrc = buildWedge()
const wedgeGeometry = shadedGeometry(wedgeSrc.positions, wedgeSrc.shade, () => ghostColor)

/** El monoplaza en una sola geometría (carrocería y banda con el color del fantasma; piezas neutras con el suyo). */
const car = buildCar()
const detailGeometry = (() => {
  const layers = [car.layers.paint, car.layers.band, car.layers.neutral]
  const n = layers.reduce((k, l) => k + l.shade.length, 0)
  const positions = new Float32Array(n * 3)
  const shade = new Float32Array(n)
  const part = new Uint8Array(n)
  let o = 0
  for (const l of layers) {
    positions.set(l.positions, o * 3)
    shade.set(l.shade, o)
    part.set(l.part, o)
    o += l.shade.length
  }
  return shadedGeometry(positions, shade, (i) => NEUTRAL[CAR_PARTS[part[i]!]!] ?? ghostColor)
})()

const material = new MeshBasicMaterial({
  vertexColors: true,
  transparent: true,
  opacity: Number.parseFloat(token('--tz-ghost-opacity')),
  depthWrite: false,
  depthTest: true,
  toneMapped: false,
})
const noRaycast = () => {}
function ghostMesh(g: BufferGeometry): Mesh<BufferGeometry, MeshBasicMaterial> {
  const mesh = new Mesh(g, material)
  mesh.renderOrder = renderOrder
  mesh.frustumCulled = false
  mesh.visible = false
  mesh.raycast = noRaycast
  return mesh
}
const wedge = ghostMesh(wedgeGeometry)
const detail = ghostMesh(detailGeometry)
/** Lista estable para la plantilla (TresCanvas vuelve a evaluar su slot). */
const meshes = [wedge, detail]
const triangles = { wedge: wedgeSrc.triangles, detail: car.triangles }

/** Lo que pintó el último render (`sceneStats.ghost`). */
const stats = {
  visible: false,
  state: 'off' as string,
  car: null as string | null,
  lap: null as number | null,
  lod: 'wedge' as 'wedge' | 'detail',
  /** Posición canónica (m) del fantasma y el instante de B que se dibuja. */
  x: 0,
  y: 0,
  t: 0,
  drawCalls: 0,
  triangles: 0,
}
const offStat = registerSceneStat('ghost', () => ({ ...stats }))

/** Instante del último frame del runtime: el del modelo que dibujan los coches. */
let frameMs = rt.clock.timeMs
const offFrame = rt.onFrame((t) => (frameMs = t))

const point = { x: 0, y: 0, z: 0, heading: 0 }
const pose = { x: 0, y: 0, z: 0 }
const scratch = newPlaceScratch()
const world = new Vector3()
let near = false

function hide(state: string) {
  wedge.visible = false
  detail.visible = false
  stats.visible = false
  stats.state = state
  stats.drawCalls = 0
  stats.triangles = 0
}

const { sizes } = useTres()
useSceneFrame(({ camera }) => {
  const a = playback.selectedCar
  const b = compare.compareCar
  if (!a || !b || !compare.comparing) return hide('off')
  if (!compare.showGhost) return hide('hidden')
  const f = engine.frame(a, b, compare.compareRef ?? engine.defaultRef, frameMs)
  stats.car = b
  stats.lap = f.lapB
  if (f.missing) return hide(f.missing)
  const g = f.ghost
  stats.t = g.t
  const trackB = engine.track(b)
  if (g.state !== 'visible' || !trackB || !placeSample(props.model, trackB, g.sample, point, scratch, span)) {
    return hide(g.state)
  }
  carPose(point, 0, props.flat, pose)
  const yInv = 1 / Math.max(1e-3, props.yScale)
  const y = pose.y + LIFT_M * yInv
  // Tamaño visual y nivel de detalle como los coches (real de cerca; con un mínimo en pantalla de lejos).
  const cam = camera as PerspectiveCamera | undefined
  const dist = cam ? cam.position.distanceTo(world.set(pose.x, y * props.yScale, pose.z)) : Infinity
  const k = carSizeScale(dist)
  const projY = cam?.projectionMatrix.elements[5] ?? 1
  near = cam !== undefined && nextDetail(near, screenLengthPx(CAR_LENGTH_M * k, dist, projY, sizes.height.value))
  const mesh = near ? detail : wedge
  ;(near ? wedge : detail).visible = false
  mesh.visible = true
  mesh.position.set(pose.x, y, pose.z)
  mesh.rotation.set(0, point.heading, 0)
  mesh.scale.set(k, k * yInv, k)
  stats.visible = true
  stats.state = 'visible'
  stats.lod = near ? 'detail' : 'wedge'
  stats.x = point.x
  stats.y = point.y
  stats.drawCalls = 1
  stats.triangles = near ? triangles.detail : triangles.wedge
})

onBeforeUnmount(() => {
  offFrame()
  offStat()
  wedgeGeometry.dispose()
  detailGeometry.dispose()
  material.dispose()
})
</script>

<script lang="ts">
/** Orden de pintado: después de los coches (10/11). */
export const renderOrder = 12
</script>

<template>
  <TresGroup>
    <primitive v-for="(mesh, i) in meshes" :key="i" :object="mesh" />
  </TresGroup>
</template>
