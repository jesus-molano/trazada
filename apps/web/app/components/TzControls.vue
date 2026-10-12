<script setup lang="ts">
/**
 * Controles del reproductor: reproducir/pausa (placa maciza de pintura, D47), velocidades (la elegida, placa maciza),
 * los botones del hueco `replay-dock` y la lectura de vuelta y reloj. Iconos del registro (D30). Al cambiar entre
 * reproducir y pausa, el icono hace un fundido corto (21b, `tz-swap` de base.css); el reloj nunca se anima.
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
/**
 * La lectura no cambia de ancho con el reloj: desde 1280 px el timeline va en la misma fila (D44) y se estrecharía al
 * pasar de «59:59» a «1:00:00» o de la vuelta 9 a la 10 (con el puntero encima, el instante bajo él saltaría). El reloj
 * (monoespaciado) reserva los caracteres de su lectura más larga en la sesión, que siempre es la de uno de los extremos;
 * la vuelta, el ancho de la última (cifras tabulares) con una copia invisible debajo.
 */
const clockChars = Math.max(formatClock(rt.clock.startMs - origin).length, formatClock(rt.clock.endMs - origin).length)
const clockStyle = { minWidth: `${clockChars}ch` }
const widestLap = Math.max(totalLaps ?? 0, rt.markers.laps.at(-1)?.lap ?? 0)
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
      <!-- Play ↔ pausa: un icono deja paso al otro con un fundido corto (21b; con reduced motion, al instante). -->
      <Transition name="tz-swap">
        <TzIcon :key="playback.playing ? 'pause' : 'play'" :name="playback.playing ? 'pause' : 'play'" size="lg" class="tz-control__icon" />
      </Transition>
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
      <span v-if="isRace && totalLaps" class="tz-readout__lap">
        <span>{{ t('controls.lap', { lap, total: totalLaps }) }}</span>
        <span class="tz-readout__reserve" aria-hidden="true">{{ t('controls.lap', { lap: widestLap, total: totalLaps }) }}</span>
      </span>
      <span class="tz-readout__clock" :style="clockStyle" :aria-label="t('controls.elapsed')">{{ elapsed }}</span>
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
  /* Fantasma (D50): sin contorno; tono al pasar por encima. */
  border: 1px solid transparent;
  border-radius: var(--tz-radius-md);
  background: transparent;
  color: var(--tz-text-muted);
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

/* Reproducir/pausa: placa cuadrada maciza de pintura de 40 px con radio 12 (D47, D50), con el icono relleno. */
.tz-control--play {
  width: 40px;
  height: 40px;
  border-radius: var(--tz-radius-lg);
  border-color: var(--tz-accent);
  background: var(--tz-accent);
  color: var(--tz-accent-on);
}

.tz-control__icon {
  fill: currentColor;
}

/* Los dos iconos del cambio play ↔ pausa ocupan la misma celda mientras dura (el botón no cambia de tamaño). */
.tz-control--play > * {
  grid-area: 1 / 1;
}

/* Velocidades como un segmentado: pista de tono y la elegida en placa (D50). */
.tz-rates {
  display: inline-flex;
  gap: var(--tz-space-0-5);
  padding: var(--tz-space-0-5);
  border-radius: var(--tz-radius-md);
  background: var(--tz-surface-2);
}

.tz-rates .tz-control {
  height: 28px;
  min-width: 30px;
  border-radius: var(--tz-radius-pill);
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
    background: var(--tz-surface-3);
    color: var(--tz-text);
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

/* La vuelta y, en la misma celda, su copia invisible con la última vuelta: el ancho no cambia de la 9 a la 10. */
.tz-readout__lap {
  display: inline-grid;
  font-family: var(--tz-font-sans);
  font-size: var(--tz-text-sm);
  color: var(--tz-text-muted);
}

.tz-readout__lap > * {
  grid-area: 1 / 1;
  text-align: end;
}

.tz-readout__reserve {
  visibility: hidden;
}

/*
 * El reloj, la cifra que se lee de un vistazo: más grande (su valor nunca se anima). Ancho mínimo en `ch` (`clockStyle`:
 * su lectura más larga en la sesión), alineado al final: la hora aparece a la izquierda sin mover los segundos.
 */
.tz-readout__clock {
  font-size: var(--tz-text-num-md);
  font-weight: var(--tz-weight-semibold);
  text-align: end;
}
</style>
