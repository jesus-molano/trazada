<script setup lang="ts">
/**
 * Marca compacta del replay (D44): el replay no lleva la cabecera global (layouts/replay.vue), así que su cabecera
 * empieza por la marca, «← TRAZADA» (vuelve al selector), con el piano debajo (D47: solo bajo la marca y en la pestaña
 * activa del análisis), y el cambio de idioma. Ocupa una sola fila de la cabecera, a la altura de sus chips.
 */
const { t, locale, setLocale } = useI18n()

async function toggleLocale() {
  await setLocale(locale.value === 'es' ? 'en' : 'es')
}
</script>

<template>
  <div class="tz-brandbar" data-testid="brand-bar">
    <NuxtLink
      to="/"
      class="tz-brandbar__brand"
      :aria-label="t('ui.brand.name', { app: t('app.name') })"
      :title="t('ui.brand.back')"
      data-testid="brand-link"
    >
      <TzIcon name="back" size="sm" />
      <span class="tz-brandbar__word">{{ t('app.name') }}</span>
    </NuxtLink>
    <button
      type="button"
      class="tz-brandbar__lang"
      :aria-label="t('app.switchLanguage')"
      data-testid="lang-toggle"
      @click="toggleLocale"
    >
      {{ t('app.otherLocaleShort') }}
    </button>
  </div>
</template>

<style scoped>
.tz-brandbar {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: var(--tz-space-2);
}

/* «← TRAZADA»: rótulo condensado en mayúsculas, como en la cabecera de la portada, con el piano debajo. */
.tz-brandbar__brand {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: var(--tz-space-1);
  height: 28px;
  padding: 0 var(--tz-space-1) var(--tz-space-0-5) 0;
  color: var(--tz-text);
  font-family: var(--tz-font-display);
  font-size: var(--tz-text-lg);
  font-weight: var(--tz-weight-bold);
  letter-spacing: var(--tz-tracking-display);
  line-height: var(--tz-leading-none);
  text-transform: uppercase;
  white-space: nowrap;
}

.tz-brandbar__brand :deep(.tz-icon) {
  color: var(--tz-text-muted);
}

/* Piano (kerb) bajo la palabra: decorativo, rojo siempre en pareja con el blanco. */
.tz-brandbar__brand::after {
  content: '';
  position: absolute;
  right: var(--tz-space-1);
  bottom: 0;
  left: calc(var(--tz-icon-sm) + var(--tz-space-1));
  height: 3px;
  background: var(--tz-kerb);
  pointer-events: none;
}

.tz-brandbar__lang {
  position: relative;
  height: 28px;
  padding: 0 var(--tz-space-2);
  border: 1px solid var(--tz-border-strong);
  border-radius: var(--tz-radius-pill);
  background: var(--tz-overlay);
  font-size: var(--tz-text-xs);
  font-weight: var(--tz-weight-semibold);
  cursor: pointer;
  transition: border-color var(--tz-dur-fast) var(--tz-ease-standard);
}

/* Zona táctil de --tz-hit-min con puntero grueso, sin mover el layout. */
.tz-brandbar__lang::after {
  content: '';
  position: absolute;
  inset: min(0px, calc((100% - var(--tz-hit-min)) / 2)) 0;
}

@media (hover: hover) {
  .tz-brandbar__brand:hover {
    text-decoration: none;
    color: var(--tz-accent-strong);
  }

  .tz-brandbar__lang:hover {
    border-color: var(--tz-accent);
  }
}
</style>
