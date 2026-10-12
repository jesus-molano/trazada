<script setup lang="ts">
import type { SessionType } from '@trazada/schema'
import { STAGGER_MAX_STEPS } from '~/design/motion'
import {
  type BrowseEvent,
  type BrowseSession,
  downloadable,
  eventKey,
  jobKey,
  mergeEvents,
  queueSummary,
  readyCount,
  sessionView,
} from '~/manager/model'
import { useCatalogStore } from '~/stores/catalog'
import { useManagerStore } from '~/stores/manager'
import { countryLabel } from '~/venues/countries'
import { outlineFor } from '~/venues/outlines'

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
  browseObserver?.disconnect()
  narrowQuery?.removeEventListener('change', onNarrow)
})

/**
 * Portada estrecha (< 1100 px, D50): el panel de sesiones se abre a lo ancho justo debajo de la fila de la tarjeta
 * tocada, sin desplazar la página (el foco va a su título). Para colocarlo hace falta saber cuántas tarjetas caben por
 * fila: se mide al cambiar de tamaño (estado grueso), nunca por frame.
 */
const NARROW_QUERY = '(width < 1100px)'
const narrow = ref(false)
const columns = ref(1)
const browse = ref<HTMLElement | null>(null)
let narrowQuery: MediaQueryList | null = null
let browseObserver: ResizeObserver | null = null
function onNarrow() {
  narrow.value = !!narrowQuery?.matches
  measureColumns()
}
function measureColumns() {
  const el = browse.value
  if (!el || !narrow.value) return
  columns.value = Math.max(1, getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length)
}
onMounted(() => {
  narrowQuery = window.matchMedia(NARROW_QUERY)
  narrowQuery.addEventListener('change', onNarrow)
  onNarrow()
  if (typeof ResizeObserver !== 'undefined') {
    browseObserver = new ResizeObserver(measureColumns)
    watch(
      browse,
      (el, old) => {
        if (old) browseObserver?.unobserve(old)
        if (el) browseObserver?.observe(el)
        measureColumns()
      },
      { immediate: true },
    )
  }
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

/**
 * Las listas (tarjetas y sesiones) solo entran animadas tras un cambio que pide el usuario (otra temporada u otro
 * Gran Premio), nunca al cargar: la portada aparece quieta, y ningún texto se lee (ni se mide) a medio fundir.
 */
const animateLists = ref(false)

function selectSeason(s: number) {
  animateLists.value = true
  void router.replace({ query: { season: String(s) } })
}
function selectEvent(e: BrowseEvent) {
  animateLists.value = true
  void router.replace({ query: { season: String(season.value), event: eventKey(e) } }).then(async () => {
    // El foco, al título del panel (que ya es aria-live), sin mover la página: en estrecho se abre justo debajo.
    await nextTick()
    sessionsHeading.value?.focus({ preventScroll: true })
  })
}

/** Orden en la rejilla estrecha: las tarjetas en pares y el panel justo detrás de la última de la fila elegida. */
const selectedIndex = computed(() => (selectedEvent.value ? events.value.findIndex((e) => e.key === selectedEvent.value!.key) : -1))
const panelOrder = computed(() => {
  const n = events.value.length
  const i = selectedIndex.value
  if (i < 0) return 2 * n + 1
  const cols = columns.value
  return 2 * Math.min(n - 1, Math.floor(i / cols) * cols + cols - 1) + 1
})
const cardStyle = (i: number) => ({ ...enterStep(i), order: narrow.value ? 2 * i : undefined })

function viewOf(e: BrowseEvent, s: BrowseSession) {
  const job = manager.jobsByKey.get(jobKey({ season: season.value, round: e.round, session: s.session })) ?? null
  return sessionView(s, job, now.value, manager.available)
}

/**
 * País (en el idioma de la interfaz) y fecha del primer día; sin país (sesiones dev), solo la fecha. Sin ninguno de
 * los dos, cadena vacía: la tarjeta dice «sin dato».
 */
function eventMeta(e: BrowseEvent): string {
  return [e.country ? countryLabel(e.country, locale.value) : '', e.dateStart ? formatDate(e.dateStart, locale.value) : '']
    .filter(Boolean)
    .join(' · ')
}

/** Sesiones listas para ver (las «no disponibles» no cuentan: se generaron, pero no se pueden reproducir). */
function builtCount(e: BrowseEvent): number {
  return readyCount(e.sessions.map((s) => viewOf(e, s)))
}

/**
 * Paso de la entrada escalonada (tz-enter) de la tarjeta `index`, con el tope de motion.ts: la duración del paso
 * es --tz-stagger, que vale 0 con prefers-reduced-motion. Solo se anima la aparición, nunca una cifra (D42).
 */
const enterStep = (index: number) => ({ '--i': Math.min(index, STAGGER_MAX_STEPS) })

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

// Los botones de bloque y «Cancelar todo» desaparecen al usarlos: el foco pasa a un sitio estable.
const cancelAllButton = ref<HTMLButtonElement | null>(null)
const sessionsHeading = ref<HTMLElement | null>(null)
async function keepFocus(action: Promise<void>, ...targets: (() => HTMLElement | null)[]) {
  await action
  await nextTick()
  if (document.activeElement && document.activeElement !== document.body) return
  for (const target of targets) {
    const el = target()
    if (el?.isConnected) {
      el.focus()
      return
    }
  }
}
function enqueueBulk(items: Parameters<typeof manager.enqueue>[0]) {
  void keepFocus(
    manager.enqueue(items),
    () => cancelAllButton.value,
    () => sessionsHeading.value,
  )
}
function cancelAll() {
  void keepFocus(manager.cancelAll(), () => sessionsHeading.value)
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
    <div v-if="catalog.status === 'error'" class="tz-selector__state is-error" role="alert" data-testid="catalog-error">
      <p class="tz-selector__message"><TzIcon name="error" class="tz-selector__icon" />{{ t('selector.error') }}</p>
      <button type="button" class="tz-button" @click="catalog.load(true)">
        <TzIcon name="retry" size="sm" />{{ t('selector.retry') }}
      </button>
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
          <TzIcon name="download" class="tz-manager__icon" />
          <span class="tz-manager__text">{{ queueText }}</span>
          <button
            ref="cancelAllButton"
            type="button"
            class="tz-button tz-button--quiet tz-manager__action"
            data-testid="cancel-all"
            @click="cancelAll()"
          >
            <TzIcon name="close" size="sm" />{{ t('manager.cancelAll') }}
          </button>
        </div>
        <p v-if="manager.actionError" class="tz-manager__alert" role="alert" data-testid="manager-error">
          <TzIcon name="error" class="tz-manager__icon" />
          <span class="tz-manager__text">{{ t('manager.actionError') }}</span>
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
          <TzIcon name="error" class="tz-manager__icon" />
          <span class="tz-manager__text">{{ t('manager.scheduleError', { season }) }} {{ t(`manager.error.${scheduleState.error ?? 'failed'}`) }}</span>
          <button type="button" class="tz-button tz-manager__action" @click="manager.loadSchedule(season, true)">
            <TzIcon name="retry" size="sm" />{{ t('selector.retry') }}
          </button>
        </div>
      </div>

      <p v-if="events.length === 0 && scheduleState?.status !== 'loading'" class="tz-selector__state is-empty" data-testid="season-empty">
        {{ t('selector.emptySeason', { season }) }}
      </p>

      <div v-else-if="events.length > 0" ref="browse" class="tz-browse" :class="{ 'is-narrow': narrow }">
        <section class="tz-events" :aria-label="t('selector.events', { season })">
          <div class="tz-heading-row">
            <h2 class="tz-heading">{{ t('selector.events', { season }) }}</h2>
            <button
              v-if="seasonRacesMissing.length > 0"
              type="button"
              class="tz-button tz-button--quiet tz-manager__action"
              :title="t('manager.downloadHint')"
              data-testid="download-season-races"
              @click="enqueueBulk(seasonRacesMissing)"
            >
              <TzIcon name="download" size="sm" />{{ t('manager.downloadSeasonRaces', seasonRacesMissing.length) }}
            </button>
          </div>
          <!-- Una lista por temporada: al cambiar de temporada, las tarjetas entran escalonadas (tz-enter). -->
          <ul :key="season" role="list" class="tz-event-list" :class="{ 'is-entering': animateLists }">
            <li v-for="(e, i) in events" :key="e.key" :style="cardStyle(i)">
              <button
                type="button"
                class="tz-event"
                :class="{ 'is-active': selectedEvent?.key === e.key }"
                :aria-pressed="selectedEvent?.key === e.key"
                :data-testid="`event-${e.slug}`"
                @click="selectEvent(e)"
              >
                <TzTrackOutline :d="outlineFor(season, e.round, e.slug)" />
                <span class="tz-event__body">
                  <span class="tz-event__top">
                    <span class="tz-event__round tz-tabular">{{ t('selector.round', { round: e.round }) }}</span>
                    <span
                      v-if="manager.available && e.scheduled"
                      class="tz-event__built tz-tabular"
                      :class="{ 'is-complete': builtCount(e) === e.sessions.length }"
                      :title="t('manager.builtLabel', { built: builtCount(e), total: e.sessions.length })"
                      :data-testid="`built-${e.slug}`"
                    >
                      <TzIcon v-if="builtCount(e) === e.sessions.length" name="check" size="sm" />
                      <span aria-hidden="true">{{
                        t('manager.built', { built: builtCount(e), total: e.sessions.length })
                      }}</span>
                      <span class="tz-visually-hidden">{{
                        t('manager.builtLabel', { built: builtCount(e), total: e.sessions.length })
                      }}</span>
                    </span>
                  </span>
                  <span class="tz-event__name"><TzFlag :country="e.country" />{{ e.event }}</span>
                  <span v-if="eventMeta(e)" class="tz-event__meta">{{ eventMeta(e) }}</span>
                  <!-- Ni país ni fecha: se dice, sin inventar ninguno. -->
                  <span v-else class="tz-event__meta is-missing">{{ t('portada.noData') }}</span>
                </span>
              </button>
            </li>
          </ul>
        </section>

        <section
          class="tz-sessions"
          :aria-label="t('selector.sessions')"
          :style="narrow ? { order: panelOrder } : undefined"
          data-testid="sessions-panel"
        >
          <div class="tz-heading-row tz-sessions__head">
            <div class="tz-sessions__title">
              <h2 ref="sessionsHeading" class="tz-heading" tabindex="-1" aria-live="polite">
                {{ selectedEvent ? selectedEvent.event : t('selector.sessions') }}
              </h2>
              <p v-if="selectedEvent" class="tz-sessions__meta">
                <span class="tz-tabular">{{ t('selector.round', { round: selectedEvent.round }) }}</span>
                <template v-if="eventMeta(selectedEvent)"> · {{ eventMeta(selectedEvent) }}</template>
              </p>
            </div>
            <TzTrackOutline
              v-if="selectedEvent"
              class="tz-sessions__outline"
              :d="outlineFor(season, selectedEvent.round, selectedEvent.slug)"
            />
          </div>
          <!-- Las que faltan del Gran Premio, a lo ancho del panel. -->
          <button
            v-if="eventMissing.length > 1"
            type="button"
            class="tz-button tz-button--quiet tz-manager__action tz-sessions__all"
            :title="t('manager.downloadHint')"
            data-testid="download-event"
            @click="enqueueBulk(eventMissing)"
          >
            <TzIcon name="download" size="sm" />{{ t('manager.downloadEvent', eventMissing.length) }}
          </button>
          <p v-if="!selectedEvent" class="tz-selector__state is-empty">{{ t('selector.pickEvent') }}</p>
          <!-- Una lista por Gran Premio: al elegir otro, sus sesiones entran con un fundido escalonado. -->
          <ul v-else :key="selectedEvent.key" role="list" class="tz-session-list" :class="{ 'is-entering': animateLists }">
            <li v-for="(s, i) in selectedEvent.sessions" :key="s.session" :style="enterStep(i)">
              <TzSessionRow
                class="tz-session-list__row"
                :type="s.session"
                :view="viewOf(selectedEvent, s)"
                @download="download(selectedEvent, s.session)"
                @cancel="(id) => manager.cancel(id)"
              />
              <!-- Ya descargada: volver a descargarla o borrarla (con el gestor de datos). -->
              <TzSessionActions
                v-if="manager.available && viewOf(selectedEvent, s).kind === 'link'"
                :season="season"
                :round="selectedEvent.round"
                :session="s.session"
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

/* Estados de carga, vacío y error: el texto lo dice todo; el icono solo lo acompaña. */
.tz-selector__state {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--tz-space-3) var(--tz-space-4);
  margin: 0;
  color: var(--tz-text-muted);
}

/* Vacío («elige un Gran Premio», temporada sin sesiones): hueco con contorno discontinuo, nunca contenido inventado. */
.tz-selector__state.is-empty {
  padding: var(--tz-space-4);
  border: 1px dashed var(--tz-border-strong);
  border-radius: var(--tz-radius-md);
}

.tz-selector__state.is-error {
  padding: var(--tz-space-3) var(--tz-space-4);
  border: 1px solid var(--tz-danger);
  border-radius: var(--tz-radius-md);
  background: var(--tz-surface-1);
  color: var(--tz-text);
  animation: rise var(--tz-dur-base) var(--tz-ease-enter) backwards;
}

.tz-selector__message {
  display: flex;
  flex: 1;
  align-items: center;
  gap: var(--tz-space-2);
  margin: 0;
}

.tz-selector__icon,
.tz-manager__alert .tz-manager__icon {
  color: var(--tz-danger);
}

.tz-seasons ul,
.tz-event-list,
.tz-session-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

/* Temporadas como un segmentado (D50): pista de tono, cifras en mono y la elegida en placa maciza de pintura. */
.tz-seasons ul {
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--tz-space-0-5);
  padding: var(--tz-space-0-5);
  border-radius: var(--tz-radius-md);
  background: var(--tz-surface-2);
}

.tz-season {
  position: relative;
  padding: var(--tz-space-1) var(--tz-space-3);
  border: 0;
  border-radius: var(--tz-radius-pill);
  background: transparent;
  color: var(--tz-text-muted);
  font-family: var(--tz-font-mono);
  font-size: var(--tz-text-sm);
  font-weight: var(--tz-weight-medium);
  cursor: pointer;
  transition:
    background-color var(--tz-dur-fast) var(--tz-ease-standard),
    border-color var(--tz-dur-fast) var(--tz-ease-standard),
    color var(--tz-dur-fast) var(--tz-ease-standard),
    transform var(--tz-dur-fast) var(--tz-ease-standard);
}

/* Zona táctil: crece hasta --tz-hit-min (44 px con puntero grueso) sin mover el layout. */
.tz-season::after {
  content: '';
  position: absolute;
  inset: min(0px, calc((100% - var(--tz-hit-min)) / 2)) 0;
}

.tz-season.is-active {
  background: var(--tz-accent);
  color: var(--tz-accent-on);
}

.tz-season:active,
.tz-event:active {
  transform: scale(var(--tz-press-scale));
}

/*
 * Escritorio (D50): la rejilla de Grandes Premios a la izquierda y el panel de sesiones fijo a la derecha (380 px,
 * sticky): con un Gran Premio de abajo elegido, sus «Descargar» siguen a la vista.
 */
.tz-browse {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 380px;
  gap: var(--tz-space-6);
  align-items: start;
}

.tz-sessions {
  position: sticky;
  top: var(--tz-space-4);
  display: grid;
  gap: var(--tz-space-3);
  padding: var(--tz-space-4);
  border-radius: var(--tz-radius-sheet);
  background: var(--tz-surface-1);
}

.tz-sessions__head {
  flex-wrap: nowrap;
  align-items: flex-start;
  margin: 0;
}

.tz-sessions__title {
  display: grid;
  gap: var(--tz-space-1);
  min-width: 0;
}

.tz-sessions__title .tz-heading {
  font-size: var(--tz-text-lg);
  color: var(--tz-text);
}

.tz-sessions__meta {
  margin: 0;
  font-size: var(--tz-text-xs);
  color: var(--tz-text-muted);
}

.tz-sessions__meta .tz-tabular {
  font-family: var(--tz-font-mono);
}

.tz-sessions__outline {
  flex: none;
  width: 96px;
  height: 64px;
  color: var(--tz-text-muted);
}

.tz-sessions__all {
  justify-content: center;
  width: 100%;
}

/*
 * Estrecho (< 1100 px, tablet en vertical): una sola rejilla; las tarjetas en orden y el panel de sesiones, a lo
 * ancho, justo detrás de la fila de la tarjeta elegida (el orden lo pone el componente). Sin desplazar la página.
 */
.tz-browse.is-narrow {
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: var(--tz-space-3);
  /* Las tarjetas de una fila, igual de altas aunque un nombre ocupe dos líneas. */
  align-items: stretch;
}

.tz-browse.is-narrow > .tz-events,
.tz-browse.is-narrow .tz-event-list {
  display: contents;
}

.tz-browse.is-narrow .tz-events > .tz-heading-row {
  grid-column: 1 / -1;
  order: -1;
}

.tz-browse.is-narrow .tz-sessions {
  position: static;
  grid-column: 1 / -1;
  animation: tz-enter var(--tz-dur-base) var(--tz-ease-enter) backwards;
}

/* Rótulo de columna: Barlow 13/600 en caja de frase (D50). */
.tz-heading {
  margin: 0 0 var(--tz-space-3);
  font-size: var(--tz-text-sm);
  font-weight: var(--tz-weight-semibold);
  color: var(--tz-text-muted);
}

/* 4 tarjetas por fila a 1440 px y 5 a 1920 (D50). */
.tz-event-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: var(--tz-space-3);
}

/*
 * Entrada escalonada de tarjetas y sesiones (D42), tras un cambio del usuario: opacidad y un desplazamiento corto,
 * con duración, curva y paso de los tokens (todo 0 con prefers-reduced-motion). Va en el <li>, así no pisa la escala
 * al pulsar del botón; solo rellena hacia atrás, nunca deja un transform puesto al terminar.
 */
.tz-event-list.is-entering > li,
.tz-session-list.is-entering > li {
  animation: tz-enter var(--tz-dur-base) var(--tz-ease-enter) backwards;
  animation-delay: calc(var(--i, 0) * var(--tz-stagger));
}

/* Tarjeta de Gran Premio: trazado, ronda, bandera y nombre en condensada, y país y fecha. */
.tz-event {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  align-items: center;
  gap: var(--tz-space-3);
  width: 100%;
  /* Todas las tarjetas de una fila, igual de altas aunque algún nombre ocupe dos líneas. */
  height: 100%;
  padding: var(--tz-space-3) var(--tz-space-4);
  border: 0;
  border-radius: var(--tz-radius-lg);
  background: var(--tz-surface-1);
  text-align: start;
  cursor: pointer;
  transition:
    background-color var(--tz-dur-fast) var(--tz-ease-standard),
    border-color var(--tz-dur-fast) var(--tz-ease-standard),
    transform var(--tz-dur-fast) var(--tz-ease-standard);
}

/* La elegida: tono alto y anillo de pintura completo de 1,5 px; nunca una franja lateral (D50). */
.tz-event.is-active {
  background: var(--tz-surface-3);
  box-shadow: inset 0 0 0 1.5px var(--tz-accent);
}

.tz-event__round {
  font-family: var(--tz-font-mono);
  font-size: var(--tz-text-xs);
  letter-spacing: var(--tz-tracking-mono);
  color: var(--tz-text-faint);
}

.tz-event__body {
  display: grid;
  gap: var(--tz-space-1);
  min-width: 0;
}

.tz-event__name {
  display: flex;
  /* La bandera, en la primera línea si el nombre ocupa dos. */
  align-items: first baseline;
  gap: var(--tz-space-2);
  font-size: var(--tz-text-md);
  font-weight: var(--tz-weight-semibold);
  line-height: var(--tz-leading-tight);
}

.tz-event :deep(.tz-outline) {
  transition: color var(--tz-dur-fast) var(--tz-ease-standard);
}

.tz-event.is-active :deep(.tz-outline) {
  color: var(--tz-accent);
}

.tz-event__meta {
  font-size: var(--tz-text-xs);
  color: var(--tz-text-muted);
}

/* «sin dato»: con su estilo propio (tenue y en cursiva), para no confundirlo con un dato. */
.is-missing {
  font-style: italic;
  color: var(--tz-text-faint);
}

.tz-session-list {
  display: grid;
}

/* Filas de sesión con filetes (D50); las acciones de una descargada, a su derecha. */
.tz-session-list > li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--tz-space-1);
}

.tz-session-list > li + li {
  border-top: 1px solid var(--tz-border);
}

.tz-session-list__row {
  flex: 1 1 12em;
  min-width: 0;
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

.tz-heading[tabindex='-1']:focus {
  outline: none;
}

.tz-event__top {
  display: flex;
  justify-content: space-between;
  gap: var(--tz-space-2);
}

/* Sesiones listas para ver (n/total): una etiqueta pequeña; completo, con el icono y el color de éxito. */
.tz-event__built {
  display: inline-flex;
  align-items: center;
  gap: var(--tz-space-1);
  font-family: var(--tz-font-mono);
  font-size: var(--tz-text-xs);
  letter-spacing: var(--tz-tracking-mono);
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
  gap: var(--tz-space-2) var(--tz-space-3);
  margin: 0;
  padding: var(--tz-space-3) var(--tz-space-4);
  border: 1px solid var(--tz-accent);
  border-radius: var(--tz-radius-md);
  background: var(--tz-surface-1);
  animation: rise var(--tz-dur-base) var(--tz-ease-enter) backwards;
}

.tz-manager__alert {
  border-color: var(--tz-danger);
}

.tz-manager__text {
  flex: 1;
}

.tz-manager__action {
  position: relative;
  padding: var(--tz-space-1) var(--tz-space-3);
  font-size: var(--tz-text-sm);
}

/* Zona táctil: crece hasta --tz-hit-min (44 px con puntero grueso) sin mover el layout. */
.tz-manager__action::after {
  content: '';
  position: absolute;
  inset: min(0px, calc((100% - var(--tz-hit-min)) / 2)) 0;
}

/*
 * Aviso o cola que aparece: sube un poco (--tz-shift, 0 con movimiento reducido), sin fundido: su texto se lee (y
 * axe lo mide) entero desde el primer frame.
 */
@keyframes rise {
  from {
    transform: translateY(var(--tz-shift));
  }
}

/* Hover solo con un puntero que puede «flotar»: en táctil se quedaría pegado tras tocar. */
@media (hover: hover) {
  .tz-season:hover:not(.is-active) {
    color: var(--tz-text);
  }

  .tz-event:hover:not(.is-active) {
    background: var(--tz-surface-2);
  }

  .tz-event:hover :deep(.tz-outline) {
    color: var(--tz-accent);
  }
}
</style>
