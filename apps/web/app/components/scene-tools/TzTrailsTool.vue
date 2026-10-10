<script setup lang="ts">
/**
 * Estelas (ítem 7): «No / Equipo / Velocidad» en el grupo «Capas» de las herramientas de escena. Apagadas por
 * defecto y recordadas por navegador (`stores/trails.ts`). Con el color por velocidad, una leyenda con la escala fija
 * y el gris de «sin dato». La pista «ⓘ» explica qué es dato y qué no (línea central, cortes, velocidad sin
 * interpolar).
 */
import { TRAIL_SPAN_MS, TRAIL_SPEED_KMH } from '~/engine/replay/trail'
import { MAX_SAMPLE_AGE_MS } from '~/engine/telemetry/telemetry'
import { type TrailMode, useTrailsStore } from '~/stores/trails'

const { t } = useI18n()
const trails = useTrailsStore()
onMounted(() => trails.hydrate())

const modes = computed<{ mode: TrailMode; label: string }[]>(() => [
  { mode: 'off', label: t('trails.modes.off') },
  { mode: 'team', label: t('trails.modes.team') },
  { mode: 'speed', label: t('trails.modes.speed') },
])
const hint = computed(() =>
  [t('trails.hint', { s: TRAIL_SPAN_MS / 1000 }), t('trails.hintSpeed', { age: MAX_SAMPLE_AGE_MS / 1000 })].join(' '),
)
</script>

<script lang="ts">
export const order = 10
export const group = 'layers'
</script>

<template>
  <span class="tz-trails" data-testid="trails-tool">
    <span id="tz-trails-label" class="tz-trails__label">{{ t('trails.label') }}</span>
    <span class="tz-segmented" role="group" aria-labelledby="tz-trails-label">
      <button
        v-for="m in modes"
        :key="m.mode"
        type="button"
        :aria-pressed="trails.mode === m.mode"
        :data-testid="`trails-${m.mode}`"
        @click="trails.setMode(m.mode)"
      >
        {{ m.label }}
      </button>
    </span>
    <span
      v-if="trails.mode === 'speed'"
      class="tz-chip tz-trails__legend"
      role="group"
      :aria-label="t('trails.legendLabel')"
      data-testid="trails-legend"
    >
      <span class="tz-trails__ramp" aria-hidden="true" />
      <span class="tz-num">{{ t('trails.legend', { min: TRAIL_SPEED_KMH.min, max: TRAIL_SPEED_KMH.max }) }}</span>
      <span class="tz-trails__swatch" aria-hidden="true" />
      <span>{{ t('trails.noSample') }}</span>
    </span>
    <TzHint :label="t('trails.hintLabel')" :text="hint" testid="trails-hint" align="end" />
  </span>
</template>

<style scoped>
.tz-trails {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--tz-space-1);
  min-width: 0;
}

.tz-trails__label {
  font-size: var(--tz-text-xs);
  color: var(--tz-text-muted);
}

.tz-trails__ramp {
  width: var(--tz-space-8);
  height: var(--tz-space-2);
  border-radius: var(--tz-radius-pill);
  background: linear-gradient(to right, var(--tz-trail-slow), var(--tz-trail-mid), var(--tz-trail-fast));
}

.tz-trails__swatch {
  width: var(--tz-space-2);
  height: var(--tz-space-2);
  border-radius: var(--tz-radius-pill);
  background: var(--tz-trail-nodata);
}
</style>
