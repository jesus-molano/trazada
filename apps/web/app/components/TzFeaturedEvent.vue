<script setup lang="ts">
/**
 * El Gran Premio del momento, arriba y en grande en la portada: el del fin de semana en curso
 * desde el día de los primeros libres; si no, el último; en pretemporada, el próximo (`featuredEvent`, con el calendario
 * del gestor local o, sin él, las fechas del catálogo). Su trazado grande, sus sesiones con la misma fila que el
 * selector (abrir, descargar, progreso, «disponible el…») y, si aún no ha empezado, cuánto falta. Sin fechas, no sale.
 */
import {
  type BrowseEvent,
  type BrowseSession,
  downloadable,
  featuredEvent,
  jobKey,
  mergeEvents,
  sessionView,
} from '~/manager/model'
import { useCatalogStore } from '~/stores/catalog'
import { useManagerStore } from '~/stores/manager'
import { countryLabel } from '~/venues/countries'
import { outlineFor } from '~/venues/outlines'

const { t, locale } = useI18n()
const catalog = useCatalogStore()
const manager = useManagerStore()

/** Reloj de pared (cada 30 s basta: lo que cambia es el día o la cuenta atrás en horas). */
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

/** La temporada del año en curso (la del momento), aunque la portada tenga otra elegida abajo. */
const season = computed(() => new Date(now.value).getFullYear())
watch(
  [season, () => manager.available],
  ([s, available]) => {
    if (available) void manager.loadSchedule(s)
  },
  { immediate: true },
)
const events = computed(() =>
  mergeEvents(catalog.eventsOf(season.value), manager.available ? (manager.schedules[season.value]?.schedule?.events ?? null) : null),
)
const featured = computed(() => featuredEvent(events.value, now.value))

const kicker = computed(() => {
  const w = featured.value?.when
  return w === 'live' ? t('featured.live') : w === 'next' ? t('featured.next') : t('featured.last')
})

/** «Ronda 18 · Singapur · 9–11 oct» (lo que haya). */
const meta = computed(() => {
  const e = featured.value?.event
  if (!e) return ''
  const days = e.sessions.map((s) => (s.startUtc ? Date.parse(s.startUtc) : Number.NaN)).filter(Number.isFinite)
  const fmt = new Intl.DateTimeFormat(locale.value, { day: 'numeric', month: 'short' })
  const dates = days.length ? fmt.formatRange(Math.min(...days), Math.max(...days)) : e.dateStart ? fmt.format(Date.parse(`${e.dateStart}T00:00:00`)) : ''
  return [t('selector.round', { round: e.round }), e.country ? countryLabel(e.country, locale.value) : '', dates].filter(Boolean).join(' · ')
})

/** Hasta la primera sesión que aún no ha empezado: «Libres 1 en 2 d 5 h» (solo si falta menos de una semana). */
const countdown = computed(() => {
  const e = featured.value?.event
  if (!e) return ''
  const next = e.sessions
    .filter((s) => s.startUtc && Date.parse(s.startUtc) > now.value)
    .sort((a, b) => Date.parse(a.startUtc!) - Date.parse(b.startUtc!))[0]
  if (!next) return ''
  const ms = Date.parse(next.startUtc!) - now.value
  if (ms > 7 * 86_400_000) return ''
  const d = Math.floor(ms / 86_400_000)
  const h = Math.floor((ms % 86_400_000) / 3_600_000)
  const m = Math.max(1, Math.floor((ms % 3_600_000) / 60_000))
  const left = d > 0 ? t('featured.inDays', { d, h }) : h > 0 ? t('featured.inHours', { h, m }) : t('featured.inMinutes', { m })
  return t('featured.countdown', { session: t(`session.${next.session}`), left })
})

/** Las sesiones del Gran Premio que ya se pueden descargar y faltan (con el gestor local). */
const missing = computed(() =>
  featured.value && manager.available ? downloadable(season.value, featured.value.event, manager.jobsByKey, now.value) : [],
)

function viewOf(e: BrowseEvent, s: BrowseSession) {
  const job = manager.jobsByKey.get(jobKey({ season: season.value, round: e.round, session: s.session })) ?? null
  return sessionView(s, job, now.value, manager.available)
}
</script>

<template>
  <section
    v-if="featured"
    class="tz-featured"
    aria-labelledby="tz-featured-name"
    data-testid="featured-event"
    :data-when="featured.when"
    :data-round="featured.event.round"
  >
    <div class="tz-featured__body">
      <p class="tz-featured__kicker">{{ kicker }}</p>
      <h2 id="tz-featured-name" class="tz-featured__name"><TzFlag :country="featured.event.country" />{{ featured.event.event }}</h2>
      <p v-if="meta" class="tz-featured__meta tz-tabular">{{ meta }}</p>
      <p v-if="countdown" class="tz-featured__countdown tz-tabular" data-testid="featured-countdown">{{ countdown }}</p>
      <button
        v-if="missing.length > 1"
        type="button"
        class="tz-button tz-button--quiet tz-featured__all"
        :title="t('manager.downloadHint')"
        data-testid="featured-download-all"
        @click="manager.enqueue(missing)"
      >
        <TzIcon name="download" size="sm" />{{ t('manager.downloadEvent', missing.length) }}
      </button>
      <ul role="list" class="tz-featured__sessions">
        <li v-for="s in featured.event.sessions" :key="s.session">
          <TzSessionRow
            scope="featured"
            :type="s.session"
            :view="viewOf(featured.event, s)"
            @download="manager.enqueue([{ season, round: featured.event.round, session: s.session }])"
            @cancel="(id) => manager.cancel(id)"
          />
          <TzSessionActions
            scope="featured"
            v-if="manager.available && viewOf(featured.event, s).kind === 'link'"
            :season="season"
            :round="featured.event.round"
            :session="s.session"
          />
        </li>
      </ul>
    </div>
    <TzTrackOutline class="tz-featured__outline" :d="outlineFor(season, featured.event.round, featured.event.slug)" />
  </section>
</template>

<style scoped>
/* Ficha grande (D50): surface-1 con radio de hoja; a la izquierda el Gran Premio y sus sesiones, a la derecha su trazado. */
.tz-featured {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 360px);
  gap: var(--tz-space-6);
  align-items: center;
  padding: var(--tz-space-6) var(--tz-space-8);
  border-radius: var(--tz-radius-sheet);
  background: var(--tz-surface-1);
}

.tz-featured__kicker {
  margin: 0;
  color: var(--tz-text-muted);
  font-size: var(--tz-text-sm);
  font-weight: var(--tz-weight-medium);
}

.tz-featured__name {
  display: flex;
  align-items: center;
  gap: var(--tz-space-3);
  margin: var(--tz-space-1) 0 0;
  font-family: var(--tz-font-display);
  font-size: var(--tz-text-2xl);
  font-weight: var(--tz-weight-bold);
  letter-spacing: var(--tz-tracking-display);
  line-height: var(--tz-leading-tight);
  text-transform: uppercase;
}

.tz-featured__meta,
.tz-featured__countdown {
  margin: var(--tz-space-1) 0 0;
  color: var(--tz-text-muted);
  font-size: var(--tz-text-sm);
}

.tz-featured__countdown {
  color: var(--tz-text);
}

.tz-featured__all {
  margin-top: var(--tz-space-4);
}

.tz-featured__sessions {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 0 var(--tz-space-6);
  margin: var(--tz-space-4) 0 0;
  padding: 0;
  list-style: none;
}

.tz-featured__sessions > li {
  border-top: 1px solid var(--tz-border);
}

/* El trazado, grande (la miniatura del selector mide 44 px): más claro y con un trazo más grueso. */
.tz-featured .tz-featured__outline {
  justify-self: center;
  width: 100%;
  height: 220px;
  color: var(--tz-text);
}

.tz-featured .tz-featured__outline :deep(path) {
  stroke-width: 3px;
}

/* Estrecho: el trazado arriba, más pequeño. */
@media (width < 900px) {
  .tz-featured {
    grid-template-columns: minmax(0, 1fr);
    padding: var(--tz-space-4);
  }

  .tz-featured .tz-featured__outline {
    order: -1;
    height: 140px;
  }
}
</style>
