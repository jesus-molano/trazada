<script setup lang="ts">
/**
 * Gráfica por distancia de la comparación (ítem 1, D31; uPlot, Canvas 2D): un canal (velocidad, acelerador, freno) de
 * los dos pilotos frente a la distancia recorrida dentro de la vuelta, de 0 a la longitud de la vuelta. Cada piloto
 * con su color (`--tz-compare-a` / `--tz-compare-b`) y su sigla en la leyenda: nunca solo el color.
 *
 * Los datos llegan por `setData` (sin reactividad de Vue sobre los arrays) y la línea de la posición actual de A, por
 * `setCursor`: un elemento del DOM que se mueve con un transform, sin redibujar la gráfica. Alto de `--tz-chart-h`
 * (`compact`: el de un canal de encendido/apagado). Sin Canvas 2D (entorno de tests), no pinta la gráfica.
 */
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { token } from '~/design/tokens'

const props = defineProps<{
  label: string
  /** Una serie por piloto: su rótulo (sigla), su color y su escala; `stepped`, canal de encendido/apagado. */
  series: { label: string; color: string; scale: string; stepped?: boolean }[]
  /** Rango fijo de cada escala. */
  ranges: Record<string, [number, number]>
  /** Longitud de la vuelta (m): el eje x va de 0 a ella. */
  lengthM: number
  compact?: boolean
  testid?: string
}>()

const host = ref<HTMLElement | null>(null)
let plot: uPlot | null = null
let cursorEl: HTMLDivElement | null = null
let cursorD: number | null = null
let ro: ResizeObserver | null = null
let resize: (() => void) | null = null

/** Alto del canal de encendido/apagado respecto al de las demás. */
const COMPACT = 0.6
const chartHeight = () => Math.round(Number.parseFloat(token('--tz-chart-h')) * (props.compact ? COMPACT : 1))

function canDraw(): boolean {
  try {
    return typeof document !== 'undefined' && !!document.createElement('canvas').getContext('2d')
  } catch {
    return false
  }
}

const empty = (): uPlot.AlignedData => [[], ...props.series.map(() => [])]

function setData(data: uPlot.AlignedData): void {
  plot?.setData(data)
}

/** Deja la gráfica vacía (sin dato: nada de trazos de otro coche u otra vuelta). */
function clear(): void {
  plot?.setData(empty())
}

/** Línea de la posición de A (m dentro de la vuelta); null, sin línea. */
function setCursor(d: number | null): void {
  cursorD = d
  const el = cursorEl
  if (!plot || !el) return
  if (d === null || !(d >= 0 && d <= props.lengthM)) {
    if (!el.hidden) el.hidden = true
    return
  }
  el.hidden = false
  el.style.transform = `translateX(${plot.valToPos(d, 'x')}px)`
}

onMounted(() => {
  const el = host.value
  if (!el || !canDraw()) return
  const scales: uPlot.Scales = { x: { time: false, range: [0, props.lengthM] } }
  for (const [k, r] of Object.entries(props.ranges)) scales[k] = { range: r }
  plot = new uPlot(
    {
      width: el.clientWidth || 240,
      height: chartHeight(),
      legend: { show: false },
      cursor: { show: false },
      select: { show: false, left: 0, top: 0, width: 0, height: 0 },
      scales,
      axes: [{ show: false }, { show: false, scale: props.series[0]?.scale ?? 'y' }],
      series: [
        {},
        ...props.series.map((s) => ({
          label: s.label,
          stroke: s.color,
          width: 1.5,
          scale: s.scale,
          spanGaps: false,
          points: { show: false },
          ...(s.stepped && uPlot.paths.stepped ? { paths: uPlot.paths.stepped({ align: 1 }) } : {}),
        })),
      ],
    },
    empty(),
    el,
  )
  cursorEl = document.createElement('div')
  cursorEl.className = 'tz-dchart__cursor'
  cursorEl.hidden = true
  plot.over.append(cursorEl)
  resize = () => {
    plot?.setSize({ width: el.clientWidth, height: chartHeight() })
    setCursor(cursorD)
  }
  ro = new ResizeObserver(resize)
  ro.observe(el)
  window.addEventListener('resize', resize)
})

onBeforeUnmount(() => {
  ro?.disconnect()
  if (resize) window.removeEventListener('resize', resize)
  plot?.destroy()
  plot = null
  cursorEl = null
})

defineExpose({ setData, clear, setCursor })
</script>

<template>
  <figure class="tz-dchart" :aria-label="label" :data-testid="testid">
    <figcaption class="tz-dchart__label">
      <span class="tz-dchart__name">{{ label }}</span>
      <span v-for="s in series" :key="s.label" class="tz-dchart__key">
        <i :style="{ background: s.color }" aria-hidden="true" />{{ s.label }}
      </span>
    </figcaption>
    <div ref="host" class="tz-dchart__plot" />
  </figure>
</template>

<style scoped>
.tz-dchart {
  margin: 0;
}

.tz-dchart__label {
  display: flex;
  gap: var(--tz-space-2);
  margin-bottom: 2px;
  font-size: var(--tz-text-2xs);
  color: var(--tz-text-muted);
  white-space: nowrap;
}

.tz-dchart__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tz-dchart__key i {
  display: inline-block;
  width: 8px;
  height: 2px;
  margin-right: 4px;
  vertical-align: middle;
}

.tz-dchart__plot {
  position: relative;
  width: 100%;
}

/* Posición actual de A (la mueve `setCursor`, sin redibujar la gráfica). */
.tz-dchart__plot :deep(.tz-dchart__cursor) {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 0;
  border-left: 1px solid var(--tz-text-muted);
  pointer-events: none;
}
</style>
