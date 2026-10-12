<script setup lang="ts">
/**
 * Pista (cinta con color por altura), bordes, pit lane y línea de meta. Va dentro de TresCanvas.
 * La exageración de altura se aplica con la escala Y del grupo padre.
 *
 * Sentido de la marcha (D50, lámina 5): chevrones tenues de pintura cada `CHEVRON_EVERY_M` sobre la cinta, en el sentido
 * de s creciente (el de la carrera), pintados en el shader con la distancia recorrida de cada vértice (`seamRibbon`:
 * sin salto de s en la meta). De lejos, cuando un píxel cubre más de un par de metros, se desvanecen (serían ruido).
 */
import { BufferAttribute, BufferGeometry, Color, DoubleSide, LineBasicMaterial, MeshBasicMaterial, type WebGLProgramParametersWithUniforms } from 'three'
import { setMapAttributes, useMapWidth } from '~/composables/useMapWidth'
import { token } from '~/design/tokens'
import type { CircuitModel } from '~/engine/track/circuit'
import { CHEVRON_EVERY_M, seamRibbon } from '~/engine/track/detail'
import { MIN_PIT_PX, MIN_TRACK_PX } from '~/engine/track/mapWidth'
import { buildRibbon, edgeNormal, toThree, TRACK_WIDTH_M } from '~/engine/track/ribbon'

const props = defineProps<{ model: CircuitModel; flat: boolean }>()

const PIT_WIDTH_M = 9
const LOW = new Color(token('--tz-track-low'))
const HIGH = new Color(token('--tz-track-high'))
const EDGE = new Color(token('--tz-track-edge'))
const FINISH = token('--tz-track-finish')
const BG = token('--tz-scene-bg')
const PIT = token('--tz-pit')
const PAINT = new Color(token('--tz-paint'))

/** Color por vértice de la cinta: de `low` a `high` según la altura (`shade`, 0…1). */
function shadeColors(shade: Float32Array, low: Color, high: Color, out: Float32Array) {
  const c = new Color()
  for (let i = 0; i < shade.length; i++) c.lerpColors(low, high, shade[i]!).toArray(out, i * 3)
}

function ribbonGeometry(width: number, path = props.model.centerline) {
  const r = buildRibbon(path, width, props.flat)
  // Con la distancia recorrida y el lado de cada vértice (los chevrones de sentido) y la costura de la meta cerrada.
  const seam = seamRibbon(path, r)
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(seam.positions, 3))
  const colors = new Float32Array(seam.shade.length * 3)
  shadeColors(seam.shade, LOW, HIGH, colors)
  g.setAttribute('color', new BufferAttribute(colors, 3))
  g.setAttribute('tzAlong', new BufferAttribute(seam.along, 1))
  g.setAttribute('tzAcross', new BufferAttribute(seam.across, 1))
  g.setIndex(new BufferAttribute(seam.indices, 1))
  setMapAttributes(g, seam.mapCenter, seam.mapNormal)
  const edges = (['left', 'right'] as const).map((side) => {
    const e = new BufferGeometry()
    e.setAttribute('position', new BufferAttribute(r[side], 3))
    setMapAttributes(e, r.center, edgeNormal(r, side))
    return e
  })
  return { ribbon: g, edges }
}

const track = ribbonGeometry(TRACK_WIDTH_M)
const pit = props.model.pitlane ? ribbonGeometry(PIT_WIDTH_M, props.model.pitlane) : null

/**
 * Línea de meta: un rectángulo a través de la pista en s = 0, 1 m más ancho que ella a cada lado y de 2 m
 * de largo; si la pista se ensancha en pantalla, crece con ella (a lo largo, 1/7 de lo que crece a lo ancho).
 */
function finishLine(): BufferGeometry {
  const p = props.model.centerline.sample(0, { x: 0, y: 0, z: 0, tx: 1, ty: 0 })
  const nx = -p.ty
  const ny = p.tx
  const half = TRACK_WIDTH_M / 2 + 1
  const z = (props.flat ? 0 : p.z) + 0.05
  const pos = new Float32Array(12)
  const center = new Float32Array(12)
  const normal = new Float32Array(12)
  const along = new Float32Array(12)
  const corners: [number, number][] = [
    [1, -1],
    [-1, -1],
    [1, 1],
    [-1, 1],
  ]
  corners.forEach(([side, dir], i) => {
    toThree(p.x + side * nx * half + dir * p.tx, p.y + side * ny * half + dir * p.ty, z, pos, i * 3)
    toThree(p.x, p.y, z, center, i * 3)
    // Direcciones en planta (canónico → three): (x, y) → (x, 0, −y).
    normal.set([side * nx, 0, -side * ny], i * 3)
    along.set([(dir * p.tx) / 7, 0, (-dir * p.ty) / 7], i * 3)
  })
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(pos, 3))
  g.setIndex([0, 1, 2, 1, 3, 2])
  setMapAttributes(g, center, normal, along)
  return g
}
const finish = finishLine()

/**
 * Chevrones de sentido en la cinta (ver arriba): una «V» que apunta hacia s creciente en los últimos 26 m de cada
 * tramo de `CHEVRON_EVERY_M`, mezclada con la pintura al 28 %. Se suma a la anchura de mapa (`useMapWidth`).
 */
const CHEVRON_GLSL = /* glsl */ `
{
  float m = mod(vTzAlong, tzChevronEvery);
  float u = m - (tzChevronEvery - 26.0);
  float av = abs(vTzAcross);
  float target = 22.0 * (1.0 - av / 0.62);
  float chev = (u > 0.0 && av < 0.62) ? 1.0 - smoothstep(3.0, 5.5, abs(u - target)) : 0.0;
  chev *= 1.0 - smoothstep(0.6, 2.0, fwidth(vTzAlong));
  diffuseColor.rgb = mix(diffuseColor.rgb, tzPaint, 0.28 * chev);
}
`
function withChevrons(material: MeshBasicMaterial) {
  const base = material.onBeforeCompile.bind(material)
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer) => {
    base(shader, renderer)
    shader.uniforms.tzPaint = { value: PAINT }
    shader.uniforms.tzChevronEvery = { value: CHEVRON_EVERY_M }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float tzAlong;\nattribute float tzAcross;\nvarying float vTzAlong;\nvarying float vTzAcross;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTzAlong = tzAlong;\nvTzAcross = tzAcross;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 tzPaint;\nuniform float tzChevronEvery;\nvarying float vTzAlong;\nvarying float vTzAcross;')
      .replace('#include <color_fragment>', `#include <color_fragment>\n${CHEVRON_GLSL}`)
  }
  // Otro programa que el de la anchura de mapa sola (las demás cintas no llevan chevrones).
  material.customProgramCacheKey = () => 'tz-map-width-chevrons'
}

// Anchura de mapa (en el shader): la genérica de 14 m de cerca y un mínimo en pantalla al alejarse (si no, a escala de
// circuito, un hilo). Pista, bordes y meta comparten parámetros: se ensanchan juntos.
const mapWidth = useMapWidth()
const TRACK_HALF = TRACK_WIDTH_M / 2
const PIT_HALF = PIT_WIDTH_M / 2
// polygonOffset: los bordes (líneas coplanarias) quedan siempre por encima de la cinta.
const trackMaterial = mapWidth(
  new MeshBasicMaterial({
    vertexColors: true,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  }),
  TRACK_HALF,
  MIN_TRACK_PX,
)
withChevrons(trackMaterial)
const edgeMaterial = mapWidth(new LineBasicMaterial({ color: EDGE }), TRACK_HALF, MIN_TRACK_PX)
const finishMaterial = mapWidth(
  new MeshBasicMaterial({
    color: FINISH,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  }),
  TRACK_HALF,
  MIN_TRACK_PX,
  true,
)
// Pit lane: opaco (color ya mezclado con el fondo) y dibujado antes que todo, sin escribir profundidad: donde
// se solapa con la pista, la meta o los coches, mandan ellos.
const PIT_FILL = new Color(BG).lerp(new Color(PIT), 0.35)
const PIT_EDGE = new Color(BG).lerp(new Color(PIT), 0.6)
const pitMaterial = mapWidth(new MeshBasicMaterial({ color: PIT_FILL, side: DoubleSide, depthWrite: false }), PIT_HALF, MIN_PIT_PX)
const pitEdgeMaterial = mapWidth(new LineBasicMaterial({ color: PIT_EDGE, depthWrite: false }), PIT_HALF, MIN_PIT_PX)

onBeforeUnmount(() => {
  for (const g of [track.ribbon, ...track.edges, finish]) g.dispose()
  if (pit) for (const g of [pit.ribbon, ...pit.edges]) g.dispose()
  for (const m of [trackMaterial, edgeMaterial, finishMaterial, pitMaterial, pitEdgeMaterial]) m.dispose()
})

defineExpose({ trackWidth: TRACK_WIDTH_M })
</script>

<template>
  <TresGroup>
    <template v-if="pit">
      <TresMesh name="pit-ribbon" :geometry="pit.ribbon" :material="pitMaterial" :render-order="-1" :frustum-culled="false" />
      <TresLine
        v-for="(edge, i) in pit.edges"
        :key="`p${i}`"
        name="pit-edge"
        :geometry="edge"
        :material="pitEdgeMaterial"
        :render-order="-1"
        :frustum-culled="false"
      />
    </template>
    <TresMesh name="track-ribbon" :geometry="track.ribbon" :material="trackMaterial" :render-order="1" :frustum-culled="false" />
    <TresLineLoop
      v-for="(edge, i) in track.edges"
      :key="`e${i}`"
      name="track-edge"
      :geometry="edge"
      :material="edgeMaterial"
      :render-order="2"
      :frustum-culled="false"
    />
    <TresMesh name="track-finish" :geometry="finish" :material="finishMaterial" :render-order="3" :frustum-culled="false" />
  </TresGroup>
</template>
