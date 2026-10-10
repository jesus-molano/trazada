<script setup lang="ts">
import { RATES } from '~/engine/clock/SessionClock'
import { formatClock } from '~/engine/format/time'
import { clockOrigin, leaderLapAt } from '~/engine/timeline/markers'
import { getRuntime, usePlaybackStore } from '~/stores/playback'

const { t } = useI18n()
const playback = usePlaybackStore()
const rt = getRuntime()!
const { playback: pb, totalLaps, type } = rt.session.manifest.session
const isRace = type === 'race' || type === 'sprint'
const origin = clockOrigin(type, rt.session.timing, pb)

const elapsed = computed(() => formatClock(playback.timeMs - origin))
const lap = computed(() => (isRace ? leaderLapAt(rt.markers, playback.timeMs) : 0))
</script>

<template>
  <div class="tz-controls">
    <button
      type="button"
      class="tz-control tz-control--play"
      :aria-label="playback.playing ? t('controls.pause') : t('controls.play')"
      :title="`${playback.playing ? t('controls.pause') : t('controls.play')} (${t('controls.keySpace')})`"
      data-testid="play-toggle"
      :data-playing="playback.playing"
      @click="playback.toggle()"
    >
      <svg v-if="playback.playing" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="6" y="5" width="4" height="14" rx="1" />
        <rect x="14" y="5" width="4" height="14" rx="1" />
      </svg>
      <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" /></svg>
    </button>

    <div class="tz-rates" role="group" :aria-label="t('controls.rate')">
      <button
        v-for="(r, i) in RATES"
        :key="r"
        type="button"
        class="tz-control tz-rate tz-tabular"
        :aria-pressed="playback.rate === r"
        :title="t('controls.rateKey', { key: i + 1 })"
        :data-testid="`rate-${r}`"
        @click="playback.setRate(r)"
      >
        ×{{ r }}
      </button>
    </div>

    <!-- Botones de otras funciones (hueco components/replay-dock/, que monta TzReplayDock). -->
    <slot />

    <p class="tz-readout tz-tabular" data-testid="time-readout">
      <span v-if="isRace && totalLaps" class="tz-readout__lap">{{ t('controls.lap', { lap, total: totalLaps }) }}</span>
      <span class="tz-readout__clock" :aria-label="t('controls.elapsed')">{{ elapsed }}</span>
    </p>
  </div>
</template>

<style scoped>
.tz-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--tz-space-3);
}

.tz-control {
  display: inline-grid;
  place-items: center;
  min-width: 32px;
  height: 32px;
  padding: 0 var(--tz-space-2);
  border: 1px solid var(--tz-border-strong);
  border-radius: var(--tz-radius-md);
  background: transparent;
  cursor: pointer;
  transition:
    background-color var(--tz-dur-fast) var(--tz-ease-standard),
    border-color var(--tz-dur-fast) var(--tz-ease-standard);
}

.tz-control:hover {
  border-color: var(--tz-accent);
}

.tz-control--play {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border-color: var(--tz-accent);
  background: var(--tz-accent-soft);
}

.tz-control svg {
  width: 18px;
  height: 18px;
  fill: currentColor;
}

.tz-rates {
  display: inline-flex;
  gap: var(--tz-space-1);
}

.tz-rate {
  font-size: var(--tz-text-sm);
  font-weight: var(--tz-weight-semibold);
}

.tz-rate[aria-pressed='true'] {
  border-color: var(--tz-accent);
  background: var(--tz-accent-soft);
  color: var(--tz-accent-strong);
}

.tz-readout {
  display: inline-flex;
  gap: var(--tz-space-3);
  margin: 0 0 0 auto;
  font-family: var(--tz-font-mono);
  font-size: var(--tz-text-md);
}

.tz-readout__lap {
  color: var(--tz-text-muted);
}
</style>
