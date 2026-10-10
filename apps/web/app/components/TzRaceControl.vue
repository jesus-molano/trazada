<script setup lang="ts">
/**
 * Mensajes de dirección de carrera hasta el instante del reloj, del más reciente al más antiguo: el texto
 * original tal cual (en inglés) y el tipo traducido. Se recalcula con el estado grueso (~10 Hz) y solo
 * cambia el DOM cuando aparece o desaparece un mensaje.
 */
import type { RaceControlEvent } from '@trazada/schema'
import { formatClock } from '~/engine/format/time'
import { clockOrigin } from '~/engine/timeline/markers'
import { visibleCount } from '~/engine/trackstate/TrackState'
import { getRuntime, usePlaybackStore } from '~/stores/playback'

const { t, te } = useI18n()
const playback = usePlaybackStore()
const rt = getRuntime()!
const { playback: pb, type } = rt.session.manifest.session
const origin = clockOrigin(type, rt.session.timing, pb)
const events = rt.raceControl
const times = events.map((e) => e.t)

const open = ref(true)
const count = computed(() => visibleCount(times, playback.timeMs))
const visible = computed(() => events.slice(0, count.value).reverse())

function kindLabel(e: RaceControlEvent): string {
  const key = `rc.kind.${e.parsed.kind}`
  return te(key) ? t(key) : t('rc.kind.other')
}

const FLAG_KINDS = new Set(['sector_yellow', 'sector_double_yellow', 'sector_clear', 'blue_flag', 'chequered_flag', 'green_light', 'track_clear'])
const NEUTRAL_KINDS = new Set(['sc_deployed', 'sc_ending', 'sc_in_this_lap', 'vsc_deployed', 'vsc_ending', 'red_flag'])
const STEWARD_KINDS = new Set(['incident', 'penalty', 'penalty_served', 'lap_deleted', 'lap_reinstated', 'track_limits', 'black_and_white_flag', 'black_and_orange_flag', 'black_flag'])

function tone(kind: string): string {
  if (NEUTRAL_KINDS.has(kind)) return 'is-neutral'
  if (kind === 'sector_yellow' || kind === 'sector_double_yellow') return 'is-yellow'
  if (FLAG_KINDS.has(kind)) return 'is-flag'
  if (STEWARD_KINDS.has(kind)) return 'is-stewards'
  return ''
}
</script>

<template>
  <section class="tz-rc" :class="{ 'is-open': open }" :aria-label="t('rc.title')" data-testid="race-control">
    <button
      type="button"
      class="tz-rc__head"
      :aria-expanded="open"
      aria-controls="tz-rc-list"
      :title="t('rc.toggle')"
      data-testid="race-control-toggle"
      @click="open = !open"
    >
      <h2 class="tz-rc__title">{{ t('rc.title') }}</h2>
      <span class="tz-rc__count tz-tabular">{{ t('rc.count', { n: count }) }}</span>
      <span class="tz-rc__chevron" aria-hidden="true" />
    </button>
    <ol v-show="open" id="tz-rc-list" class="tz-rc__list" aria-live="off">
      <li v-if="!visible.length" class="tz-rc__empty">{{ t('rc.empty') }}</li>
      <li
        v-for="(e, i) in visible"
        :key="count - 1 - i"
        class="tz-rc__item"
        :class="tone(e.parsed.kind)"
        :data-t="e.t"
        :data-kind="e.parsed.kind"
        data-testid="rc-message"
      >
        <div class="tz-rc__meta">
          <span class="tz-rc__time tz-tabular">{{ formatClock(e.t - origin) }}</span>
          <span v-if="e.lap" class="tz-rc__lap tz-tabular">{{ t('rc.lap', { lap: e.lap }) }}</span>
          <span class="tz-rc__kind" data-testid="rc-kind">{{ kindLabel(e) }}</span>
        </div>
        <p class="tz-rc__text" lang="en" :title="t('rc.original')" data-testid="rc-text">{{ e.text }}</p>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.tz-rc {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--tz-border);
  border-radius: var(--tz-radius-lg);
  background: var(--tz-overlay);
  backdrop-filter: blur(10px);
  box-shadow: var(--tz-shadow-panel);
}

.tz-rc.is-open {
  flex: 1 1 auto;
  min-height: 150px;
}

.tz-rc__head {
  display: flex;
  align-items: center;
  gap: var(--tz-space-2);
  width: 100%;
  padding: var(--tz-space-2) var(--tz-space-3);
  border: 0;
  background: transparent;
  text-align: start;
  cursor: pointer;
}

.tz-rc__title {
  flex: 1;
  margin: 0;
  font-size: var(--tz-text-xs);
  font-weight: var(--tz-weight-semibold);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--tz-text-muted);
}

.tz-rc__count {
  font-size: var(--tz-text-2xs);
  color: var(--tz-text-faint);
}

.tz-rc__chevron {
  width: 8px;
  height: 8px;
  border-right: 2px solid var(--tz-text-muted);
  border-bottom: 2px solid var(--tz-text-muted);
  transform: rotate(-45deg);
  transition: transform var(--tz-dur-fast) var(--tz-ease-standard);
}

.is-open .tz-rc__chevron {
  transform: rotate(45deg);
}

.tz-rc__list {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 0 var(--tz-space-2) var(--tz-space-2);
  overflow-y: auto;
  list-style: none;
}

.tz-rc__empty {
  padding: var(--tz-space-2);
  font-size: var(--tz-text-xs);
  color: var(--tz-text-muted);
}

.tz-rc__item {
  padding: var(--tz-space-2);
  border-left: 3px solid var(--tz-border-strong);
  border-radius: var(--tz-radius-sm);
}

.tz-rc__item + .tz-rc__item {
  margin-top: var(--tz-space-1);
}

.tz-rc__item.is-yellow {
  border-left-color: var(--tz-flag-yellow);
}

.tz-rc__item.is-flag {
  border-left-color: var(--tz-flag-green);
}

.tz-rc__item.is-neutral {
  border-left-color: var(--tz-sc);
}

.tz-rc__item.is-stewards {
  border-left-color: var(--tz-accent);
}

.tz-rc__meta {
  display: flex;
  align-items: baseline;
  gap: var(--tz-space-2);
  font-size: var(--tz-text-2xs);
  color: var(--tz-text-muted);
}

.tz-rc__time {
  font-family: var(--tz-font-mono);
}

.tz-rc__kind {
  margin-left: auto;
  font-weight: var(--tz-weight-semibold);
  color: var(--tz-text);
}

.tz-rc__text {
  margin: 2px 0 0;
  font-family: var(--tz-font-mono);
  font-size: var(--tz-text-xs);
  line-height: 1.35;
  overflow-wrap: anywhere;
}
</style>
