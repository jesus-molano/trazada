<script setup lang="ts">
/**
 * Pista (cinta con color por altura), bordes, pit lane y línea de meta. Va dentro de TresCanvas.
 * La exageración de altura se aplica con la escala Y del grupo padre.
 *
 * Es lo único de la escena con niebla (ambiente, ítem 10, D37): sus materiales la usan (`fog: true`) y la niebla de la
 * escena (`scene-layers/TzSky.vue`) solo atenúa su parte lejana; coches, banderas, estelas y las demás capas no la
 * usan, así que conservan su color. De noche (sol por debajo del horizonte, según el ambiente) la pista se aclara un
 * poco hacia `--tz-track-night-tint`, como con focos: se recolorea solo al cambiar ese tono, nunca en cada frame.
 */
import { BufferAttribute, BufferGeometry, Color, DoubleSide, LineBasicMaterial, MeshBasicMaterial, SRGBColorSpace } from 'three'
import { setMapAttributes, useMapWidth } from '~/composables/useMapWidth'
import { useSceneAmbience } from '~/composables/useSceneAmbience'
import { useSceneFrame } from '~/composables/useSceneFrame'
import { token } from '~/design/tokens'
import type { CircuitModel } from '~/engine/track/circuit'
import { MIN_PIT_PX, MIN_TRACK_PX } from '~/engine/track/mapWidth'
import { buildRibbon, edgeNormal, toThree, TRACK_WIDTH_M } from '~/engine/track/ribbon'
import { getRuntime } from '~/stores/playback'

const props = defineProps<{ model: CircuitModel; flat: boolean }>()

const PIT_WIDTH_M = 9
const LOW = new Color(token('--tz-track-low'))
const HIGH = new Color(token('--tz-track-high'))
const EDGE = new Color(token('--tz-track-edge'))
const FINISH = token('--tz-track-finish')
const BG = token('--tz-scene-bg')
const PIT = token('--tz-pit')

/** Color por vértice de la cinta: de `low` a `high` según la altura (`shade`, 0…1). */
function shadeColors(shade: Float32Array, low: Color, high: Color, out: Float32Array) {
  const c = new Color()
  for (let i = 0; i < shade.length; i++) c.lerpColors(low, high, shade[i]!).toArray(out, i * 3)
}

function ribbonGeometry(width: number, path = props.model.centerline) {
  const r = buildRibbon(path, width, props.flat)
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(r.positions, 3))
  const colors = new Float32Array(r.shade.length * 3)
  shadeColors(r.shade, LOW, HIGH, colors)
  g.setAttribute('color', new BufferAttribute(colors, 3))
  g.setIndex(new BufferAttribute(r.indices, 1))
  setMapAttributes(g, r.mapCenter, r.mapNormal)
  const edges = (['left', 'right'] as const).map((side) => {
    const e = new BufferGeometry()
    e.setAttribute('position', new BufferAttribute(r[side], 3))
    setMapAttributes(e, r.center, edgeNormal(r, side))
    return e
  })
  return { ribbon: g, edges, shade: r.shade, colors }
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
    fog: true,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  }),
  TRACK_HALF,
  MIN_TRACK_PX,
)
const edgeMaterial = mapWidth(new LineBasicMaterial({ color: EDGE, fog: true }), TRACK_HALF, MIN_TRACK_PX)
const finishMaterial = mapWidth(
  new MeshBasicMaterial({
    color: FINISH,
    side: DoubleSide,
    fog: true,
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
const pitMaterial = mapWidth(new MeshBasicMaterial({ color: PIT_FILL, side: DoubleSide, depthWrite: false, fog: true }), PIT_HALF, MIN_PIT_PX)
const pitEdgeMaterial = mapWidth(new LineBasicMaterial({ color: PIT_EDGE, depthWrite: false, fog: true }), PIT_HALF, MIN_PIT_PX)

/**
 * Tono nocturno del ambiente: mezcla en sRGB (como un degradado CSS) hacia `--tz-track-night-tint`; con 0, los colores
 * de siempre, tal cual. Cambia por pasos de sol de 0,25°: unas pocas decenas de recoloreos en un crepúsculo.
 */
const NIGHT_TINT = new Color(token('--tz-track-night-tint'))
const ambience = useSceneAmbience()
const rt = getRuntime()!
const tinted = { low: new Color(), high: new Color() }
const srgbA = { r: 0, g: 0, b: 0 }
const srgbB = { r: 0, g: 0, b: 0 }
let tint = 0

function towardNight(base: Color, k: number, out: Color): Color {
  if (k === 0) return out.copy(base)
  base.getRGB(srgbA, SRGBColorSpace)
  NIGHT_TINT.getRGB(srgbB, SRGBColorSpace)
  return out.setRGB(srgbA.r + (srgbB.r - srgbA.r) * k, srgbA.g + (srgbB.g - srgbA.g) * k, srgbA.b + (srgbB.b - srgbA.b) * k, SRGBColorSpace)
}

function applyTint(k: number) {
  tint = k
  shadeColors(track.shade, towardNight(LOW, k, tinted.low), towardNight(HIGH, k, tinted.high), track.colors)
  track.ribbon.getAttribute('color').needsUpdate = true
  towardNight(EDGE, k, edgeMaterial.color)
  towardNight(PIT_FILL, k, pitMaterial.color)
  towardNight(PIT_EDGE, k, pitEdgeMaterial.color)
}

useSceneFrame(() => {
  const k = ambience?.look(rt.clock.timeMs)?.trackTint ?? 0
  if (k !== tint) applyTint(k)
})

onBeforeUnmount(() => {
  for (const g of [track.ribbon, ...track.edges, finish]) g.dispose()
  if (pit) for (const g of [pit.ribbon, ...pit.edges]) g.dispose()
  for (const m of [trackMaterial, edgeMaterial, finishMaterial, pitMaterial, pitEdgeMaterial]) m.dispose()
})

defineExpose({ trackWidth: TRACK_WIDTH_M })
</script>

<template>
  <TresGroup>
    <!-- Nombres: el ambiente comprueba con ellos que solo la pista usa la niebla (sceneStats.ambience.foggedObjects). -->
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
