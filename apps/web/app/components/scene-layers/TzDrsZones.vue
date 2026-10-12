<script setup lang="ts">
/**
 * Zonas de DRS deducidas de la telemetría (ítem 11, D38) sobre la pista: un tinte de `--tz-drs` en cada zona,
 * intenso mientras dirección de carrera tiene el DRS activado (ventana `drs` del estado de pista) y tenue el resto del
 * tiempo. Es una estimación: la etiqueta «Estimado» la ponen la herramienta y la fila de etiquetas de la escena.
 *
 * Una sola malla con todas las zonas (1 draw call), con la anchura de mapa de la pista (mismo shader y parámetros que
 * la cinta y las banderas, así que la cubre entera a cualquier distancia), sin niebla y sin escribir profundidad. Por
 * debajo de las banderas (renderOrder 0,7 < 1): una bandera amarilla en una zona se sigue viendo. Lee el estado de
 * pista antes de cada render (`useSceneFrame`) sin reactividad y solo toca el material cuando cambia. Sin zonas (2026, sin canal o sin
 * aperturas suficientes) o apagadas, no se dibuja nada (0 draw calls).
 */
import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshBasicMaterial } from 'three'
import { useMapWidth } from '~/composables/useMapWidth'
import { useSceneFrame } from '~/composables/useSceneFrame'
import { token } from '~/design/tokens'
import { drsZoneMesh } from '~/engine/drs/zoneMesh'
import type { CircuitModel } from '~/engine/track/circuit'
import { MIN_TRACK_PX } from '~/engine/track/mapWidth'
import { TRACK_WIDTH_M } from '~/engine/track/ribbon'
import { registerSceneStat } from '~/replay/debug'
import { useDrsStore } from '~/stores/drs'
import { getRuntime } from '~/stores/playback'

const props = defineProps<{ model: CircuitModel; flat: boolean; yScale: number }>()

const rt = getRuntime()!
const drs = useDrsStore()
drs.hydrate()

/** Opacidad del tinte con el DRS activado por dirección de carrera y sin él. */
const OPACITY_ENABLED = 0.42
const OPACITY_DISABLED = 0.12

const zones = rt.session.drsZones
const built = drsZoneMesh(props.model.centerline, zones.spans, props.flat)
const geometry = new BufferGeometry()
geometry.setAttribute('position', new BufferAttribute(built.positions, 3))
geometry.setAttribute('mapCenter', new BufferAttribute(built.mapCenter, 3))
geometry.setAttribute('mapNormal', new BufferAttribute(built.mapNormal, 3))
geometry.setIndex(new BufferAttribute(built.indices, 1))
const triangles = built.indices.length / 3

const mapWidth = useMapWidth()
const material = mapWidth(
  new MeshBasicMaterial({
    color: token('--tz-drs'),
    transparent: true,
    opacity: OPACITY_DISABLED,
    side: DoubleSide,
    // Transparente y de doble cara, three.js la pintaría en dos pasadas; es una cinta plana: basta una (1 draw call).
    forceSinglePass: true,
    depthWrite: false,
    toneMapped: false,
    // Coplanaria con la pista, como el tinte de neutralización: siempre por encima de ella.
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

/** Lo que pintó el último render (`sceneStats.drsZones`). */
const stats = {
  status: zones.status,
  zones: zones.spans.length / 2,
  shown: false,
  enabled: false,
  drawCalls: 0,
  triangles: 0,
}
const offStat = registerSceneStat('drsZones', () => ({
  ...stats,
  cars: zones.cars,
  spans: Array.from(zones.spans),
}))

let show = drs.show
watch(
  () => drs.show,
  (value) => {
    show = value
    rt.requestFrame()
  },
)

let seenVersion = -1
let seenShow: boolean | null = null
useSceneFrame(() => {
  const ts = rt.trackState
  if (ts.version === seenVersion && show === seenShow) return
  seenVersion = ts.version
  seenShow = show
  const enabled = ts.snapshot.drs
  const shown = show && triangles > 0
  mesh.visible = shown
  material.opacity = enabled ? OPACITY_ENABLED : OPACITY_DISABLED
  stats.shown = shown
  stats.enabled = enabled
  stats.drawCalls = shown ? 1 : 0
  stats.triangles = shown ? triangles : 0
})

onBeforeUnmount(() => {
  offStat()
  geometry.dispose()
  material.dispose()
})
</script>

<script lang="ts">
/** Orden de pintado: encima de la cinta (0) y del calor (0,5), debajo de las banderas (1). */
export const renderOrder = 0.7
</script>

<template>
  <primitive :object="mesh" />
</template>
