<script setup lang="ts">
/**
 * Etiqueta común para todo lo que no es un dato real (principio de datos honestos): «≈ Estimado: <campo>». Es un
 * chip que se pulsa para ver por qué es estimado (una pista, como TzHint: en iPad un `title` no se ve nunca); con
 * ratón, la explicación también está en el título. Un campo desconocido (datos más nuevos) se muestra con su nombre.
 *
 * - `compact`: en la cabecera del replay, por debajo de 1600 px, el chip dice solo «≈ Estimado» (la cabecera tiene que
 *   caber en una fila). El campo sigue en el nombre accesible, en el título y en la explicación; la palabra «Estimado»
 *   no se esconde nunca.
 * - `plain`: sin botón, para cuando va dentro de algo que no admite controles (la tarjeta de la vista previa del
 *   timeline es un `role="tooltip"`): la explicación va en el título y, para lectores de pantalla, en el texto.
 *
 * El icono acompaña a la palabra «Estimado», nunca la sustituye (D30).
 */
const props = withDefaults(
  defineProps<{ field: string; params?: Record<string, string | number>; compact?: boolean; plain?: boolean }>(),
  { params: undefined, compact: false, plain: false },
)
const { t, te } = useI18n()
const label = computed(() =>
  te(`estimated.fields.${props.field}`) ? t(`estimated.fields.${props.field}`, props.params ?? {}) : props.field,
)
const hint = computed(() => (te(`estimated.hints.${props.field}`) ? t(`estimated.hints.${props.field}`) : t('estimated.hintUnknown')))
/** Nombre accesible del chip: empieza por lo que se ve («Estimado: …»). */
const name = computed(() => `${t('estimated.tag')} ${label.value}`)
</script>

<template>
  <span v-if="plain" class="tz-estimated is-plain" :title="hint" data-testid="estimated" :data-field="field">
    <TzIcon name="estimated" size="sm" class="tz-estimated__icon" />
    <span class="tz-estimated__tag">{{ t('estimated.tag') }}</span>
    {{ label }}
    <span class="tz-visually-hidden">. {{ hint }}</span>
  </span>
  <TzHint
    v-else
    class="tz-estimated"
    :class="{ 'is-compact': compact }"
    plain
    :label="name"
    :text="hint"
    :testid="`estimated-${field}-why`"
    :title="hint"
    data-testid="estimated"
    :data-field="field"
  >
    <template #button>
      <TzIcon name="estimated" size="sm" class="tz-estimated__icon" />
      <span class="tz-estimated__tag">{{ t('estimated.tag') }}</span>
      <span class="tz-estimated__short" aria-hidden="true">{{ t('estimated.tagShort') }}</span>
      <span class="tz-estimated__label">{{ label }}</span>
    </template>
  </TzHint>
</template>

<style scoped>
.tz-estimated {
  display: inline-flex;
  align-items: center;
  gap: var(--tz-space-1);
  border: 1px dashed var(--tz-estimated);
  border-radius: var(--tz-radius-pill);
  color: var(--tz-estimated);
  font-size: var(--tz-text-xs);
  line-height: var(--tz-leading-tight);
  white-space: nowrap;
}

.tz-estimated.is-plain {
  padding: var(--tz-space-0-5) var(--tz-space-2);
}

/* El chip entero es el botón de la pista (el borde discontinuo es el del chip). */
.tz-estimated :deep(.tz-hint__trigger) {
  padding: var(--tz-space-0-5) var(--tz-space-2);
  border-radius: var(--tz-radius-pill);
}

.tz-estimated :deep(.tz-hint__trigger[aria-expanded='true']) {
  background: var(--tz-accent-soft);
}

.tz-estimated__icon {
  flex: none;
}

.tz-estimated__tag {
  font-weight: var(--tz-weight-semibold);
}

/* «Estimado» sin dos puntos: solo en el chip compacto. */
.tz-estimated__short {
  display: none;
  font-weight: var(--tz-weight-semibold);
}

@media (hover: hover) {
  .tz-estimated :deep(.tz-hint__trigger:hover) {
    background: var(--tz-accent-soft);
  }
}

/*
 * Compacto (cabecera del replay, < 1600 px): se ve «≈ Estimado»; «Estimado: <campo>» sigue en el nombre accesible,
 * en el título y en la explicación que se abre al pulsar.
 */
@media (width < 1600px) {
  .tz-estimated.is-compact .tz-estimated__tag,
  .tz-estimated.is-compact .tz-estimated__label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .tz-estimated.is-compact .tz-estimated__short {
    display: inline;
  }
}
</style>
