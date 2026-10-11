<script setup lang="ts">
/**
 * Botón de la paleta de comandos (ítem 14, D43) para el iPad: allí no hay Ctrl+K ni «/». Solo con puntero grueso o
 * sin hover (con ratón está el atajo). Va en el dock, junto a los saltos entre momentos y a mano del pulgar, y no en
 * la cabecera: allí, con el botón de la realización automática, partía la cabecera en dos filas a 1180 y 1366 px
 * táctiles y la escena y los paneles perdían 46 px de alto. La lupa siempre lleva su nombre accesible y su título; el
 * texto, desde 1600 px.
 */
const { t } = useI18n()
const { open, toggle } = usePalette()
</script>

<script lang="ts">
/** Hueco `replay-dock` (D29): detrás de los saltos entre momentos y antes del resumen de fin de sesión. */
export const order = 20
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
/* Como los controles del dock: 32 px de alto y, con puntero grueso, zona táctil de --tz-hit-min. */
.tz-palette-btn {
  position: relative;
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  gap: var(--tz-space-2);
  min-width: var(--tz-space-8);
  height: var(--tz-space-8);
  padding: 0 var(--tz-space-3);
  border: 1px solid var(--tz-border-strong);
  border-radius: var(--tz-radius-md);
  background: transparent;
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
    padding: 0;
  }

  .tz-palette-btn__text {
    display: none;
  }
}
</style>
