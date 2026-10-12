<script setup lang="ts">
/**
 * Aviso de build vieja (plugins/stale-build.client.ts): no modal, abajo y al centro, con «Recargar» y cerrar. Lo anuncia
 * `role="status"` (sin robar el foco).
 */
const { t } = useI18n()
const stale = useState('tz-stale-build', () => false)
const dismissed = ref(false)
const reload = () => window.location.reload()
</script>

<template>
  <div v-if="stale && !dismissed" class="tz-stale tz-enter" role="status" data-testid="stale-build">
    <TzIcon name="info" size="sm" class="tz-stale__icon" />
    <p class="tz-stale__text">{{ t('staleBuild.text') }}</p>
    <button type="button" class="tz-button tz-stale__reload" data-testid="stale-build-reload" @click="reload">
      {{ t('staleBuild.reload') }}
    </button>
    <button
      type="button"
      class="tz-iconbtn tz-stale__close"
      :aria-label="t('staleBuild.close')"
      data-testid="stale-build-close"
      @click="dismissed = true"
    >
      <TzIcon name="close" size="sm" />
    </button>
  </div>
</template>

<style scoped>
.tz-stale {
  position: fixed;
  left: 50%;
  bottom: var(--tz-space-6);
  z-index: var(--tz-z-overlay);
  display: flex;
  align-items: center;
  gap: var(--tz-space-2);
  max-width: min(560px, calc(100vw - 2 * var(--tz-space-4)));
  padding: var(--tz-space-2) var(--tz-space-2) var(--tz-space-2) var(--tz-space-3);
  border: 1px solid var(--tz-border-strong);
  border-radius: var(--tz-radius-lg);
  background: var(--tz-surface-3);
  box-shadow: var(--tz-shadow-panel);
  translate: -50% 0;
}

.tz-stale__icon {
  flex: none;
  color: var(--tz-text-muted);
}

.tz-stale__text {
  margin: 0;
  font-size: var(--tz-text-sm);
}

.tz-stale__reload,
.tz-stale__close {
  flex: none;
}
</style>
