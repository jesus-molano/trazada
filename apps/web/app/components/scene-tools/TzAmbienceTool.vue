<script setup lang="ts">
/**
 * Ambiente (ítem 10, D37): «No / Sí» en el grupo «Capas» de las herramientas de escena, activo por defecto y recordado
 * por navegador (`stores/ambience.ts`). Encendido, dice en qué fase está el cielo y a qué altura está el sol, y deja
 * claro que es decorativo: posición del sol, no el tiempo. Sin posición del circuito o sin hora UTC válida, lo dice
 * («sin dato de ubicación») y no hay nada que encender: la escena se queda neutra. La pista «ⓘ» explica el cálculo.
 *
 * La altura del sol sale del estado grueso del reloj (≤ 10 Hz) y solo se repinta al cambiar de grado o de fase.
 */
import { useSceneAmbience } from '~/composables/useSceneAmbience'
import { DAY_MIN_DEG, FOG_MAX, NIGHT_MAX_DEG, phaseOf, quantizeSun } from '~/engine/ambience/ambience'
import { useAmbienceStore } from '~/stores/ambience'
import { usePlaybackStore } from '~/stores/playback'

const { t, locale } = useI18n()
const store = useAmbienceStore()
const playback = usePlaybackStore()
const ambience = useSceneAmbience()
/** Sin sesión cargada (la herramienta solo vive en la escena), no pinta nada. */
const status = ambience?.status ?? null

const sun = computed(() => (ambience && status === 'ok' ? ambience.sunAt(playback.timeMs) : null))
const phase = computed(() => (sun.value === null ? null : phaseOf(quantizeSun(sun.value))))
const deg = computed(() => (sun.value === null ? null : Math.round(sun.value)))
const phaseLabel = computed(() => {
  if (phase.value === 'day') return t('ambience.phases.day')
  return phase.value === 'dusk' ? t('ambience.phases.dusk') : t('ambience.phases.night')
})
const intFmt = computed(() => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 0 }))
const pctFmt = computed(() => new Intl.NumberFormat(locale.value, { style: 'percent', maximumFractionDigits: 0 }))

const note = computed(() => (status === 'no-location' ? t('ambience.noLocation') : t('ambience.noTime')))
const hint = computed(() => {
  if (status === 'no-location') return t('ambience.hintNoLocation')
  if (status === 'no-time') return t('ambience.hintNoTime')
  return [
    t('ambience.hint', { day: intFmt.value.format(DAY_MIN_DEG), night: intFmt.value.format(NIGHT_MAX_DEG) }),
    t('ambience.hintFog', { pct: pctFmt.value.format(FOG_MAX) }),
    t('ambience.hintSource'),
  ].join(' ')
})
</script>

<script lang="ts">
export const order = 30
export const group = 'layers'
</script>

<template>
  <span v-if="status" class="tz-ambience" data-testid="ambience-tool" :data-status="status" :data-phase="store.on ? (phase ?? '') : ''">
    <span id="tz-ambience-label" class="tz-ambience__label">{{ t('ambience.label') }}</span>
    <template v-if="status === 'ok'">
      <span class="tz-segmented" role="group" aria-labelledby="tz-ambience-label">
        <button type="button" :aria-pressed="!store.on" data-testid="ambience-off" @click="store.setOn(false)">
          {{ t('ambience.off') }}
        </button>
        <button type="button" :aria-pressed="store.on" data-testid="ambience-on" @click="store.setOn(true)">
          {{ t('ambience.on') }}
        </button>
      </span>
      <span v-if="store.on && phase !== null && deg !== null" class="tz-chip tz-num" data-testid="ambience-sun">
        {{ t('ambience.state', { phase: phaseLabel, deg: intFmt.format(deg) }) }}
      </span>
      <span class="tz-ambience__note" data-testid="ambience-decorative">{{ t('ambience.decorative') }}</span>
    </template>
    <span v-else class="tz-ambience__note" data-testid="ambience-note">{{ note }}</span>
    <TzHint :label="t('ambience.hintLabel')" :text="hint" testid="ambience-hint" align="end" />
  </span>
</template>

<style scoped>
.tz-ambience {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--tz-space-1);
  min-width: 0;
  max-width: 100%;
}

.tz-ambience__label {
  font-size: var(--tz-text-xs);
  color: var(--tz-text-muted);
}

/* Varias líneas antes que un menú muy ancho. */
.tz-ambience__note {
  max-width: 34ch;
  font-size: var(--tz-text-xs);
  color: var(--tz-text-muted);
}
</style>
