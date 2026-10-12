<script setup lang="ts">
/**
 * Detalle del trazado (D50, lámina 5 «Herramienta pro»), debajo de la pista:
 *
 * - **Relieve**: faldones desde cada borde de la cinta hasta el suelo (el punto más bajo del circuito), que se funden
 *   con el fondo entre 4 y 30 m por debajo de la pista. La altura es dato: dejan leer los desniveles y los cruces
 *   (Suzuka). Con la anchura de mapa de la pista (mismo shader): caen a plomo desde el borde que se ve. Con la pista
 *   plana, no hay. 1 draw call.
 * - **Retícula**: el suelo con líneas cada 100 m (y algo más marcadas cada 500 m) que se desvanecen lejos del circuito.
 *   Decorativa (la escala sí es la real): lo dice «Cómo se dibuja». 1 draw call, 2 triángulos.
 *
 * Las dos se apagan en «Capas» (`stores/trackDetail.ts`). Geometría estática: ningún uniform por frame. La retícula va
 * en la lista opaca con mezcla (no en la transparente): se pinta antes que el pit lane, que no escribe profundidad y
 * la tapa.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CustomBlending,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  OneMinusSrcAlphaFactor,
  PlaneGeometry,
  ShaderMaterial,
  SrcAlphaFactor,
  Vector3,
} from 'three'
import { useMapWidth } from '~/composables/useMapWidth'
import { token } from '~/design/tokens'
import type { CircuitModel } from '~/engine/track/circuit'
import { buildSkirts, GROUND_MARGIN_M, planCircle, SKIRT_FADE_M } from '~/engine/track/detail'
import { MIN_TRACK_PX } from '~/engine/track/mapWidth'
import { buildRibbon, TRACK_WIDTH_M } from '~/engine/track/ribbon'
import { registerSceneStat } from '~/replay/debug'
import { getRuntime } from '~/stores/playback'
import { useTrackDetailStore } from '~/stores/trackDetail'

const props = defineProps<{ model: CircuitModel; flat: boolean; yScale: number }>()

const rt = getRuntime()!
const detail = useTrackDetailStore()
detail.hydrate()

const ribbon = buildRibbon(props.model.centerline, TRACK_WIDTH_M, props.flat)

// ── Faldones: color por vértice, del tono del faldón al fondo según lo que baja (fundido entre 4 y 30 m).
const skirts = buildSkirts(props.model.centerline, ribbon, props.flat, props.flat ? -GROUND_MARGIN_M : undefined)
const SKIRT_TOP = new Color(token('--tz-track-skirt'))
const BG = new Color(token('--tz-scene-bg'))
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const skirtColors = new Float32Array(skirts.depth.length * 3)
const c = new Color()
for (let i = 0; i < skirts.depth.length; i++) {
  c.lerpColors(SKIRT_TOP, BG, smooth(SKIRT_FADE_M[0], SKIRT_FADE_M[1], skirts.depth[i]!)).toArray(skirtColors, i * 3)
}
const skirtGeometry = new BufferGeometry()
skirtGeometry.setAttribute('position', new BufferAttribute(skirts.positions, 3))
skirtGeometry.setAttribute('color', new BufferAttribute(skirtColors, 3))
skirtGeometry.setAttribute('mapCenter', new BufferAttribute(skirts.mapCenter, 3))
skirtGeometry.setAttribute('mapNormal', new BufferAttribute(skirts.mapNormal, 3))
skirtGeometry.setIndex(new BufferAttribute(skirts.indices, 1))
const skirtTriangles = skirts.indices.length / 3

const mapWidth = useMapWidth()
const skirtMaterial = mapWidth(new MeshBasicMaterial({ vertexColors: true, side: DoubleSide }), TRACK_WIDTH_M / 2, MIN_TRACK_PX)
const skirtMesh = new Mesh(skirtGeometry, skirtMaterial)
skirtMesh.name = 'track-skirts'
skirtMesh.renderOrder = 0
skirtMesh.frustumCulled = false

// ── Retícula: un plano en el suelo, con las líneas y el desvanecido en el shader (escala real: 100 y 500 m).
const plan = planCircle(ribbon)
const gridGeometry = new PlaneGeometry(plan.radius * 5, plan.radius * 5)
gridGeometry.rotateX(-Math.PI / 2)
const gridMaterial = new ShaderMaterial({
  // En la lista opaca, con mezcla: ver arriba.
  transparent: false,
  blending: CustomBlending,
  blendSrc: SrcAlphaFactor,
  blendDst: OneMinusSrcAlphaFactor,
  depthWrite: false,
  uniforms: {
    uCenter: { value: new Vector3(plan.x, 0, plan.z) },
    uRadius: { value: plan.radius },
    uColor: { value: new Color(token('--tz-paint')) },
  },
  vertexShader: /* glsl */ `
    varying vec3 vWorld;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      vWorld = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uCenter;
    uniform float uRadius;
    uniform vec3 uColor;
    varying vec3 vWorld;
    // Línea de 1 px (con suavizado) cada \`step\` metros.
    float line(float x, float step) {
      float d = abs(fract(x / step - 0.5) - 0.5) * step;
      return 1.0 - smoothstep(0.0, fwidth(x) * 1.2, d);
    }
    void main() {
      float g = max(line(vWorld.x, 100.0), line(vWorld.z, 100.0)) * 0.07
        + max(line(vWorld.x, 500.0), line(vWorld.z, 500.0)) * 0.06;
      float r = length(vWorld.xz - uCenter.xz);
      float fade = 1.0 - smoothstep(uRadius * 0.6, uRadius * 1.6, r);
      gl_FragColor = vec4(uColor, g * fade);
      #include <colorspace_fragment>
    }`,
})
const gridMesh = new Mesh(gridGeometry, gridMaterial)
gridMesh.name = 'track-grid'
gridMesh.position.set(plan.x, skirts.groundY, plan.z)
gridMesh.renderOrder = -2
gridMesh.frustumCulled = false

/** Lo que pinta (`sceneStats.trackDetail`). */
const offStat = registerSceneStat('trackDetail', () => {
  const relief = skirtMesh.visible && skirtTriangles > 0
  return {
    relief,
    grid: gridMesh.visible,
    drawCalls: (relief ? 1 : 0) + (gridMesh.visible ? 1 : 0),
    triangles: (relief ? skirtTriangles : 0) + (gridMesh.visible ? 2 : 0),
  }
})

watch(
  () => [detail.relief, detail.grid] as const,
  ([relief, grid]) => {
    skirtMesh.visible = relief && skirtTriangles > 0
    gridMesh.visible = grid
    rt.requestFrame()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  offStat()
  for (const g of [skirtGeometry, gridGeometry]) g.dispose()
  for (const m of [skirtMaterial, gridMaterial]) m.dispose()
})
</script>

<script lang="ts">
/** Orden de pintado (plan §3): la retícula, lo primero (−2); los faldones, con la cinta (0). */
export const renderOrder = -2
</script>

<template>
  <primitive :object="gridMesh" />
  <primitive :object="skirtMesh" />
</template>
