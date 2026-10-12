<script setup lang="ts">
/** Cambio de idioma (es/en) de la cabecera del replay: en el grupo «Ayuda», ya no junto a la marca (D50). */
const { t, locale, setLocale } = useI18n()

async function toggleLocale() {
  await setLocale(locale.value === 'es' ? 'en' : 'es')
}
</script>

<template>
  <button type="button" class="tz-lang-toggle" :aria-label="t('app.switchLanguage')" data-testid="lang-toggle" @click="toggleLocale">
    {{ t('app.otherLocaleShort') }}
  </button>
</template>

<style scoped>
/* Botón fantasma de 32 px, como los demás de la cabecera; tono al pasar por encima. */
.tz-lang-toggle {
  position: relative;
  height: var(--tz-space-8);
  padding: 0 var(--tz-space-2);
  border: 0;
  border-radius: var(--tz-radius-md);
  background: transparent;
  color: var(--tz-text-muted);
  font-size: var(--tz-text-sm);
  font-weight: var(--tz-weight-semibold);
  cursor: pointer;
}

/* Zona táctil de --tz-hit-min con puntero grueso, sin mover el layout. */
.tz-lang-toggle::after {
  content: '';
  position: absolute;
  inset: min(0px, calc((100% - var(--tz-hit-min)) / 2)) 0;
}

@media (hover: hover) {
  .tz-lang-toggle:hover {
    background: var(--tz-surface-2);
    color: var(--tz-text);
  }
}
</style>
