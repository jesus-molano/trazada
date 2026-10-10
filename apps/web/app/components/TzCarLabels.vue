<script setup lang="ts">
/**
 * Siglas de los coches en DOM, sobre el lienzo. Se reposicionan en cada render con `transform`
 * (sin reactividad por frame). Un clic selecciona el coche.
 *
 * Sin amontonarse: si dos siglas se pisan, se muestra la del coche que va por delante (y siempre la del
 * coche elegido); el coche se sigue dibujando y se puede elegir en la clasificación o con un clic.
 */
import { type Camera, Vector3 } from 'three'
import type { CarState } from '~/engine/replay/ReplayModel'
import { usePlaybackStore } from '~/stores/playback'

const props = defineProps<{ states: CarState[]; offsets: Float32Array }>()
const playback = usePlaybackStore()
const root = ref<HTMLElement | null>(null)
const v = new Vector3()

/** Separación de la sigla sobre el coche (px) y holgura entre siglas. */
const LIFT_PX = 14
const GAP_PX = 2
const sx: number[] = []
const sy: number[] = []
const on: boolean[] = []
const order: number[] = []
const placed: number[] = []
/** Tamaño de cada sigla: el texto no cambia, se mide una vez (leerlo en cada frame forzaría el layout). */
const sizes = new WeakMap<HTMLElement, [number, number]>()

function sizeOf(node: HTMLElement): [number, number] {
  let s = sizes.get(node)
  if (!s || s[0] === 0) {
    s = [node.offsetWidth, node.offsetHeight]
    sizes.set(node, s)
  }
  return s
}

function update(camera: Camera, width: number, height: number, yScale: number, flat: boolean): void {
  const nodes = root.value?.children
  if (!nodes) return
  const n = props.states.length
  order.length = 0
  for (let i = 0; i < n; i++) {
    const st = props.states[i]!
    on[i] = false
    if (!st.visible || !nodes[i]) continue
    const o = props.offsets[i]!
    v.set(st.x - Math.sin(st.heading) * o, (flat ? 0 : st.z) * yScale, -(st.y + Math.cos(st.heading) * o)).project(camera)
    on[i] = v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05
    sx[i] = ((v.x + 1) / 2) * width
    sy[i] = ((1 - v.y) / 2) * height - LIFT_PX
    order.push(i)
  }
  // Prioridad: el coche elegido y, después, el que va por delante (más distancia recorrida).
  const selected = playback.selectedCar
  order.sort((a, b) => {
    const sa = props.states[a]!
    const sb = props.states[b]!
    if ((sa.car === selected) !== (sb.car === selected)) return sa.car === selected ? -1 : 1
    return sb.s - sa.s
  })
  placed.length = 0
  for (let i = 0; i < n; i++) {
    const node = nodes[i] as HTMLElement | undefined
    if (node && !on[i]) node.style.visibility = 'hidden'
  }
  for (const i of order) {
    const node = nodes[i] as HTMLElement
    if (!on[i]) continue
    const [w, h] = sizeOf(node)
    const x0 = sx[i]! - w / 2
    const x1 = sx[i]! + w / 2
    const y0 = sy[i]! - h
    const y1 = sy[i]!
    let free = props.states[i]!.car === selected
    if (!free) {
      free = true
      for (let k = 0; k < placed.length; k += 4) {
        if (x0 < placed[k + 2]! + GAP_PX && x1 > placed[k]! - GAP_PX && y0 < placed[k + 3]! + GAP_PX && y1 > placed[k + 1]! - GAP_PX) {
          free = false
          break
        }
      }
    }
    node.style.visibility = free ? 'visible' : 'hidden'
    if (!free) continue
    placed.push(x0, y0, x1, y1)
    node.style.transform = `translate3d(${sx[i]}px, ${sy[i]}px, 0) translate(-50%, -100%)`
  }
}

defineExpose({ update })
</script>

<template>
  <div ref="root" class="tz-cars" data-testid="car-labels">
    <button
      v-for="st in states"
      :key="st.car"
      type="button"
      class="tz-car"
      :class="{ 'is-selected': playback.selectedCar === st.car }"
      :style="{ '--team': st.driver?.color ?? 'var(--tz-team-unknown)' }"
      :data-car="st.car"
      :aria-label="st.driver ? `${st.driver.first} ${st.driver.last}` : st.car"
      :aria-pressed="playback.selectedCar === st.car"
      tabindex="-1"
      @click="playback.selectCar(playback.selectedCar === st.car ? null : st.car)"
    >
      {{ st.driver?.tla ?? st.car }}
    </button>
  </div>
</template>

<style scoped>
.tz-cars {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.tz-car {
  position: absolute;
  left: 0;
  top: 0;
  visibility: hidden;
  padding: 1px 5px 1px 6px;
  border: 0;
  border-left: 3px solid var(--team);
  border-radius: var(--tz-radius-sm);
  background: var(--tz-label-bg);
  color: var(--tz-text);
  font-family: var(--tz-font-mono);
  font-size: var(--tz-text-2xs);
  font-weight: var(--tz-weight-semibold);
  letter-spacing: 0.04em;
  white-space: nowrap;
  cursor: pointer;
  pointer-events: auto;
  will-change: transform;
}

.tz-car.is-selected {
  z-index: 1;
  outline: 1px solid var(--team);
  background: var(--tz-surface-3);
}
</style>
