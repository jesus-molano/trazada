<script setup lang="ts">
/**
 * Comparar dos pilotos (ítem 1, D31), en el panel del coche seleccionado (vista «Comparar» de TzTelemetry): el coche
 * seleccionado (A) frente a otro (B), con la vuelta de referencia de B (misma vuelta, mejor vuelta o última vuelta).
 *
 * - Diferencia en vivo por distancia (engine/compare/delta.ts): sale del GPS, así que va en décimas y con su etiqueta
 *   «Estimado» (`lapDelta`). «En boxes» con A en el pit lane; «sin dato» sin posición de alguno o sin referencia (y el
 *   motivo, debajo).
 * - Diferencia oficial de la última vuelta cerrada (tiempos de vuelta del cronometraje: dato real, en milésimas).
 * - Trazas por distancia de velocidad, acelerador y freno (TzDistanceChart): las muestras de la telemetría, de la
 *   vuelta en curso de A hasta el instante actual y de la vuelta de referencia de B. Son las reales salvo cuando el
 *   manifest declara la telemetría reconstruida (fuentes dev): la explicación lo dice, y el panel ya lleva su
 *   «Estimado» (`telemetry`, en TzTelemetry).
 * - El fantasma de B sobre el mapa (scene-layers/TzGhost.vue), con su estado aquí: la posición real de B, o la
 *   reconstruida si el manifest declara `positions` (la escena ya lleva su «Estimado»; la explicación lo dice).
 *
 * Nada por frame pasa por la reactividad de Vue: la diferencia, el estado del fantasma y la línea de las gráficas se
 * escriben en el DOM (y solo cuando cambian); las trazas se redibujan cuando cambia la vuelta o llega una muestra
 * nueva (como mucho ~15 veces por segundo); lo demás (vueltas, oficial) se guarda en un `shallowRef` solo al cambiar.
 */
import type uPlot from 'uplot'
import { token } from '~/design/tokens'
import { roundDelta } from '~/engine/compare/delta'
import { COMPARE_REFS, type CompareRef, isCompareRef } from '~/engine/compare/reference'
import { COMPARE_EXT, type CompareFrame, type CompareMissing, createCompare, type OfficialDiff } from '~/engine/compare/session'
import { alignTraces, traceCount } from '~/engine/compare/trace'
import { formatLapTime } from '~/engine/format/time'
import { SEGMENT_GAP_MS } from '~/engine/interp/hermite'
import { useCompareStore } from '~/stores/compare'
import { getRuntime, usePlaybackStore } from '~/stores/playback'

const CHART_INTERVAL_MS = 66 // ~15 Hz, como las mini gráficas

const { t, locale } = useI18n()
const playback = usePlaybackStore()
const compare = useCompareStore()
compare.hydrate()
const rt = getRuntime()!
const engine = rt.ext(COMPARE_EXT, createCompare)

const mode = computed<CompareRef>(() => compare.compareRef ?? engine.defaultRef)
const byNumber = new Map(rt.drivers.map((d) => [d.number, d]))
const tla = (car: string | null) => (car ? (byNumber.get(car)?.tla ?? car) : '')
const tlaA = computed(() => tla(playback.selectedCar))
const tlaB = computed(() => tla(compare.compareCar))

/** Pilotos que pueden ser B: todos menos A, en el orden del manifest (estable: no baila durante la reproducción). */
const options = computed(() =>
  rt.drivers
    .filter((d) => d.number !== playback.selectedCar)
    .map((d) => ({ car: d.number, label: t('compare.option', { tla: d.tla, name: d.last }) })),
)
const REF_LABELS = computed<Record<CompareRef, string>>(() => ({
  same: t('compare.refSame'),
  best: t('compare.refBest'),
  last: t('compare.refLast'),
}))

function onCar(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  compare.setCompareCar(value === '' ? null : value)
}

function onRef(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  if (isCompareRef(value)) compare.setRef(value)
}

const colorA = token('--tz-compare-a')
const colorB = token('--tz-compare-b')
const lengthM = engine.lengthM

/** Lo que cambia poco (al cambiar de vuelta o cerrar una): vueltas, motivo sin dato y diferencia oficial. */
interface Coarse {
  lapA: number | null
  lapB: number | null
  lapMsB: number | null
  missing: CompareMissing | null
  official: OfficialDiff | null
}
const coarse = shallowRef<Coarse>({ lapA: null, lapB: null, lapMsB: null, missing: null, official: null })
let coarseKey = ''

const series = computed(() => {
  const b = coarse.value.lapB === null ? tlaB.value : t('compare.legendB', { tla: tlaB.value, lap: coarse.value.lapB })
  return {
    speed: [
      { label: tlaA.value, color: colorA, scale: 'speed' },
      { label: b, color: colorB, scale: 'speed' },
    ],
    throttle: [
      { label: tlaA.value, color: colorA, scale: 'pct' },
      { label: b, color: colorB, scale: 'pct' },
    ],
    // Freno de encendido/apagado: un carril por piloto (B arriba, A abajo), en escalones.
    brake: [
      { label: tlaA.value, color: colorA, scale: 'brakeA', stepped: true },
      { label: b, color: colorB, scale: 'brakeB', stepped: true },
    ],
  }
})
const RANGES = {
  speed: { speed: [0, 360] as [number, number] },
  pct: { pct: [0, 105] as [number, number] },
  brake: { brakeA: [-0.15, 2.4] as [number, number], brakeB: [-1.4, 1.15] as [number, number] },
}

/** Por qué no hay comparación (o qué se compara): una línea bajo la diferencia. */
const refText = computed(() => {
  const c = coarse.value
  const a = tlaA.value
  const b = tlaB.value
  switch (c.missing) {
    case 'noLapA':
      return t('compare.missing.noLapA', { a })
    case 'noPositionA':
      return t('compare.missing.noPositionA', { a, lap: c.lapA ?? '' })
    case 'noLap':
      if (mode.value === 'same') return t('compare.missing.noLapSame', { b, lap: c.lapA ?? '' })
      return mode.value === 'best' ? t('compare.missing.noLapBest', { b }) : t('compare.missing.noLapLast', { b })
    case 'notStarted':
      return t('compare.missing.notStarted', { b, lap: c.lapA ?? '' })
    case 'noPosition':
      return t('compare.missing.noPosition', { b, lap: c.lapB ?? '' })
    case null:
      break
  }
  const time = c.lapMsB === null ? t('compare.noTime') : formatLapTime(c.lapMsB, locale.value)
  return t('compare.vs', { lapA: c.lapA ?? '', tla: b, lapB: c.lapB ?? '', time })
})

const officialFmt = computed(
  () => new Intl.NumberFormat(locale.value, { minimumFractionDigits: 3, maximumFractionDigits: 3, signDisplay: 'exceptZero' }),
)
/** Diferencia oficial de la última vuelta cerrada de A (dato real): la cifra, o por qué no la hay. */
const official = computed(() => {
  const o = coarse.value.official
  if (!o) return null
  const lap = o.lapA
  const b = tlaB.value
  if (o.missing) return { text: t('compare.officialNoRef', { lap }), detail: '', sign: '' }
  if (o.pending) return { text: t('compare.officialPending', { lap, b, lapB: o.lapB ?? '' }), detail: '', sign: '' }
  if (o.diffMs === null) return { text: t('compare.officialNoTime', { lap }), detail: '', sign: '' }
  const time = (ms: number | null, deleted: boolean) =>
    ms === null ? t('compare.noTime') : deleted ? t('compare.deletedTime', { time: formatLapTime(ms, locale.value) }) : formatLapTime(ms, locale.value)
  return {
    text: t('compare.official', { lap, diff: officialFmt.value.format(o.diffMs / 1000) }),
    detail: t('compare.officialDetail', {
      a: tlaA.value,
      timeA: time(o.msA, o.deletedA),
      b,
      lapB: o.lapB ?? '',
      timeB: time(o.msB, o.deletedB),
    }),
    sign: o.diffMs > 0 ? 'loss' : o.diffMs < 0 ? 'gain' : 'even',
  }
})

/** Lo que el manifest declara reconstruido en esta sesión (fijo: el panel se monta con cada sesión). */
const estimated = rt.session.manifest.quality.estimated
const telemetryEstimated = estimated.includes('telemetry')
const positionsEstimated = estimated.includes('positions')
const hint = computed(() =>
  [
    t('compare.hint'),
    telemetryEstimated ? t('compare.hintTracesEstimated') : t('compare.hintTraces'),
    positionsEstimated
      ? t('compare.hintGhostEstimated', { gap: SEGMENT_GAP_MS / 1000 })
      : t('compare.hintGhost', { gap: SEGMENT_GAP_MS / 1000 }),
    t('compare.hintRefs'),
  ].join(' '),
)
const ghostHint = computed(() => (positionsEstimated ? t('compare.ghostHintEstimated') : t('compare.ghostHint')))

// --- Por frame (fuera de Vue) ---

const deltaEl = ref<HTMLElement | null>(null)
const ghostEl = ref<HTMLElement | null>(null)
type Chart = { setData: (d: uPlot.AlignedData) => void; clear: () => void; setCursor: (d: number | null) => void }
const speedChart = ref<Chart | null>(null)
const throttleChart = ref<Chart | null>(null)
const brakeChart = ref<Chart | null>(null)

const deltaFmt = computed(
  () => new Intl.NumberFormat(locale.value, { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero' }),
)
let deltaKey = ''
let ghostKey = ''
let chartKey = ''
let chartCounts = ''
let chartsEmpty = true
let lastChart = -Infinity

/** Diferencia en vivo: la cifra en décimas con su signo (y el color solo lo acompaña), «en boxes» o «sin dato». */
function paintDelta(f: CompareFrame | null) {
  const el = deltaEl.value
  if (!el) return
  const state = !f ? 'none' : f.missing ? 'missing' : f.delta.state
  const ms = f && state === 'ok' ? roundDelta(f.delta.ms) : null
  const key = `${state}|${ms}|${locale.value}`
  if (key === deltaKey) return
  deltaKey = key
  el.dataset.state = state
  el.dataset.ms = ms === null ? '' : String(ms)
  el.dataset.sign = ms === null ? '' : ms > 0 ? 'loss' : ms < 0 ? 'gain' : 'even'
  if (ms !== null) el.textContent = t('compare.seconds', { s: deltaFmt.value.format(ms / 1000) })
  else if (state === 'pit') el.textContent = t('compare.inPit')
  else el.textContent = state === 'none' ? '—' : t('compare.noData')
}

/** Estado del fantasma (lo dibuja la escena si está activado). */
function paintGhost(f: CompareFrame | null) {
  const el = ghostEl.value
  if (!el) return
  const state = !f || f.missing ? 'none' : f.ghost.state
  const key = `${state}|${f?.lapB}|${tlaB.value}|${locale.value}`
  if (key === ghostKey) return
  ghostKey = key
  el.dataset.state = state
  const b = tlaB.value
  const lap = f?.lapB ?? ''
  const text: Record<typeof state, string> = {
    none: t('compare.ghostState.none'),
    visible: t('compare.ghostState.visible', { b, lap }),
    notYet: t('compare.ghostState.notYet', { b }),
    finished: t('compare.ghostState.finished', { b }),
    noData: t('compare.ghostState.noData', { b }),
  }
  el.textContent = text[state]
}

/** Trazas por distancia: se rehacen al cambiar de vuelta o de referencia y al llegar muestras nuevas de A o de B. */
function paintCharts(f: CompareFrame | null, tm: number) {
  const charts = [speedChart.value, throttleChart.value, brakeChart.value]
  if (charts.some((c) => !c)) return
  const cursor = f && Number.isFinite(f.delta.dA) ? f.delta.dA : null
  for (const c of charts) c!.setCursor(cursor)
  const ta = f ? engine.traceA(f) : null
  const tb = f ? engine.traceB(f) : null
  if (!ta && !tb) {
    if (!chartsEmpty) for (const c of charts) c!.clear()
    chartsEmpty = true
    chartKey = ''
    return
  }
  const ca = ta ? traceCount(ta, tm) : 0
  const cb = tb ? traceCount(tb, tm) : 0
  const key = `${f!.a}:${f!.kA}|${f!.b}:${f!.kB}`
  const counts = `${ca}|${cb}`
  if (key === chartKey && counts === chartCounts) return
  const now = performance.now()
  if (key === chartKey && rt.clock.playing && now - lastChart < CHART_INTERVAL_MS) return
  chartKey = key
  chartCounts = counts
  lastChart = now
  chartsEmpty = false
  const al = alignTraces(ta, ca, tb, cb)
  speedChart.value!.setData([al.x, ...al.speed])
  throttleChart.value!.setData([al.x, ...al.throttle])
  brakeChart.value!.setData([al.x, ...al.brake])
}

/** Con reproducción, lo grueso se revisa como mucho cada este tiempo (como el estado grueso del runtime). */
const COARSE_INTERVAL_MS = 100
let lastCoarse = -Infinity

function updateCoarse(f: CompareFrame | null, a: string | null, b: string | null, tm: number) {
  const now = performance.now()
  if (rt.clock.playing && coarseKey !== '' && now - lastCoarse < COARSE_INTERVAL_MS) return
  lastCoarse = now
  const o = a && b ? engine.official(a, b, mode.value, tm) : null
  const key = [
    f?.lapA,
    f?.lapB,
    f?.lapMsB,
    f?.missing,
    o?.lapA,
    o?.lapB,
    o?.msA,
    o?.msB,
    o?.diffMs,
    o?.pending,
    o?.deletedA,
    o?.deletedB,
    o?.missing,
  ].join('|')
  if (key === coarseKey) return
  coarseKey = key
  coarse.value = { lapA: f?.lapA ?? null, lapB: f?.lapB ?? null, lapMsB: f?.lapMsB ?? null, missing: f?.missing ?? null, official: o }
}

function paint(tm: number) {
  const a = playback.selectedCar
  const b = compare.compareCar
  const f = a && b ? engine.frame(a, b, mode.value, tm) : null
  paintDelta(f)
  paintGhost(f)
  paintCharts(f, tm)
  updateCoarse(f, a, b, tm)
}

let off: (() => void) | null = null
onMounted(() => {
  off = rt.onFrame(paint)
  rt.requestFrame()
})
onBeforeUnmount(() => off?.())
// Al cambiar de B o de referencia, o al montarse las gráficas, se repinta todo en el frame siguiente.
watch(
  () => [compare.compareCar, mode.value, playback.selectedCar, speedChart.value],
  () => {
    deltaKey = ''
    ghostKey = ''
    chartKey = ''
    coarseKey = ''
    rt.requestFrame()
  },
  { flush: 'post' },
)
</script>

<template>
  <div class="tz-cmp" data-testid="compare" :data-mode="mode">
    <div class="tz-cmp__controls">
      <select
        class="tz-cmp__select tz-cmp__select--car"
        :value="compare.compareCar ?? ''"
        :aria-label="t('compare.with')"
        data-testid="compare-car"
        @change="onCar"
      >
        <option value="">{{ t('compare.choose') }}</option>
        <option v-for="o in options" :key="o.car" :value="o.car">{{ o.label }}</option>
      </select>
      <select class="tz-cmp__select" :value="mode" :aria-label="t('compare.refLabel')" data-testid="compare-ref" @change="onRef">
        <option v-for="r in COMPARE_REFS" :key="r" :value="r">{{ REF_LABELS[r] }}</option>
      </select>
      <button
        type="button"
        class="tz-cmp__ghost"
        :aria-pressed="compare.showGhost"
        :aria-label="t('compare.ghost')"
        :title="ghostHint"
        data-testid="compare-ghost"
        @click="compare.setShowGhost(!compare.showGhost)"
      >
        <TzIcon name="ghost" size="sm" />
      </button>
    </div>

    <template v-if="compare.compareCar">
      <div class="tz-cmp__delta" :title="t('compare.deltaTitle', { a: tlaA, b: tlaB })">
        <span class="tz-visually-hidden">{{ t('compare.deltaLabel', { a: tlaA, b: tlaB }) }}</span>
        <span ref="deltaEl" class="tz-num tz-num--lg tz-cmp__value" data-state="none" data-testid="compare-delta">—</span>
        <TzEstimated field="lapDelta" />
        <TzHint class="tz-cmp__hint" :label="t('compare.hintLabel')" :text="hint" testid="compare-hint" align="end" />
      </div>
      <p class="tz-cmp__line" data-testid="compare-ref-info" :data-missing="coarse.missing ?? undefined">{{ refText }}</p>
      <p v-if="official" class="tz-cmp__line" data-testid="compare-official" :data-sign="official.sign || undefined">
        <span class="tz-cmp__official tz-tabular">{{ official.text }}</span>
        <span v-if="official.detail" class="tz-cmp__detail tz-tabular">{{ official.detail }}</span>
      </p>
      <p v-show="compare.showGhost" ref="ghostEl" class="tz-cmp__line" data-state="none" data-testid="compare-ghost-state" />

      <TzDistanceChart
        ref="speedChart"
        :label="t('compare.chartSpeed')"
        :series="series.speed"
        :ranges="RANGES.speed"
        :length-m="lengthM"
        testid="compare-chart-speed"
      />
      <TzDistanceChart
        ref="throttleChart"
        :label="t('compare.chartThrottle')"
        :series="series.throttle"
        :ranges="RANGES.pct"
        :length-m="lengthM"
        testid="compare-chart-throttle"
      />
      <TzDistanceChart
        ref="brakeChart"
        :label="t('compare.chartBrake')"
        :series="series.brake"
        :ranges="RANGES.brake"
        :length-m="lengthM"
        compact
        testid="compare-chart-brake"
      />
    </template>
    <p v-else class="tz-cmp__empty" data-testid="compare-empty">{{ t('compare.empty') }}</p>
  </div>
</template>

<style scoped>
.tz-cmp {
  display: flex;
  flex-direction: column;
  gap: var(--tz-space-1);
  min-width: 0;
}

.tz-cmp__controls {
  display: flex;
  align-items: center;
  gap: var(--tz-space-1);
  min-width: 0;
}

.tz-cmp__select {
  min-width: 0;
  max-width: 48%;
  padding: 2px var(--tz-space-1);
  border: 1px solid var(--tz-border-strong);
  border-radius: var(--tz-radius-sm);
  background: var(--tz-surface-2);
  color: var(--tz-text);
  font-size: var(--tz-text-xs);
}

.tz-cmp__select--car {
  flex: 1;
}

.tz-cmp__ghost {
  position: relative;
  display: inline-grid;
  flex: none;
  align-self: stretch;
  place-items: center;
  min-width: 28px;
  padding: 2px var(--tz-space-2);
  border: 1px solid var(--tz-border-strong);
  border-radius: var(--tz-radius-sm);
  background: transparent;
  color: var(--tz-text-muted);
  cursor: pointer;
}

/* Zona táctil de --tz-hit-min con puntero grueso, sin mover el layout. */
.tz-cmp__ghost::after {
  content: '';
  position: absolute;
  inset: min(0px, calc((100% - var(--tz-hit-min)) / 2)) min(0px, calc((100% - var(--tz-hit-min)) / 2));
}

/* Activado: placa maciza de pintura, como todo botón pulsado (D47); el filo de abajo, del color de B (el fantasma es B). */
.tz-cmp__ghost[aria-pressed='true'] {
  border-color: var(--tz-accent);
  background: var(--tz-accent);
  color: var(--tz-accent-on);
  box-shadow: inset 0 -3px 0 var(--tz-compare-b);
}

@media (hover: hover) {
  .tz-cmp__ghost:hover:not([aria-pressed='true']) {
    border-color: var(--tz-accent);
  }
}

.tz-cmp__delta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--tz-space-2);
  min-width: 0;
}

/* El signo y el texto dicen quién gana tiempo; el color solo lo acompaña. */
.tz-cmp__value[data-sign='gain'] {
  color: var(--tz-gain);
}

.tz-cmp__value[data-sign='loss'] {
  color: var(--tz-loss);
}

.tz-cmp__value:not([data-state='ok']) {
  font-size: var(--tz-text-sm);
  color: var(--tz-text-muted);
}

.tz-cmp__hint {
  margin-left: auto;
}

.tz-cmp__line {
  display: flex;
  flex-wrap: wrap;
  gap: 0 var(--tz-space-2);
  margin: 0;
  font-size: var(--tz-text-2xs);
  color: var(--tz-text-muted);
}

.tz-cmp__official {
  color: var(--tz-text);
}

.tz-cmp__line[data-sign='gain'] .tz-cmp__official {
  color: var(--tz-gain);
}

.tz-cmp__line[data-sign='loss'] .tz-cmp__official {
  color: var(--tz-loss);
}

.tz-cmp__detail {
  color: var(--tz-text-muted);
}

.tz-cmp__empty {
  margin: var(--tz-space-1) 0 0;
  font-size: var(--tz-text-xs);
  color: var(--tz-text-muted);
}
</style>
