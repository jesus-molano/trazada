<script setup lang="ts">
/**
 * Banderas sobre la pista: tinte de toda la cinta con SC, VSC o roja, y los sectores de comisarios con
 * bandera amarilla, doble amarilla o roja. Lee el estado de pista del runtime antes de cada render (`useSceneFrame`, sin
 * reactividad) y solo toca la escena cuando cambia. Va dentro de TresCanvas, en el grupo de la pista.
 */
import { BufferAttribute, BufferGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial } from 'three'
import type { NeutralKind, SectorFlagKind } from '~/engine/trackstate/TrackState'
import type { CircuitModel } from '~/engine/track/circuit'
import { useMapWidth } from '~/composables/useMapWidth'
import { useSceneFrame } from '~/composables/useSceneFrame'
import { MIN_TRACK_PX } from '~/engine/track/mapWidth'
import { buildRibbon, rangeIndices, TRACK_WIDTH_M } from '~/engine/track/ribbon'
import { token } from '~/design/tokens'
import { sceneStats } from '~/replay/debug'
import { getRuntime } from '~/stores/playback'

const props = defineProps<{ model: CircuitModel; flat: boolean }>()
const rt = getRuntime()!

const NEUTRAL_COLOR: Record<NeutralKind, string> = {
  red: token('--tz-flag-red'),
  sc: token('--tz-sc'),
  vsc: token('--tz-vsc'),
  'vsc-ending': token('--tz-vsc'),
}
const FLAG_COLOR: Record<SectorFlagKind, string> = {
  YELLOW: token('--tz-flag-yellow'),
  'DOUBLE YELLOW': token('--tz-flag-double-yellow'),
  RED: token('--tz-flag-red'),
}

// Misma cinta que la pista (comparten forma); cada capa usa su propio índice sobre las posiciones.
const ribbon = buildRibbon(props.model.centerline, TRACK_WIDTH_M, props.flat)
const position = new BufferAttribute(ribbon.positions, 3)
const mapCenter = new BufferAttribute(ribbon.mapCenter, 3)
const mapNormal = new BufferAttribute(ribbon.mapNormal, 3)
const geometries: BufferGeometry[] = []
function geometry(indices: Uint32Array): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', position)
  g.setAttribute('mapCenter', mapCenter)
  g.setAttribute('mapNormal', mapNormal)
  g.setIndex(new BufferAttribute(indices, 1))
  geometries.push(g)
  return g
}
// Misma anchura de mapa que la pista (mismos parámetros, mismo shader): las capas la cubren entera.
const mapWidth = useMapWidth()
function overlayMaterial(opacity: number, offset: number): MeshBasicMaterial {
  const material = new MeshBasicMaterial({
    transparent: true,
    opacity,
    side: DoubleSide,
    depthWrite: false,
    // Sin la niebla del ambiente (D37): el color de una bandera es su significado y no se atenúa con la distancia.
    fog: false,
    polygonOffset: true,
    polygonOffsetFactor: offset,
    polygonOffsetUnits: offset,
  })
  return mapWidth(material, TRACK_WIDTH_M / 2, MIN_TRACK_PX)
}

const group = new Group()
const tint = new Mesh(geometry(ribbon.indices), overlayMaterial(0.5, -1))
tint.renderOrder = renderOrder
tint.visible = false
tint.frustumCulled = false
group.add(tint)

const sectors = new Map<number, Mesh<BufferGeometry, MeshBasicMaterial>>()
for (const ms of props.model.marshalSectors) {
  const mesh = new Mesh(geometry(rangeIndices(props.model.centerline, ms.sStart, ms.sEnd)), overlayMaterial(0.85, -2))
  mesh.renderOrder = renderOrder
  mesh.visible = false
  mesh.frustumCulled = false
  sectors.set(ms.number, mesh)
  group.add(mesh)
}
sceneStats.marshalSectors = sectors.size

let seen = -1
useSceneFrame(() => {
  const ts = rt.trackState
  if (ts.version === seen) return
  seen = ts.version
  const { neutral, sectors: flags } = ts.snapshot
  tint.visible = neutral !== null
  if (neutral) tint.material.color.set(NEUTRAL_COLOR[neutral])
  const shown: number[] = []
  for (const [n, mesh] of sectors) {
    const flag = flags[n]
    mesh.visible = flag !== undefined
    if (flag) {
      mesh.material.color.set(FLAG_COLOR[flag])
      shown.push(n)
    }
  }
  sceneStats.trackTint = neutral
  sceneStats.sectorOverlays = shown
})

onBeforeUnmount(() => {
  for (const g of geometries) g.dispose()
  tint.material.dispose()
  for (const mesh of sectors.values()) mesh.material.dispose()
  sceneStats.trackTint = null
  sceneStats.sectorOverlays = []
})
</script>

<script lang="ts">
/**
 * Orden de pintado de las banderas (plan §3): encima de la cinta (0) y de las capas que la colorean (calor 0,5, zonas
 * de DRS 0,7). Lo comprueba tests/nuxt/heat.test.ts: la seguridad siempre se ve.
 */
export const renderOrder = 1
</script>

<template>
  <primitive :object="group" />
</template>
