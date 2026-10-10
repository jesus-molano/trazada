<script setup lang="ts">
/**
 * Pista (cinta con color por altura), bordes, pit lane y línea de meta. Va dentro de TresCanvas.
 * La exageración de altura se aplica con la escala Y del grupo padre.
 */
import { BufferAttribute, BufferGeometry, Color } from 'three'
import { useMapWidth } from '~/composables/useMapWidth'
import { token } from '~/design/tokens'
import type { CircuitModel } from '~/engine/track/circuit'
import { MIN_PIT_PX, MIN_TRACK_PX } from '~/engine/track/mapWidth'
import { buildRibbon, setRibbonHalfWidth, toThree, TRACK_WIDTH_M } from '~/engine/track/ribbon'
import { sceneStats } from '~/replay/debug'

const props = defineProps<{ model: CircuitModel; flat: boolean }>()

const PIT_WIDTH_M = 9
const LOW = new Color(token('--tz-track-low'))
const HIGH = new Color(token('--tz-track-high'))
const EDGE = token('--tz-track-edge')
const FINISH = token('--tz-track-finish')
const PIT = token('--tz-pit')

function ribbonGeometry(width: number, path = props.model.centerline) {
  const r = buildRibbon(path, width, props.flat)
  const g = new BufferGeometry()
  const position = new BufferAttribute(r.positions, 3)
  g.setAttribute('position', position)
  const colors = new Float32Array(r.shade.length * 3)
  const c = new Color()
  for (let i = 0; i < r.shade.length; i++) c.lerpColors(LOW, HIGH, r.shade[i]!).toArray(colors, i * 3)
  g.setAttribute('color', new BufferAttribute(colors, 3))
  g.setIndex(new BufferAttribute(r.indices, 1))
  const edges = [r.left, r.right].map((pts) => {
    const e = new BufferGeometry()
    e.setAttribute('position', new BufferAttribute(pts, 3))
    return e
  })
  /** Reescribe la cinta y sus bordes con otra semianchura (misma forma). */
  const setHalf = (half: number) => {
    setRibbonHalfWidth(r, half)
    position.needsUpdate = true
    for (const e of edges) e.getAttribute('position').needsUpdate = true
  }
  return { ribbon: g, edges, setHalf }
}

const track = shallowRef(ribbonGeometry(TRACK_WIDTH_M))
const pit = shallowRef(props.model.pitlane ? ribbonGeometry(PIT_WIDTH_M, props.model.pitlane) : null)

/** Línea de meta: un rectángulo a través de la pista en s = 0 (2 m de largo, o más si la pista se ensancha). */
const finishPos = new Float32Array(12)
const finish = shallowRef<BufferGeometry>(finishLine())
function writeFinish(trackHalf: number) {
  const p = props.model.centerline.sample(0, { x: 0, y: 0, z: 0, tx: 1, ty: 0 })
  const nx = -p.ty
  const ny = p.tx
  const half = trackHalf + 1
  const len = Math.max(1, trackHalf / 7)
  const z = (props.flat ? 0 : p.z) + 0.05
  const corners: [number, number][] = [
    [p.x + nx * half - p.tx * len, p.y + ny * half - p.ty * len],
    [p.x - nx * half - p.tx * len, p.y - ny * half - p.ty * len],
    [p.x + nx * half + p.tx * len, p.y + ny * half + p.ty * len],
    [p.x - nx * half + p.tx * len, p.y - ny * half + p.ty * len],
  ]
  corners.forEach(([x, y], i) => toThree(x, y, z, finishPos, i * 3))
}
function finishLine(): BufferGeometry {
  writeFinish(TRACK_WIDTH_M / 2)
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(finishPos, 3))
  g.setIndex([0, 1, 2, 1, 3, 2])
  return g
}

// Anchura de mapa: la real de cerca y un mínimo en pantalla al alejarse (si no, a escala de circuito, un hilo).
const groundY = props.flat ? 0 : (props.model.zRange[0] + props.model.zRange[1]) / 2
sceneStats.trackHalfWidthM = TRACK_WIDTH_M / 2
useMapWidth(TRACK_WIDTH_M / 2, MIN_TRACK_PX, groundY, (half) => {
  track.value.setHalf(half)
  writeFinish(half)
  finish.value.getAttribute('position').needsUpdate = true
  sceneStats.trackHalfWidthM = half
})
useMapWidth(PIT_WIDTH_M / 2, MIN_PIT_PX, groundY, (half) => pit.value?.setHalf(half))

onBeforeUnmount(() => {
  for (const g of [track.value.ribbon, ...track.value.edges, finish.value]) g.dispose()
  if (pit.value) for (const g of [pit.value.ribbon, ...pit.value.edges]) g.dispose()
})

defineExpose({ trackWidth: TRACK_WIDTH_M })
</script>

<template>
  <TresGroup>
    <!-- polygonOffset: los bordes (líneas coplanarias) quedan siempre por encima de la cinta -->
    <TresMesh :geometry="track.ribbon" :render-order="1" :frustum-culled="false">
      <TresMeshBasicMaterial vertex-colors :side="2" :polygon-offset="true" :polygon-offset-factor="1" :polygon-offset-units="1" />
    </TresMesh>
    <TresLineLoop v-for="(edge, i) in track.edges" :key="`e${i}`" :geometry="edge" :render-order="2">
      <TresLineBasicMaterial :color="EDGE" />
    </TresLineLoop>
    <TresMesh :geometry="finish" :render-order="3">
      <TresMeshBasicMaterial :color="FINISH" :side="2" :polygon-offset="true" :polygon-offset-factor="-2" :polygon-offset-units="-2" />
    </TresMesh>
    <template v-if="pit">
      <!-- El pit lane se dibuja primero y sin profundidad: donde se solapa con la pista, manda la pista. -->
      <TresMesh :geometry="pit.ribbon" :render-order="0" :frustum-culled="false">
        <TresMeshBasicMaterial :color="PIT" :transparent="true" :opacity="0.35" :side="2" :depth-test="false" :depth-write="false" />
      </TresMesh>
      <TresLine v-for="(edge, i) in pit.edges" :key="`p${i}`" :geometry="edge">
        <TresLineBasicMaterial :color="PIT" :transparent="true" :opacity="0.6" />
      </TresLine>
    </template>
  </TresGroup>
</template>
