<script setup lang="ts">
import type { CatalogEvent, CatalogSession } from '@trazada/schema'
import { sessionIdFromManifestPath } from '~/data/session-id'
import { useCatalogStore } from '~/stores/catalog'

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const catalog = useCatalogStore()

onMounted(() => catalog.load())

const eventKey = (e: CatalogEvent) => `${String(e.round).padStart(2, '0')}-${e.slug}`

const season = computed<number>(() => {
  const q = Number(route.query.season)
  if (catalog.seasons.includes(q)) return q
  // Por defecto, la temporada más reciente con datos.
  return catalog.seasons.find((s) => catalog.eventsOf(s).length > 0) ?? catalog.seasons[0]!
})
const events = computed(() => catalog.eventsOf(season.value))
const selectedEvent = computed<CatalogEvent | null>(() => {
  const q = typeof route.query.event === 'string' ? route.query.event : null
  return events.value.find((e) => eventKey(e) === q) ?? null
})

function selectSeason(s: number) {
  void router.replace({ query: { season: String(s) } })
}
function selectEvent(e: CatalogEvent) {
  void router.replace({ query: { season: String(season.value), event: eventKey(e) } })
}

function sessionLink(s: CatalogSession): string | null {
  const id = sessionIdFromManifestPath(s.path)
  return id && s.status !== 'no-position' ? `/replay?s=${id}` : null
}
</script>

<template>
  <div class="tz-selector">
    <div v-if="catalog.status === 'error'" class="tz-selector__state" role="alert" data-testid="catalog-error">
      <p>{{ t('selector.error') }}</p>
      <button type="button" class="tz-button" @click="catalog.load(true)">{{ t('selector.retry') }}</button>
    </div>
    <div
      v-else-if="catalog.status !== 'ready'"
      class="tz-selector__state"
      aria-live="polite"
      data-testid="catalog-loading"
    >
      {{ t('selector.loading') }}
    </div>

    <template v-else>
      <nav class="tz-seasons" :aria-label="t('selector.seasons')">
        <ul role="list">
          <li v-for="s in catalog.seasons" :key="s">
            <button
              type="button"
              class="tz-season"
              :class="{ 'is-active': s === season }"
              :aria-pressed="s === season"
              :data-testid="`season-${s}`"
              @click="selectSeason(s)"
            >
              <span class="tz-tabular">{{ s }}</span>
            </button>
          </li>
        </ul>
      </nav>

      <p v-if="events.length === 0" class="tz-selector__state" data-testid="season-empty">
        {{ t('selector.emptySeason', { season }) }}
      </p>

      <div v-else class="tz-browse">
        <section class="tz-events" :aria-label="t('selector.events', { season })">
          <h2 class="tz-heading">{{ t('selector.events', { season }) }}</h2>
          <ul role="list" class="tz-event-list">
            <li v-for="e in events" :key="eventKey(e)">
              <button
                type="button"
                class="tz-event"
                :class="{ 'is-active': selectedEvent && eventKey(selectedEvent) === eventKey(e) }"
                :aria-pressed="!!selectedEvent && eventKey(selectedEvent) === eventKey(e)"
                :data-testid="`event-${e.slug}`"
                @click="selectEvent(e)"
              >
                <span class="tz-event__round tz-tabular">{{ t('selector.round', { round: e.round }) }}</span>
                <span class="tz-event__name">{{ e.event }}</span>
                <span class="tz-event__meta">
                  {{ e.country }}<template v-if="e.dateStart"> · {{ formatDate(e.dateStart, locale) }}</template>
                </span>
              </button>
            </li>
          </ul>
        </section>

        <section class="tz-sessions" :aria-label="t('selector.sessions')" aria-live="polite">
          <h2 class="tz-heading">{{ selectedEvent ? selectedEvent.event : t('selector.sessions') }}</h2>
          <p v-if="!selectedEvent" class="tz-muted">{{ t('selector.pickEvent') }}</p>
          <ul v-else role="list" class="tz-session-list">
            <li v-for="s in selectedEvent.sessions" :key="s.session">
              <NuxtLink
                v-if="sessionLink(s)"
                :to="sessionLink(s)!"
                class="tz-session"
                :data-testid="`session-${s.session}`"
              >
                <span class="tz-session__name">{{ t(`session.${s.session}`) }}</span>
                <span v-if="s.dev" class="tz-badge tz-badge--dev" :title="t('selector.devHint')">{{
                  t('selector.dev')
                }}</span>
                <span v-if="s.bytes" class="tz-session__size tz-tabular">{{ formatBytes(s.bytes, locale) }}</span>
              </NuxtLink>
              <div
                v-else
                class="tz-session is-disabled"
                aria-disabled="true"
                :title="t('selector.unavailableHint')"
                :data-testid="`session-${s.session}`"
              >
                <span class="tz-session__name">{{ t(`session.${s.session}`) }}</span>
                <span class="tz-badge">{{ t('selector.unavailable') }}</span>
                <span class="tz-visually-hidden">{{ t('selector.unavailableHint') }}</span>
              </div>
            </li>
          </ul>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.tz-selector {
  display: grid;
  gap: var(--tz-space-6);
}

.tz-selector__state {
  margin: 0;
  color: var(--tz-text-muted);
}

.tz-seasons ul,
.tz-event-list,
.tz-session-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.tz-seasons ul {
  display: flex;
  flex-wrap: wrap;
  gap: var(--tz-space-2);
}

.tz-season {
  padding: var(--tz-space-2) var(--tz-space-4);
  border: 1px solid var(--tz-border-strong);
  border-radius: var(--tz-radius-pill);
  background: transparent;
  font-weight: var(--tz-weight-semibold);
  cursor: pointer;
  transition:
    background-color var(--tz-dur-fast) var(--tz-ease-standard),
    border-color var(--tz-dur-fast) var(--tz-ease-standard);
}

.tz-season:hover,
.tz-event:hover {
  border-color: var(--tz-accent);
}

.tz-season.is-active {
  border-color: var(--tz-accent);
  background: var(--tz-accent-soft);
  color: var(--tz-accent-strong);
}

.tz-browse {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
  gap: var(--tz-space-6);
  align-items: start;
}

@media (width < 800px) {
  .tz-browse {
    grid-template-columns: minmax(0, 1fr);
  }
}

.tz-heading {
  margin: 0 0 var(--tz-space-3);
  font-size: var(--tz-text-sm);
  font-weight: var(--tz-weight-semibold);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--tz-text-muted);
}

.tz-event-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--tz-space-3);
}

.tz-event {
  display: grid;
  gap: var(--tz-space-1);
  width: 100%;
  padding: var(--tz-space-3) var(--tz-space-4);
  border: 1px solid var(--tz-border);
  border-radius: var(--tz-radius-md);
  background: var(--tz-surface-1);
  text-align: start;
  cursor: pointer;
  transition: border-color var(--tz-dur-fast) var(--tz-ease-standard);
}

.tz-event.is-active {
  border-color: var(--tz-accent);
  background: var(--tz-surface-2);
}

.tz-event__round {
  font-size: var(--tz-text-xs);
  color: var(--tz-text-faint);
}

.tz-event__name {
  font-weight: var(--tz-weight-semibold);
}

.tz-event__meta {
  font-size: var(--tz-text-sm);
  color: var(--tz-text-muted);
}

.tz-session-list {
  display: grid;
  gap: var(--tz-space-2);
}

.tz-session {
  display: flex;
  align-items: center;
  gap: var(--tz-space-3);
  padding: var(--tz-space-3) var(--tz-space-4);
  border: 1px solid var(--tz-border);
  border-radius: var(--tz-radius-md);
  background: var(--tz-surface-1);
  color: var(--tz-text);
}

a.tz-session:hover {
  border-color: var(--tz-accent);
  text-decoration: none;
}

.tz-session.is-disabled {
  color: var(--tz-text-faint);
  cursor: not-allowed;
}

.tz-session__name {
  flex: 1;
  font-weight: var(--tz-weight-medium);
}

.tz-session__size {
  font-size: var(--tz-text-sm);
  color: var(--tz-text-muted);
}

.tz-badge {
  padding: 2px var(--tz-space-2);
  border: 1px solid var(--tz-border-strong);
  border-radius: var(--tz-radius-pill);
  font-size: var(--tz-text-2xs);
  font-weight: var(--tz-weight-semibold);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.tz-badge--dev {
  border-color: var(--tz-estimated);
  color: var(--tz-estimated);
}

.tz-muted {
  margin: 0;
  color: var(--tz-text-muted);
}
</style>
