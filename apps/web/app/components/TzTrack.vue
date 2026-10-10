<script setup lang="ts">
/**
 * Pista (cinta con color por altura), bordes, pit lane y línea de meta. Va dentro de TresCanvas.
 * La exageración de altura se aplica con la escala Y del grupo padre.
 */
import { BufferAttribute, BufferGeometry, Color } from 'three'
import type { CircuitModel } from '~/engine/track/circuit'
import { buildRibbon, toThree, TRACK_WIDTH_M } from '~/engine/track/ribbon'

const props = defineProps<{ model: CircuitModel; flat: boolean }>()

const PIT_WIDTH_M = 9
const LOW = new Color('#1c222b')
const HIGH = new Color('#3d495c')

function ribbonGeometry(width: number, path = props.model.centerline) {
  const r = buildRibbon(path, width, props.flat)
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(r.positions, 3))
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
  return { ribbon: g, edges }
}

const track = shallowRef(ribbonGeometry(TRACK_WIDTH_M))
const pit = shallowRef(props.model.pitlane ? ribbonGeometry(PIT_WIDTH_M, props.model.pitlane) : null)

/** Línea de meta: un rectángulo de 2 m a través de la pista en s = 0. */
const finish = shallowRef<BufferGeometry>(finishLine())
function finishLine(): BufferGeometry {
  const p = props.model.centerline.sample(0, { x: 0, y: 0, z: 0, tx: 1, ty: 0 })
  const nx = -p.ty
  const ny = p.tx
  const half = TRACK_WIDTH_M / 2 + 1
  const z = (props.flat ? 0 : p.z) + 0.05
  const pos = new Float32Array(12)
  const corners: [number, number][] = [
    [p.x + nx * half - p.tx, p.y + ny * half - p.ty],
    [p.x - nx * half - p.tx, p.y - ny * half - p.ty],
    [p.x + nx * half + p.tx, p.y + ny * half + p.ty],
    [p.x - nx * half + p.tx, p.y - ny * half + p.ty],
  ]
  corners.forEach(([x, y], i) => toThree(x, y, z, pos, i * 3))
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(pos, 3))
  g.setIndex([0, 1, 2, 1, 3, 2])
  return g
}

onBeforeUnmount(() => {
  for (const g of [track.value.ribbon, ...track.value.edges, finish.value]) g.dispose()
  if (pit.value) for (const g of [pit.value.ribbon, ...pit.value.edges]) g.dispose()
})

defineExpose({ trackWidth: TRACK_WIDTH_M })
</script>

<template>
  <TresGroup>
    <!-- polygonOffset: los bordes (líneas coplanarias) quedan siempre por encima de la cinta -->
    <TresMesh :geometry="track.ribbon" :render-order="1">
      <TresMeshBasicMaterial vertex-colors :side="2" :polygon-offset="true" :polygon-offset-factor="1" :polygon-offset-units="1" />
    </TresMesh>
    <TresLineLoop v-for="(edge, i) in track.edges" :key="`e${i}`" :geometry="edge" :render-order="2">
      <TresLineBasicMaterial color="#6b778a" />
    </TresLineLoop>
    <TresMesh :geometry="finish" :render-order="3">
      <TresMeshBasicMaterial color="#e8ebf0" :side="2" :polygon-offset="true" :polygon-offset-factor="-2" :polygon-offset-units="-2" />
    </TresMesh>
    <template v-if="pit">
      <!-- El pit lane se dibuja primero y sin profundidad: donde se solapa con la pista, manda la pista. -->
      <TresMesh :geometry="pit.ribbon" :render-order="0">
        <TresMeshBasicMaterial color="#a78bfa" :transparent="true" :opacity="0.35" :side="2" :depth-test="false" :depth-write="false" />
      </TresMesh>
      <TresLine v-for="(edge, i) in pit.edges" :key="`p${i}`" :geometry="edge">
        <TresLineBasicMaterial color="#a78bfa" :transparent="true" :opacity="0.6" />
      </TresLine>
    </template>
  </TresGroup>
</template>
