<script setup lang="ts">
/**
 * Mapa de calor sobre la pista (ítem 2, D32): una copia de la cinta de la pista con un color por vértice, el de la
 * velocidad medida o el del ganador de cada minisector (engine/track/heat.ts). Donde no hay dato no se dibuja nada y se
 * ve la pista de debajo: nunca se rellena.
 *
 * Una sola malla (1 draw call; 0 apagado o sin nada que pintar), con la anchura de mapa de la pista (mismos atributos
 * `mapCenter`/`mapNormal`, mismo shader y parámetros de `useMapWidth`: la cubre entera a cualquier distancia), sin
 * niebla y sin escribir profundidad. Siempre por debajo de las banderas: transparente y con renderOrder 0,5, menor que
 * el de las zonas de DRS (0,7) y el de las banderas de sector y neutralización (TzTrackFlags, 1), que se pintan después
 * y encima (la seguridad gana al mapa de calor).
 *
 * Los colores se suben a la GPU solo cuando cambia lo que se pinta (modo, coches o vuelta: `heat.view.version`), nunca
 * en cada frame: el store se recalcula con el reloj grueso y la capa copia el resultado justo antes del siguiente render
 * (`useSceneFrame`; nada en pausa ni con la escena tapada).
 */
import { BufferAttribute, BufferGeometry, Color, DoubleSide, DynamicDrawUsage, Mesh, MeshBasicMaterial } from 'three'
import { useMapWidth } from '~/composables/useMapWidth'
import { useSceneFrame } from '~/composables/useSceneFrame'
import { token } from '~/design/tokens'
import type { CircuitModel } from '~/engine/track/circuit'
import { type HeatPalette, heatPointColors, heatRibbon, type HeatView, type Rgb } from '~/engine/track/heat'
import { MIN_TRACK_PX } from '~/engine/track/mapWidth'
import { buildRibbon, TRACK_WIDTH_M } from '~/engine/track/ribbon'
import { registerSceneStat } from '~/replay/debug'
import { useHeatStore } from '~/stores/heat'
import { getRuntime } from '~/stores/playback'

const props = defineProps<{ model: CircuitModel; flat: boolean; yScale: number }>()

const rt = getRuntime()!
const heat = useHeatStore()
heat.hydrate()

/** Colores de los tokens en el espacio de trabajo de three (lineal), como los colores por vértice de la pista. */
const rgb = (name: `--tz-${string}`): Rgb => {
  const c = new Color(token(name))
  return [c.r, c.g, c.b]
}
const PALETTE: HeatPalette = {
  ramp: (['--tz-heat-0', '--tz-heat-1', '--tz-heat-2', '--tz-heat-3', '--tz-heat-4'] as const).map(rgb),
  a: rgb('--tz-compare-a'),
  b: rgb('--tz-compare-b'),
  tie: rgb('--tz-heat-tie'),
}

// Copia de la cinta de la pista (misma forma y mismos atributos de anchura de mapa); color e índices propios.
const path = props.model.centerline
const ribbon = buildRibbon(path, TRACK_WIDTH_M, props.flat)
const points = path.count
const pointRgb = new Float32Array(points * 3)
const pointValid = new Uint8Array(points)
const colors = new Float32Array(points * 6)
const index = new Uint32Array(ribbon.indices.length)
const colorAttr = new BufferAttribute(colors, 3).setUsage(DynamicDrawUsage)
const indexAttr = new BufferAttribute(index, 1).setUsage(DynamicDrawUsage)
const geometry = new BufferGeometry()
geometry.setAttribute('position', new BufferAttribute(ribbon.positions, 3))
geometry.setAttribute('mapCenter', new BufferAttribute(ribbon.mapCenter, 3))
geometry.setAttribute('mapNormal', new BufferAttribute(ribbon.mapNormal, 3))
geometry.setAttribute('color', colorAttr)
geometry.setIndex(indexAttr)
geometry.setDrawRange(0, 0)

const mapWidth = useMapWidth()
const material = mapWidth(
  new MeshBasicMaterial({
    vertexColors: true,
    // Transparente (opaco a la vista) para pintarse en la pasada de las transparencias, en el orden de renderOrder:
    // después de la pista y antes que las zonas de DRS y las banderas.
    transparent: true,
    opacity: 1,
    side: DoubleSide,
    forceSinglePass: true,
    depthWrite: false,
    // El color exacto del token, como en la leyenda.
    toneMapped: false,
    fog: false,
    // Coplanaria con la pista: siempre por encima de ella (las banderas usan un desplazamiento mayor).
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  }),
  TRACK_WIDTH_M / 2,
  MIN_TRACK_PX,
)
const mesh = new Mesh(geometry, material)
mesh.renderOrder = renderOrder
mesh.frustumCulled = false
mesh.visible = false

/** Lo que pintó la última subida (`sceneStats.heat`). */
const stats = {
  mode: 'off' as 'off' | HeatView['mode'],
  status: 'off' as 'off' | HeatView['status'],
  version: 0,
  car: null as string | null,
  lap: null as number | null,
  carB: null as string | null,
  lapB: null as number | null,
  sessionBest: false,
  minKmh: null as number | null,
  maxKmh: null as number | null,
  minisectors: null as { a: number; b: number; tie: number; none: number } | null,
  points,
  colored: 0,
  uploads: 0,
  drawCalls: 0,
  triangles: 0,
}
const offStat = registerSceneStat('heat', () => ({ ...stats, fogged: material.fog, renderOrder: mesh.renderOrder }))

/** La vista que falta subir (undefined: nada pendiente). Se copia del store sin reactividad. */
let pending: HeatView | null | undefined = heat.view
watch(
  () => heat.view,
  (view) => {
    pending = view
    rt.requestFrame()
  },
)

function apply(view: HeatView | null): void {
  let count = 0
  if (view && view.status === 'ok') {
    heatPointColors(view, path, PALETTE, pointRgb, pointValid)
    count = heatRibbon(pointRgb, pointValid, path.closed, colors, index)
    colorAttr.needsUpdate = true
    indexAttr.needsUpdate = true
    stats.uploads++
  }
  geometry.setDrawRange(0, count)
  mesh.visible = count > 0
  stats.mode = view?.mode ?? 'off'
  stats.status = view?.status ?? 'off'
  stats.version = view?.version ?? 0
  stats.car = view?.carA ?? null
  stats.lap = view?.a?.lap ?? null
  stats.carB = view?.carB ?? null
  stats.lapB = view?.b?.lap ?? null
  stats.sessionBest = view?.sessionBest ?? false
  stats.minKmh = view?.speed && count > 0 ? view.minKmh : null
  stats.maxKmh = view?.speed && count > 0 ? view.maxKmh : null
  stats.minisectors = view?.counts ? { ...view.counts } : null
  stats.colored = count > 0 ? view!.colored : 0
  stats.drawCalls = count > 0 ? 1 : 0
  stats.triangles = count / 3
}

useSceneFrame(() => {
  if (pending === undefined) return
  const view = pending
  pending = undefined
  apply(view)
})

onBeforeUnmount(() => {
  offStat()
  geometry.dispose()
  material.dispose()
})
</script>

<script lang="ts">
/** Orden de pintado (plan §3): encima de la cinta (0), debajo de las zonas de DRS (0,7) y de las banderas (1). */
export const renderOrder = 0.5
</script>

<template>
  <primitive :object="mesh" />
</template>
