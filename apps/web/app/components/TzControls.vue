<script setup lang="ts">
/**
 * Controles del reproductor: reproducir/pausa (placa maciza de pintura, D47), velocidades (la elegida, placa maciza),
 * los botones del hueco `replay-dock` y la lectura de vuelta y reloj. Iconos del registro (D30).
 */
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
      <TzIcon :name="playback.playing ? 'pause' : 'play'" size="lg" class="tz-control__icon" />
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
  position: relative;
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
    border-color var(--tz-dur-fast) var(--tz-ease-standard),
    transform var(--tz-dur-fast) var(--tz-ease-standard);
}

/* Zona táctil de --tz-hit-min de alto con puntero grueso, sin mover el layout (en horizontal no pisa al vecino). */
.tz-control::after {
  content: '';
  position: absolute;
  inset: min(0px, calc((100% - var(--tz-hit-min)) / 2)) 0;
}

.tz-control:active {
  transform: scale(var(--tz-press-scale));
}

/* Reproducir/pausa: placa cuadrada maciza de pintura (D47), con el icono relleno. */
.tz-control--play {
  width: 40px;
  height: 40px;
  border-color: var(--tz-accent);
  background: var(--tz-accent);
  color: var(--tz-accent-on);
}

.tz-control__icon {
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

/* Velocidad elegida: placa maciza (placa = activado; aria-pressed lo dice también). */
.tz-rate[aria-pressed='true'] {
  border-color: var(--tz-accent);
  background: var(--tz-accent);
  color: var(--tz-accent-on);
}

@media (hover: hover) {
  .tz-control:hover:not([aria-pressed='true'], .tz-control--play) {
    border-color: var(--tz-accent);
  }

  .tz-control--play:hover {
    border-color: var(--tz-accent-strong);
    background: var(--tz-accent-strong);
  }
}

.tz-readout {
  display: inline-flex;
  align-items: baseline;
  gap: var(--tz-space-3);
  margin: 0 0 0 auto;
  font-family: var(--tz-font-mono);
  font-size: var(--tz-text-md);
  white-space: nowrap;
}

.tz-readout__lap {
  font-family: var(--tz-font-sans);
  font-size: var(--tz-text-sm);
  color: var(--tz-text-muted);
}

/* El reloj, la cifra que se lee de un vistazo: más grande (su valor nunca se anima). */
.tz-readout__clock {
  font-size: var(--tz-text-num-md);
  font-weight: var(--tz-weight-semibold);
}
</style>
