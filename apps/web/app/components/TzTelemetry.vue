<script setup lang="ts">
/**
 * Panel del coche seleccionado: muestra cruda vigente de la telemetría (sin interpolar), DRS si el canal
 * existe y mini gráficas de los últimos 20 s. Los valores se escriben por frame en el DOM. Sin muestra vigente
 * del coche seleccionado (también justo al cambiar de coche), cada celda dice «—» y las gráficas se vacían:
 * nunca quedan cifras ni trazos de otro coche u otro instante.
 *
 * Dos vistas (ítem 1, D31): «En vivo» (lo anterior) y «Comparar» (TzCompare: este coche frente a otro, con la
 * diferencia por distancia, las trazas y el fantasma). El botón de la cabecera cambia de una a otra sin sumar alto
 * al panel; Mayús+clic en la clasificación abre la comparación con ese coche y Esc la cierra (prioridad 60).
 *
 * Jerarquía (D44): la cabecera lleva un tinte del color del equipo (nunca como color de texto: no llega a 4,5:1) y las
 * cifras que se leen de un vistazo (velocidad y marcha) van grandes; su valor es la muestra cruda, nunca se anima.
 *
 * Diseño «Análisis» (ítem 15): gráficas más altas (`--tz-chart-h-tall`) y con una ventana de 40 s. Al elegir otro coche
 * (o abrir el panel), la cabecera destella una vez (21b): solo su fondo, nunca las cifras ni el texto.
 *
 * Sin sitio (tablets, o «Análisis» con sus gráficas altas): una mini gráfica va entera o no va (`fitCharts`). Primero la
 * dirección de carrera cede alto hasta quedarse con un mensaje; después se quita la gráfica de pedales y luego la de
 * velocidad (sus cifras siguen en las celdas); y, si ni así caben las celdas, de la dirección de carrera queda solo su
 * cabecera. Si aun así el panel no cabe, se desplaza y un fundido abajo dice que hay más (en táctil no se ve la barra
 * de desplazamiento).
 */
import type uPlot from 'uplot'
import { token } from '~/design/tokens'
import type { LayoutPreset } from '~/engine/layout/presets'
import { hasRegulation2026Notice } from '~/data/regulation'
import { drsState, Telemetry, type TelemetrySample } from '~/engine/telemetry/telemetry'
import { ESC_PRIORITY, registerEscape } from '~/replay/keys'
import { useCompareStore } from '~/stores/compare'
import { getRuntime, usePlaybackStore } from '~/stores/playback'

const props = withDefaults(defineProps<{ preset?: LayoutPreset }>(), { preset: 'spectator' })
/** Ventana de las mini gráficas (s): 20 s; en «Análisis», 40 s. */
const CHART_WINDOW_S = { spectator: 20, analysis: 40 } as const satisfies Record<LayoutPreset, number>
const CHART_INTERVAL_MS = 66 // ~15 Hz
const windowS = computed(() => CHART_WINDOW_S[props.preset])
const tall = computed(() => props.preset === 'analysis')

const { t, locale } = useI18n()
const playback = usePlaybackStore()
const compare = useCompareStore()
/** Vista «Comparar» en lugar de la telemetría en vivo. */
const comparing = computed(() => compare.tab === 'compare')
const rt = getRuntime()!
const telemetry = new Telemetry(rt.session.car)
const drsChannel = rt.session.manifest.channels.drs === 'present'
const season = rt.session.manifest.session.season
/**
 * «¿Por qué?» del DRS que falta: desde 2026, el aviso del reglamento (el mismo texto que en los avisos de la sesión);
 * antes, que esta sesión no trae el canal.
 */
const drsWhyText = computed(() =>
  hasRegulation2026Notice(season) ? t('regulation.body', { chip: t('trackStatus.overtake'), straight: t('rc.kind.straight_mode') }) : t('drs.noChannel'),
)
/** La fuente no trae telemetría tal cual: el panel lo dice (Estimado). */
const telemetryEstimated = rt.session.manifest.quality.estimated.includes('telemetry')

const driver = computed(() => rt.drivers.find((d) => d.number === playback.selectedCar) ?? null)
const speedEl = ref<HTMLElement | null>(null)
const gearEl = ref<HTMLElement | null>(null)
const rpmEl = ref<HTMLElement | null>(null)
const throttleEl = ref<HTMLElement | null>(null)
const throttleTrack = ref<HTMLElement | null>(null)
const throttleBar = ref<HTMLElement | null>(null)
const brakeEl = ref<HTMLElement | null>(null)
const drsEl = ref<HTMLElement | null>(null)
type Chart = { setData: (d: uPlot.AlignedData) => void; clear: () => void }
const speedChart = ref<Chart | null>(null)
const pedalChart = ref<Chart | null>(null)
const hasSample = ref(true)

// Formatos de Intl creados una vez por idioma (no en cada frame).
const intFmt = computed(() => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 0 }))
const pctFmt = computed(() => new Intl.NumberFormat(locale.value, { style: 'percent', maximumFractionDigits: 0 }))
const num = (v: number) => intFmt.value.format(v)

const sample: TelemetrySample = { t: 0, speedKmh: 0, rpm: 0, gear: 0, throttle: null, brake: false, drsRaw: null }
let lastChart = -Infinity
/** Las gráficas están vacías (para no vaciarlas en cada frame sin dato). */
let chartsCleared = false

const setText = (el: HTMLElement | null, text: string) => {
  if (el && el.textContent !== text) el.textContent = text
}

/** Sin muestra vigente: «—» en todas las celdas, sin barra ni luz de freno, y gráficas vacías. */
function paintNoData() {
  for (const el of [speedEl.value, gearEl.value, rpmEl.value, throttleEl.value]) setText(el, '—')
  if (throttleTrack.value) throttleTrack.value.dataset.known = 'false'
  if (brakeEl.value) {
    brakeEl.value.dataset.on = 'none'
    setText(brakeEl.value, '—')
  }
  if (drsEl.value && drsChannel) {
    drsEl.value.dataset.state = 'none'
    setText(drsEl.value, '—')
  }
  if (!chartsCleared) {
    speedChart.value?.clear()
    pedalChart.value?.clear()
    chartsCleared = true
  }
}

function paint(timeMs: number) {
  const car = playback.selectedCar
  // En la vista «Comparar», las celdas y las mini gráficas no están montadas.
  if (!car || comparing.value) return
  const s = telemetry.sampleAt(car, timeMs, sample)
  if (hasSample.value !== !!s) hasSample.value = !!s
  if (!s) {
    paintNoData()
    return
  }
  setText(speedEl.value, num(s.speedKmh))
  setText(gearEl.value, s.gear === 0 ? 'N' : String(s.gear))
  setText(rpmEl.value, num(s.rpm))
  setText(throttleEl.value, s.throttle === null ? '—' : pctFmt.value.format(s.throttle / 100))
  // Acelerador sin dato: sin barra (una barra vacía diría 0 %).
  if (throttleTrack.value) throttleTrack.value.dataset.known = String(s.throttle !== null)
  if (throttleBar.value) throttleBar.value.style.transform = `scaleX(${(s.throttle ?? 0) / 100})`
  if (brakeEl.value) {
    brakeEl.value.dataset.on = String(s.brake)
    setText(brakeEl.value, '')
  }
  if (drsEl.value && drsChannel) {
    const st = drsState(s.drsRaw)
    drsEl.value.dataset.state = st ?? 'none'
    setText(drsEl.value, st ? t(`telemetry.drs.${st}`) : '—')
  }
  const now = performance.now()
  if (chartsCleared || now - lastChart >= CHART_INTERVAL_MS || !rt.clock.playing) {
    lastChart = now
    drawCharts(car, timeMs)
  }
}

function drawCharts(car: string, timeMs: number) {
  const series = telemetry.seriesOf(car)
  if (!series) {
    speedChart.value?.clear()
    pedalChart.value?.clear()
    chartsCleared = true
    return
  }
  chartsCleared = false
  const [from, to] = telemetry.windowOf(car, timeMs - windowS.value * 1000, timeMs)
  const n = to - from
  const x = new Float64Array(n)
  for (let i = 0; i < n; i++) x[i] = (series.t[from + i]! - timeMs) / 1000
  const speed = (series.speed as Float32Array).subarray(from, to)
  const throttle = new Float32Array(n)
  const brake = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const th = series.throttle[from + i]!
    throttle[i] = th === 255 ? Number.NaN : th
    brake[i] = series.brake[from + i]! > 0 ? 1 : 0
  }
  speedChart.value?.setData([x, speed])
  pedalChart.value?.setData([x, throttle, brake])
}

/*
 * Gráficas enteras o ninguna: se mide al cambiar de tamaño el panel, su columna o lo que contiene (como mucho una vez
 * por frame; nunca en cada frame de la reproducción). Los atributos se escriben directos en el DOM: cada intento se mide
 * en el mismo frame, sin pintar los intermedios.
 */
const panelEl = ref<HTMLElement | null>(null)
/** La columna en la que va el panel: lo que se le pide a la dirección de carrera va en ella (`--replay-rc-fit`). */
let fitSide: HTMLElement | null = null
let fitRaf = 0
let fitResize: ResizeObserver | null = null
let fitMutation: MutationObserver | null = null

const overflows = (el: HTMLElement) => el.scrollHeight > el.clientHeight + 1

/** ¿Queda contenido por debajo de lo que se ve? Entonces, el fundido de abajo. */
function markOverflow() {
  const el = panelEl.value
  if (!el) return
  const more = el.scrollTop + el.clientHeight < el.scrollHeight - 1
  if (more !== el.hasAttribute('data-overflow')) el.toggleAttribute('data-overflow', more)
}

/** Lo que la telemetría le pide a la dirección de carrera (pages/replay.vue): nada, un mensaje o solo su cabecera. */
function askRaceControl(floor: 'one' | 'head' | null) {
  if (floor) fitSide?.style.setProperty('--replay-rc-fit', `var(--replay-rc-${floor})`)
  else fitSide?.style.removeProperty('--replay-rc-fit')
}

function fitCharts() {
  fitRaf = 0
  const el = panelEl.value
  if (!el) return
  const charts = [...el.querySelectorAll<HTMLElement>(':scope > .tz-chart')]
  askRaceControl(null)
  for (const c of charts) c.removeAttribute('data-fit-hidden')
  // Las gráficas antes que más mensajes de dirección de carrera.
  if (overflows(el)) askRaceControl('one')
  // De la última a la primera: los pedales antes que la velocidad.
  for (let i = charts.length - 1; i >= 0 && overflows(el); i--) charts[i]!.setAttribute('data-fit-hidden', '')
  // Las celdas, antes que el último mensaje.
  if (overflows(el)) askRaceControl('head')
  markOverflow()
}

function scheduleFit() {
  if (!fitRaf) fitRaf = requestAnimationFrame(fitCharts)
}

/** El panel, su columna y cada cosa que contiene (las gráficas se montan de nuevo al cambiar de diseño o de vista). */
function observeFit() {
  const el = panelEl.value
  if (fitSide !== (el?.parentElement ?? null)) {
    askRaceControl(null)
    fitSide = el?.parentElement ?? null
  }
  if (!fitResize || !el) return
  fitResize.disconnect()
  fitResize.observe(el)
  if (el.parentElement) fitResize.observe(el.parentElement)
  for (const child of el.children) fitResize.observe(child)
  fitMutation?.disconnect()
  fitMutation?.observe(el, { childList: true })
  scheduleFit()
}

let off: (() => void) | null = null
let offEscape: (() => void) | null = null
onMounted(() => {
  off = rt.onFrame(paint)
  // Esc cierra antes la comparación que el seguimiento y la selección (ESC_PRIORITY).
  offEscape = registerEscape(ESC_PRIORITY.compare, { active: () => comparing.value, run: () => compare.close() })
  rt.requestFrame()
  if (typeof ResizeObserver !== 'undefined' && typeof MutationObserver !== 'undefined') {
    fitResize = new ResizeObserver(scheduleFit)
    fitMutation = new MutationObserver(observeFit)
    observeFit()
  }
})
watch(panelEl, observeFit, { flush: 'post' })
onBeforeUnmount(() => {
  off?.()
  offEscape?.()
  fitResize?.disconnect()
  fitMutation?.disconnect()
  if (fitRaf) cancelAnimationFrame(fitRaf)
  fitRaf = 0
  askRaceControl(null)
})
watch(
  () => playback.selectedCar,
  () => {
    lastChart = -Infinity
    rt.requestFrame()
  },
)
// De vuelta a «En vivo», las mini gráficas se montan vacías: se pintan en el frame siguiente.
watch(comparing, (on) => {
  if (on) return
  lastChart = -Infinity
  chartsCleared = true
  rt.requestFrame()
})
// Otro diseño: las mini gráficas se vuelven a montar (otro alto y otra ventana) y se pintan en el frame siguiente.
watch(
  () => props.preset,
  () => {
    lastChart = -Infinity
    chartsCleared = true
    rt.requestFrame()
  },
)
</script>

<template>
  <section
    v-if="driver"
    ref="panelEl"
    class="tz-tel"
    :aria-label="t('telemetry.title', { tla: driver.tla })"
    :style="{ '--team': driver.color || 'var(--tz-team-unknown)' }"
    data-testid="telemetry"
    :data-car="driver.number"
    @scroll.passive="markOverflow"
  >
    <header class="tz-tel__head">
      <!-- Destello único del fondo al cambiar de coche (decorativo; por debajo del texto). -->
      <span :key="driver.number" class="tz-tel__flash" aria-hidden="true" />
      <span class="tz-tel__tla" :title="`${driver.first} ${driver.last}`">{{ driver.tla }}</span>
      <!-- Con poco sitio (tablet), el nombre no va acortado a una o dos letras: solo para lectores de pantalla. -->
      <span class="tz-tel__name" data-testid="telemetry-name"><span class="tz-tel__name-text">{{ driver.first }} {{ driver.last }}</span></span>
      <!-- «En vivo» / «Comparar»: un conmutador en la cabecera (una fila más no cabría a 1280×800). -->
      <button
        type="button"
        class="tz-tel__compare"
        :aria-pressed="comparing"
        :aria-label="t('compare.tab')"
        :title="t('compare.tabHint')"
        data-testid="compare-toggle"
        @click="compare.setTab(comparing ? 'live' : 'compare')"
      >
        <TzIcon name="compare" size="sm" />
      </button>
      <button
        type="button"
        class="tz-tel__follow"
        :aria-pressed="playback.following"
        :title="t('telemetry.followHint')"
        data-testid="follow-toggle"
        @click="playback.setFollowing(!playback.following)"
      >
        <TzIcon :name="playback.following ? 'overview' : 'follow'" size="sm" />
        <span>{{ playback.following ? t('telemetry.overview') : t('telemetry.follow') }}</span>
      </button>
      <button
        type="button"
        class="tz-iconbtn tz-tel__close"
        :aria-label="t('telemetry.close')"
        :title="t('telemetry.close')"
        data-testid="telemetry-close"
        @click="playback.selectCar(null)"
      >
        <TzIcon name="close" size="sm" />
      </button>
    </header>

    <p v-if="telemetryEstimated" class="tz-tel__estimated"><TzEstimated field="telemetry" /></p>
    <TzLapInfo :car="driver.number" />
    <TzCompare v-if="comparing" />
    <template v-else>
      <p v-if="!hasSample" class="tz-tel__nodata" data-testid="telemetry-nodata">{{ t('telemetry.noData') }}</p>

      <dl class="tz-tel__grid" :class="{ 'is-stale': !hasSample }">
        <div class="tz-tel__cell tz-tel__cell--big tz-tel__cell--wide">
          <dt>{{ t('telemetry.speed') }}</dt>
          <dd><span ref="speedEl" class="tz-num tz-num--xl tz-num--display" data-testid="tel-speed">—</span> <small>{{ t('telemetry.kmh') }}</small></dd>
        </div>
        <div class="tz-tel__cell tz-tel__cell--big">
          <dt>{{ t('telemetry.gear') }}</dt>
          <dd><span ref="gearEl" class="tz-num tz-num--xl tz-num--display" data-testid="tel-gear">—</span></dd>
        </div>
        <div class="tz-tel__cell">
          <dt>{{ t('telemetry.rpm') }}</dt>
          <dd><span ref="rpmEl" class="tz-num tz-num--md" data-testid="tel-rpm">—</span></dd>
        </div>
        <div class="tz-tel__cell tz-tel__cell--wide">
          <dt>{{ t('telemetry.throttle') }}</dt>
          <dd>
            <span ref="throttleTrack" class="tz-tel__bar" data-known="false" aria-hidden="true"><span ref="throttleBar" /></span>
            <span ref="throttleEl" class="tz-tabular" data-testid="tel-throttle">—</span>
          </dd>
        </div>
        <div class="tz-tel__cell">
          <dt>{{ t('telemetry.brake') }}</dt>
          <dd ref="brakeEl" class="tz-tel__brake" data-on="none" :title="t('telemetry.brakeHint')" data-testid="tel-brake">—</dd>
        </div>
        <div class="tz-tel__cell tz-tel__cell--wide">
          <dt>{{ t('telemetry.drsLabel') }}</dt>
          <dd v-if="drsChannel" ref="drsEl" class="tz-tel__drs" data-state="none" data-testid="tel-drs">—</dd>
          <dd v-else class="tz-tel__drs-na" data-testid="tel-drs-unavailable">
            {{ t('telemetry.drsUnavailable', { season }) }}
            <!-- Pista flotante (TzHint): el texto del reglamento es largo y, en línea, empujaría las gráficas fuera del panel. -->
            <TzHint plain class="tz-tel__why" :label="t('telemetry.drsWhy')" :text="drsWhyText" testid="tel-drs-why" align="end">
              <template #button>
                <span class="tz-link">{{ t('telemetry.drsWhy') }}</span>
              </template>
            </TzHint>
          </dd>
        </div>
      </dl>

      <!-- Con otro diseño, otra clave: se vuelven a montar con su alto y su ventana. -->
      <TzMiniChart
        :key="`speed-${preset}`"
        ref="speedChart"
        :label="t('telemetry.chartSpeed', { s: windowS })"
        :series="[{ label: t('telemetry.speed'), color: token('--tz-chart-speed'), scale: 'speed' }]"
        :ranges="{ speed: [0, 360] }"
        :window-s="windowS"
        :tall="tall"
        :no-data-label="t('telemetry.chartNoData')"
      />
      <TzMiniChart
        :key="`pedals-${preset}`"
        ref="pedalChart"
        :label="t('telemetry.chartPedals', { s: windowS })"
        :series="[
          { label: t('telemetry.throttle'), color: token('--tz-chart-throttle'), scale: 'pct' },
          { label: t('telemetry.brakeOnOff'), color: token('--tz-chart-brake'), scale: 'onoff', stepped: true },
        ]"
        :ranges="{ pct: [0, 105], onoff: [0, 4] }"
        :window-s="windowS"
        :tall="tall"
        :no-data-label="t('telemetry.chartNoData')"
      />
    </template>
    <TzCarRadio :car="driver.number" />
  </section>
</template>

<style scoped>
.tz-tel {
  /* Prioridad sobre la dirección de carrera: la telemetría (con sus gráficas) no encoge; si no cabe, scroll. */
  flex: 0 0 auto;
  max-height: calc(100% - var(--replay-rc-floor, 150px) - var(--tz-panel-gap));
  min-height: 0;
  overflow-y: auto;
  padding: 0 var(--tz-panel-pad) var(--tz-space-3);
  border: 1px solid var(--tz-border);
  border-top: 4px solid var(--team);
  border-radius: var(--tz-radius-lg);
  background: var(--tz-overlay);
  box-shadow: var(--tz-shadow-panel);
  accent-color: var(--tz-accent);
}

/* Hay más por debajo (el panel no cabe entero en su columna): un fundido abajo lo dice (con los tokens; solo alfa). */
.tz-tel[data-overflow] {
  mask-image: linear-gradient(to bottom, var(--tz-bg) calc(100% - var(--tz-space-8)), transparent);
}

/* Una mini gráfica que no cabe entera no va (fitCharts): nunca a medias. */
.tz-tel > .tz-chart[data-fit-hidden] {
  display: none;
}

.tz-tel__estimated {
  margin: 0 0 var(--tz-space-2);
}

/* Cabecera con un tinte del color del equipo (≤ --tz-team-tint; sin color-mix, sin tinte). */
.tz-tel__head {
  position: relative;
  isolation: isolate;
  display: flex;
  align-items: center;
  gap: var(--tz-space-2);
  margin: 0 calc(-1 * var(--tz-panel-pad)) var(--tz-space-3);
  padding: var(--tz-space-2) var(--tz-panel-pad);
  border-bottom: 1px solid var(--tz-border);
  background: linear-gradient(90deg, color-mix(in oklab, var(--team) var(--tz-team-tint), transparent), transparent 70%);
}

/* Destello único al cambiar de coche: el fondo, del acento suave a nada (con reduce, 0 ms); por debajo del texto. */
.tz-tel__flash {
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  animation: tz-flash var(--tz-dur-slow) var(--tz-ease-exit);
}

.tz-tel__tla {
  font-family: var(--tz-font-mono);
  font-size: var(--tz-text-xl);
  font-weight: var(--tz-weight-bold);
  letter-spacing: var(--tz-tracking-mono);
  line-height: var(--tz-leading-none);
}

.tz-tel__name {
  flex: 1 1 0;
  min-width: 0;
  container-type: inline-size;
  color: var(--tz-text-muted);
  font-size: var(--tz-text-xs);
}

.tz-tel__name-text {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Menos de unas seis letras («Le…», «Kimi A…» no dicen nada junto a la sigla): fuera de la vista, no del nombre accesible. */
@container (width < 3.5em) {
  .tz-tel__name-text {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
}

.tz-tel__compare,
.tz-tel__follow {
  position: relative;
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: var(--tz-space-1);
  height: 28px;
  padding: 0 var(--tz-space-2);
  border: 1px solid var(--tz-border-strong);
  border-radius: var(--tz-radius-sm);
  background: transparent;
  font-size: var(--tz-text-xs);
  white-space: nowrap;
  cursor: pointer;
}

/* Zona táctil de --tz-hit-min con puntero grueso, sin mover el layout. */
.tz-tel__compare::after,
.tz-tel__follow::after {
  content: '';
  position: absolute;
  inset: min(0px, calc((100% - var(--tz-hit-min)) / 2)) 0;
}

/* Activado (comparando, siguiendo): placa maciza de pintura (D47). */
.tz-tel__compare[aria-pressed='true'],
.tz-tel__follow[aria-pressed='true'] {
  border-color: var(--tz-accent);
  background: var(--tz-accent);
  color: var(--tz-accent-on);
}

.tz-tel__close {
  width: 28px;
  height: 28px;
}

@media (hover: hover) {
  .tz-tel__compare:hover:not([aria-pressed='true']),
  .tz-tel__follow:hover:not([aria-pressed='true']) {
    border-color: var(--tz-accent);
  }
}

.tz-tel__nodata {
  margin: 0 0 var(--tz-space-2);
  color: var(--tz-text-muted);
  font-size: var(--tz-text-xs);
}

.tz-tel__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--tz-space-2);
  margin: 0 0 var(--tz-space-3);
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

/* Velocidad y marcha: las cifras grandes (muestra cruda; «270 km/h» en una línea). */
.tz-tel__cell--big dd {
  margin-top: var(--tz-space-0-5);
  white-space: nowrap;
}

.tz-tel__cell--big small {
  font-family: var(--tz-font-sans);
  font-size: var(--tz-text-2xs);
  color: var(--tz-text-muted);
}

.tz-tel__cell--wide {
  grid-column: span 2;
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

.tz-tel__bar[data-known='false'] {
  visibility: hidden;
}

.tz-tel__bar span {
  display: block;
  height: 100%;
  background: var(--tz-success);
  transform-origin: left center;
  transform: scaleX(0);
}

/* Encendido/apagado (el canal no da la presión): una luz, o «—» sin dato. */
.tz-tel__brake:not([data-on='none']) {
  width: 14px;
  height: 14px;
  margin-top: 3px !important;
  border: 1px solid var(--tz-border-strong);
  border-radius: 50%;
  background: var(--tz-surface-3);
}

.tz-tel__brake[data-on='true'] {
  border-color: var(--tz-danger);
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

/* «¿Por qué?»: pista con aspecto de enlace (.tz-link, pintura subrayada); la zona táctil la pone TzHint. */
.tz-tel__why {
  margin-left: var(--tz-space-1);
  vertical-align: baseline;
}
</style>
