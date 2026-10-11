<script setup lang="ts">
import { OUTLINE_VIEWBOX } from '~/venues/outlines'

/** Miniatura del trazado (decorativa). Sin trazado, un hueco neutro del mismo tamaño: nunca uno inventado. */
defineProps<{ d: string | null }>()
const { t } = useI18n()
</script>

<template>
  <svg
    v-if="d"
    class="tz-outline"
    :viewBox="OUTLINE_VIEWBOX"
    aria-hidden="true"
    focusable="false"
    data-testid="track-outline"
  >
    <path :d="d" />
  </svg>
  <span v-else class="tz-outline tz-outline--empty" :title="t('selector.noOutline')" aria-hidden="true" data-testid="track-outline-empty" />
</template>

<style scoped>
.tz-outline {
  display: block;
  flex: none;
  width: 44px;
  height: 44px;
  color: var(--tz-text-muted);
}

.tz-outline path {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.75px;
  stroke-linejoin: round;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
}

.tz-outline--empty {
  border: 1px dashed var(--tz-border-strong);
  border-radius: var(--tz-radius-sm);
}
</style>
