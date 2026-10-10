<script setup lang="ts">
/** Etiqueta común para todo lo que no es un dato real (principio de datos honestos). */
defineProps<{ hint?: string }>()
const { t } = useI18n()
</script>

<template>
  <span class="tz-estimated" :title="hint" data-testid="estimated">
    <span class="tz-estimated__tag">{{ t('estimated.tag') }}</span>
    <slot />
  </span>
</template>

<style scoped>
.tz-estimated {
  display: inline-flex;
  align-items: center;
  gap: var(--tz-space-1);
  padding: 2px var(--tz-space-2);
  border: 1px dashed var(--tz-estimated);
  border-radius: var(--tz-radius-pill);
  color: var(--tz-estimated);
  font-size: var(--tz-text-xs);
}

.tz-estimated__tag {
  font-weight: var(--tz-weight-semibold);
}
</style>
