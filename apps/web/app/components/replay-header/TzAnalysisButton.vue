<script setup lang="ts">
/**
 * Abre y cierra la hoja de análisis (ítem 3, `useAnalysis`). Por debajo de 1600 px solo el icono, con su nombre
 * accesible y su título: la cabecera del replay va justa (Tanda 1, H13) y así sigue cabiendo en una fila a 1440 y a 1280 px.
 */
const { t } = useI18n()
const { open, toggle } = useAnalysis()
</script>

<script lang="ts">
/** Hueco `replay-header` (D29): botón de la hoja de análisis (ítem 3), el primero de la cabecera. */
export const order = 10
export const group = 'view'
</script>

<template>
  <button
    type="button"
    class="tz-analysis-btn"
    aria-haspopup="dialog"
    :aria-expanded="open"
    :aria-label="t('analysis.button')"
    :title="t('analysis.buttonHint')"
    data-testid="analysis-button"
    @click="toggle()"
  >
    <TzIcon name="analysis" size="sm" />
    <span class="tz-analysis-btn__text" aria-hidden="true">{{ t('analysis.button') }}</span>
  </button>
</template>

<style scoped>
/* Como el chip de estado de la cabecera; con puntero grueso, zona táctil de --tz-hit-min. */
.tz-analysis-btn {
  position: relative;
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: var(--tz-space-2);
  height: 28px;
  padding: 0 var(--tz-space-3);
  border: 1px solid transparent;
  border-radius: var(--tz-radius-md);
  background: transparent;
  color: var(--tz-text-muted);
  font-size: var(--tz-text-sm);
  font-weight: var(--tz-weight-medium);
  white-space: nowrap;
  cursor: pointer;
  transition:
    background-color var(--tz-dur-fast) var(--tz-ease-standard),
    color var(--tz-dur-fast) var(--tz-ease-standard),
    transform var(--tz-dur-fast) var(--tz-ease-standard);
}

.tz-analysis-btn::after {
  content: '';
  position: absolute;
  inset: min(0px, calc((100% - var(--tz-hit-min)) / 2));
}

.tz-analysis-btn[aria-expanded='true'] {
  border-color: transparent;
  background: var(--tz-accent-soft);
  color: var(--tz-accent-strong);
}

.tz-analysis-btn:active {
  transform: scale(var(--tz-press-scale));
}

@media (hover: hover) {
  .tz-analysis-btn:hover {
    background: var(--tz-surface-2);
    color: var(--tz-text);
  }
}

/*
 * Con su texto a cualquier ancho de escritorio (D50: ya es el único «Análisis» de la cabecera); solo el icono por
 * debajo de 1360 px o si la cabecera no cabe (nivel 2 de useHeaderFit, en pages/replay.vue).
 */
@media (width < 1360px) {
  .tz-analysis-btn {
    padding: 0 var(--tz-space-2);
  }

  .tz-analysis-btn__text {
    display: none;
  }
}
</style>
