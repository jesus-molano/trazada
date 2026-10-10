<script setup lang="ts">
/**
 * Panel del coche seleccionado: muestra cruda vigente de la telemetría (sin interpolar), DRS si el canal
 * existe y mini gráficas de los últimos 20 s. Los valores se escriben por frame en el DOM.
 */
import type uPlot from 'uplot'
import { token } from '~/design/tokens'
import { drsState, Telemetry, type TelemetrySample } from '~/engine/telemetry/telemetry'
import { getRuntime, usePlaybackStore } from '~/stores/playback'

const CHART_WINDOW_S = 20
const CHART_INTERVAL_MS = 66 // ~15 Hz

const { t, locale } = useI18n()
const playback = usePlaybackStore()
const rt = getRuntime()!
const telemetry = new Telemetry(rt.session.car)
const drsChannel = rt.session.manifest.channels.drs === 'present'
const season = rt.session.manifest.session.season
/** La fuente no trae telemetría tal cual: el panel lo dice (Estimado). */
const telemetryEstimated = rt.session.manifest.quality.estimated.includes('telemetry')

const driver = computed(() => rt.drivers.find((d) => d.number === playback.selectedCar) ?? null)
const speedEl = ref<HTMLElement | null>(null)
const gearEl = ref<HTMLElement | null>(null)
const rpmEl = ref<HTMLElement | null>(null)
const throttleEl = ref<HTMLElement | null>(null)
const throttleBar = ref<HTMLElement | null>(null)
const brakeEl = ref<HTMLElement | null>(null)
const drsEl = ref<HTMLElement | null>(null)
const speedChart = ref<{ setData: (d: uPlot.AlignedData) => void } | null>(null)
const pedalChart = ref<{ setData: (d: uPlot.AlignedData) => void } | null>(null)
const hasSample = ref(true)

// Formatos de Intl creados una vez por idioma (no en cada frame).
const intFmt = computed(() => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 0 }))
const pctFmt = computed(() => new Intl.NumberFormat(locale.value, { style: 'percent', maximumFractionDigits: 0 }))
const num = (v: number) => intFmt.value.format(v)

const sample: TelemetrySample = { t: 0, speedKmh: 0, rpm: 0, gear: 0, throttle: null, brake: false, drsRaw: null }
let lastChart = -Infinity

function paint(timeMs: number) {
  const car = playback.selectedCar
  if (!car) return
  const s = telemetry.sampleAt(car, timeMs, sample)
  if (hasSample.value !== !!s) hasSample.value = !!s
  if (!s) return
  if (speedEl.value) speedEl.value.textContent = num(s.speedKmh)
  if (gearEl.value) gearEl.value.textContent = s.gear === 0 ? 'N' : String(s.gear)
  if (rpmEl.value) rpmEl.value.textContent = num(s.rpm)
  if (throttleEl.value) throttleEl.value.textContent = s.throttle === null ? '—' : pctFmt.value.format(s.throttle / 100)
  if (throttleBar.value) throttleBar.value.style.transform = `scaleX(${(s.throttle ?? 0) / 100})`
  if (brakeEl.value) brakeEl.value.dataset.on = String(s.brake)
  if (drsEl.value && drsChannel) {
    const st = drsState(s.drsRaw)
    drsEl.value.dataset.state = st ?? 'none'
    drsEl.value.textContent = st ? t(`telemetry.drs.${st}`) : '—'
  }
  const now = performance.now()
  if (now - lastChart >= CHART_INTERVAL_MS || !rt.clock.playing) {
    lastChart = now
    drawCharts(car, timeMs)
  }
}

function drawCharts(car: string, timeMs: number) {
  const series = telemetry.seriesOf(car)
  if (!series) return
  const [from, to] = telemetry.windowOf(car, timeMs - CHART_WINDOW_S * 1000, timeMs)
  const n = to - from
  const x = new Float64Array(n)
  for (let i = 0; i < n; i++) x[i] = (series.t[from + i]! - timeMs) / 1000
  const speed = (series.speed as Float32Array).subarray(from, to)
  const throttle = new Float32Array(n)
  const brake = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const th = series.throttle[from + i]!
    throttle[i] = th === 255 ? Number.NaN : th
    brake[i] = series.brake[from + i]! > 0 ? 100 : 0
  }
  speedChart.value?.setData([x, speed])
  pedalChart.value?.setData([x, throttle, brake])
}

let off: (() => void) | null = null
onMounted(() => {
  off = rt.onFrame(paint)
  rt.requestFrame()
})
onBeforeUnmount(() => off?.())
watch(
  () => playback.selectedCar,
  () => {
    lastChart = -Infinity
    rt.requestFrame()
  },
)
</script>

<template>
  <section
    v-if="driver"
    class="tz-tel"
    :aria-label="t('telemetry.title', { tla: driver.tla })"
    :style="{ '--team': driver.color }"
    data-testid="telemetry"
    :data-car="driver.number"
  >
    <header class="tz-tel__head">
      <span class="tz-tel__tla">{{ driver.tla }}</span>
      <span class="tz-tel__name">{{ driver.first }} {{ driver.last }}</span>
      <button
        type="button"
        class="tz-tel__follow"
        :aria-pressed="playback.following"
        :title="t('telemetry.followHint')"
        data-testid="follow-toggle"
        @click="playback.setFollowing(!playback.following)"
      >
        {{ playback.following ? t('telemetry.overview') : t('telemetry.follow') }}
      </button>
      <button type="button" class="tz-tel__close" :aria-label="t('telemetry.close')" @click="playback.selectCar(null)">
        ×
      </button>
    </header>

    <p v-if="telemetryEstimated" class="tz-tel__estimated"><TzEstimated field="telemetry" /></p>
    <TzLapInfo :car="driver.number" />
    <p v-if="!hasSample" class="tz-tel__nodata" data-testid="telemetry-nodata">{{ t('telemetry.noData') }}</p>

    <dl class="tz-tel__grid" :class="{ 'is-stale': !hasSample }">
      <div class="tz-tel__cell tz-tel__cell--big">
        <dt>{{ t('telemetry.speed') }}</dt>
        <dd><span ref="speedEl" class="tz-tabular" data-testid="tel-speed">—</span> <small>{{ t('telemetry.kmh') }}</small></dd>
      </div>
      <div class="tz-tel__cell">
        <dt>{{ t('telemetry.gear') }}</dt>
        <dd ref="gearEl" class="tz-tabular" data-testid="tel-gear">—</dd>
      </div>
      <div class="tz-tel__cell">
        <dt>{{ t('telemetry.rpm') }}</dt>
        <dd ref="rpmEl" class="tz-tabular" data-testid="tel-rpm">—</dd>
      </div>
      <div class="tz-tel__cell tz-tel__cell--wide">
        <dt>{{ t('telemetry.throttle') }}</dt>
        <dd>
          <span class="tz-tel__bar" aria-hidden="true"><span ref="throttleBar" /></span>
          <span ref="throttleEl" class="tz-tabular" data-testid="tel-throttle">—</span>
        </dd>
      </div>
      <div class="tz-tel__cell">
        <dt>{{ t('telemetry.brake') }}</dt>
        <dd ref="brakeEl" class="tz-tel__brake" data-on="false" data-testid="tel-brake" />
      </div>
      <div class="tz-tel__cell tz-tel__cell--full">
        <dt>{{ t('telemetry.drsLabel') }}</dt>
        <dd v-if="drsChannel" ref="drsEl" class="tz-tel__drs" data-state="none" data-testid="tel-drs">—</dd>
        <dd v-else class="tz-tel__drs-na" data-testid="tel-drs-unavailable">
          {{ t('telemetry.drsUnavailable', { season }) }}
          <details class="tz-tel__why">
            <summary>{{ t('telemetry.drsWhy') }}</summary>
            <span class="tz-tel__hint">{{ t('telemetry.drsUnavailableHint') }}</span>
          </details>
        </dd>
      </div>
    </dl>

    <TzMiniChart
      ref="speedChart"
      :label="t('telemetry.chartSpeed')"
      :series="[{ label: t('telemetry.speed'), color: token('--tz-chart-speed'), scale: 'speed' }]"
      :ranges="{ speed: [0, 360] }"
      :window-s="CHART_WINDOW_S"
    />
    <TzMiniChart
      ref="pedalChart"
      :label="t('telemetry.chartPedals')"
      :series="[
        { label: t('telemetry.throttle'), color: token('--tz-chart-throttle'), scale: 'pct' },
        { label: t('telemetry.brake'), color: token('--tz-chart-brake'), scale: 'pct' },
      ]"
      :ranges="{ pct: [0, 105] }"
      :window-s="CHART_WINDOW_S"
    />
  </section>
</template>

<style scoped>
.tz-tel {
  /* Prioridad sobre la dirección de carrera: la telemetría (con sus gráficas) no encoge; si no cabe, scroll. */
  flex: 0 0 auto;
  max-height: calc(100% - var(--replay-rc-min, 150px) - var(--tz-space-3));
  min-height: 0;
  overflow-y: auto;
  padding: var(--tz-space-3);
  border: 1px solid var(--tz-border);
  border-top: 3px solid var(--team);
  border-radius: var(--tz-radius-lg);
  background: var(--tz-overlay);
  box-shadow: var(--tz-shadow-panel);
}

.tz-tel__estimated {
  margin: 0 0 var(--tz-space-2);
}

.tz-tel__head {
  display: flex;
  align-items: center;
  gap: var(--tz-space-2);
  margin-bottom: var(--tz-space-2);
}

.tz-tel__tla {
  font-family: var(--tz-font-mono);
  font-weight: var(--tz-weight-bold);
}

.tz-tel__name {
  flex: 1;
  overflow: hidden;
  color: var(--tz-text-muted);
  font-size: var(--tz-text-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tz-tel__follow,
.tz-tel__close {
  padding: 2px var(--tz-space-2);
  border: 1px solid var(--tz-border-strong);
  border-radius: var(--tz-radius-sm);
  background: transparent;
  font-size: var(--tz-text-xs);
  cursor: pointer;
}

.tz-tel__follow[aria-pressed='true'] {
  border-color: var(--tz-accent);
  color: var(--tz-accent-strong);
}

.tz-tel__nodata {
  margin: 0 0 var(--tz-space-2);
  color: var(--tz-text-muted);
  font-size: var(--tz-text-xs);
}

.tz-tel__grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--tz-space-2);
  margin: 0 0 var(--tz-space-2);
}

.tz-tel__grid.is-stale {
  opacity: 0.4;
}

.tz-tel__cell dt {
  font-size: var(--tz-text-2xs);
  color: var(--tz-text-muted);
}

.tz-tel__cell dd {
  margin: 0;
  font-family: var(--tz-font-mono);
  font-size: var(--tz-text-md);
}

.tz-tel__cell--big dd {
  font-size: var(--tz-text-xl);
  /* «261 km/h» en una línea: el panel es estrecho y cada línea de más empuja las gráficas fuera. */
  white-space: nowrap;
}

.tz-tel__cell--big small {
  font-size: var(--tz-text-2xs);
  color: var(--tz-text-muted);
}

.tz-tel__cell--wide {
  grid-column: span 2;
}

.tz-tel__cell--full {
  grid-column: 1 / -1;
}

.tz-tel__bar {
  display: inline-block;
  width: 70px;
  height: 6px;
  margin-right: var(--tz-space-2);
  overflow: hidden;
  border-radius: var(--tz-radius-pill);
  background: var(--tz-surface-3);
  vertical-align: middle;
}

.tz-tel__bar span {
  display: block;
  height: 100%;
  background: var(--tz-success);
  transform-origin: left center;
  transform: scaleX(0);
}

.tz-tel__brake {
  width: 14px;
  height: 14px;
  margin-top: 3px !important;
  border-radius: 50%;
  background: var(--tz-surface-3);
}

.tz-tel__brake[data-on='true'] {
  background: var(--tz-danger);
}

.tz-tel__drs[data-state='open'] {
  color: var(--tz-success);
}

.tz-tel__drs[data-state='available'] {
  color: var(--tz-flag-yellow);
}

.tz-tel__drs-na {
  font-family: var(--tz-font-sans) !important;
  font-size: var(--tz-text-xs) !important;
  color: var(--tz-text-muted);
}

.tz-tel__why {
  display: inline;
}

.tz-tel__why summary {
  display: inline;
  margin-left: var(--tz-space-1);
  color: var(--tz-accent-strong);
  cursor: pointer;
  list-style: none;
}

.tz-tel__why summary::-webkit-details-marker {
  display: none;
}

.tz-tel__hint {
  display: block;
  margin-top: 2px;
  font-size: var(--tz-text-2xs);
  color: var(--tz-text-faint);
}
</style>
