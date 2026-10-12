<script setup lang="ts">
/**
 * Momentos (ítem 5, D35; hueco `analysis-tabs`): adelantamientos confirmados por el orden oficial en la línea de meta,
 * duelos a menos de 1 s (`engine/moments/`) y, desde D49, las neutralizaciones y los mensajes destacados de dirección
 * de carrera entre los que también saltan los botones del dock, con «Sin spoilers» (solo lo confirmado hasta el
 * instante del reloj). Pulsar uno salta 5 s antes y, en un adelantamiento, elige al que adelanta; en un duelo, al
 * perseguidor, comparado con el de delante (ítem 1). El instante de un adelantamiento sale del GPS: lleva «Estimado»
 * (`overtakeTime`) y, si no se puede situar, «momento exacto: sin dato».
 *
 * Arriba, «Ver y saltar entre» (`stores/moments.ts`): elige qué listas se ven aquí y entre qué momentos saltan los
 * botones del dock (D49; antes solo lo segundo, y parecía roto). Adelantamientos y duelos, solo en carrera y sprint (en
 * libres y clasificación, su estado vacío lo explica); las neutralizaciones y los mensajes, en cualquier sesión.
 *
 * Las filas se parten en líneas cuando no caben (el chip «terminó en adelantamiento» baja bajo los nombres): nada se
 * corta con «…» salvo el texto de un mensaje, que se limita a dos líneas con el texto entero en su título.
 */
import { crossingTimes, leaderLapAt } from '~/engine/analysis/raceTrace'
import { formatClock } from '~/engine/format/time'
import type { Duel } from '~/engine/moments/duels'
import { duels } from '~/engine/moments/duels'
import type { Moment, MomentKind } from '~/engine/moments/jumps'
import type { Overtake } from '~/engine/moments/overtakes'
import { clockOrigin } from '~/engine/timeline/markers'
import { rcTint } from '~/replay/rcKinds'
import { JUMP_FILTERS, type JumpFilter, useMomentsStore } from '~/stores/moments'
import { getRuntime, usePlaybackStore } from '~/stores/playback'

const { t, te, locale } = useI18n()
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
/** Estado de pista deducido (fuentes dev): las neutralizaciones llevan «Estimado». */
const trackInferred = rt.session.manifest.quality.estimated.includes('trackStatus')

const FILTER_TEXT: Record<JumpFilter, () => string> = {
  all: () => t('moments.jump.filter.all'),
  overtake: () => t('moments.jump.filter.overtake'),
  duel: () => t('moments.jump.filter.duel'),
  neutralisation: () => t('moments.jump.filter.neutralisation'),
  raceControl: () => t('moments.jump.filter.raceControl'),
}
/** Clases sin ningún momento en esta sesión: su botón, deshabilitado. */
const available = (f: JumpFilter) => f === 'all' || model.kinds.has(f)

/** Qué listas se ven con la clase elegida (la misma que recorren los botones del dock). */
const showOvertakes = computed(() => moments.filter === 'all' || moments.filter === 'overtake')
const showDuels = computed(() => moments.filter === 'all' || moments.filter === 'duel')
const showOthers = computed(() => moments.filter === 'all' || moments.filter === 'neutralisation' || moments.filter === 'raceControl')
/** Adelantamientos y duelos solo con datos de carrera; si no, su nota los sustituye. */
const raceLists = computed(() => model.race && table.cars.size > 0)
const sections = computed(() => (raceLists.value ? Number(showOvertakes.value) + Number(showDuels.value) : 0) + Number(showOthers.value))
/** Qué se elige al pulsar, solo de las listas que se ven (sin adelantamientos ni duelos, solo «Pulsa uno…»). */
const pickText = computed(() => {
  const o = raceLists.value && showOvertakes.value
  const d = raceLists.value && showDuels.value
  const who = o && d ? t('moments.pickWho.both') : o ? t('moments.pickWho.overtake') : d ? t('moments.pickWho.duel') : null
  return who ? `${t('moments.pick')} ${who}` : t('moments.pick')
})

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

/**
 * Neutralizaciones y mensajes destacados de dirección de carrera: exactamente los destinos de los botones del dock
 * (`model.moments`, con los mensajes de una misma clase a menos de 30 s ya juntados). Lo que no depende del reloj se
 * calcula una vez: la vuelta (en carrera y sprint, la del mensaje o, sin ella, la vuelta en curso del primero) y el
 * texto.
 */
interface OtherMoment {
  m: Moment
  /** Clase concreta: sc, vsc o red; o la del mensaje (`parsed.kind`). */
  sub: string
  lap: number | null
  text: string | null
  cars: readonly string[]
}

const OTHER_KINDS: readonly MomentKind[] = ['neutralisation', 'raceControl']
const others: OtherMoment[] = model.moments
  .filter((m) => OTHER_KINDS.includes(m.kind))
  .map((m): OtherMoment => {
    if (m.kind === 'neutralisation') {
      const w = rt.session.events.windows[m.index]!
      return { m, sub: w.kind, lap: model.race ? leaderLapAt(table, w.fromMs) : null, text: null, cars: [] }
    }
    const e = rt.raceControl[m.index]!
    return { m, sub: e.parsed.kind, lap: model.race ? (e.lap ?? leaderLapAt(table, e.t)) : null, text: e.text, cars: e.parsed.cars }
  })
const otherCutoff = useEffectiveCutoff(Float64Array.from(others.map((o) => o.m.t)).sort(), st.cutoffMs)
/** Clases de la lista con la clase elegida. */
const otherKinds = computed<readonly MomentKind[]>(() =>
  moments.filter === 'neutralisation' || moments.filter === 'raceControl' ? [moments.filter] : OTHER_KINDS,
)
const othersInSession = computed(() => others.filter((o) => otherKinds.value.includes(o.m.kind)))

function otherLabel(o: OtherMoment): string {
  if (o.m.kind === 'neutralisation') return t(`trackStatus.neutral.${o.sub}`)
  const key = `rc.kind.${o.sub}`
  return te(key) ? t(key) : t('rc.kind.other')
}

interface OtherRow {
  key: string
  o: OtherMoment
  lap: string | null
  lapLong: string | null
  label: string
  /** Clase para el glifo de su columna de estado (una neutralización, como el mensaje que la abre). */
  glyph: string
  tint: string
  time: string
  involved: boolean
}

/** Glifo de una neutralización: el del mensaje que la abre (SC, VSC o bandera roja). */
const NEUTRAL_GLYPH: Readonly<Record<string, string>> = { sc: 'sc_deployed', vsc: 'vsc_deployed', 'vsc-ending': 'vsc_ending', red: 'red_flag' }

const otherRows = computed<OtherRow[]>(() =>
  othersInSession.value
    .filter((o) => o.m.t <= otherCutoff.value)
    .map((o) => ({
      key: `${o.m.kind}-${o.m.index}`,
      o,
      lap: o.lap !== null ? t('moments.overtakes.lap', { lap: o.lap }) : null,
      lapLong: o.lap !== null ? t('moments.overtakes.lapLong', { lap: o.lap }) : null,
      label: otherLabel(o),
      glyph: o.m.kind === 'neutralisation' ? NEUTRAL_GLYPH[o.sub] ?? 'sc_deployed' : o.sub,
      tint: o.m.kind === 'neutralisation' ? (o.sub === 'red' ? 'is-red' : 'is-neutral') : rcTint(o.sub),
      time: formatClock(o.m.t - origin),
      involved: playback.selectedCar !== null && o.cars.includes(playback.selectedCar),
    })),
)
const othersEstimated = computed(() => trackInferred && otherRows.value.some((r) => r.o.m.kind === 'neutralisation'))
/** Título y explicación de la lista de abajo: solo neutralizaciones, solo mensajes o las dos. */
const OTHERS_TEXT = {
  all: () => ({ title: t('moments.others.title.all'), basis: t('moments.others.basis.all') }),
  neutralisation: () => ({ title: t('moments.others.title.neutralisation'), basis: t('moments.others.basis.neutralisation') }),
  raceControl: () => ({ title: t('moments.others.title.raceControl'), basis: t('moments.others.basis.raceControl') }),
}
const othersText = computed(() =>
  OTHERS_TEXT[moments.filter === 'neutralisation' || moments.filter === 'raceControl' ? moments.filter : 'all'](),
)

const ids = useId()
const overtakesId = `${ids}-overtakes`
const duelsId = `${ids}-duels`
const othersId = `${ids}-others`
</script>

<script lang="ts">
/** Hueco `analysis-tabs` (ítem 5): detrás de las de vueltas; listas solo con datos en carrera y sprint. */
export const order = 40
export const tab = 'moments'
export const label = (t: (key: string) => string) => t('moments.tab')
export const raceOnly = true
</script>

<template>
  <div class="tz-atab tz-moments" data-testid="moments" :data-race="model.race" :data-filter="moments.filter">
    <div class="tz-moments__jumps">
      <span class="tz-moments__jumps-label">
        <span class="tz-moments__jumps-icons" aria-hidden="true">
          <TzIcon name="jumpBack" size="sm" />
          <TzIcon name="jumpForward" size="sm" />
        </span>
        {{ t('moments.jump.filterLabel') }}
      </span>
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

    <template v-if="showOvertakes || showDuels">
      <p v-if="!model.race" class="tz-atab__empty" data-testid="moments-only-race">{{ t('moments.onlyRace') }}</p>
      <p v-else-if="table.cars.size === 0" class="tz-atab__empty" data-testid="moments-no-laps">{{ t('moments.noLaps') }}</p>
      <p v-else-if="showOvertakes" class="tz-atab__note">{{ t('moments.basis') }} {{ t('moments.lap1') }}</p>
    </template>
    <p class="tz-atab__note" data-testid="moments-pick">{{ pickText }}</p>

    <div class="tz-moments__cols" :class="{ 'is-single': sections === 1 }" data-testid="moments-cols">
      <section v-if="raceLists && showOvertakes" class="tz-moments__col" :aria-labelledby="overtakesId" data-testid="moments-overtakes">
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
              <span class="tz-moments__body">
                <span class="tz-moments__who">
                  <span class="tz-moments__team" :style="r.color ? { background: r.color } : undefined" aria-hidden="true" />
                  <span class="tz-moments__who-text">{{ r.who }}</span>
                </span>
                <span class="tz-moments__when tz-tabular" :class="{ 'is-nodata': r.o.atMs === null }">{{ r.when }}</span>
                <span class="tz-visually-hidden">, {{ r.whenLong }}</span>
              </span>
            </button>
          </li>
        </ul>
      </section>

      <section v-if="raceLists && showDuels" class="tz-moments__col" :aria-labelledby="duelsId" data-testid="moments-duels">
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
              :class="{ 'is-involved': r.involved }"
              data-testid="duel-row"
              :data-leader="r.d.leader"
              :data-chaser="r.d.chaser"
              :data-first-lap="r.d.firstLap"
              :data-last-lap="r.d.lastLap"
              :data-open="r.d.open"
              @click="moments.goToDuel(r.d, { compare: true })"
            >
              <span class="tz-moments__lap tz-tabular" aria-hidden="true">{{ r.laps }}</span>
              <span class="tz-moments__body">
                <span class="tz-moments__who">
                  <span class="tz-moments__team" :style="r.color ? { background: r.color } : undefined" aria-hidden="true" />
                  <span class="tz-moments__who-text">{{ r.who }}</span>
                </span>
                <span class="tz-visually-hidden">, {{ r.lapsLong }},</span>
                <span class="tz-moments__when tz-tabular">{{ r.min }}</span>
                <span v-if="r.state" class="tz-chip tz-moments__state">{{ r.state }}</span>
              </span>
            </button>
          </li>
        </ul>
      </section>

      <section v-if="showOthers" class="tz-moments__col" :aria-labelledby="othersId" data-testid="moments-others">
        <h3 :id="othersId" class="tz-moments__title">
          {{ othersText.title }}
          <span class="tz-moments__count tz-tabular">{{ t('moments.others.count', { n: otherRows.length }, otherRows.length) }}</span>
        </h3>
        <p v-if="othersEstimated" class="tz-moments__approx">
          <TzEstimated field="trackStatus" />
        </p>
        <p class="tz-moments__approx" data-testid="others-basis">{{ othersText.basis }}</p>
        <p v-if="othersInSession.length === 0" class="tz-moments__empty" data-testid="others-none">{{ t('moments.others.none') }}</p>
        <p v-else-if="otherRows.length === 0" class="tz-moments__empty" data-testid="others-nothing-yet">{{ t('moments.others.nothingYet') }}</p>
        <ul v-else class="tz-moments__list">
          <li v-for="r in otherRows" :key="r.key">
            <button
              type="button"
              class="tz-moments__row"
              :class="{ 'is-involved': r.involved, 'no-lap': !model.race }"
              data-testid="other-row"
              :data-kind="r.o.m.kind"
              :data-sub="r.o.sub"
              :data-t="r.o.m.t"
              @click="moments.go(r.o.m)"
            >
              <template v-if="model.race">
                <span class="tz-moments__lap tz-tabular" aria-hidden="true">{{ r.lap }}</span>
                <span v-if="r.lapLong" class="tz-visually-hidden">{{ r.lapLong }}</span>
              </template>
              <span class="tz-moments__body">
                <span class="tz-moments__kind" data-testid="other-kind"><TzRcGlyph :kind="r.glyph" />{{ r.label }}</span>
                <span v-if="r.o.text" class="tz-moments__rc" lang="en" :title="r.o.text" data-testid="other-text">{{ r.o.text }}</span>
                <span class="tz-moments__when tz-tabular">{{ r.time }}</span>
              </span>
            </button>
          </li>
        </ul>
      </section>
    </div>
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
  max-width: none;
  margin: 0;
  font-size: var(--tz-text-xs);
  line-height: var(--tz-leading-normal);
  color: var(--tz-text-muted);
}

/* Qué se ve y entre qué saltan los botones del dock: el grupo puede pasar a otra línea en pantallas estrechas. */
.tz-moments__jumps {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--tz-space-2);
}

.tz-moments__jumps-label {
  display: inline-flex;
  align-items: center;
  gap: var(--tz-space-1);
  font-size: var(--tz-text-xs);
  font-weight: var(--tz-weight-semibold);
  color: var(--tz-text-muted);
}

/* Los iconos de ⏮ ⏭ del dock: lo une a esos botones. */
.tz-moments__jumps-icons {
  display: inline-flex;
  color: var(--tz-text-muted);
}

.tz-moments__jumps .tz-segmented {
  flex-wrap: wrap;
}

.tz-moments__jumps .tz-segmented > button:disabled {
  color: var(--tz-text-faint);
  cursor: default;
}

/* Hasta tres columnas si caben (adelantamientos, duelos y el resto); si no, una debajo de otra. */
.tz-moments__cols {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
  gap: var(--tz-space-4);
  align-items: start;
}

/* Una sola lista (una clase elegida): no se estira a todo el ancho. */
.tz-moments__cols.is-single {
  grid-template-columns: minmax(0, 48rem);
}

.tz-moments__col {
  display: flex;
  flex-direction: column;
  gap: var(--tz-space-1);
  min-width: 0;
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
 * Fila pulsable: la vuelta y el cuerpo; 44 px con puntero grueso (--tz-hit-min). El cuerpo se parte en líneas cuando
 * sus partes no caben (D49): el chip de un duelo y luego «mín.» bajan bajo los nombres en vez de cortarse con «…».
 */
.tz-moments__row {
  position: relative;
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  align-items: center;
  column-gap: var(--tz-space-2);
  width: 100%;
  min-height: max(28px, var(--tz-hit-min));
  padding: var(--tz-space-1) var(--tz-space-2);
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

/* Sin vuelta (libres y clasificación): solo el cuerpo. */
.tz-moments__row.no-lap {
  grid-template-columns: minmax(0, 1fr);
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

.tz-moments__body {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  column-gap: var(--tz-space-2);
  row-gap: var(--tz-space-1);
  min-width: 0;
}

/* Quién: crece y nunca cede por debajo de lo que ocupa (las dos siglas); lo que no quepa detrás baja de línea. */
.tz-moments__who {
  display: inline-flex;
  flex: 1 0 auto;
  align-items: center;
  gap: var(--tz-space-2);
  min-width: min(7.5em, 100%);
  max-width: 100%;
  overflow: hidden;
}

/* El texto, en un bloque propio (solo en una columna más estrecha que dos siglas llegaría a acortarse). */
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
  flex: none;
  margin-left: auto;
  font-family: var(--tz-font-mono);
  font-size: var(--tz-text-xs);
  white-space: nowrap;
}

.tz-moments__when.is-nodata {
  font-family: var(--tz-font-sans);
  font-style: italic;
  color: var(--tz-text-faint);
}

.tz-moments__state {
  flex: none;
}

/* Clase de una neutralización o de un mensaje: su glifo de la columna de estado y el tipo en seminegrita (D50). */
.tz-moments__kind {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: var(--tz-space-1);
  font-size: var(--tz-text-xs);
  font-weight: var(--tz-weight-semibold);
}

/* Texto original del mensaje: dos líneas como mucho (el entero, en el título). */
.tz-moments__rc {
  display: -webkit-box;
  flex: 1 1 12em;
  min-width: 0;
  overflow: hidden;
  font-family: var(--tz-font-mono);
  font-size: var(--tz-text-xs);
  font-weight: var(--tz-weight-regular);
  line-height: 1.35;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
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
