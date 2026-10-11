<script setup lang="ts">
/**
 * Lo que enseña la escena mientras dos dedos mueven el reloj (ítem 17, D43): en el centro, cuánto se ha movido
 * («+0:45», con la escala del gesto) y, encima, la tarjeta de la vista previa del timeline (ítem 16) con lo que pasaba
 * en ese instante (dato real; lo calcula el motor). Presentacional: lo alimenta `useSceneGestures`. Solo existe mientras
 * dura el gesto, sin animaciones: es la respuesta directa a los dedos. Oculto para los lectores de pantalla: el timeline
 * (un deslizador con su valor) ya dice dónde está el reloj.
 */
import type { ScrubHud } from '~/composables/useSceneGestures'
import { formatClock } from '~/engine/format/time'
import { SCRUB_WINDOW_MS } from '~/engine/gestures/twoFinger'

const props = defineProps<{ hud: ScrubHud }>()
const { t } = useI18n()

const offset = computed(() => {
  const ms = props.hud.offsetMs
  // Por segundos enteros hacia cero, como el reloj (sin moverse, «+0:00»).
  const whole = Math.trunc(ms / 1000) * 1000
  return `${whole < 0 ? '−' : '+'}${formatClock(Math.abs(whole))}`
})
const scale = computed(() => t('gestures.scrubScale', { min: SCRUB_WINDOW_MS / 60_000 }))
</script>

<template>
  <div class="tz-gesture-hud" aria-hidden="true" data-testid="gesture-scrub" :data-offset="Math.round(hud.offsetMs)">
    <TzTimelinePreview data-testid="gesture-preview" :at="hud.at" :x="hud.width / 2" :width="hud.width" :visible="true" />
    <p class="tz-gesture-hud__chip">
      <span class="tz-gesture-hud__offset tz-tabular" data-testid="gesture-offset">{{ offset }}</span>
      <span class="tz-gesture-hud__scale">{{ scale }}</span>
    </p>
  </div>
</template>

<style scoped>
/* Franja a lo ancho de la escena, algo por encima del centro (en tablet vertical, los paneles van abajo). La tarjeta
 * se coloca encima de ella, centrada; el chip, dentro. */
.tz-gesture-hud {
  position: absolute;
  left: 0;
  right: 0;
  top: 40%;
  z-index: var(--tz-z-panels);
  display: flex;
  justify-content: center;
  pointer-events: none;
}

.tz-gesture-hud__chip {
  display: inline-flex;
  align-items: baseline;
  gap: var(--tz-space-2);
  margin: 0;
  padding: var(--tz-space-1) var(--tz-space-3);
  border: 1px solid var(--tz-border-strong);
  border-radius: var(--tz-radius-pill);
  background: var(--tz-surface-2);
  box-shadow: var(--tz-shadow-panel);
}

.tz-gesture-hud__offset {
  font-family: var(--tz-font-mono);
  font-size: var(--tz-text-lg);
  font-weight: var(--tz-weight-semibold);
  color: var(--tz-text);
}

.tz-gesture-hud__scale {
  font-size: var(--tz-text-xs);
  color: var(--tz-text-muted);
}
</style>
