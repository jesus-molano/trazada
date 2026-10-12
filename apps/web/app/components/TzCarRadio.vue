<script setup lang="ts">
/**
 * Radio del coche elegido en la telemetría (D51): sus últimos clips publicados hasta el instante del reloj (nunca uno
 * del futuro), del más reciente al más antiguo, con reproducir y pausa. Solo si la sesión trae radio: sin ella, el
 * panel de dirección de carrera ya lo dice. Se recalcula con el estado grueso.
 */
import { formatClock } from '~/engine/format/time'
import { clipsUpTo, radioClips, radioStatus } from '~/engine/radio/radio'
import { clockOrigin } from '~/engine/timeline/markers'
import { getRuntime, usePlaybackStore } from '~/stores/playback'
import { useRadioStore } from '~/stores/radio'

const props = defineProps<{ car: string }>()
const { t } = useI18n()
const rt = getRuntime()!
const playback = usePlaybackStore()
const radio = useRadioStore()
const status = radioStatus(rt.session.manifest)
const shown = status === 'present' || status === 'partial'
const { playback: pb, type } = rt.session.manifest.session
// Sin radio no se lee nada más de la sesión.
const origin = shown ? clockOrigin(type, rt.session.timing, pb) : 0
const all = shown ? radioClips(rt.session.events) : []
const mine = computed(() => all.filter((c) => c.car === props.car))
const times = computed(() => mine.value.map((c) => c.t))
/** Cuántos de los suyos se han publicado ya: solo cambia cuando entra uno. */
const count = computed(() => clipsUpTo(times.value, playback.timeMs))
/** Los últimos (los más recientes primero): la telemetría no crece sin fin. */
const MAX_SHOWN = 3
const recent = computed(() => mine.value.slice(Math.max(0, count.value - MAX_SHOWN), count.value).reverse())
const who = computed(() => rt.drivers.find((d) => d.number === props.car)?.tla ?? `#${props.car}`)
</script>

<template>
  <section v-if="shown" class="tz-car-radio" :aria-label="t('radio.car.title')" data-testid="car-radio">
    <div class="tz-car-radio__head">
      <h3 class="tz-panel-title tz-car-radio__title">{{ t('radio.car.title') }}</h3>
      <!-- El mismo interruptor que en dirección de carrera (que se oculta con un piloto elegido). -->
      <button
        type="button"
        class="tz-car-radio__live"
        :aria-pressed="radio.live"
        :title="t('radio.liveHint')"
        data-testid="car-radio-live"
        @click="radio.live = !radio.live"
      >
        <TzIcon name="radio" size="sm" />{{ t('radio.live') }}
      </button>
    </div>
    <p v-if="!recent.length" class="tz-car-radio__empty">{{ t('radio.car.empty') }}</p>
    <ol v-else class="tz-car-radio__list">
      <li v-for="c in recent" :key="c.file" class="tz-car-radio__item" data-testid="car-radio-clip">
        <span class="tz-car-radio__time tz-tabular" :title="t('radio.published')">{{ formatClock(c.t - origin) }}</span>
        <TzRadioClip :clip="c" :who="who" :when="formatClock(c.t - origin)" />
      </li>
    </ol>
  </section>
</template>

<style scoped>
.tz-car-radio {
  margin-top: var(--tz-space-3);
}

.tz-car-radio__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--tz-space-2);
  margin-bottom: var(--tz-space-1);
}

.tz-car-radio__title {
  margin: 0;
}

.tz-car-radio__live {
  display: inline-flex;
  align-items: center;
  gap: var(--tz-space-1);
  min-height: var(--tz-space-8);
  padding: 0 var(--tz-space-2);
  border: 0;
  border-radius: var(--tz-radius-md);
  background: transparent;
  color: var(--tz-text-muted);
  font-size: var(--tz-text-xs);
  cursor: pointer;
}

@media (hover: hover) {
  .tz-car-radio__live:hover:not([aria-pressed='true']) {
    background: var(--tz-surface-2);
    color: var(--tz-text);
  }
}

/* Activado: la placa maciza de pintura (D47). */
.tz-car-radio__live[aria-pressed='true'] {
  background: var(--tz-accent);
  color: var(--tz-accent-on);
}

.tz-car-radio__empty {
  margin: 0;
  font-size: var(--tz-text-xs);
  color: var(--tz-text-muted);
}

.tz-car-radio__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.tz-car-radio__item {
  display: flex;
  align-items: center;
  gap: var(--tz-space-2);
}

.tz-car-radio__item + .tz-car-radio__item {
  margin-top: var(--tz-space-1);
}

.tz-car-radio__time {
  min-width: 4.5em;
  font-family: var(--tz-font-mono);
  font-size: var(--tz-text-2xs);
  color: var(--tz-text-muted);
}
</style>
