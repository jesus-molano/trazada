<script setup lang="ts">
/**
 * Avisos de calidad del manifest (`quality.notes`) en la cabecera del replay: un botón con cuántos hay que
 * despliega la lista. Se traducen por su código; uno desconocido se muestra con su texto original (en
 * español, como lo escribe el pipeline), nunca se esconde.
 *
 * Desde 2026 se añade, aparte y rotulado como información (icono ⓘ con su nombre), el aviso del reglamento de 2026
 * (`data/regulation.ts`): lo nuevo del reglamento no llega en el cronometraje público. No es del manifest: sale de la
 * temporada. Cuenta en la cifra del botón, que es lo que hay para leer en el panel; con solo ese aviso, el botón lleva
 * el icono de información en vez del de alerta. Sin nada que contar, no se pinta nada.
 *
 * La cabecera del replay tiene que caber en una fila: por debajo de 1920 px, el botón muestra el icono y la cifra
 * («⚠ 5»); la palabra («avisos») sigue en el texto y en el nombre accesible, que empieza por la cifra (WCAG 2.5.3).
 */
import type { QualityNote } from '@trazada/schema'
import { qualityNotes } from '~/data/quality-notes'
import { hasRegulation2026Notice } from '~/data/regulation'

const props = withDefaults(
  defineProps<{ notes: readonly (string | QualityNote)[] | undefined; season?: number | null }>(),
  { season: null },
)
const { t, locale } = useI18n()

const items = computed(() => qualityNotes(props.notes))
/** Aviso informativo del reglamento de 2026 (por la temporada, no por el manifest). */
const regulation = computed(() => hasRegulation2026Notice(props.season))
/** Lo que cuenta el botón: los avisos del procesado y, desde 2026, el del reglamento. */
const count = computed(() => items.value.length + (regulation.value ? 1 : 0))
const regulationTitleId = `regulation-title-${useId()}`
const numberFmt = computed(() => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 2 }))
const params = (p: Record<string, number | string>) =>
  Object.fromEntries(Object.entries(p).map(([k, v]) => [k, typeof v === 'number' ? numberFmt.value.format(v) : v]))
</script>

<template>
  <TzDisclosure
    v-if="count"
    :label="t('sessionNotes.button', { n: count }, count)"
    :name="t('sessionNotes.buttonName', { n: count }, count)"
    testid="session-notes"
    :icon="items.length ? 'alert' : 'info'"
    align="start"
  >
    <template #label>
      <span class="tz-tabular">{{ count }}</span>{{ ' ' }}<span class="tz-notes__word">{{ t('sessionNotes.word', count) }}</span>
    </template>
    <template v-if="items.length">
      <p class="tz-notes__title">{{ t('sessionNotes.title') }}</p>
      <ol class="tz-notes__list">
        <li v-for="(n, i) in items" :key="i" :data-code="n.code ?? 'unknown'">
          <span class="tz-notes__text">
            <template v-if="n.code">{{ t(`sessionNotes.note.${n.key}`, params(n.params)) }}</template>
            <template v-else>
              <span class="tz-notes__raw">{{ t('sessionNotes.raw') }}</span>
              <span lang="es">{{ n.text }}</span>
            </template>
          </span>
        </li>
      </ol>
    </template>
    <div
      v-if="regulation"
      class="tz-notes__info"
      :class="{ 'is-after': items.length }"
      role="group"
      :aria-labelledby="regulationTitleId"
      data-testid="regulation-notice"
    >
      <p :id="regulationTitleId" class="tz-notes__title tz-notes__info-title">
        <TzIcon name="info" size="sm" :label="t('regulation.info')" class="tz-notes__info-icon" />
        <span>{{ t('regulation.title') }}</span>
      </p>
      <p class="tz-notes__info-body">{{ t('regulation.body', { chip: t('trackStatus.overtake'), straight: t('rc.kind.straight_mode') }) }}</p>
    </div>
  </TzDisclosure>
</template>

<style scoped>
/* Por debajo de 1920 px, solo el icono y la cifra (la palabra sigue en el nombre accesible y en el título). */
@media (width < 1920px) {
  .tz-notes__word {
    display: none;
  }
}

.tz-notes__title {
  margin: 0 0 var(--tz-space-2);
  font-weight: var(--tz-weight-semibold);
}

/* Lista numerada con filetes (D50): la cifra, tenue y en su columna; sin viñetas ni cajas. */
.tz-notes__list {
  margin: 0;
  padding: 0;
  list-style: none;
  counter-reset: tz-note;
}

.tz-notes__list > li {
  display: grid;
  grid-template-columns: var(--tz-space-6) 1fr;
  padding: var(--tz-space-3) 0;
  border-top: 1px solid var(--tz-border);
  counter-increment: tz-note;
}

.tz-notes__list > li:first-child {
  border-top: 0;
  padding-top: var(--tz-space-1);
}

.tz-notes__list > li::before {
  content: counter(tz-note);
  color: var(--tz-text-faint);
  font-variant-numeric: tabular-nums;
}

.tz-notes__text {
  grid-column: 2;
}

.tz-notes__raw {
  margin-right: var(--tz-space-1);
  color: var(--tz-text-muted);
}

/* Aviso del reglamento: información, no un fallo del procesado; separado de la lista si la hay. */
.tz-notes__info.is-after {
  margin-top: var(--tz-space-3);
  padding-top: var(--tz-space-3);
  border-top: 1px solid var(--tz-border);
}

.tz-notes__info-title {
  display: flex;
  align-items: center;
  gap: var(--tz-space-1);
}

.tz-notes__info-icon {
  flex: none;
  color: var(--tz-text-muted);
}

.tz-notes__info-body {
  margin: 0;
  color: var(--tz-text-muted);
}
</style>
