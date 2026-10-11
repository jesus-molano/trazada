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
/** Hueco `replay-header` (D29): el último botón, junto a las herramientas de la escena. */
export const order = 30
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
  border: 1px solid var(--tz-border-strong);
  border-radius: var(--tz-radius-pill);
  background: var(--tz-overlay);
  cursor: pointer;
  transition:
    border-color var(--tz-dur-fast) var(--tz-ease-standard),
    transform var(--tz-dur-fast) var(--tz-ease-standard);
}

.tz-help-btn[aria-expanded='true'] {
  border-color: var(--tz-accent);
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
    border-color: var(--tz-accent);
  }
}
</style>
