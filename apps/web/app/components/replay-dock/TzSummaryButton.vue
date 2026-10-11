<script setup lang="ts">
/**
 * Vuelve a abrir la tarjeta de fin de sesión (`useSessionSummary`). Solo existe desde el momento de la tarjeta: antes
 * del fin de la sesión no hay resumen (y al volver atrás, desaparece).
 *
 * Mientras se arrastra el cabezal del timeline, ni aparece ni desaparece: el timeline va en la misma fila que los
 * controles (D44) y perdería de golpe el ancho del botón bajo el puntero (el instante arrastrado saltaría). Al soltar,
 * se pone al día.
 */
import { usePlaybackStore } from '~/stores/playback'

const { t } = useI18n()
const playback = usePlaybackStore()
const { available, open, show } = useSessionSummary()
const shown = ref(available.value)
watchEffect(() => {
  if (!playback.scrubbing) shown.value = available.value
})
</script>

<script lang="ts">
/** Hueco `replay-dock` (D29): botón del resumen de fin de sesión (ítem 12), detrás de los demás botones del dock. */
export const order = 90
</script>

<template>
  <button
    v-if="shown"
    type="button"
    class="tz-summary-btn"
    aria-haspopup="dialog"
    :aria-expanded="open"
    :title="t('summary.buttonHint')"
    data-testid="summary-button"
    @click="show()"
  >
    <TzIcon name="summary" size="sm" />
    {{ t('summary.button') }}
  </button>
</template>

<style scoped>
/* Como los controles del dock: 32 px de alto y, con puntero grueso, zona táctil de --tz-hit-min. */
.tz-summary-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: var(--tz-space-2);
  height: var(--tz-space-8);
  padding: 0 var(--tz-space-3);
  border: 1px solid var(--tz-border-strong);
  border-radius: var(--tz-radius-md);
  background: transparent;
  font-size: var(--tz-text-sm);
  font-weight: var(--tz-weight-semibold);
  cursor: pointer;
  transition:
    border-color var(--tz-dur-fast) var(--tz-ease-standard),
    transform var(--tz-dur-fast) var(--tz-ease-standard);
}

.tz-summary-btn::after {
  content: '';
  position: absolute;
  inset: min(0px, calc((100% - var(--tz-hit-min)) / 2)) 0;
}

.tz-summary-btn[aria-expanded='true'] {
  border-color: var(--tz-accent);
  background: var(--tz-accent-soft);
  color: var(--tz-accent-strong);
}

.tz-summary-btn:active {
  transform: scale(var(--tz-press-scale));
}

@media (hover: hover) {
  .tz-summary-btn:hover {
    border-color: var(--tz-accent);
  }
}
</style>
