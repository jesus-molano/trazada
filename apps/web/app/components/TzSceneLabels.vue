<script setup lang="ts">
/**
 * Etiquetas en DOM sobre el lienzo (curvas; en H6, siglas de coches). Se reposicionan en cada render
 * escribiendo `transform` directamente: sin reactividad por frame.
 */
import { type Camera, Vector3 } from 'three'

export interface SceneLabel {
  id: string
  text: string
  /** Posición en el sistema de three (antes de la escala Y de la exageración). */
  x: number
  y: number
  z: number
}

const props = defineProps<{ labels: SceneLabel[]; kind: string }>()
const root = ref<HTMLElement | null>(null)
const v = new Vector3()

function update(camera: Camera, width: number, height: number, yScale: number): void {
  const el = root.value
  if (!el) return
  const nodes = el.children
  for (let i = 0; i < props.labels.length; i++) {
    const node = nodes[i] as HTMLElement | undefined
    const l = props.labels[i]!
    if (!node) continue
    v.set(l.x, l.y * yScale, l.z).project(camera)
    const visible = v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1
    node.style.visibility = visible ? 'visible' : 'hidden'
    if (visible) {
      node.style.transform = `translate3d(${((v.x + 1) / 2) * width}px, ${((1 - v.y) / 2) * height}px, 0) translate(-50%, -50%)`
    }
  }
}

defineExpose({ update })
</script>

<template>
  <div ref="root" class="tz-labels" :class="`tz-labels--${kind}`" aria-hidden="true">
    <span v-for="l in labels" :key="l.id" class="tz-label" :data-label="l.id">{{ l.text }}</span>
  </div>
</template>

<style scoped>
.tz-labels {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.tz-label {
  position: absolute;
  left: 0;
  top: 0;
  visibility: hidden;
  will-change: transform;
  white-space: nowrap;
}

.tz-labels--corner .tz-label {
  padding: 1px 5px;
  border-radius: var(--tz-radius-sm);
  background: var(--tz-label-bg-soft);
  color: var(--tz-text-muted);
  font-family: var(--tz-font-mono);
  font-size: var(--tz-text-2xs);
  font-weight: var(--tz-weight-semibold);
}
</style>
