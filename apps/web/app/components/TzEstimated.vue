<script setup lang="ts">
/**
 * Etiqueta común para todo lo que no es un dato real (principio de datos honestos): "Estimado: <campo>",
 * con la explicación en el título. Un campo desconocido (datos más nuevos) se muestra con su nombre.
 */
const props = defineProps<{ field: string; params?: Record<string, string | number> }>()
const { t, te } = useI18n()
const label = computed(() =>
  te(`estimated.fields.${props.field}`) ? t(`estimated.fields.${props.field}`, props.params ?? {}) : props.field,
)
const hint = computed(() => (te(`estimated.hints.${props.field}`) ? t(`estimated.hints.${props.field}`) : t('estimated.hintUnknown')))
</script>

<template>
  <span class="tz-estimated" :title="hint" data-testid="estimated" :data-field="field">
    <span class="tz-estimated__tag">{{ t('estimated.tag') }}</span>
    {{ label }}
    <span class="tz-visually-hidden">. {{ hint }}</span>
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
  white-space: nowrap;
}

.tz-estimated__tag {
  font-weight: var(--tz-weight-semibold);
}
</style>
