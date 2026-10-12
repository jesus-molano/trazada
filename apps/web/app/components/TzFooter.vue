<script setup lang="ts">
/**
 * Pie con el disclaimer legal, completo y visible en todas las páginas. `compact` (layout del replay, D44): menos
 * relleno y a todo el ancho, para que la escena no pierda alto; el texto no se recorta nunca.
 */
withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })
const { t } = useI18n()
</script>

<template>
  <footer class="tz-footer" :class="{ 'is-compact': compact }" data-testid="disclaimer">
    <p>{{ t('legal.disclaimer') }}</p>
  </footer>
</template>

<style scoped>
.tz-footer {
  position: relative;
  z-index: var(--tz-z-panels);
  padding: var(--tz-space-3) var(--tz-space-6);
  border-top: 1px solid var(--tz-border);
  background: var(--tz-surface-1);
  color: var(--tz-text-faint);
  font-size: var(--tz-text-2xs);
  line-height: var(--tz-leading-normal);
}

.tz-footer p {
  margin: 0;
  max-width: 120ch;
}

.tz-footer.is-compact {
  padding: var(--tz-space-1) var(--tz-space-6);
  line-height: var(--tz-leading-tight);
}

.tz-footer.is-compact p {
  max-width: none;
}

/* Modo compacto del replay (móvil y ventanas pequeñas): el aviso sigue entero, con menos aire. */
@media (width < 768px), (height < 500px) {
  .tz-footer.is-compact {
    padding: var(--tz-space-0-5) var(--tz-space-3);
  }
}
</style>
