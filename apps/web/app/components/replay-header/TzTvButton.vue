<script setup lang="ts">
/**
 * Botón de la realización automática (ítem 9, D39) en la cabecera, para el iPad: allí no hay tecla T y el menú
 * «Cámara» de las herramientas de escena queda lejos. Solo con puntero grueso o sin hover (con ratón, la cabecera
 * tiene que caber en una fila a 1280 px y ya están el menú y la tecla). Solo el icono por debajo de 1600 px, con su
 * nombre accesible y su título. Está desde que se engancha el runtime, deshabilitado hasta que la escena 3D monta su
 * cámara: así la cabecera no cambia de alto después del primer encuadre. Sin escena (sin WebGL), se queda
 * deshabilitado y su título dice por qué.
 */
import { useTvStore } from '~/stores/tv'

const { t } = useI18n()
const tv = useTvStore()
const title = computed(() => {
  if (!tv.available) return t('tv.unavailable')
  return tv.active ? t('tv.buttonStop') : t('tv.buttonStart')
})
</script>

<script lang="ts">
/** Hueco `replay-header` (D29): detrás del botón de análisis. */
export const order = 20
</script>

<template>
  <button
    type="button"
    class="tz-tv-btn"
    :aria-pressed="tv.active"
    :disabled="!tv.available"
    :aria-label="t('tv.name')"
    :title="title"
    data-testid="tv-button"
    @click="tv.toggle()"
  >
    <TzIcon name="director" size="sm" />
    <span class="tz-tv-btn__text" aria-hidden="true">{{ t('tv.short') }}</span>
  </button>
</template>

<style scoped>
/* Como el botón de análisis; con puntero grueso, zona táctil de --tz-hit-min. */
.tz-tv-btn {
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

.tz-tv-btn::after {
  content: '';
  position: absolute;
  inset: min(0px, calc((100% - var(--tz-hit-min)) / 2));
}

.tz-tv-btn[aria-pressed='true'] {
  border-color: var(--tz-accent);
  background: var(--tz-accent-soft);
  color: var(--tz-accent-strong);
}

.tz-tv-btn:active:not(:disabled) {
  transform: scale(var(--tz-press-scale));
}

.tz-tv-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

/* Con ratón (puntero fino y hover), fuera: el menú «Cámara» y la tecla T bastan. */
@media (hover: hover) and (pointer: fine) {
  .tz-tv-btn {
    display: none;
  }
}

@media (width < 1600px) {
  .tz-tv-btn {
    padding: 0 var(--tz-space-2);
  }

  .tz-tv-btn__text {
    display: none;
  }
}
</style>
