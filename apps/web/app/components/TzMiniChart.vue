<script setup lang="ts">
/**
 * Mini gráfica (uPlot, Canvas 2D) de una ventana deslizante. Los datos llegan por `setData` desde el
 * panel (sin reactividad de Vue sobre los arrays).
 */
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'

const props = defineProps<{
  label: string
  series: { label: string; color: string; scale?: string }[]
  /** Rango fijo de cada escala (p. ej. velocidad 0–360). */
  ranges: Record<string, [number, number]>
  windowS: number
}>()

const host = ref<HTMLElement | null>(null)
let plot: uPlot | null = null
let ro: ResizeObserver | null = null

function setData(data: uPlot.AlignedData): void {
  // Con las escalas fijas (rangos de props), «resetScales» las deja igual; lo importante es que uPlot rehaga
  // los trazos. Antes: setData(data, false) + redraw(false) pintaba los trazos en caché (vacíos).
  plot?.setData(data)
}

onMounted(() => {
  const el = host.value!
  const scales: uPlot.Scales = { x: { time: false, range: [-props.windowS, 0] } }
  for (const [k, r] of Object.entries(props.ranges)) scales[k] = { range: r }
  plot = new uPlot(
    {
      width: el.clientWidth || 240,
      height: 64,
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
        })),
      ],
    },
    [new Float64Array(0), ...props.series.map(() => new Float64Array(0))],
    el,
  )
  ro = new ResizeObserver(() => plot?.setSize({ width: el.clientWidth, height: 64 }))
  ro.observe(el)
})

onBeforeUnmount(() => {
  ro?.disconnect()
  plot?.destroy()
  plot = null
})

defineExpose({ setData })
</script>

<template>
  <figure class="tz-chart" :aria-label="label">
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
