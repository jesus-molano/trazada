<script setup lang="ts">
/**
 * «Seguir viendo» en la portada (ítem 13): las 3 sesiones vistas más recientes con una posición guardada, con lo
 * visto, dónde se dejaron y cuándo, y × para olvidarlas. Solo salen las que siguen en el catálogo y se pueden
 * reproducir (una sesión borrada no aparece). Lo guardado vive en este navegador (localStorage, D41), así que se lee
 * al montar: la portada se prerenderiza sin la tarjeta.
 */
import { type ContinueItem, continueItems, relativeTime, type ResumeEntry, resumeStore } from '~/replay/resume'
import { useCatalogStore } from '~/stores/catalog'

const { t, locale } = useI18n()
const catalog = useCatalogStore()
const label = useResumeLabel()
const headingId = `continue-${useId()}`

const entries = shallowRef<readonly ResumeEntry[]>([])
/** Reloj de pared para «hace 2 h» (al montar basta: la portada no se queda abierta horas). */
const now = ref(0)
onMounted(() => {
  entries.value = resumeStore.list()
  now.value = Date.now()
  void catalog.load()
})

const items = computed(() => continueItems(entries.value, catalog.status === 'ready' ? catalog.catalog : null))

const relative = computed(() => new Intl.RelativeTimeFormat(locale.value, { numeric: 'auto', style: 'short' }))
const percent = computed(() => new Intl.NumberFormat(locale.value, { style: 'percent', maximumFractionDigits: 0 }))

const sessionName = (item: ContinueItem) => `${t(`session.${item.type}`)} · ${item.season}`
const fullName = (item: ContinueItem) => `${item.event} · ${sessionName(item)}`
function ago(item: ContinueItem): string {
  const { value, unit } = relativeTime(now.value - item.entry.savedAt)
  return relative.value.format(value, unit)
}
const barStyle = (item: ContinueItem) => ({ transform: `scaleX(${item.progress})` })

const list = ref<HTMLElement | null>(null)
/** Olvida una sesión; el foco pasa al × de la que ocupa su lugar (o de la última) para no caer al <body>. */
async function forget(id: string, index: number) {
  resumeStore.forget(id)
  entries.value = resumeStore.list()
  await nextTick()
  const buttons = list.value?.querySelectorAll<HTMLElement>('[data-testid="continue-forget"]') ?? []
  buttons[Math.min(index, buttons.length - 1)]?.focus()
}
</script>

<template>
  <section v-if="items.length > 0" class="tz-continue" :aria-labelledby="headingId" data-testid="continue">
    <h2 :id="headingId" class="tz-continue__title">{{ t('resume.continue.title') }}</h2>
    <ul ref="list" role="list" class="tz-continue__list">
      <li v-for="(item, i) in items" :key="item.entry.id" class="tz-continue__item" :data-session="item.entry.id">
        <NuxtLink :to="`/replay?s=${item.entry.id}`" class="tz-continue__link" data-testid="continue-link">
          <span class="tz-visually-hidden">{{ t('resume.continue.title') }}</span>
          <span class="tz-continue__name"><TzFlag :country="item.country" />{{ item.event }}</span>
          <span class="tz-continue__where tz-tabular" data-testid="continue-where">
            {{ t('resume.continue.where', { session: sessionName(item), at: label(item.entry) }) }}
          </span>
          <span class="tz-continue__ago">{{ ago(item) }}</span>
          <span class="tz-continue__bar" aria-hidden="true"><span :style="barStyle(item)" /></span>
          <span class="tz-visually-hidden">{{ t('resume.continue.progress', { pct: percent.format(item.progress) }) }}</span>
        </NuxtLink>
        <button
          type="button"
          class="tz-iconbtn tz-continue__forget"
          :aria-label="t('resume.continue.forget', { session: fullName(item) })"
          :title="t('resume.continue.forget', { session: fullName(item) })"
          data-testid="continue-forget"
          @click="forget(item.entry.id, i)"
        >
          <TzIcon name="close" />
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.tz-continue {
  display: grid;
  gap: var(--tz-space-3);
}

.tz-continue__title {
  margin: 0;
  font-size: var(--tz-text-sm);
  font-weight: var(--tz-weight-semibold);
  letter-spacing: var(--tz-tracking-caps);
  text-transform: uppercase;
  color: var(--tz-text-muted);
}

.tz-continue__list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--tz-space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.tz-continue__item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: var(--tz-space-1);
  padding-right: var(--tz-space-2);
  border: 1px solid var(--tz-border);
  border-radius: var(--tz-radius-md);
  background: var(--tz-surface-1);
  transition: border-color var(--tz-dur-fast) var(--tz-ease-standard);
}

@media (hover: hover) {
  .tz-continue__item:hover {
    border-color: var(--tz-accent);
  }
}

/* Toda la tarjeta (menos el ×) es el enlace; con puntero grueso, al menos --tz-hit-min (44 px) de alto. */
.tz-continue__link {
  display: grid;
  gap: var(--tz-space-1);
  min-width: 0;
  min-height: var(--tz-hit-min);
  padding: var(--tz-space-3) var(--tz-space-2) var(--tz-space-3) var(--tz-space-4);
  border-radius: var(--tz-radius-md);
  color: var(--tz-text);
}

@media (hover: hover) {
  .tz-continue__link:hover {
    text-decoration: none;
  }
}

.tz-continue__name {
  display: flex;
  align-items: first baseline;
  gap: var(--tz-space-2);
  font-weight: var(--tz-weight-semibold);
}

.tz-continue__where {
  font-size: var(--tz-text-sm);
  color: var(--tz-text);
}

.tz-continue__ago {
  font-size: var(--tz-text-xs);
  color: var(--tz-text-muted);
}

/* Lo visto: barra fina (decorativa; el porcentaje va en texto para los lectores de pantalla). */
.tz-continue__bar {
  display: block;
  height: var(--tz-space-1);
  margin-top: var(--tz-space-1);
  overflow: hidden;
  border-radius: var(--tz-radius-pill);
  background: var(--tz-surface-3);
}

.tz-continue__bar > span {
  display: block;
  height: 100%;
  background: var(--tz-accent);
  transform-origin: left center;
}

.tz-continue__forget {
  margin-top: var(--tz-space-2);
}
</style>
