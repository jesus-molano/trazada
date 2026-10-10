<script setup lang="ts">
/**
 * Los coches: un único InstancedMesh (1 draw call) con el color del equipo por instancia. Las matrices
 * se escriben en cada render desde el ReplayModel (sin reactividad). Va dentro de TresCanvas.
 */
import { useLoop } from '@tresjs/core'
import { BufferAttribute, BufferGeometry, Color, InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, Vector3 } from 'three'
import { sceneStats } from '~/replay/debug'
import { getRuntime, usePlaybackStore } from '~/stores/playback'

const props = defineProps<{ yScale: number; flat: boolean }>()

const rt = getRuntime()!
const playback = usePlaybackStore()
const states = rt.model.states

/** Cuña de 5,6 × 2 × 1 m apuntando a +x (sistema de three: Y arriba). */
function carGeometry(): BufferGeometry {
  const L = 5.6
  const W = 2
  const H = 1
  // Morro estrecho delante, alerón ancho detrás
  const v = [
    [L / 2, 0, -W * 0.15], [L / 2, 0, W * 0.15], [L / 2, H * 0.4, 0],
    [-L / 2, 0, -W / 2], [-L / 2, 0, W / 2], [-L / 2, H, -W / 2], [-L / 2, H, W / 2],
  ]
  const faces = [
    [0, 2, 1], [3, 4, 6], [3, 6, 5], // morro, trasera
    [0, 1, 4], [0, 4, 3], // suelo
    [1, 2, 6], [1, 6, 4], [0, 3, 5], [0, 5, 2], [2, 5, 6], // laterales y techo
  ]
  const pos = new Float32Array(faces.length * 9)
  faces.forEach((f, i) => f.forEach((vi, j) => pos.set(v[vi]!, i * 9 + j * 3)))
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(pos, 3))
  g.computeVertexNormals()
  return g
}

const geometry = carGeometry()
const material = new MeshBasicMaterial({ color: 0xffffff, depthTest: false })
const mesh = new InstancedMesh(geometry, material, states.length)
mesh.frustumCulled = false
mesh.renderOrder = 10
const color = new Color()
states.forEach((st, i) => mesh.setColorAt(i, color.set(st.driver?.color ?? '#9BA4B0')))
mesh.instanceColor!.needsUpdate = true
sceneStats.instances = mesh.count
sceneStats.instanceColors = states.map((_, i) => {
  mesh.getColorAt(i, color)
  return `#${color.getHexString().toUpperCase()}`
})
sceneStats.instanceCars = states.map((st) => st.car)

const m = new Matrix4()
const q = new Quaternion()
const p = new Vector3()
const sc = new Vector3()
const up = new Vector3(0, 1, 0)
const target = new Vector3()
/** Distancia de cámara a partir de la cual los coches dejan de encogerse en pantalla. */
const MIN_SIZE_DISTANCE = 450

const { onBeforeRender } = useLoop()
onBeforeRender(({ camera }) => {
  // Tamaño visual: real de cerca y con un mínimo en pantalla al alejarse (a escala de mapa, un coche
  // de 5,6 m no se vería). Es una exageración solo visual del tamaño, no de la posición.
  const cam = camera.value
  const yInv = 1 / Math.max(1e-3, props.yScale)
  for (let i = 0; i < states.length; i++) {
    const st = states[i]!
    if (!st.visible) {
      m.makeScale(0, 0, 0)
    } else {
      const selected = playback.selectedCar === st.car ? 1.35 : 1
      p.set(st.x, (props.flat ? 0 : st.z) + 0.6 * yInv, -st.y)
      q.setFromAxisAngle(up, st.heading)
      const k = cam ? Math.max(1, cam.position.distanceTo(target.set(p.x, p.y * props.yScale, p.z)) / MIN_SIZE_DISTANCE) : 1
      sc.set(k * selected, k * selected * yInv, k * selected)
      m.compose(p, q, sc)
    }
    mesh.setMatrixAt(i, m)
  }
  mesh.instanceMatrix.needsUpdate = true
})

onBeforeUnmount(() => {
  geometry.dispose()
  material.dispose()
  mesh.dispose()
})
</script>

<template>
  <primitive :object="mesh" />
</template>
