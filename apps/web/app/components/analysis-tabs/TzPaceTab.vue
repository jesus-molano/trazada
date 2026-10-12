<script setup lang="ts">
/**
 * Ritmo por vuelta (ítem 3, D33): el tiempo oficial de cada vuelta (`engine/analysis/pace.ts`), sin corrección de
 * combustible ni suavizado. Las vueltas que no sirven para comparar ritmo se marcan y no se quitan: entrada o salida
 * de boxes, SC/VSC/roja y vuelta 1 con punto hueco; anuladas con aspa (desde su mensaje); sin tiempo oficial, contadas
 * debajo. En carrera y sprint, por vuelta; en libres y clasificación, por el momento de la sesión en que acaba cada
 * vuelta. Por defecto, el coche elegido y los cinco primeros de la clasificación al abrir la pestaña (y los que dejaron
 * de ser el elegido con la hoja abierta, al quitarlos o al elegir a otro, D49); la leyenda muestra u oculta cada piloto.
 *
 * La escala del eje y encuadra las vueltas representativas; las que quedan fuera se cuentan y «Ver todas» las
 * enseña (nada desaparece en silencio). Un clic en un punto elige a su piloto (D49; en los del elegido, o fuera de los
 * puntos, salta al inicio de esa vuelta).
 *
 * Ficha de cada serie al pasar el ratón o tocarla (D49): la vuelta y su tiempo, qué marca lleva y lo que cuentan los
 * datos del coche (`TzCarStory`).
 */
import { type ChartGroup, type ChartSeries, type ChartSpec, driverStyles, LAP_INCRS, TIME_INCRS } from '~/analysis/chart'
import { outsideRange, pace, paceAxis, paceChart, paceEventTimes, representativeRange } from '~/engine/analysis/pace'
import { lapStartMs, leaderLapAt, stoppedCars } from '~/engine/analysis/raceTrace'
import { formatClock, formatLapTime } from '~/engine/format/time'
import { clockOrigin } from '~/engine/timeline/markers'
import { token } from '~/design/tokens'
import { getRuntime, usePlaybackStore } from '~/stores/playback'

const TAB = 'pace'
const { t, locale } = useI18n()
const rt = getRuntime()!
const playback = usePlaybackStore()
const st = useAnalysis()
const table = st.table
const axis = paceAxis(table)
const styles = driverStyles(rt.drivers)
const unknownColor = token('--tz-team-unknown')
const { startMs: playStart, endMs: playEnd } = rt.session.manifest.session.playback
/**
 * Origen del reloj visible (el del dock): el eje por hora va en el reloj del reproductor, no en la hora interna de la
 * sesión, así que sus marcas caen en minutos redondos del dock.
 */
const origin = clockOrigin(rt.session.manifest.session.type, rt.session.timing, rt.session.manifest.session.playback)
/** Nombre completo de cada piloto del manifest (cabecera de la ficha). */
const names = new Map(rt.drivers.map((d) => [d.number, `${d.first} ${d.last}`.trim()]))
/** Coches en el orden del manifest (los que solo están en la tabla de vueltas, después). */
const cars = [...rt.drivers.map((d) => d.number).filter((c) => table.cars.has(c)), ...[...table.cars.keys()].filter((c) => !styles.has(c))]
/**
 * Por defecto: el coche elegido, los cinco primeros de la clasificación al abrir la pestaña y los que dejaron de ser el
 * elegido con la hoja abierta (`paceKept`, D49).
 */
const top5 = playback.order.filter((c) => table.cars.has(c)).slice(0, 5)

const times = rt.ext('analysis:paceTimes', (r) => paceEventTimes(r.leaderboard.lapTable))
const cutoff = useEffectiveCutoff(times, st.cutoffMs)
const chart = computed(() => markRaw(paceChart(pace(table, cars, cutoff.value), axis)))
/** Sin corte («Sin spoilers» desactivado o el reloj al final de la reproducción); cambia poco (no con cada aviso del reloj). */
const uncut = computed(() => cutoff.value === Infinity)
/** Por vuelta (carrera y sprint): coches que dejaron de pasar por meta, con la serie más corta (sin sigla suelta). */
const stopped = computed(() => (axis === 'lap' ? stoppedCars(table, cutoff.value) : new Map<string, number>()))

const visibleList = computed<readonly string[]>(() => {
  const chosen = st.shown.value[TAB]
  if (chosen) return chosen
  const sel = playback.selectedCar
  const kept = st.paceKept.value
  return cars.filter((c) => c === sel || top5.includes(c) || kept.includes(c))
})
const visible = computed(() => new Set(visibleList.value))

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

/** Escala: la del ritmo (vueltas representativas) o todas las vueltas. */
const scaleAll = ref(false)
const paceRange = computed(() => representativeRange(chart.value, visibleList.value))
const outside = computed(() => (paceRange.value ? outsideRange(chart.value, paceRange.value, visibleList.value) : 0))
const shownCars = computed(() => chart.value.cars.filter((c) => visible.value.has(c.car)))
const noTime = computed(() => shownCars.value.reduce((n, c) => n + c.noTime, 0))
const lap1NoTime = computed(() => table.race && shownCars.value.some((c) => c.lap1NoTime))

const leadLap = computed(() => (axis === 'lap' ? leaderLapAt(table, playback.timeMs) : null))

const spec = computed<ChartSpec>(() => {
  const c = chart.value
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
  const series: ChartSeries[] = c.cars.flatMap((p) => [
    { group: p.car, mark: axis === 'lap' ? ('lineDot' as const) : ('dot' as const), values: p.normal },
    { group: p.car, mark: 'hollow' as const, values: p.excluded },
    { group: p.car, mark: 'cross' as const, values: p.deleted },
  ])
  let xRange: [number, number]
  if (axis === 'lap') {
    xRange = [1, Math.max(2, c.x.length, leadLap.value ?? 1)]
  } else {
    // La sesión entera (su duración no es un spoiler); sin corte, también lo que acabe después de la reproducción.
    const lo = Math.min(playStart, c.x[0] ?? playStart)
    const hi = Math.max(playEnd, uncut.value ? (c.x[c.x.length - 1] ?? playEnd) : playEnd)
    xRange = [lo - origin, (hi > lo ? hi : lo + 1) - origin]
  }
  return markRaw({
    x: axis === 'lap' ? c.x : c.x.map((v) => v - origin),
    series,
    groups,
    xRange,
    yRange: scaleAll.value ? null : paceRange.value,
    yDir: 1,
    xIncrs: axis === 'lap' ? LAP_INCRS : TIME_INCRS,
    formatX: axis === 'lap' ? (v: number) => t('analysis.lapShort', { lap: v }) : (v: number) => formatClock(v),
    formatY: (v: number) => formatLapTime(v * 1000, locale.value),
    labelColumn: axis === 'lap',
  })
})

/** Línea del instante actual: la vuelta en curso del primero (por vuelta) o el reloj (por instante). */
const cursorX = computed(() => (axis === 'lap' ? leadLap.value : playback.timeMs - origin))

/** Ficha: «{x}: {y}» y qué marca lleva esa vuelta (la de la serie que tiene el valor). */
function cardLine(car: string, i: number): { value: string; mark: string } | null {
  const c = chart.value.cars.find((x) => x.car === car)
  const sp = spec.value
  if (!c || i >= sp.x.length) return null
  const x = sp.formatX(sp.x[i]!)
  const marks: [number | null | undefined, () => string][] = [
    [c.normal[i], () => t('analysis.card.markNormal')],
    [c.excluded[i], () => t('analysis.card.markExcluded')],
    [c.deleted[i], () => t('analysis.card.markDeleted')],
  ]
  const hit = marks.find(([v]) => v !== null && v !== undefined)
  if (!hit) return { value: t('analysis.card.value', { x, y: '—' }), mark: '' }
  return { value: t('analysis.card.value', { x, y: sp.formatY(hit[0]!) }), mark: hit[1]() }
}

/** Pie de la ficha: por vuelta, «Clic: ir al inicio de la V10»; por hora, «… de esa vuelta». */
function pickLabel(i: number) {
  if (axis !== 'lap') return { click: t('analysis.card.clickThat'), button: t('analysis.card.goThat') }
  const x = spec.value.formatX(spec.value.x[i]!)
  return { click: t('analysis.card.click', { x }), button: t('analysis.card.go', { x }) }
}

function pick(i: number) {
  const c = chart.value
  const ms = axis === 'lap' ? lapStartMs(table, c.x[i]!) : (c.startMs[i] ?? -1) >= 0 ? c.startMs[i]! : null
  if (ms !== null) playback.seek(ms)
}
</script>

<script lang="ts">
/** Hueco `analysis-tabs` (ítem 3): ritmo por vuelta. */
export const order = 20
export const tab = 'pace'
export const label = (t: (key: string) => string) => t('analysis.tabs.pace')
</script>

<template>
  <div class="tz-atab" data-testid="pace" :data-axis="axis">
    <p v-if="table.cars.size === 0" class="tz-atab__empty" data-testid="analysis-no-laps">{{ t('analysis.noLaps') }}</p>
    <template v-else>
      <p class="tz-atab__axis">{{ axis === 'lap' ? t('analysis.pace.axisLap') : t('analysis.pace.axisTime') }}</p>
      <p v-if="chart.x.length === 0" class="tz-atab__empty" data-testid="analysis-nothing-yet">{{ t('analysis.nothingYet') }}</p>
      <TzAnalysisChart
        v-else
        :spec="spec"
        :cursor-x="cursorX"
        :label="axis === 'lap' ? t('analysis.pace.chartLap') : t('analysis.pace.chartTime')"
        :legend-label="t('analysis.legend')"
        testid="pace-chart"
        :pick-label="pickLabel"
        selectable
        @pick="pick"
        @toggle="toggle"
        @set-all="setAll"
        @select="playback.selectCar($event)"
      >
        <template #card="{ hit, compact }">
          <template v-for="(line, k) in [cardLine(hit.key, hit.index)]" :key="k">
            <template v-if="line">
              <p data-testid="analysis-card-value">{{ line.value }}</p>
              <p v-if="line.mark" class="tz-atab__card-mark" data-testid="analysis-card-mark">{{ line.mark }}</p>
            </template>
          </template>
          <TzCarStory :car="hit.key" :cutoff-ms="cutoff" :stopped="stopped.has(hit.key)" :compact="compact" />
        </template>
      </TzAnalysisChart>
      <p v-if="chart.x.length > 0 && visibleList.length === 0" class="tz-atab__note" data-testid="pace-nothing-shown">
        {{ t('analysis.pace.nothingShown') }}
      </p>
      <ul class="tz-atab__marks" data-testid="pace-marks">
        <li>{{ t('analysis.pace.markNormal') }}</li>
        <li>{{ t('analysis.pace.markExcluded') }}</li>
        <li>{{ t('analysis.pace.markDeleted') }}</li>
      </ul>
      <p v-if="outside > 0 || scaleAll" class="tz-atab__note tz-atab__scale" data-testid="pace-outside">
        <span v-if="!scaleAll">{{ t('analysis.pace.outside', { n: outside }, outside) }}</span>
        <button type="button" class="tz-atab__link" data-testid="pace-scale" @click="scaleAll = !scaleAll">
          {{ scaleAll ? t('analysis.pace.showPace') : t('analysis.pace.showAll') }}
        </button>
      </p>
      <p v-if="noTime > 0" class="tz-atab__note" data-testid="pace-no-time">{{ t('analysis.pace.noTime', { n: noTime }, noTime) }}</p>
      <p v-if="lap1NoTime" class="tz-atab__note" data-testid="pace-lap1">{{ t('analysis.pace.lap1') }}</p>
      <p v-if="!table.trackStatusKnown" class="tz-atab__note" data-testid="pace-no-track-status">{{ t('analysis.pace.noTrackStatus') }}</p>
      <p class="tz-atab__note">{{ t('analysis.pace.basis') }}</p>
      <details class="tz-atab__how">
        <summary class="tz-link">{{ t('analysis.howToRead') }}</summary>
        <p class="tz-atab__note" data-testid="pace-identify">
          {{ axis === 'lap' ? t('analysis.identifyPaceLap') : t('analysis.identify') }}
        </p>
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

.tz-atab__marks {
  display: flex;
  flex-wrap: wrap;
  gap: var(--tz-space-1) var(--tz-space-4);
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: var(--tz-text-xs);
  color: var(--tz-text);
}

.tz-atab__scale {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--tz-space-2);
}

.tz-atab__link {
  position: relative;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--tz-accent);
  font-size: var(--tz-text-xs);
  font-weight: var(--tz-weight-semibold);
  text-decoration: underline;
  cursor: pointer;
}

.tz-atab__card-mark {
  color: var(--tz-text-muted);
}

.tz-atab__link::after {
  content: '';
  position: absolute;
  inset: min(0px, calc((100% - var(--tz-hit-min)) / 2)) 0;
}
</style>
