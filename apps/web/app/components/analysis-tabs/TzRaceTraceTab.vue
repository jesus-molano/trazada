<script setup lang="ts">
/**
 * Race trace (ítem 3, D33): diferencia con el primero en cada paso por meta, vuelta a vuelta
 * (`engine/analysis/raceTrace.ts`), con los tiempos oficiales de paso por la línea; sin corrección de combustible ni
 * suavizado. Solo en carrera y sprint (en libres y clasificación, su estado vacío lo explica). Todos los pilotos
 * visibles por defecto; el coche elegido, destacado. Un clic en una línea elige a su piloto (D49; en la del elegido, o
 * fuera de las líneas, salta al inicio de esa vuelta).
 *
 * De quién es cada línea (D49): la leyenda va por grupos (los que siguen, en el orden en que acaban las líneas de arriba
 * abajo; los que dejaron de pasar por meta, como la clasificación; y, con todos los pasos por meta a la vista, los
 * pilotos sin ninguno en los datos) y cada serie tiene su ficha al pasar el ratón o tocarla (`TzRaceTraceCard`). Con
 * corte, un piloto sin pasos por meta va al final de «De arriba abajo», como uno que aún no ha cruzado la línea: decir
 * que no tiene vueltas en los datos adelantaría que no va a completar ninguna.
 */
import { type ChartGroup, type ChartNoLaps, type ChartSpec, driverStyles, LAP_INCRS } from '~/analysis/chart'
import {
  allCrossingsVisible,
  crossingTimes,
  lapStartMs,
  lastCrossings,
  leaderLapAt,
  legendOrder,
  raceTrace,
  stoppedCars,
} from '~/engine/analysis/raceTrace'
import { token } from '~/design/tokens'
import { getRuntime, usePlaybackStore } from '~/stores/playback'

const TAB = 'raceTrace'
const { t, locale } = useI18n()
const rt = getRuntime()!
const playback = usePlaybackStore()
const st = useAnalysis()
const table = st.table
const styles = driverStyles(rt.drivers)
const unknownColor = token('--tz-team-unknown')
/**
 * Todos los pilotos, en el orden del manifest (los que solo están en la tabla de vueltas, después). Los del manifest sin
 * vueltas en los datos también (su serie, vacía): antes desaparecían sin decirlo.
 */
const cars = [...rt.drivers.map((d) => d.number), ...[...table.cars.keys()].filter((c) => !styles.has(c))]
/** Nombre completo de cada piloto del manifest (cabecera de la ficha). */
const names = new Map(rt.drivers.map((d) => [d.number, `${d.first} ${d.last}`.trim()]))
/** Un piloto sin pasos por meta en los datos, en la leyenda (sin botón: no hay serie que mostrar u ocultar). */
function noLapsEntry(car: string): ChartNoLaps {
  const style = styles.get(car)
  return { key: car, label: style?.label ?? car, color: style?.color ?? unknownColor, dash: style?.dash ?? false }
}

const times = rt.ext('analysis:crossings', (r) => crossingTimes(r.leaderboard.lapTable))
const cutoff = useEffectiveCutoff(times, st.cutoffMs)
const trace = computed(() => markRaw(raceTrace(table, cutoff.value)))
/** Coches que dejaron de pasar por meta: su serie acaba antes (sin sigla suelta a media gráfica). */
const stopped = computed(() => stoppedCars(table, cutoff.value))
const legend = computed(() =>
  legendOrder(trace.value, stopped.value, lastCrossings(table, cutoff.value), cars, allCrossingsVisible(times, cutoff.value)),
)
const visible = computed(() => new Set(st.shown.value[TAB] ?? cars))

/** «Mostrar todos» u «Ocultar todos» de la leyenda. */
function setAll(on: boolean) {
  st.setShown(TAB, on ? [...cars] : [])
}

function toggle(car: string) {
  const next = new Set(visible.value)
  if (next.has(car)) next.delete(car)
  else next.add(car)
  st.setShown(TAB, cars.filter((c) => next.has(c)))
}

const secFmt = computed(() => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }))
/** Vuelta en curso del primero con el reloj (haya o no corte): la línea del instante actual. */
const leadLap = computed(() => leaderLapAt(table, playback.timeMs))

const spec = computed<ChartSpec>(() => {
  const tr = trace.value
  const byCar = new Map(tr.series.map((s) => [s.car, s]))
  const selected = playback.selectedCar
  const groups = cars.map((car): ChartGroup => {
    const style = styles.get(car)
    return {
      key: car,
      label: style?.label ?? car,
      name: names.get(car) || undefined,
      color: style?.color ?? unknownColor,
      dash: style?.dash ?? false,
      visible: visible.value.has(car),
      emphasis: car === selected,
      stopped: stopped.value.has(car),
    }
  })
  const series = cars.map((car) => ({
    group: car,
    mark: 'line' as const,
    values: Array.from(byCar.get(car)?.gapMs ?? new Float64Array(tr.laps.length).fill(Number.NaN), (v) => (Number.isNaN(v) ? null : v / 1000)),
  }))
  // Eje y desde 0 (el primero) hasta el mayor gap de los pilotos visibles: nunca hay gaps negativos.
  let maxGap = 0
  for (const s of series) if (visible.value.has(s.group)) for (const v of s.values) if (v !== null && v > maxGap) maxGap = v
  return markRaw({
    x: Array.from(tr.laps),
    series,
    groups,
    // Hasta la vuelta en curso, para que se vea la línea del instante actual aunque esa vuelta aún no tenga datos.
    xRange: [1, Math.max(2, tr.laps.length, leadLap.value ?? 1)],
    yRange: [0, Math.max(1, maxGap * 1.05)],
    yDir: -1,
    xIncrs: LAP_INCRS,
    formatX: (v: number) => t('analysis.lapShort', { lap: v }),
    formatY: (v: number) => (v === 0 ? '0' : `+${secFmt.value.format(v)}`),
    labelColumn: true,
    legend: { running: legend.value.running, stopped: legend.value.stopped, noLaps: legend.value.none.map(noLapsEntry) },
  })
})

/** Pie de la ficha: «Clic: ir al inicio de la V10» y el botón de la ficha fijada. */
function pickLabel(i: number) {
  const x = spec.value.formatX(spec.value.x[i]!)
  return { click: t('analysis.card.click', { x }), button: t('analysis.card.go', { x }) }
}

const cursorX = leadLap

function pick(i: number) {
  const lap = spec.value.x[i]
  const ms = lap === undefined ? null : lapStartMs(table, lap)
  if (ms !== null) playback.seek(ms)
}
</script>

<script lang="ts">
/** Hueco `analysis-tabs` (ítem 3): la primera pestaña; solo con datos en carrera y sprint. */
export const order = 10
export const tab = 'raceTrace'
export const label = (t: (key: string) => string) => t('analysis.tabs.raceTrace')
export const raceOnly = true
</script>

<template>
  <div class="tz-atab" data-testid="race-trace">
    <p v-if="!table.race" class="tz-atab__empty" data-testid="race-trace-only-race">{{ t('analysis.raceTrace.onlyRace') }}</p>
    <p v-else-if="table.cars.size === 0" class="tz-atab__empty" data-testid="analysis-no-laps">{{ t('analysis.noLaps') }}</p>
    <template v-else>
      <p class="tz-atab__axis">{{ t('analysis.raceTrace.axis') }}</p>
      <p v-if="spec.x.length === 0" class="tz-atab__empty" data-testid="analysis-nothing-yet">{{ t('analysis.nothingYet') }}</p>
      <TzAnalysisChart
        v-else
        :spec="spec"
        :cursor-x="cursorX"
        :label="t('analysis.raceTrace.chart')"
        :legend-label="t('analysis.legend')"
        testid="race-trace-chart"
        :pick-label="pickLabel"
        selectable
        @pick="pick"
        @toggle="toggle"
        @set-all="setAll"
        @select="playback.selectCar($event)"
      >
        <template #card="{ hit, compact }">
          <TzRaceTraceCard
            :car="hit.key"
            :index="hit.index"
            :cutoff-ms="cutoff"
            :trace="trace"
            :stopped="stopped.has(hit.key)"
            :compact="compact"
          />
        </template>
      </TzAnalysisChart>
      <p class="tz-atab__note">{{ t('analysis.raceTrace.basis') }}</p>
      <details class="tz-atab__how">
        <summary class="tz-link">{{ t('analysis.howToRead') }}</summary>
        <p class="tz-atab__note">{{ t('analysis.identifyLap') }}</p>
      </details>
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

.tz-atab__axis {
  margin: 0;
  font-size: var(--tz-text-xs);
  font-weight: var(--tz-weight-semibold);
  color: var(--tz-text-muted);
}

.tz-atab__empty {
  max-width: 64ch;
  margin: var(--tz-space-4) 0;
  font-size: var(--tz-text-md);
  font-style: italic;
  color: var(--tz-text-muted);
}

.tz-atab__how summary {
  font-size: var(--tz-text-xs);
}

.tz-atab__how .tz-atab__note {
  margin-top: var(--tz-space-1);
}

/* A lo ancho de la gráfica (D50): con 96ch se quedaba en una columna estrecha con mucho hueco a la derecha. */
.tz-atab__note {
  margin: 0;
  font-size: var(--tz-text-xs);
  line-height: var(--tz-leading-normal);
  color: var(--tz-text-muted);
}
</style>
