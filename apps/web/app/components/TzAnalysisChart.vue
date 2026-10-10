<script setup lang="ts">
/**
 * Gráfica de la hoja de análisis (ítem 3, D33) con uPlot (Canvas 2D, MIT; ya es dependencia). Colores de los tokens
 * (ejes, rejilla, texto) y de los equipos (manifest). Cada piloto se identifica por su sigla: la leyenda (botones
 * para mostrar u ocultar su serie) y un rótulo al final de su serie; nunca solo por el color. El segundo piloto de
 * cada equipo, en discontinuo; con un coche destacado, el resto se atenúa.
 *
 * La descripción llega entera en `spec` (sin reactividad profunda: los arrays no se recorren con Vue) y la gráfica se
 * rehace cuando cambia (las pestañas solo la cambian al cruzar un instante que cambia los datos o al tocar la
 * leyenda). La línea del instante actual (`cursorX`) es un elemento del DOM: moverla no redibuja la gráfica. Un clic
 * en la gráfica elige el punto del eje x más cercano (`pick`).
 *
 * Sin Canvas 2D (entorno de tests), no pinta la gráfica; la leyenda sí.
 */
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { type ChartSpec, DIM_ALPHA, lastValueIndex, nearestIndex, spreadLabels } from '~/analysis/chart'
import { token } from '~/design/tokens'

const props = defineProps<{
  spec: ChartSpec
  /** Valor del eje x del instante actual (línea vertical); null, sin línea. */
  cursorX: number | null
  /** Nombre accesible de la gráfica (ya traducido). */
  label: string
  /** Nombre del grupo de la leyenda (ya traducido). */
  legendLabel: string
  testid?: string
}>()

const emit = defineEmits<{ pick: [index: number]; toggle: [key: string] }>()

const host = ref<HTMLElement | null>(null)
let plot: uPlot | null = null
let cursorEl: HTMLDivElement | null = null
let ro: ResizeObserver | null = null
let raf = 0

function canDraw(): boolean {
  try {
    return typeof document !== 'undefined' && !!document.createElement('canvas').getContext('2d')
  } catch {
    return false
  }
}

const DASH = [6, 4]

/** Aspas para las vueltas anuladas (puntos a medida de uPlot). */
const crossPoints: uPlot.Series.Points.PathBuilder = (u, seriesIdx, idx0, idx1) => {
  const s = u.series[seriesIdx]!
  const xs = u.data[0]
  const ys = u.data[seriesIdx]!
  const r = ((s.points?.size ?? 8) / 2) * uPlot.pxRatio
  const stroke = new Path2D()
  for (let i = idx0; i <= idx1; i++) {
    const y = ys[i]
    if (y === null || y === undefined) continue
    const cx = u.valToPos(xs[i]!, 'x', true)
    const cy = u.valToPos(y, s.scale ?? 'y', true)
    stroke.moveTo(cx - r, cy - r)
    stroke.lineTo(cx + r, cy + r)
    stroke.moveTo(cx + r, cy - r)
    stroke.lineTo(cx - r, cy + r)
  }
  const clip = new Path2D()
  clip.rect(u.bbox.left - r, u.bbox.top - r, u.bbox.width + 2 * r, u.bbox.height + 2 * r)
  return { stroke, fill: null, clip }
}

const noPath: uPlot.Series.PathBuilder = () => null

function seriesOptions(spec: ChartSpec): uPlot.Series[] {
  const groups = new Map(spec.groups.map((g) => [g.key, g]))
  const dimmed = spec.groups.some((g) => g.visible && g.emphasis)
  const surface = token('--tz-surface-1')
  return [
    {},
    ...spec.series.map((s): uPlot.Series => {
      const g = groups.get(s.group)!
      const base: uPlot.Series = {
        label: g.label,
        show: g.visible,
        scale: 'y',
        stroke: g.color,
        width: g.emphasis ? 2.5 : 1.5,
        alpha: dimmed && !g.emphasis ? DIM_ALPHA : 1,
        spanGaps: false,
      }
      switch (s.mark) {
        case 'line':
          return { ...base, ...(g.dash ? { dash: DASH } : {}), points: { show: false } }
        case 'lineDot':
          return { ...base, ...(g.dash ? { dash: DASH } : {}), points: { show: true, size: 5, width: 1, fill: g.color, stroke: g.color } }
        case 'dot':
          return { ...base, paths: noPath, points: { show: true, size: 6, width: 1, fill: g.color, stroke: g.color } }
        case 'hollow':
          return { ...base, paths: noPath, points: { show: true, size: 7, width: 1.5, fill: surface, stroke: g.color } }
        case 'cross':
          return { ...base, paths: noPath, points: { show: true, size: 8, width: 1.5, stroke: g.color, paths: crossPoints } }
      }
    }),
  ]
}

/** Rótulo (sigla) al final de cada serie visible, sin pisarse, con una marca del color de su equipo. */
function drawEndLabels(u: uPlot, spec: ChartSpec) {
  const r = uPlot.pxRatio
  const dimmed = spec.groups.some((g) => g.visible && g.emphasis)
  const entries: { label: string; color: string; alpha: number; x: number; y: number }[] = []
  for (const g of spec.groups) {
    if (!g.visible) continue
    const lists = spec.series.filter((s) => s.group === g.key).map((s) => s.values)
    const i = lastValueIndex(lists)
    if (i < 0) continue
    const v = lists.map((l) => l[i]).find((x) => x !== null && x !== undefined)
    if (v === null || v === undefined) continue
    const x = u.valToPos(spec.x[i]!, 'x', true)
    const y = u.valToPos(v, 'y', true)
    // Fuera del área visible (rango fijo del eje y): sin rótulo; la leyenda lo nombra.
    if (y < u.bbox.top || y > u.bbox.top + u.bbox.height) continue
    entries.push({ label: g.label, color: g.color, alpha: dimmed && !g.emphasis ? DIM_ALPHA : 1, x, y })
  }
  if (!entries.length) return
  const ys = spreadLabels(
    entries.map((e) => e.y),
    11 * r,
    u.bbox.top + 5 * r,
    u.bbox.top + u.bbox.height - 5 * r,
  )
  const ctx = u.ctx
  ctx.save()
  ctx.font = `${10 * r}px ${token('--tz-font-sans')}`
  ctx.textBaseline = 'middle'
  const text = token('--tz-text')
  entries.forEach((e, k) => {
    const lx = e.x + 6 * r
    ctx.globalAlpha = e.alpha
    ctx.fillStyle = e.color
    ctx.fillRect(lx, ys[k]! - r, 5 * r, 2 * r)
    ctx.fillStyle = text
    ctx.fillText(e.label, lx + 7 * r, ys[k]!)
  })
  ctx.restore()
}

function placeCursor() {
  const el = cursorEl
  if (!plot || !el) return
  const x = props.cursorX
  const min = plot.scales.x?.min
  const max = plot.scales.x?.max
  if (x === null || min === undefined || max === undefined || x < min || x > max) {
    el.hidden = true
    return
  }
  el.hidden = false
  el.style.transform = `translateX(${plot.valToPos(x, 'x')}px)`
}

function destroy() {
  plot?.destroy()
  plot = null
  cursorEl = null
}

function onPick(event: MouseEvent) {
  if (!plot) return
  const rect = plot.over.getBoundingClientRect()
  const left = event.clientX - rect.left
  if (left < 0 || left > rect.width) return
  const i = nearestIndex(props.spec.x, plot.posToVal(left, 'x'))
  if (i >= 0) emit('pick', i)
}

function build() {
  destroy()
  const el = host.value
  if (!el || !canDraw()) return
  const spec = props.spec
  const muted = token('--tz-text-muted')
  const grid = token('--tz-border')
  const font = `${token('--tz-text-xs')} ${token('--tz-font-sans')}`
  const axis = (scale: string, format: (v: number) => string): uPlot.Axis => ({
    scale,
    stroke: muted,
    font,
    grid: { stroke: grid, width: 1 },
    ticks: { stroke: grid, width: 1, size: 4 },
    values: (_u, splits) => splits.map(format),
  })
  plot = new uPlot(
    {
      width: Math.max(1, el.clientWidth),
      height: Math.max(1, el.clientHeight),
      // Hueco a la derecha para los rótulos del final de las series.
      padding: [8, 44, 0, 0],
      legend: { show: false },
      cursor: { x: true, y: false, points: { show: false }, drag: { x: false, y: false, setScale: false }, focus: { prox: -1 } },
      select: { show: false, left: 0, top: 0, width: 0, height: 0 },
      scales: {
        x: { time: false, ...(spec.xRange ? { range: spec.xRange } : {}) },
        y: { dir: spec.yDir, ...(spec.yRange ? { range: spec.yRange } : {}) },
      },
      axes: [
        { ...axis('x', spec.formatX), space: 56, ...(spec.xIncrs ? { incrs: [...spec.xIncrs] } : {}) },
        { ...axis('y', spec.formatY), size: 64 },
      ],
      series: seriesOptions(spec),
      hooks: {
        draw: [(u) => drawEndLabels(u, spec), () => placeCursor()],
      },
    },
    [spec.x as number[], ...spec.series.map((s) => s.values as (number | null)[])],
    el,
  )
  cursorEl = document.createElement('div')
  cursorEl.className = 'tz-achart__cursor'
  cursorEl.setAttribute('data-testid', 'analysis-cursor')
  plot.over.append(cursorEl)
  plot.over.addEventListener('click', onPick)
  placeCursor()
}

function resize() {
  cancelAnimationFrame(raf)
  raf = requestAnimationFrame(() => {
    const el = host.value
    if (plot && el) plot.setSize({ width: Math.max(1, el.clientWidth), height: Math.max(1, el.clientHeight) })
  })
}

watch(() => props.spec, build)
watch(() => props.cursorX, placeCursor)

onMounted(() => {
  build()
  if (typeof ResizeObserver !== 'undefined' && host.value) {
    ro = new ResizeObserver(resize)
    ro.observe(host.value)
  }
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  ro?.disconnect()
  destroy()
})
</script>

<template>
  <figure class="tz-achart" :data-testid="testid ?? 'analysis-chart'" :data-points="spec.x.length">
    <div ref="host" class="tz-achart__plot" role="img" :aria-label="label" />
    <figcaption class="tz-achart__legend" role="group" :aria-label="legendLabel">
      <button
        v-for="g in spec.groups"
        :key="g.key"
        type="button"
        class="tz-achart__key"
        :class="{ 'is-emphasis': g.emphasis }"
        :aria-pressed="g.visible"
        :data-car="g.key"
        data-testid="analysis-legend-item"
        @click="emit('toggle', g.key)"
      >
        <span class="tz-achart__swatch" :class="{ 'is-dash': g.dash }" :style="{ '--swatch': g.color }" aria-hidden="true" />
        {{ g.label }}
      </button>
    </figcaption>
  </figure>
</template>

<style scoped>
.tz-achart {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  gap: var(--tz-space-2);
  margin: 0;
}

/* La gráfica ocupa el alto que quede (al menos 200 px); uPlot va encima, fuera del flujo, y se ajusta al medirla. */
.tz-achart__plot {
  position: relative;
  flex: 1 1 0;
  min-height: 200px;
  overflow: hidden;
}

.tz-achart__plot :deep(.uplot) {
  position: absolute;
  inset: 0;
}

/* Línea del instante actual (la mueve `placeCursor`, sin redibujar la gráfica). */
.tz-achart__plot :deep(.tz-achart__cursor) {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 0;
  border-left: 2px solid var(--tz-accent);
  pointer-events: none;
}

.tz-achart__plot :deep(.u-over) {
  cursor: pointer;
}

/* Línea del puntero de uPlot (qué vuelta se elige con un clic), con los tokens en lugar de su color propio. */
.tz-achart__plot :deep(.u-cursor-x) {
  border-right: 1px dashed var(--tz-text-faint);
}

.tz-achart__legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--tz-space-1);
}

.tz-achart__key {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: var(--tz-space-1);
  padding: var(--tz-space-0-5) var(--tz-space-2);
  border: 1px solid var(--tz-border);
  border-radius: var(--tz-radius-pill);
  background: transparent;
  color: var(--tz-text-faint);
  font-family: var(--tz-font-mono);
  font-size: var(--tz-text-xs);
  letter-spacing: var(--tz-tracking-mono);
  cursor: pointer;
  transition:
    border-color var(--tz-dur-fast) var(--tz-ease-standard),
    color var(--tz-dur-fast) var(--tz-ease-standard);
}

/* Zona táctil: crece en vertical hasta --tz-hit-min sin mover el layout. */
.tz-achart__key::after {
  content: '';
  position: absolute;
  inset: min(0px, calc((100% - var(--tz-hit-min)) / 2)) 0;
}

.tz-achart__key[aria-pressed='true'] {
  border-color: var(--tz-border-strong);
  background: var(--tz-surface-2);
  color: var(--tz-text);
}

.tz-achart__key.is-emphasis[aria-pressed='true'] {
  border-color: var(--tz-accent);
}

/* Muestra de la serie: el color de equipo como trazo (nunca como color de texto), discontinuo para el segundo piloto. */
.tz-achart__swatch {
  width: 14px;
  height: 0;
  border-top: 2px solid var(--swatch, var(--tz-team-unknown));
}

.tz-achart__swatch.is-dash {
  border-top-style: dashed;
}

.tz-achart__key[aria-pressed='false'] .tz-achart__swatch {
  opacity: 0.4;
}

@media (hover: hover) {
  .tz-achart__key:hover {
    border-color: var(--tz-accent);
  }
}
</style>
