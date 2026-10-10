<script setup lang="ts">
/**
 * Vuelta en curso y última vuelta del coche seleccionado (tabla de vueltas, dato real). En carrera, la
 * vuelta 1 no trae tiempo oficial: el usuario puede pedir su estimación, que se marca como Estimado.
 */
import { formatLapTime } from '~/engine/format/time'
import { LapTimes } from '~/engine/timing/laps'
import { getRuntime, usePlaybackStore } from '~/stores/playback'
import { useSettingsStore } from '~/stores/settings'

const props = defineProps<{ car: string }>()
const { t, locale } = useI18n()
const playback = usePlaybackStore()
const settings = useSettingsStore()
const rt = getRuntime()!
const s = rt.session.manifest.session
const laps = new LapTimes(rt.session.timing, s.type, s.playback.lightsOutMs ?? null, rt.session.events.raceControl)

const info = computed(() => laps.at(props.car, playback.timeMs, settings.estimateLap1))
const lastText = computed(() => (info.value.lastLapMs === null ? '—' : formatLapTime(info.value.lastLapMs, locale.value)))
/** La opción de estimar solo tiene sentido justo cuando la última vuelta es la 1 de una carrera. */
const offerLap1 = computed(() => laps.canEstimateLap1 && info.value.lastLap === 1)
</script>

<template>
  <dl class="tz-lap" data-testid="lap-info">
    <div class="tz-lap__cell">
      <dt>{{ t('telemetry.lap') }}</dt>
      <dd class="tz-tabular" data-testid="lap-current">{{ info.lap ?? '—' }}</dd>
    </div>
    <div class="tz-lap__cell tz-lap__cell--wide">
      <dt>
        {{ t('telemetry.lastLap') }}<template v-if="info.lastLap"> ({{ info.lastLap }})</template>
      </dt>
      <dd>
        <span class="tz-tabular" :class="{ 'is-deleted': info.deleted }" data-testid="lap-last">{{ lastText }}</span>
        <span
          v-if="info.deleted"
          class="tz-lap__deleted"
          :title="t('telemetry.lapDeletedHint')"
          data-testid="lap-last-deleted"
        >{{ t('telemetry.lapDeleted') }}</span>
        <button
          v-if="offerLap1"
          type="button"
          class="tz-lap__toggle"
          :aria-pressed="settings.estimateLap1"
          :title="t('telemetry.estimateLap1Hint')"
          data-testid="toggle-lap1"
          @click="settings.setEstimateLap1(!settings.estimateLap1)"
        >
          {{ t('telemetry.estimateLap1') }}
        </button>
        <TzEstimated v-if="info.estimated" field="lap1" />
      </dd>
    </div>
  </dl>
</template>

<style scoped>
.tz-lap {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--tz-space-3);
  margin: 0 0 var(--tz-space-2);
}

.tz-lap__cell dt {
  font-size: var(--tz-text-2xs);
  color: var(--tz-text-muted);
}

.tz-lap__cell dd {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--tz-space-2);
  margin: 2px 0 0;
  font-family: var(--tz-font-mono);
  font-size: var(--tz-text-sm);
}

/* Tiempo anulado por dirección de carrera: tachado y con su insignia (no se oculta: es un dato real). */
.is-deleted {
  color: var(--tz-text-muted);
  text-decoration: line-through;
}

.tz-lap__deleted {
  padding: 0 var(--tz-space-1);
  border: 1px solid var(--tz-danger);
  border-radius: var(--tz-radius-sm);
  color: var(--tz-danger);
  font-family: var(--tz-font-sans);
  font-size: var(--tz-text-2xs);
}

.tz-lap__toggle {
  padding: 0 var(--tz-space-2);
  border: 1px solid var(--tz-border);
  border-radius: var(--tz-radius-sm);
  background: transparent;
  font-family: var(--tz-font-sans);
  font-size: var(--tz-text-2xs);
  cursor: pointer;
}

.tz-lap__toggle[aria-pressed='true'] {
  border-color: var(--tz-accent);
  color: var(--tz-accent-strong);
}
</style>
