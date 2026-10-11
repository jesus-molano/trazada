<script setup lang="ts">
/**
 * Momentos (ítem 5, D35; hueco `analysis-tabs`): adelantamientos confirmados por el orden oficial en la línea de meta y
 * duelos a menos de 1 s (`engine/moments/`), con «Sin spoilers» (solo lo confirmado hasta el instante del reloj).
 * Pulsar uno salta 5 s antes y elige al que adelanta; en un duelo, al perseguidor, comparado con el de delante
 * (ítem 1). El instante de un adelantamiento sale del GPS: lleva «Estimado» (`overtakeTime`) y, si no se puede situar,
 * «momento exacto: sin dato».
 *
 * Arriba, entre qué momentos saltan los botones del dock (`stores/moments.ts`): esto vale en cualquier sesión. Las
 * listas, solo en carrera y sprint (en libres y clasificación, su estado vacío lo explica).
 */
import { crossingTimes } from '~/engine/analysis/raceTrace'
import { formatClock } from '~/engine/format/time'
import type { Duel } from '~/engine/moments/duels'
import { duels } from '~/engine/moments/duels'
import type { Overtake } from '~/engine/moments/overtakes'
import { clockOrigin } from '~/engine/timeline/markers'
import { JUMP_FILTERS, type JumpFilter, useMomentsStore } from '~/stores/moments'
import { getRuntime, usePlaybackStore } from '~/stores/playback'

const { t, locale } = useI18n()
const rt = getRuntime()!
const playback = usePlaybackStore()
const moments = useMomentsStore()
const model = moments.model()!
const st = useAnalysis()
const table = st.table
const { type, playback: pb } = rt.session.manifest.session
const origin = clockOrigin(type, rt.session.timing, pb)
const drivers = new Map(rt.drivers.map((d) => [d.number, d]))
const name = (car: string) => drivers.get(car)?.tla ?? car
const color = (car: string) => drivers.get(car)?.color || null

const FILTER_TEXT: Record<JumpFilter, () => string> = {
  all: () => t('moments.jump.filter.all'),
  overtake: () => t('moments.jump.filter.overtake'),
  duel: () => t('moments.jump.filter.duel'),
  neutralisation: () => t('moments.jump.filter.neutralisation'),
  raceControl: () => t('moments.jump.filter.raceControl'),
}
/** Clases sin ningún momento en esta sesión: su botón, deshabilitado. */
const available = (f: JumpFilter) => f === 'all' || model.kinds.has(f)

const times = rt.ext('analysis:crossings', (r) => crossingTimes(r.leaderboard.lapTable))
const cutoff = useEffectiveCutoff(times, st.cutoffMs)

const shownOvertakes = computed(() => model.overtakes.filter((o) => o.confirmedMs <= cutoff.value))
/** Con corte, los duelos se vuelven a calcular hasta él (uno en curso no sabe aún cómo acaba). */
const shownDuels = computed(() =>
  cutoff.value === Infinity ? model.duels.duels : duels(table, cutoff.value, model.overtakes).duels,
)
const anyLocated = computed(() => shownOvertakes.value.some((o) => o.atMs !== null))

const gapFmt = computed(() => new Intl.NumberFormat(locale.value, { minimumFractionDigits: 3, maximumFractionDigits: 3 }))

interface OvertakeRow {
  key: string
  o: Overtake
  lap: string
  lapLong: string
  who: string
  when: string
  whenLong: string
  color: string | null
  involved: boolean
}

const overtakeRows = computed<OvertakeRow[]>(() =>
  shownOvertakes.value.map((o) => ({
    key: `${o.passer}-${o.passed}-${o.lap}`,
    o,
    lap: t('moments.overtakes.lap', { lap: o.lap }),
    lapLong: t('moments.overtakes.lapLong', { lap: o.lap }),
    who: t('moments.overtakes.who', { passer: name(o.passer), passed: name(o.passed) }),
    when: o.atMs !== null ? t('moments.overtakes.at', { time: formatClock(o.atMs - origin) }) : t('moments.overtakes.atNoData'),
    whenLong: o.atMs !== null ? t('moments.overtakes.atLong') : t('moments.overtakes.atNoDataLong'),
    color: color(o.passer),
    involved: playback.selectedCar === o.passer || playback.selectedCar === o.passed,
  })),
)

interface DuelRow {
  key: string
  d: Duel
  who: string
  laps: string
  lapsLong: string
  min: string
  state: string | null
  color: string | null
  involved: boolean
}

const duelRows = computed<DuelRow[]>(() =>
  shownDuels.value.map((d) => ({
    key: `${d.leader}-${d.chaser}-${d.firstLap}`,
    d,
    who: t('moments.duels.who', { chaser: name(d.chaser), leader: name(d.leader) }),
    laps: t('moments.duels.laps', { from: d.firstLap, to: d.lastLap }),
    lapsLong: t('moments.duels.lapsLong', { from: d.firstLap, to: d.lastLap }),
    min: t('moments.duels.min', { gap: gapFmt.value.format(d.minGapMs / 1000) }),
    state: d.open ? t('moments.duels.open') : d.endedInOvertake ? t('moments.duels.overtake') : null,
    color: color(d.chaser),
    involved: playback.selectedCar === d.chaser || playback.selectedCar === d.leader,
  })),
)

const ids = useId()
const overtakesId = `${ids}-overtakes`
const duelsId = `${ids}-duels`
</script>

<script lang="ts">
/** Hueco `analysis-tabs` (ítem 5): detrás de las de vueltas; listas solo con datos en carrera y sprint. */
export const order = 40
export const tab = 'moments'
export const label = (t: (key: string) => string) => t('moments.tab')
export const raceOnly = true
</script>

<template>
  <div class="tz-atab tz-moments" data-testid="moments" :data-race="model.race">
    <div class="tz-moments__jumps">
      <span class="tz-moments__jumps-label">{{ t('moments.jump.filterLabel') }}</span>
      <div class="tz-segmented" role="group" :aria-label="t('moments.jump.filterLabel')" data-testid="moments-filter">
        <button
          v-for="f in JUMP_FILTERS"
          :key="f"
          type="button"
          :aria-pressed="moments.filter === f"
          :disabled="!available(f)"
          :data-filter="f"
          @click="moments.setFilter(f)"
        >
          {{ FILTER_TEXT[f]() }}
        </button>
      </div>
      <TzHint :label="t('moments.jump.filterLabel')" :text="t('moments.jump.filterHint')" testid="moments-filter-hint" />
    </div>

    <p v-if="!model.race" class="tz-atab__empty" data-testid="moments-only-race">{{ t('moments.onlyRace') }}</p>
    <p v-else-if="table.cars.size === 0" class="tz-atab__empty" data-testid="moments-no-laps">{{ t('moments.noLaps') }}</p>
    <template v-else>
      <p class="tz-atab__note">{{ t('moments.basis') }} {{ t('moments.lap1') }}</p>
      <p class="tz-atab__note">{{ t('moments.pick') }}</p>

      <div class="tz-moments__cols">
        <section class="tz-moments__col" :aria-labelledby="overtakesId" data-testid="moments-overtakes">
          <h3 :id="overtakesId" class="tz-moments__title">
            {{ t('moments.overtakes.title') }}
            <span class="tz-moments__count tz-tabular">{{ t('moments.overtakes.count', { n: overtakeRows.length }, overtakeRows.length) }}</span>
          </h3>
          <p v-if="anyLocated" class="tz-moments__approx">
            <TzEstimated field="overtakeTime" />
            <span>{{ t('moments.overtakes.approx') }}</span>
          </p>
          <p v-if="model.overtakes.length === 0" class="tz-moments__empty" data-testid="overtakes-none">{{ t('moments.overtakes.none') }}</p>
          <p v-else-if="overtakeRows.length === 0" class="tz-moments__empty" data-testid="overtakes-nothing-yet">
            {{ t('moments.overtakes.nothingYet') }}
          </p>
          <ul v-else class="tz-moments__list">
            <li v-for="r in overtakeRows" :key="r.key">
              <button
                type="button"
                class="tz-moments__row"
                :class="{ 'is-involved': r.involved }"
                data-testid="overtake-row"
                :data-passer="r.o.passer"
                :data-passed="r.o.passed"
                :data-lap="r.o.lap"
                :data-located="r.o.atMs !== null"
                @click="moments.goToOvertake(r.o)"
              >
                <span class="tz-moments__lap tz-tabular" aria-hidden="true">{{ r.lap }}</span>
                <span class="tz-visually-hidden">{{ r.lapLong }}</span>
                <span class="tz-moments__who">
                  <span class="tz-moments__team" :style="r.color ? { background: r.color } : undefined" aria-hidden="true" />
                  <span class="tz-moments__who-text">{{ r.who }}</span>
                </span>
                <span class="tz-moments__when tz-tabular" :class="{ 'is-nodata': r.o.atMs === null }">{{ r.when }}</span>
                <span class="tz-visually-hidden">, {{ r.whenLong }}</span>
              </button>
            </li>
          </ul>
        </section>

        <section class="tz-moments__col" :aria-labelledby="duelsId" data-testid="moments-duels">
          <h3 :id="duelsId" class="tz-moments__title">
            {{ t('moments.duels.title') }}
            <span class="tz-moments__count tz-tabular">{{ t('moments.duels.count', { n: duelRows.length }, duelRows.length) }}</span>
          </h3>
          <p class="tz-moments__approx">{{ t('moments.duels.basis') }}</p>
          <p v-if="model.duels.status === 'noTrackStatus'" class="tz-moments__empty" data-testid="duels-no-track-status">
            {{ t('moments.duels.noTrackStatus') }}
          </p>
          <p v-else-if="model.duels.duels.length === 0" class="tz-moments__empty" data-testid="duels-none">{{ t('moments.duels.none') }}</p>
          <p v-else-if="duelRows.length === 0" class="tz-moments__empty" data-testid="duels-nothing-yet">{{ t('moments.duels.nothingYet') }}</p>
          <ul v-else class="tz-moments__list">
            <li v-for="r in duelRows" :key="r.key">
              <button
                type="button"
                class="tz-moments__row"
                :class="{ 'is-involved': r.involved, 'has-state': !!r.state }"
                data-testid="duel-row"
                :data-leader="r.d.leader"
                :data-chaser="r.d.chaser"
                :data-first-lap="r.d.firstLap"
                :data-last-lap="r.d.lastLap"
                :data-open="r.d.open"
                @click="moments.goToDuel(r.d, { compare: true })"
              >
                <span class="tz-moments__lap tz-tabular" aria-hidden="true">{{ r.laps }}</span>
                <span class="tz-moments__who">
                  <span class="tz-moments__team" :style="r.color ? { background: r.color } : undefined" aria-hidden="true" />
                  <span class="tz-moments__who-text">{{ r.who }}</span>
                </span>
                <span class="tz-visually-hidden">, {{ r.lapsLong }},</span>
                <span class="tz-moments__when tz-tabular">{{ r.min }}</span>
                <span v-if="r.state" class="tz-chip tz-moments__state">{{ r.state }}</span>
              </button>
            </li>
          </ul>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.tz-atab {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--tz-space-2);
  padding-top: var(--tz-space-3);
}

.tz-atab__empty {
  max-width: 64ch;
  margin: var(--tz-space-4) 0;
  font-size: var(--tz-text-md);
  font-style: italic;
  color: var(--tz-text-muted);
}

.tz-atab__note {
  max-width: 96ch;
  margin: 0;
  font-size: var(--tz-text-xs);
  line-height: var(--tz-leading-normal);
  color: var(--tz-text-muted);
}

/* Entre qué saltan los botones del dock: el grupo puede pasar a otra línea en pantallas estrechas. */
.tz-moments__jumps {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--tz-space-2);
}

.tz-moments__jumps-label {
  font-size: var(--tz-text-xs);
  font-weight: var(--tz-weight-semibold);
  color: var(--tz-text-muted);
}

.tz-moments__jumps .tz-segmented {
  flex-wrap: wrap;
}

.tz-moments__jumps .tz-segmented > button:disabled {
  color: var(--tz-text-faint);
  cursor: default;
}

/* Dos columnas si caben (adelantamientos y duelos); si no, una debajo de otra. */
.tz-moments__cols {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
  gap: var(--tz-space-4);
  align-items: start;
}

/* Contenedor de sus filas: con la columna estrecha, el estado de un duelo pasa a su propia línea (más abajo). */
.tz-moments__col {
  display: flex;
  flex-direction: column;
  gap: var(--tz-space-1);
  min-width: 0;
  container-type: inline-size;
}

.tz-moments__title {
  display: flex;
  align-items: baseline;
  gap: var(--tz-space-2);
  margin: 0;
  font-size: var(--tz-text-sm);
  font-weight: var(--tz-weight-semibold);
}

.tz-moments__count {
  font-size: var(--tz-text-xs);
  font-weight: var(--tz-weight-regular);
  color: var(--tz-text-muted);
}

.tz-moments__approx {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--tz-space-1) var(--tz-space-2);
  margin: 0;
  font-size: var(--tz-text-xs);
  line-height: var(--tz-leading-normal);
  color: var(--tz-text-muted);
}

.tz-moments__empty {
  margin: var(--tz-space-2) 0;
  font-size: var(--tz-text-sm);
  font-style: italic;
  color: var(--tz-text-muted);
}

.tz-moments__list {
  display: grid;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}

/*
 * Fila pulsable: vuelta, quién y cuándo; 44 px con puntero grueso (--tz-hit-min). Quién tiene un mínimo de verdad (las
 * dos siglas): lo que va detrás no se lo come.
 */
.tz-moments__row {
  position: relative;
  display: grid;
  grid-template-columns: 64px minmax(min(7.5em, 100%), 1fr) auto auto;
  align-items: center;
  gap: var(--tz-space-2);
  width: 100%;
  min-height: max(28px, var(--tz-hit-min));
  padding: 0 var(--tz-space-2);
  border: 1px solid transparent;
  border-radius: var(--tz-radius-sm);
  background: var(--tz-surface-2);
  text-align: left;
  font-size: var(--tz-text-sm);
  cursor: pointer;
  transition:
    border-color var(--tz-dur-fast) var(--tz-ease-standard),
    transform var(--tz-dur-fast) var(--tz-ease-standard);
}

.tz-moments__row:active {
  transform: scale(var(--tz-press-scale));
}

/* Con el coche elegido en el momento: borde de acento (la forma y el peso lo dicen, no solo el color). */
.tz-moments__row.is-involved {
  border-color: var(--tz-accent);
  font-weight: var(--tz-weight-semibold);
}

.tz-moments__lap {
  font-family: var(--tz-font-mono);
  font-size: var(--tz-text-xs);
  color: var(--tz-text-muted);
}

.tz-moments__who {
  display: inline-flex;
  align-items: center;
  gap: var(--tz-space-2);
  min-width: 0;
  overflow: hidden;
}

/* El texto, en un bloque propio: así el «…» funciona (un texto suelto en un flex no se acorta). */
.tz-moments__who-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tz-moments__team {
  flex: none;
  width: 3px;
  height: 14px;
  border-radius: 2px;
  background: var(--tz-team-unknown);
}

.tz-moments__when {
  font-family: var(--tz-font-mono);
  font-size: var(--tz-text-xs);
  white-space: nowrap;
}

.tz-moments__when.is-nodata {
  font-family: var(--tz-font-sans);
  font-style: italic;
  color: var(--tz-text-faint);
}

/* Un bloque (no el inline-flex de .tz-chip, que no acorta su texto): si ni en su línea cabe, «…». */
.tz-moments__state {
  display: block;
  justify-self: end;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

/*
 * Columna estrecha (iPad en vertical): el estado del duelo («terminó en adelantamiento») baja a su propia línea, bajo
 * quién; nunca se come los nombres ni se sale de la fila.
 */
@container (max-width: 26rem) {
  .tz-moments__row.has-state {
    grid-template-columns: 64px minmax(0, 1fr) auto;
    row-gap: var(--tz-space-1);
    padding-block: var(--tz-space-1);
  }

  .tz-moments__row.has-state .tz-moments__state {
    grid-column: 2 / -1;
    justify-self: start;
  }
}

@media (hover: hover) {
  .tz-moments__row:hover {
    border-color: var(--tz-border-strong);
  }

  .tz-moments__row.is-involved:hover {
    border-color: var(--tz-accent-strong);
  }
}
</style>
