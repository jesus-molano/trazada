<script setup lang="ts">
import type { SessionType } from '@trazada/schema'
import {
  type BrowseEvent,
  type BrowseSession,
  downloadable,
  eventKey,
  jobKey,
  mergeEvents,
  queueSummary,
  sessionView,
} from '~/manager/model'
import { useCatalogStore } from '~/stores/catalog'
import { useManagerStore } from '~/stores/manager'

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const catalog = useCatalogStore()
const manager = useManagerStore()

/** Reloj de pared para saber qué sesiones ya se pueden descargar (cada 30 s basta). */
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | null = null
let unsubscribe: (() => void) | null = null
onMounted(() => {
  void catalog.load()
  unsubscribe = manager.subscribe()
  clock = setInterval(() => (now.value = Date.now()), 30_000)
})
onBeforeUnmount(() => {
  unsubscribe?.()
  if (clock) clearInterval(clock)
})

const season = computed<number>(() => {
  const q = Number(route.query.season)
  if (catalog.seasons.includes(q)) return q
  // Por defecto, la temporada más reciente con datos.
  return catalog.seasons.find((s) => catalog.eventsOf(s).length > 0) ?? catalog.seasons[0]!
})

// Con el gestor local, el calendario de la temporada elegida (para ofrecer lo que falta por descargar).
watch(
  [season, () => manager.available],
  ([s, available]) => {
    if (available) void manager.loadSchedule(s)
  },
  { immediate: true },
)
const scheduleState = computed(() => (manager.available ? (manager.schedules[season.value] ?? null) : null))
const events = computed(() =>
  mergeEvents(catalog.eventsOf(season.value), scheduleState.value?.schedule?.events ?? null),
)
const selectedEvent = computed<BrowseEvent | null>(() => {
  const q = typeof route.query.event === 'string' ? route.query.event : null
  return events.value.find((e) => e.key === q) ?? null
})

function selectSeason(s: number) {
  void router.replace({ query: { season: String(s) } })
}
function selectEvent(e: BrowseEvent) {
  void router.replace({ query: { season: String(season.value), event: eventKey(e) } })
}

function viewOf(e: BrowseEvent, s: BrowseSession) {
  const job = manager.jobsByKey.get(jobKey({ season: season.value, round: e.round, session: s.session })) ?? null
  return sessionView(s, job, now.value, manager.available)
}

function builtCount(e: BrowseEvent): number {
  return e.sessions.filter((s) => viewOf(e, s).kind === 'link').length
}

const eventMissing = computed(() =>
  selectedEvent.value && manager.available
    ? downloadable(season.value, selectedEvent.value, manager.jobsByKey, now.value)
    : [],
)
const seasonRacesMissing = computed(() =>
  manager.available
    ? events.value.flatMap((e) => downloadable(season.value, e, manager.jobsByKey, now.value, 'race'))
    : [],
)

function download(e: BrowseEvent, session: SessionType) {
  void manager.enqueue([{ season: season.value, round: e.round, session }])
}

const queue = computed(() => queueSummary(manager.jobs))
const queueText = computed(() => {
  const running = queue.value.running
  if (!running) return t('manager.queueWaiting', queue.value.queued)
  const text = t('manager.queueRunning', {
    season: running.season,
    round: running.round,
    session: t(`session.${running.session}`),
    pct: Math.round(running.pct),
  })
  return queue.value.queued ? `${text} · ${t('manager.queueMore', queue.value.queued)}` : text
})
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

      <div v-if="manager.available" class="tz-manager" data-testid="manager">
        <div v-if="queue.active > 0" class="tz-manager__queue" data-testid="download-queue">
          <span class="tz-manager__text">{{ queueText }}</span>
          <button
            type="button"
            class="tz-button tz-button--quiet tz-manager__action"
            data-testid="cancel-all"
            @click="manager.cancelAll()"
          >
            {{ t('manager.cancelAll') }}
          </button>
        </div>
        <p v-if="manager.actionError" class="tz-manager__alert" role="alert" data-testid="manager-error">
          {{ t('manager.actionError') }}
        </p>
        <p
          v-if="scheduleState?.status === 'loading'"
          class="tz-muted"
          aria-live="polite"
          data-testid="schedule-loading"
        >
          {{ t('manager.scheduleLoading', { season }) }}
        </p>
        <div v-else-if="scheduleState?.status === 'error'" class="tz-manager__alert" role="alert" data-testid="schedule-error">
          <span>{{ t('manager.scheduleError', { season }) }} {{ t(`manager.error.${scheduleState.error ?? 'failed'}`) }}</span>
          <button type="button" class="tz-button tz-manager__action" @click="manager.loadSchedule(season, true)">
            {{ t('selector.retry') }}
          </button>
        </div>
      </div>

      <p v-if="events.length === 0 && scheduleState?.status !== 'loading'" class="tz-selector__state" data-testid="season-empty">
        {{ t('selector.emptySeason', { season }) }}
      </p>

      <div v-else-if="events.length > 0" class="tz-browse">
        <section class="tz-events" :aria-label="t('selector.events', { season })">
          <div class="tz-heading-row">
            <h2 class="tz-heading">{{ t('selector.events', { season }) }}</h2>
            <button
              v-if="seasonRacesMissing.length > 0"
              type="button"
              class="tz-button tz-button--quiet tz-manager__action"
              :title="t('manager.downloadHint')"
              data-testid="download-season-races"
              @click="manager.enqueue(seasonRacesMissing)"
            >
              {{ t('manager.downloadSeasonRaces', seasonRacesMissing.length) }}
            </button>
          </div>
          <ul role="list" class="tz-event-list">
            <li v-for="e in events" :key="e.key">
              <button
                type="button"
                class="tz-event"
                :class="{ 'is-active': selectedEvent?.key === e.key }"
                :aria-pressed="selectedEvent?.key === e.key"
                :data-testid="`event-${e.slug}`"
                @click="selectEvent(e)"
              >
                <span class="tz-event__top">
                  <span class="tz-event__round tz-tabular">{{ t('selector.round', { round: e.round }) }}</span>
                  <span
                    v-if="manager.available && e.scheduled"
                    class="tz-event__built tz-tabular"
                    :class="{ 'is-complete': builtCount(e) === e.sessions.length }"
                    :title="t('manager.builtLabel', { built: builtCount(e), total: e.sessions.length })"
                    :data-testid="`built-${e.slug}`"
                  >
                    {{ t('manager.built', { built: builtCount(e), total: e.sessions.length }) }}
                    <span class="tz-visually-hidden">{{
                      t('manager.builtLabel', { built: builtCount(e), total: e.sessions.length })
                    }}</span>
                  </span>
                </span>
                <span class="tz-event__name">{{ e.event }}</span>
                <span class="tz-event__meta">
                  {{ e.country }}<template v-if="e.dateStart"> · {{ formatDate(e.dateStart, locale) }}</template>
                </span>
              </button>
            </li>
          </ul>
        </section>

        <section class="tz-sessions" :aria-label="t('selector.sessions')">
          <div class="tz-heading-row">
            <h2 class="tz-heading" aria-live="polite">
              {{ selectedEvent ? selectedEvent.event : t('selector.sessions') }}
            </h2>
            <button
              v-if="eventMissing.length > 1"
              type="button"
              class="tz-button tz-button--quiet tz-manager__action"
              :title="t('manager.downloadHint')"
              data-testid="download-event"
              @click="manager.enqueue(eventMissing)"
            >
              {{ t('manager.downloadEvent', eventMissing.length) }}
            </button>
          </div>
          <p v-if="!selectedEvent" class="tz-muted">{{ t('selector.pickEvent') }}</p>
          <ul v-else role="list" class="tz-session-list">
            <li v-for="s in selectedEvent.sessions" :key="s.session">
              <TzSessionRow
                :type="s.session"
                :view="viewOf(selectedEvent, s)"
                @download="download(selectedEvent, s.session)"
                @cancel="(id) => manager.cancel(id)"
              />
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

.tz-muted {
  margin: 0;
  color: var(--tz-text-muted);
}

.tz-heading-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--tz-space-2) var(--tz-space-4);
  margin-bottom: var(--tz-space-3);
}

.tz-heading-row .tz-heading {
  margin: 0;
}

.tz-event__top {
  display: flex;
  justify-content: space-between;
  gap: var(--tz-space-2);
}

.tz-event__built {
  font-size: var(--tz-text-xs);
  color: var(--tz-text-faint);
}

.tz-event__built.is-complete {
  color: var(--tz-success);
}

.tz-manager {
  display: grid;
  gap: var(--tz-space-3);
}

.tz-manager:empty {
  display: none;
}

.tz-manager__queue,
.tz-manager__alert {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--tz-space-2) var(--tz-space-4);
  margin: 0;
  padding: var(--tz-space-3) var(--tz-space-4);
  border: 1px solid var(--tz-accent);
  border-radius: var(--tz-radius-md);
  background: var(--tz-surface-1);
}

.tz-manager__alert {
  border-color: var(--tz-danger);
}

.tz-manager__text {
  flex: 1;
}

.tz-manager__action {
  padding: var(--tz-space-1) var(--tz-space-3);
  font-size: var(--tz-text-sm);
}
</style>
