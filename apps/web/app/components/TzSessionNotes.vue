<script setup lang="ts">
/**
 * Avisos de calidad del manifest (`quality.notes`) en la cabecera del replay: un botón con cuántos hay que
 * despliega la lista. Se traducen por su código; uno desconocido se muestra con su texto original (en
 * español, como lo escribe el pipeline), nunca se esconde. Sin avisos, no se pinta nada.
 *
 * La cabecera del replay tiene que caber en una fila: por debajo de 1600 px, el botón muestra el icono y la cifra
 * («⚠ 5»); la palabra («avisos») sigue en el texto y en el nombre accesible, que empieza por la cifra (WCAG 2.5.3).
 */
import type { QualityNote } from '@trazada/schema'
import { qualityNotes } from '~/data/quality-notes'

const props = defineProps<{ notes: readonly (string | QualityNote)[] | undefined }>()
const { t, locale } = useI18n()

const items = computed(() => qualityNotes(props.notes))
const numberFmt = computed(() => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 2 }))
const params = (p: Record<string, number | string>) =>
  Object.fromEntries(Object.entries(p).map(([k, v]) => [k, typeof v === 'number' ? numberFmt.value.format(v) : v]))
</script>

<template>
  <TzDisclosure
    v-if="items.length"
    :label="t('sessionNotes.button', { n: items.length }, items.length)"
    :name="t('sessionNotes.buttonName', { n: items.length }, items.length)"
    testid="session-notes"
    icon="alert"
    align="start"
  >
    <template #label>
      <span class="tz-tabular">{{ items.length }}</span>{{ ' ' }}<span class="tz-notes__word">{{
        t('sessionNotes.word', items.length)
      }}</span>
    </template>
    <p class="tz-notes__title">{{ t('sessionNotes.title') }}</p>
    <ul class="tz-notes__list">
      <li v-for="(n, i) in items" :key="i" :data-code="n.code ?? 'unknown'">
        <template v-if="n.code">{{ t(`sessionNotes.note.${n.key}`, params(n.params)) }}</template>
        <template v-else>
          <span class="tz-notes__raw">{{ t('sessionNotes.raw') }}</span>
          <span lang="es">{{ n.text }}</span>
        </template>
      </li>
    </ul>
  </TzDisclosure>
</template>

<style scoped>
/* Por debajo de 1600 px, solo el icono y la cifra (la palabra sigue en el nombre accesible y en el título). */
@media (width < 1600px) {
  .tz-notes__word {
    display: none;
  }
}

.tz-notes__title {
  margin: 0 0 var(--tz-space-2);
  font-weight: var(--tz-weight-semibold);
}

.tz-notes__list {
  display: grid;
  gap: var(--tz-space-2);
  margin: 0;
  padding-left: var(--tz-space-4);
}

.tz-notes__raw {
  margin-right: var(--tz-space-1);
  color: var(--tz-text-muted);
}
</style>
