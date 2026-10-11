<script setup lang="ts">
/**
 * Cielo y niebla del ambiente (ítem 10, D37). Decorativo: sigue la posición del sol en el circuito a esa hora (hora UTC
 * de la sesión y centro del circuito, `composables/useSceneAmbience.ts`), no el tiempo atmosférico.
 *
 * - Cielo: una esfera alrededor de la cámara (~1k triángulos, 1 draw call) con un degradado por vértice que solo
 *   depende de la altura de cada dirección (`backdropColor`): del horizonte al cénit por encima y hacia un «suelo»
 *   oscuro por debajo, que es lo que hay detrás de la pista en la vista general. Se pinta la primera (renderOrder −10),
 *   sin profundidad ni niebla y sin tone mapping (los colores son los tokens), y la escena va encima.
 * - Niebla: la de three.js, lineal, con la profundidad de la pista vista desde la cámara: 0 en su parte más cercana y
 *   `FOG_MAX` en la más lejana. Solo se recalcula si la cámara (posición, giro o plano near) o la escala de altura
 *   cambiaron desde la última vez (`sceneStats.ambience.computes`). Solo la usan los materiales de la pista
 *   (TzTrack.vue); todo lo demás declara `fog: false` (lo comprueba `sceneStats.ambience.foggedObjects` en los e2e).
 *
 * Sin dato de ubicación o de hora, o con el ambiente apagado: ni cielo ni niebla (0 draw calls) y se ve el fondo neutro
 * de siempre (`--tz-scene-bg`). No pide frames: se prepara antes de los renders que ya hay (reproducción, seek, cámara;
 * `useSceneFrame`, nada en pausa ni con la escena tapada) y solo recolorea al cambiar de paso de sol.
 */
import { useTres } from '@tresjs/core'
import {
  BackSide,
  BufferAttribute,
  Color,
  Fog,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  type PerspectiveCamera,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three'
import { useSceneAmbience } from '~/composables/useSceneAmbience'
import { useSceneFrame } from '~/composables/useSceneFrame'
import { type AmbienceLook, backdropColor, FOG_MAX, fogRange } from '~/engine/ambience/ambience'
import type { CircuitModel } from '~/engine/track/circuit'
import { registerSceneStat } from '~/replay/debug'
import { getRuntime } from '~/stores/playback'

const props = defineProps<{ model: CircuitModel; flat: boolean; yScale: number }>()

const rt = getRuntime()!
const ambience = useSceneAmbience()!
const { scene } = useTres()

/** Esfera de 16 × 32 segmentos: bandas de ~5,6° de altura (el degradado entre vértices es lineal) y 992 triángulos. */
const geometry = new SphereGeometry(1, 16, 32)
const position = geometry.getAttribute('position')
const colors = new Float32Array(position.count * 3)
const colorAttr = new BufferAttribute(colors, 3)
geometry.setAttribute('color', colorAttr)
/** Altura (°) de cada vértice visto desde el centro. */
const elevations = Float32Array.from({ length: position.count }, (_, i) => (Math.asin(Math.min(1, Math.max(-1, position.getY(i)))) * 180) / Math.PI)
const triangles = (geometry.index?.count ?? position.count) / 3

const material = new MeshBasicMaterial({
  vertexColors: true,
  side: BackSide,
  depthTest: false,
  depthWrite: false,
  fog: false,
  toneMapped: false,
})
const mesh = new Mesh(geometry, material)
mesh.name = 'ambience-sky'
mesh.renderOrder = renderOrder
mesh.frustumCulled = false
mesh.visible = false

/** Niebla de la escena mientras haya ambiente (su color, el de `--tz-fog`, lo pone `paint`). */
const fog = new Fog(new Color(), 1, 2)

/** Eje de la pista cada ~20 m (canónico x, y, z): la profundidad que cubre la niebla. */
const footprint = (() => {
  const path = props.model.centerline
  const step = Math.max(1, Math.round(path.count / 400))
  const out: number[] = []
  const p = { x: 0, y: 0, z: 0 }
  for (let i = 0; i < path.count; i += step) {
    path.vertex(i, p)
    out.push(p.x, p.y, p.z)
  }
  return new Float32Array(out)
})()

const color = new Color()
let painted: AmbienceLook | null = null

/** Colores del cielo y de la niebla para un paso de sol (solo cuando cambia). */
function paint(look: AmbienceLook) {
  for (let i = 0; i < elevations.length; i++) {
    const c = backdropColor(look, elevations[i]!)
    color.setRGB(c[0], c[1], c[2], SRGBColorSpace).toArray(colors, i * 3)
  }
  colorAttr.needsUpdate = true
  fog.color.setRGB(look.fog[0], look.fog[1], look.fog[2], SRGBColorSpace)
  painted = look
}

/** Lo que pintó el último render (`sceneStats.ambience`). */
const stats = {
  shown: false,
  phase: null as AmbienceLook['phase'] | null,
  sunDeg: null as number | null,
  trackTint: 0,
  fog: null as null | { near: number; far: number; max: number },
  /** Veces que se recalculó la niebla (solo al moverse la cámara o cambiar la escala de altura). */
  computes: 0,
  drawCalls: 0,
  triangles: 0,
}

/** Objetos visibles cuyo material usa la niebla de la escena (con niebla activa): solo deberían ser los de la pista. */
function foggedObjects(): string[] {
  const s = scene.value
  if (!s.fog) return []
  const out = new Set<string>()
  s.traverseVisible((o: Object3D) => {
    const m = (o as Object3D & { material?: Material | Material[] }).material
    if (!m) return
    const fogged = (x: Material & { fog?: boolean }) => x.fog === true && x.visible
    if ((Array.isArray(m) ? m : [m]).some(fogged)) out.add(o.name || o.type)
  })
  return [...out].sort()
}

const offStat = registerSceneStat('ambience', () => ({
  ...stats,
  status: ambience.status,
  enabled: ambience.enabled,
  fogged: material.fog,
  foggedObjects: foggedObjects(),
}))

/** Cámara (matriz y plano near) y escala de altura con las que se calculó la niebla; NaN: hay que calcularla. */
const fogCamera = new Matrix4()
let fogNear = Number.NaN
let fogScale = Number.NaN
let range: { near: number; far: number } | null = null

function hide() {
  fogNear = Number.NaN
  mesh.visible = false
  if (scene.value.fog === fog) scene.value.fog = null
  stats.shown = false
  stats.phase = null
  stats.sunDeg = null
  stats.trackTint = 0
  stats.fog = null
  stats.drawCalls = 0
  stats.triangles = 0
}

const camPos = new Vector3()
const forward = new Vector3()
useSceneFrame(({ camera }) => {
  const cam = camera as PerspectiveCamera | undefined
  const look = ambience.look(rt.clock.timeMs)
  if (!look || !cam) {
    if (mesh.visible || stats.shown) hide()
    return
  }
  if (look !== painted) paint(look)

  // Esfera centrada en la cámara, entre sus planos near y far. Va en el grupo con la escala de altura: se compensa
  // para que en el mundo sea una esfera (la altura de cada dirección, la de verdad).
  const k = Math.max(1e-3, props.yScale)
  const r = (cam.near + cam.far) / 2
  cam.getWorldPosition(camPos)
  cam.getWorldDirection(forward)
  mesh.position.set(camPos.x, camPos.y / k, camPos.z)
  mesh.scale.set(r, r / k, r)
  mesh.visible = true

  // Niebla: de la parte más cercana a la más lejana de la pista, a lo largo de la vista (la profundidad de three). Solo
  // depende de la cámara (su matriz ya está al día: la han actualizado getWorldPosition/getWorldDirection) y de la escala.
  if (k !== fogScale || cam.near !== fogNear || !cam.matrixWorld.equals(fogCamera)) {
    fogScale = k
    fogNear = cam.near
    fogCamera.copy(cam.matrixWorld)
    let near = Number.POSITIVE_INFINITY
    let far = Number.NEGATIVE_INFINITY
    for (let i = 0; i < footprint.length; i += 3) {
      const x = footprint[i]!
      const y = props.flat ? 0 : footprint[i + 2]! * k
      const z = -footprint[i + 1]!
      const d = (x - camPos.x) * forward.x + (y - camPos.y) * forward.y + (z - camPos.z) * forward.z
      if (d < near) near = d
      if (d > far) far = d
    }
    range = fogRange(Math.max(cam.near, near), far)
    stats.fog = range ? { near: range.near, far: range.far, max: FOG_MAX } : null
    stats.computes++
  }
  if (range) {
    fog.near = range.near
    fog.far = range.far
    if (scene.value.fog !== fog) scene.value.fog = fog
  } else if (scene.value.fog === fog) scene.value.fog = null

  stats.shown = true
  stats.phase = look.phase
  stats.sunDeg = look.sunDeg
  stats.trackTint = look.trackTint
  stats.drawCalls = 1
  stats.triangles = triangles
})

onBeforeUnmount(() => {
  offStat()
  if (scene.value.fog === fog) scene.value.fog = null
  geometry.dispose()
  material.dispose()
})
</script>

<script lang="ts">
/** Orden de pintado (plan §3): el cielo, lo primero de todo (debajo del pit lane, −1, y de la cinta). */
export const renderOrder = -10
</script>

<template>
  <primitive :object="mesh" />
</template>
