<script setup lang="ts">
/**
 * Botón de la paleta de comandos (ítem 14, D43) en la cabecera, para el iPad: allí no hay Ctrl+K ni «/». Solo con
 * puntero grueso o sin hover, como el de la realización automática (con ratón, la cabecera tiene que caber en una fila
 * a 1280 px y está el atajo). La lupa siempre lleva su nombre accesible y su título; el texto, desde 1600 px.
 */
const { t } = useI18n()
const { open, toggle } = usePalette()
</script>

<script lang="ts">
/** Hueco `replay-header` (D29): detrás del botón de la realización automática. */
export const order = 30
</script>

<template>
  <button
    type="button"
    class="tz-palette-btn"
    aria-haspopup="dialog"
    :aria-expanded="open"
    :aria-label="t('palette.button')"
    :title="t('palette.buttonHint')"
    data-testid="palette-button"
    @click="toggle()"
  >
    <TzIcon name="search" size="sm" />
    <span class="tz-palette-btn__text" aria-hidden="true">{{ t('palette.button') }}</span>
  </button>
</template>

<style scoped>
/* Como los botones de análisis y de realización; con puntero grueso, zona táctil de --tz-hit-min. */
.tz-palette-btn {
  position: relative;
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: var(--tz-space-2);
  height: 28px;
  padding: 0 var(--tz-space-3);
  border: 1px solid var(--tz-border-strong);
  border-radius: var(--tz-radius-pill);
  background: var(--tz-overlay);
  font-size: var(--tz-text-sm);
  font-weight: var(--tz-weight-semibold);
  white-space: nowrap;
  cursor: pointer;
  transition:
    border-color var(--tz-dur-fast) var(--tz-ease-standard),
    transform var(--tz-dur-fast) var(--tz-ease-standard);
}

.tz-palette-btn::after {
  content: '';
  position: absolute;
  inset: min(0px, calc((100% - var(--tz-hit-min)) / 2));
}

.tz-palette-btn[aria-expanded='true'] {
  border-color: var(--tz-accent);
  background: var(--tz-accent-soft);
  color: var(--tz-accent-strong);
}

.tz-palette-btn:active {
  transform: scale(var(--tz-press-scale));
}

/* Con ratón (puntero fino y hover), fuera: Ctrl+K (⌘K) y «/» bastan. */
@media (hover: hover) and (pointer: fine) {
  .tz-palette-btn {
    display: none;
  }
}

@media (width < 1600px) {
  .tz-palette-btn {
    padding: 0 var(--tz-space-2);
  }

  .tz-palette-btn__text {
    display: none;
  }
}
</style>
