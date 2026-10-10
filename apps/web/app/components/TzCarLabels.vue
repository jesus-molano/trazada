<script setup lang="ts">
/**
 * Siglas de los coches en DOM, sobre el lienzo. Se reposicionan en cada render con `transform`
 * (sin reactividad por frame). Un clic selecciona el coche.
 */
import { type Camera, Vector3 } from 'three'
import type { CarState } from '~/engine/replay/ReplayModel'
import { usePlaybackStore } from '~/stores/playback'

const props = defineProps<{ states: CarState[] }>()
const playback = usePlaybackStore()
const root = ref<HTMLElement | null>(null)
const v = new Vector3()

function update(camera: Camera, width: number, height: number, yScale: number, flat: boolean): void {
  const nodes = root.value?.children
  if (!nodes) return
  for (let i = 0; i < props.states.length; i++) {
    const st = props.states[i]!
    const node = nodes[i] as HTMLElement | undefined
    if (!node) continue
    if (!st.visible) {
      node.style.visibility = 'hidden'
      continue
    }
    v.set(st.x, (flat ? 0 : st.z) * yScale, -st.y).project(camera)
    const onScreen = v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05
    node.style.visibility = onScreen ? 'visible' : 'hidden'
    if (onScreen) {
      node.style.transform = `translate3d(${((v.x + 1) / 2) * width}px, ${((1 - v.y) / 2) * height - 14}px, 0) translate(-50%, -100%)`
    }
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
      :style="{ '--team': st.driver?.color ?? '#9BA4B0' }"
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
  background: rgb(17 20 26 / 0.82);
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
