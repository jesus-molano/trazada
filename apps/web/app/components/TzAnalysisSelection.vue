<script setup lang="ts">
/**
 * Coche elegido en la cabecera de la hoja de análisis (D49): «Elegido ALO · la cámara lo sigue ×». La hoja tapa el
 * panel de telemetría, donde están «Vista general» y su ×, y Esc cierra antes la hoja: sin esto, la única forma de
 * quitar la selección dentro del análisis era la paleta de comandos.
 *
 * - Solo con un coche elegido, en todas las pestañas.
 * - Su × quita la selección y el seguimiento (`selectCar(null)`); la hoja sigue abierta y el foco pasa a «Sin
 *   spoilers» (el × desaparece con el chip).
 * - Coche elegido = borde de pintura de 1 px, como la entrada destacada de la leyenda; nunca la placa maciza, que es
 *   «activado» (D47).
 */
import { driverStyles } from '~/analysis/chart'
import { getRuntime, usePlaybackStore } from '~/stores/playback'

const { t } = useI18n()
const rt = getRuntime()!
const playback = usePlaybackStore()
const styles = driverStyles(rt.drivers)
const root = ref<HTMLElement | null>(null)

const car = computed(() => playback.selectedCar)
const style = computed(() => (car.value ? styles.get(car.value) : undefined))
const driver = computed(() => style.value?.label ?? car.value ?? '')

async function clear() {
  const sheet = root.value?.closest('[data-testid="analysis-sheet"]') ?? document
  playback.selectCar(null)
  await nextTick()
  sheet.querySelector<HTMLElement>('[data-testid="analysis-spoilers"]')?.focus()
}
</script>

<template>
  <div
    v-if="car"
    ref="root"
    role="group"
    class="tz-aselect"
    :aria-label="t('analysis.selection.group', { driver })"
    data-testid="analysis-selection"
    :data-car="car"
    :data-following="playback.following"
  >
    <span
      class="tz-aselect__swatch"
      :class="{ 'is-dash': style?.dash }"
      :style="style?.color ? { '--swatch': style.color } : undefined"
      aria-hidden="true"
    />
    <span class="tz-aselect__label">{{ t('analysis.selection.label') }}</span>
    <span class="tz-aselect__tla">{{ driver }}</span>
    <span v-if="playback.following" class="tz-aselect__follow">· {{ t('analysis.selection.following') }}</span>
    <button
      type="button"
      class="tz-iconbtn tz-aselect__clear"
      :aria-label="playback.following ? t('analysis.selection.clearFollowing', { driver }) : t('analysis.selection.clear', { driver })"
      :title="playback.following ? t('analysis.selection.clearFollowing', { driver }) : t('analysis.selection.clear', { driver })"
      data-testid="analysis-selection-clear"
      @click="clear()"
    >
      <TzIcon name="close" size="sm" />
    </button>
  </div>
</template>

<style scoped>
.tz-aselect {
  display: inline-flex;
  align-items: center;
  gap: var(--tz-space-2);
  min-height: 28px;
  padding: 0 var(--tz-space-0-5) 0 var(--tz-space-3);
  border: 1px solid var(--tz-accent);
  border-radius: var(--tz-radius-pill);
  background: var(--tz-surface-2);
  font-size: var(--tz-text-sm);
  white-space: nowrap;
  animation: tz-enter var(--tz-dur-fast) var(--tz-ease-enter) both;
}

/* Muestra del coche: el trazo de su serie, como en la leyenda (discontinuo para el segundo piloto de su equipo). */
.tz-aselect__swatch {
  flex: none;
  width: 14px;
  height: 0;
  border-top: 2px solid var(--swatch, var(--tz-team-unknown));
}

.tz-aselect__swatch.is-dash {
  border-top-style: dashed;
}

.tz-aselect__label {
  color: var(--tz-text-muted);
}

.tz-aselect__tla {
  font-family: var(--tz-font-mono);
  font-weight: var(--tz-weight-semibold);
  letter-spacing: var(--tz-tracking-mono);
  color: var(--tz-text);
}

.tz-aselect__follow {
  font-size: var(--tz-text-xs);
  color: var(--tz-text-muted);
}

/* 24 px visibles; su ::after (de .tz-iconbtn) lleva la zona táctil a --tz-hit-min. */
.tz-aselect__clear {
  width: var(--tz-space-6);
  height: var(--tz-space-6);
}

/* Estrecho (tablet en vertical): sin «la cámara lo sigue» (el nombre del × lo sigue diciendo). */
@media (width < 900px) {
  .tz-aselect__follow {
    display: none;
  }
}
</style>
