<script setup lang="ts">
/**
 * Botón «?» de la cabecera (ítem 18): abre la guía de primer uso entera (`stores/tips.ts`) o, abierta, la salta. Solo el
 * icono, con su nombre accesible y su título, también desde 1600 px: la cabecera tiene que caber en una fila a 1280 y a
 * 1440 px. Solo con ratón (puntero fino y hover), justo al revés que el botón de la realización automática: en táctil
 * la cabecera no tiene sitio para los dos (con el de la paleta, partía la fila a 1180 px) y la guía se abre desde la
 * paleta del dock («guía»). Con teclado, también la tecla «?».
 */
import { useTipsStore } from '~/stores/tips'

const { t } = useI18n()
const tips = useTipsStore()
</script>

<script lang="ts">
/** Hueco `replay-header` (D29): el último botón (detrás del cambio de diseño), junto a las herramientas de la escena. */
export const order = 40
export const group = 'help'
</script>

<template>
  <button
    type="button"
    class="tz-help-btn"
    aria-haspopup="dialog"
    :aria-expanded="tips.open"
    :aria-label="t('tips.button')"
    :title="t('tips.buttonHint')"
    data-testid="help-button"
    @click="tips.toggle()"
  >
    <TzIcon name="help" size="sm" />
  </button>
</template>

<style scoped>
/* Como el botón de análisis con solo el icono; fuera salvo con ratón. */
.tz-help-btn {
  position: relative;
  display: none;
  flex: none;
  align-items: center;
  height: 28px;
  padding: 0 var(--tz-space-2);
  border: 1px solid transparent;
  border-radius: var(--tz-radius-md);
  background: transparent;
  color: var(--tz-text-muted);
  cursor: pointer;
  transition:
    background-color var(--tz-dur-fast) var(--tz-ease-standard),
    color var(--tz-dur-fast) var(--tz-ease-standard),
    transform var(--tz-dur-fast) var(--tz-ease-standard);
}

.tz-help-btn[aria-expanded='true'] {
  border-color: transparent;
  background: var(--tz-accent-soft);
  color: var(--tz-accent-strong);
}

.tz-help-btn:active {
  transform: scale(var(--tz-press-scale));
}

@media (hover: hover) and (pointer: fine) {
  .tz-help-btn {
    display: inline-flex;
  }

  .tz-help-btn:hover {
    background: var(--tz-surface-2);
    color: var(--tz-text);
  }
}

/*
 * Por debajo de 1360 px (o antes, con `data-fit="3"`: TzReplay.vue), 24 px de ancho (el mínimo de WCAG 2.2) para
 * que la cabecera siga en una fila.
 */
@media (width < 1360px) {
  .tz-help-btn {
    padding-inline: var(--tz-space-1);
  }
}
</style>
