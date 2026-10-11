<script setup lang="ts">
/**
 * Mini gráfica (uPlot, Canvas 2D) de una ventana deslizante. Los datos llegan por `setData` desde el
 * panel (sin reactividad de Vue sobre los arrays). Alto de `--tz-chart-h` (más bajo con la densidad compacta) o, con
 * `tall` (diseño «Análisis», ítem 15), de `--tz-chart-h-tall`. Al cambiar el ancho del panel (también al arrastrar su
 * asa), un `setSize` como mucho por frame.
 */
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { token } from '~/design/tokens'

const props = defineProps<{
  label: string
  /** `stepped`: canal de encendido/apagado, dibujado en escalones (sin rampas entre muestras). */
  series: { label: string; color: string; scale?: string; stepped?: boolean }[]
  /** Rango fijo de cada escala (p. ej. velocidad 0–360). */
  ranges: Record<string, [number, number]>
  windowS: number
  /** Más alta (diseño «Análisis»). */
  tall?: boolean
}>()

const host = ref<HTMLElement | null>(null)
let plot: uPlot | null = null
let ro: ResizeObserver | null = null
let raf = 0

/** Alto del trazado (px): el token de densidad, que cambia con el alto de la ventana. */
const chartHeight = () => Number.parseFloat(token(props.tall ? '--tz-chart-h-tall' : '--tz-chart-h'))

function setData(data: uPlot.AlignedData): void {
  // Con las escalas fijas (rangos de props), «resetScales» las deja igual; lo importante es que uPlot rehaga
  // los trazos. Antes: setData(data, false) + redraw(false) pintaba los trazos en caché (vacíos).
  plot?.setData(data)
}

/** Deja la gráfica vacía (sin dato: nada de trazos de otro coche u otro instante). */
function clear(): void {
  plot?.setData([new Float64Array(0), ...props.series.map(() => new Float64Array(0))])
}

/** El ancho sigue al panel; el alto, a la densidad. Un solo `setSize` por frame aunque avisen la ventana y el panel. */
function resize() {
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    const el = host.value
    if (plot && el) plot.setSize({ width: el.clientWidth, height: chartHeight() })
  })
}

onMounted(() => {
  const el = host.value!
  const scales: uPlot.Scales = { x: { time: false, range: [-props.windowS, 0] } }
  for (const [k, r] of Object.entries(props.ranges)) scales[k] = { range: r }
  plot = new uPlot(
    {
      width: el.clientWidth || 240,
      height: chartHeight(),
      legend: { show: false },
      cursor: { show: false },
      select: { show: false, left: 0, top: 0, width: 0, height: 0 },
      scales,
      axes: [
        { show: false },
        { show: false, scale: props.series[0]?.scale ?? 'y' },
      ],
      series: [
        {},
        ...props.series.map((s) => ({
          label: s.label,
          stroke: s.color,
          width: 1.5,
          scale: s.scale ?? 'y',
          points: { show: false },
          ...(s.stepped && uPlot.paths.stepped ? { paths: uPlot.paths.stepped({ align: 1 }) } : {}),
        })),
      ],
    },
    [new Float64Array(0), ...props.series.map(() => new Float64Array(0))],
    el,
  )
  // Una ventana más baja no cambia el ancho del panel: también al cambiar el tamaño de la ventana.
  ro = new ResizeObserver(resize)
  ro.observe(el)
  window.addEventListener('resize', resize)
})

onBeforeUnmount(() => {
  ro?.disconnect()
  window.removeEventListener('resize', resize)
  if (raf) cancelAnimationFrame(raf)
  raf = 0
  plot?.destroy()
  plot = null
})

defineExpose({ setData, clear })
</script>

<template>
  <figure class="tz-chart" :aria-label="label" :data-window-s="windowS" :data-tall="tall || undefined">
    <figcaption class="tz-chart__label">
      <span v-for="s in series" :key="s.label" class="tz-chart__key">
        <i :style="{ background: s.color }" aria-hidden="true" />{{ s.label }}
      </span>
    </figcaption>
    <div ref="host" class="tz-chart__plot" />
  </figure>
</template>

<style scoped>
.tz-chart {
  margin: 0;
}

.tz-chart__label {
  display: flex;
  gap: var(--tz-space-3);
  margin-bottom: 2px;
  font-size: var(--tz-text-2xs);
  color: var(--tz-text-muted);
}

.tz-chart__key i {
  display: inline-block;
  width: 8px;
  height: 2px;
  margin-right: 4px;
  vertical-align: middle;
}

.tz-chart__plot {
  width: 100%;
}
</style>
