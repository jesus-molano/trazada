<script setup lang="ts">
/**
 * Marca compacta del replay (D44): el replay no lleva la cabecera global (layouts/replay.vue), así que su cabecera
 * empieza por la marca, «← Trazada» (vuelve al selector). Limpia, sin el piano (D50); el idioma va en el grupo «Ayuda»
 * (TzLangToggle).
 */
const { t } = useI18n()
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


@media (hover: hover) {
  .tz-brandbar__brand:hover {
    text-decoration: none;
    color: var(--tz-accent-strong);
  }
}
</style>
