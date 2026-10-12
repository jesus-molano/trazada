<script setup lang="ts">
/**
 * Gráfica de la hoja de análisis (ítem 3, D33) con uPlot (Canvas 2D, MIT; ya es dependencia). Colores de los tokens
 * (ejes, rejilla, texto) y de los equipos (manifest). Cada piloto se identifica por su sigla: la leyenda (botones
 * para mostrar u ocultar su serie) y la sigla de su serie, en el margen derecho o junto a su final
 * (`analysis/endLabels.ts`); nunca solo por el color. El segundo piloto de cada equipo, en discontinuo; con un coche
 * destacado, el resto se atenúa.
 *
 * La descripción llega entera en `spec` (sin reactividad profunda: los arrays no se recorren con Vue) y la gráfica se
 * rehace cuando cambia (las pestañas solo la cambian al cruzar un instante que cambia los datos o al tocar la
 * leyenda). La línea del instante actual (`cursorX`) es un elemento del DOM: moverla no redibuja la gráfica. Un clic
 * en la gráfica elige el punto del eje x más cercano (`pick`).
 *
 * De quién es cada serie (D49): al pasar el ratón o el lápiz por una línea, por un punto o por una sigla
 * (`hitTest`, como mucho una vez por frame de pantalla), o con el ratón o el foco del teclado en su nombre de la
 * leyenda, la serie se resalta (encima, con el resto atenuado y su sigla a la altura exacta de su último dato) y una
 * ficha cuenta lo que dicen los datos de ella (hueco `card`; sin él, «{x}: {y}»). Con el dedo, un toque en una línea
 * (o mantener pulsado su nombre de la leyenda, cuyo toque corto la muestra u oculta) fija la ficha con un botón para ir
 * a esa vuelta (el toque nunca salta en el tiempo); con el ratón, el clic sigue saltando. Esc oculta la ficha sin cerrar
 * la hoja (registro de Esc, `ESC_PRIORITY.analysisCard`: por debajo de las pistas y la paleta). El resaltado cambia las
 * opacidades de uPlot y redibuja sin rehacer los caminos: nunca el foco de series de uPlot, que al soltar pone todas a
 * 1 (y borraría el atenuado del coche elegido). La ficha se coloca escribiendo su estilo, sin reactividad, donde menos
 * tapa de su serie (`chooseCardSpot`: nunca el dato señalado, el final ni su sigla); si es más alta que el área de
 * datos, pasa a su forma corta (`compact`, un solo mensaje). Su estado solo cambia cuando cambian la serie, la vuelta o
 * el modo.
 *
 * Leyenda: en el orden de `groups` o, con `spec.legend` (race trace), por grupos con su rótulo. Mientras el puntero
 * está encima, su orden no cambia (se aplica el último al salir, como el timeline del dock, D44).
 *
 * Elegir a un piloto desde la gráfica (`selectable`, D49): el coche elegido es el grupo destacado (`emphasis`). Un clic
 * del ratón en una serie elige a su piloto (`select`); en la del elegido, salta a esa vuelta (`lineClick`: nunca quita
 * la selección); fuera de las series, a la vuelta más cercana, como siempre. El puntero es una mano sobre una serie y
 * una cruz fuera. La ficha lo dice: «Clic: elegir ALO» o, en el elegido, «Elegido» y «Clic: ir al inicio de la V12»;
 * fijada con el dedo, la fila del piloto lleva «Elegir» y tocarla entera lo elige. En la leyenda, cada nombre sigue
 * mostrando u ocultando su serie (con el dedo, mantenerlo pulsado fija su ficha) y el círculo de su izquierda (fuera del
 * orden de tabulación) elige a su piloto; con el teclado, Intro en el nombre lo elige y espacio lo muestra u oculta (la
 * ficha del foco lo dice).
 *
 * Sin Canvas 2D (entorno de tests), no pinta la gráfica; la leyenda y la ficha (desde la leyenda) sí.
 */
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import {
  type ChartGroup,
  type ChartLegend,
  type ChartNoLaps,
  type ChartPreview,
  type ChartSpec,
  chooseCardSpot,
  DIM_ALPHA,
  HIT_PX,
  type HitFrame,
  hitTest,
  type LabelRect,
  lineClick,
  nearestIndex,
  type Rect,
  seriesEnd,
  seriesSamples,
} from '~/analysis/chart'
import { drawEndLabels, drawPreviewLine, LABEL_PADDING, PLOT_PAD_TOP, X_AXIS_SIZE } from '~/analysis/endLabels'
import { token } from '~/design/tokens'
import { ESC_PRIORITY, registerEscape } from '~/replay/keys'
import { canDraw2d } from '~/utils/canvas2d'

const props = defineProps<{
  spec: ChartSpec
  /** Valor del eje x del instante actual (línea vertical); null, sin línea. */
  cursorX: number | null
  /** Nombre accesible de la gráfica (ya traducido). */
  label: string
  /** Nombre del grupo de la leyenda (ya traducido). */
  legendLabel: string
  testid?: string
  /** Textos del pie de la ficha para la vuelta del índice: con el ratón («Clic: …») y el botón de la ficha fijada. */
  pickLabel?: (index: number) => { click: string; button: string }
  /** Se puede elegir a un piloto desde la gráfica (clic en su serie, su ficha o su círculo de la leyenda): `select`. */
  selectable?: boolean
}>()

const emit = defineEmits<{ pick: [index: number]; toggle: [key: string]; select: [key: string]; setAll: [on: boolean] }>()
/** `compact`: la ficha no cabe en el alto del área de datos; el hueco enseña su forma corta (un solo mensaje). */
defineSlots<{ card?(props: { hit: ChartPreview; compact: boolean }): unknown }>()

const { t } = useI18n()
/** «hasta V30» de las series que acaban antes (ver `ChartGroup.stopped`), por grupo. */
const until = computed(() => {
  const spec = props.spec
  const out = new Map<string, string>()
  for (const g of spec.groups) {
    if (!g.stopped) continue
    const end = seriesEnd(spec, g.key)
    if (end) out.set(g.key, t('analysis.until', { x: spec.formatX(spec.x[end.index]!) }))
  }
  return out
})

const host = ref<HTMLElement | null>(null)
const figure = ref<HTMLElement | null>(null)
const cardEl = ref<HTMLElement | null>(null)
let plot: uPlot | null = null
let cursorEl: HTMLDivElement | null = null
let ro: ResizeObserver | null = null
let raf = 0

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

/**
 * Marcadores a medida para el segundo piloto de cada equipo, que en las gráficas de puntos no tiene línea discontinua que
 * lo distinga de su compañero: cuadrado (lleno o hueco) en lugar de círculo y «+» en lugar de «×». Del mismo tamaño que
 * los de uPlot (diámetro `size` con el trazo incluido).
 */
function shapePoints(shape: 'square' | 'plus'): uPlot.Series.Points.PathBuilder {
  return (u, seriesIdx, idx0, idx1) => {
    const s = u.series[seriesIdx]!
    const xs = u.data[0]
    const ys = u.data[seriesIdx]!
    const size = s.points?.size ?? 6
    const width = s.points?.width ?? 1
    const h = ((shape === 'square' ? size - width : size) / 2) * uPlot.pxRatio
    const path = new Path2D()
    for (let i = idx0; i <= idx1; i++) {
      const y = ys[i]
      if (y === null || y === undefined) continue
      const cx = u.valToPos(xs[i]!, 'x', true)
      const cy = u.valToPos(y, s.scale ?? 'y', true)
      if (shape === 'square') path.rect(cx - h, cy - h, 2 * h, 2 * h)
      else {
        path.moveTo(cx - h, cy)
        path.lineTo(cx + h, cy)
        path.moveTo(cx, cy - h)
        path.lineTo(cx, cy + h)
      }
    }
    const clip = new Path2D()
    clip.rect(u.bbox.left - 2 * h, u.bbox.top - 2 * h, u.bbox.width + 4 * h, u.bbox.height + 4 * h)
    return { stroke: path, fill: shape === 'square' ? path : null, clip }
  }
}
const squarePoints = shapePoints('square')
const plusPoints = shapePoints('plus')

/**
 * Puntos sueltos de una serie de línea (un dato con huecos a los dos lados, p. ej. la primera vuelta del race trace):
 * una línea no dibuja nada con un solo punto, y su sigla quedaría junto a un dato invisible.
 */
const isolatedPoints: uPlot.Series.Points.Filter = (u, seriesIdx) => {
  const ys = u.data[seriesIdx]!
  const out: number[] = []
  for (let i = 0; i < ys.length; i++) {
    if (ys[i] === null || ys[i] === undefined) continue
    if ((i === 0 || ys[i - 1] === null || ys[i - 1] === undefined) && (i === ys.length - 1 || ys[i + 1] === null || ys[i + 1] === undefined)) out.push(i)
  }
  return out.length ? out : null
}

const noPath: uPlot.Series.PathBuilder = () => null

/** Opacidad de las series de un grupo: con una resaltada, solo ella opaca; si no, el resto atenuado si hay un elegido. */
function alphaOf(g: ChartGroup, dimmed: boolean): number {
  if (previewKey !== null) return g.key === previewKey ? 1 : DIM_ALPHA
  return dimmed && !g.emphasis ? DIM_ALPHA : 1
}

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
        alpha: alphaOf(g, dimmed),
        spanGaps: false,
      }
      switch (s.mark) {
        case 'line':
          return {
            ...base,
            ...(g.dash ? { dash: DASH } : {}),
            points: { show: false, filter: isolatedPoints, size: 5, width: 1, fill: g.color, stroke: g.color },
          }
        case 'lineDot':
          return {
            ...base,
            ...(g.dash ? { dash: DASH } : {}),
            points: { show: true, size: 5, width: 1, fill: g.color, stroke: g.color, ...(g.dash ? { paths: squarePoints } : {}) },
          }
        case 'dot':
          return {
            ...base,
            paths: noPath,
            points: { show: true, size: 6, width: 1, fill: g.color, stroke: g.color, ...(g.dash ? { paths: squarePoints } : {}) },
          }
        case 'hollow':
          return {
            ...base,
            paths: noPath,
            points: { show: true, size: 7, width: 1.5, fill: surface, stroke: g.color, ...(g.dash ? { paths: squarePoints } : {}) },
          }
        case 'cross':
          return { ...base, paths: noPath, points: { show: true, size: 8, width: 1.5, stroke: g.color, paths: g.dash ? plusPoints : crossPoints } }
      }
    }),
  ]
}

/** La serie resaltada (encima) y las siglas; guarda dónde quedaron las siglas para poder tocarlas. */
function drawOverlay(u: uPlot, spec: ChartSpec) {
  const r = uPlot.pxRatio
  const frame = { r, bbox: u.bbox, xPos: (v: number) => u.valToPos(v, 'x', true), yPos: (v: number) => u.valToPos(v, 'y', true) }
  drawPreviewLine(u.ctx, frame, spec, previewKey)
  labelRects = drawEndLabels(u.ctx, frame, spec, { font: `${10 * r}px ${token('--tz-font-sans')}`, text: token('--tz-text') }, previewKey)
}

/** Gráfica solo de puntos (ritmo por hora): la muestra de la leyenda es un punto (cuadrado, el segundo piloto). */
const pointsOnly = computed(() => !props.spec.series.some((s) => s.mark === 'line' || s.mark === 'lineDot'))

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
  labelRects = []
}

/** Clic fuera de cualquier serie: la vuelta (o el instante) más cercana del área de datos, como siempre. */
function onPick(event: MouseEvent) {
  if (!plot) return
  const rect = plot.over.getBoundingClientRect()
  const left = event.clientX - rect.left
  if (left < 0 || left > rect.width) return
  const i = nearestIndex(props.spec.x, plot.posToVal(left, 'x'))
  if (i >= 0) emit('pick', i)
}

// --- Serie resaltada y su ficha (D49) ---

/** Serie resaltada y su ficha (null: ninguna). Solo cambia cuando cambian la serie, la vuelta o el modo. */
const preview = shallowRef<ChartPreview | null>(null)
/** Lo último que enseñó la ficha: su contenido se queda mientras se desvanece. */
const shown = shallowRef<ChartPreview | null>(null)
/** Forma corta de la ficha (ver `placeCard`): se decide al medirla y vale mientras sea la del mismo piloto. */
const compact = shallowRef(false)
/** Grupo resaltado en el lienzo (solo si su serie se ve); lo leen el dibujo y las opacidades. */
let previewKey: string | null = null
/** Siglas dibujadas (px CSS del lienzo), del último dibujo. */
let labelRects: LabelRect[] = []
/** Tipo del último puntero que pulsó (un toque nunca salta en el tiempo). */
let lastPointer = 'mouse'
let moveRaf = 0
let pendingMove: { x: number; y: number } | null = null
/** Puntero en px CSS del lienzo, para colocar la ficha cuando la serie no tiene valor en esa vuelta. */
let pointerAt = { x: 0, y: 0 }

const ids = useId()
const cardId = `${ids}-card`
const cardHeadId = `${ids}-card-head`

const shownGroup = computed(() => {
  const key = shown.value?.key
  return key === undefined ? undefined : props.spec.groups.find((g) => g.key === key)
})

/** Valor de un grupo en un índice (el primero de sus series con valor), o null. */
function valueAt(spec: ChartSpec, key: string, index: number): number | null {
  for (const s of spec.series) {
    if (s.group !== key) continue
    const v = s.values[index]
    if (v !== null && v !== undefined) return v
  }
  return null
}

/** Texto de la ficha sin hueco: «{x}: {y}». */
const defaultBody = computed(() => {
  const p = shown.value
  const spec = props.spec
  if (!p || p.index >= spec.x.length) return ''
  const v = valueAt(spec, p.key, p.index)
  return t('analysis.card.value', { x: spec.formatX(spec.x[p.index]!), y: v === null ? '—' : spec.formatY(v) })
})

const pickText = computed(() => {
  const p = shown.value
  return p && props.pickLabel && p.index < props.spec.x.length ? props.pickLabel(p.index) : null
})

/**
 * Pie de la ficha: con el ratón, qué hace un clic ahí («Clic: elegir ALO» o, en el elegido, «Clic: ir al inicio de la
 * V12»); desde la leyenda con el teclado, sus teclas (espacio o Intro muestran u ocultan: elegir va aparte).
 */
const foot = computed<{ testid: string; text: string } | null>(() => {
  const p = shown.value
  const g = shownGroup.value
  if (!p || !g) return null
  if (p.mode === 'hover') {
    if (lineClick(props.spec, g.key, !!props.selectable) === 'select') {
      return { testid: 'analysis-card-click', text: t('analysis.card.clickChoose', { driver: g.label }) }
    }
    return pickText.value ? { testid: 'analysis-card-click', text: pickText.value.click } : null
  }
  if (p.mode === 'legend' && p.keyboard) return { testid: 'analysis-card-keys', text: t('analysis.card.keys') }
  return null
})

function hitFrame(u: uPlot): HitFrame {
  const r = uPlot.pxRatio
  return {
    bbox: { left: u.bbox.left / r, top: u.bbox.top / r, width: u.bbox.width / r, height: u.bbox.height / r },
    xPos: (v) => u.valToPos(v, 'x', true) / r,
    yPos: (v) => u.valToPos(v, 'y', true) / r,
    xVal: (px) => u.posToVal(px - u.bbox.left / r, 'x'),
  }
}

/** Opacidades de uPlot según lo resaltado (sin rehacer los caminos) y un redibujado. */
function applyAlphas() {
  const u = plot
  if (!u) return
  const spec = props.spec
  const groups = new Map(spec.groups.map((g) => [g.key, g]))
  const dimmed = spec.groups.some((g) => g.visible && g.emphasis)
  spec.series.forEach((s, i) => {
    const series = u.series[i + 1]
    if (series) series.alpha = alphaOf(groups.get(s.group)!, dimmed)
  })
  u.redraw(false)
}

function setPreview(next: ChartPreview | null) {
  const cur = preview.value
  if (cur?.key === next?.key && cur?.index === next?.index && cur?.mode === next?.mode && !!cur?.keyboard === !!next?.keyboard) return
  if (next && next.key !== shown.value?.key) compact.value = false
  preview.value = next
  if (next) shown.value = next
  const key = next && props.spec.groups.some((g) => g.key === next.key && g.visible) ? next.key : null
  if (key !== previewKey) {
    previewKey = key
    applyAlphas()
  }
  listen(next)
  if (next) void nextTick(placeCard)
}

/** Puntero en px CSS del lienzo de uPlot. */
function local(clientX: number, clientY: number) {
  const rect = plot?.ctx.canvas.getBoundingClientRect()
  return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) }
}

function hitAt(clientX: number, clientY: number, maxPx: number) {
  if (!plot) return null
  const p = local(clientX, clientY)
  pointerAt = p
  return hitTest(props.spec, hitFrame(plot), p.x, p.y, maxPx, labelRects)
}

function hoverAt(clientX: number, clientY: number) {
  if (preview.value?.mode === 'pinned') return
  const hit = hitAt(clientX, clientY, HIT_PX.fine)
  if (hit) setPreview({ ...hit, mode: 'hover' })
  else if (preview.value?.mode === 'hover') setPreview(null)
}

function onPointerMove(event: PointerEvent) {
  if (event.pointerType === 'touch') return
  pendingMove = { x: event.clientX, y: event.clientY }
  if (moveRaf) return
  moveRaf = requestAnimationFrame(() => {
    moveRaf = 0
    const m = pendingMove
    pendingMove = null
    if (m) hoverAt(m.x, m.y)
  })
}

function onPointerLeave(event: PointerEvent) {
  if (event.pointerType === 'touch') return
  cancelAnimationFrame(moveRaf)
  moveRaf = 0
  pendingMove = null
  if (preview.value?.mode === 'hover') setPreview(null)
}

function onPointerDown(event: PointerEvent) {
  lastPointer = event.pointerType || 'mouse'
}

/**
 * Clic en la gráfica. Con el dedo, nunca salta: fija la ficha de lo que toca (o la cierra). Con el ratón o el lápiz,
 * salta a la vuelta de la ficha (la de lo que está debajo del puntero) o, fuera de las series, a la más cercana.
 */
function onClick(event: MouseEvent) {
  if (!plot) return
  if (lastPointer === 'touch') {
    const hit = hitAt(event.clientX, event.clientY, HIT_PX.coarse)
    setPreview(hit ? { ...hit, mode: 'pinned' } : null)
    return
  }
  cancelAnimationFrame(moveRaf)
  moveRaf = 0
  hoverAt(event.clientX, event.clientY)
  const p = preview.value
  if (p?.mode !== 'hover') onPick(event)
  else if (lineClick(props.spec, p.key, !!props.selectable) === 'select') emit('select', p.key)
  else emit('pick', p.index)
}

/** Elige al piloto de un grupo (si no lo es ya: otro clic en el elegido no lo quita). */
function choose(key: string) {
  if (!props.selectable || props.spec.groups.some((g) => g.key === key && g.emphasis)) return
  emit('select', key)
}

/** «Elegir» de la ficha fijada: el botón da paso a «Elegido»; el foco, al siguiente botón de la ficha. */
function chooseFromCard(event: MouseEvent) {
  const p = preview.value
  if (!p) return
  const focused = document.activeElement === event.currentTarget
  choose(p.key)
  if (focused)
    void nextTick(() =>
      cardEl.value?.querySelector<HTMLElement>('[data-testid="analysis-card-go"], [data-testid="analysis-card-close"]')?.focus(),
    )
}

/** Ficha desde la leyenda (ratón o foco del teclado): la vuelta del último dato de su serie. */
function showFromLegend(key: string, keyboard = false) {
  const end = seriesEnd(props.spec, key)
  setPreview({ key, index: end?.index ?? Math.max(0, props.spec.x.length - 1), mode: 'legend', keyboard })
}

function onKeyEnter(event: PointerEvent, key: string) {
  if (event.pointerType !== 'touch') showFromLegend(key)
}

/** Lo que hay que mantener pulsado un nombre de la leyenda (con el dedo) para fijar su ficha en vez de mostrar u ocultar. */
const LONG_PRESS_MS = 500
/** Lo que se puede mover el dedo sin que deje de ser una pulsación larga (px CSS). */
const LONG_PRESS_SLOP = 10
let pressTimer: ReturnType<typeof setTimeout> | null = null
let pressFrom: { x: number; y: number } | null = null
/** Nombre cuya pulsación larga ya fijó la ficha: su clic no la muestra ni la oculta. */
let pressed: string | null = null

function cancelPress() {
  if (pressTimer !== null) clearTimeout(pressTimer)
  pressTimer = null
  pressFrom = null
}

/** Con el dedo en un nombre de la leyenda: si se queda quieto `LONG_PRESS_MS`, fija la ficha de su serie. */
function onKeyDown(event: PointerEvent, key: string) {
  pressed = null
  cancelPress()
  if (event.pointerType !== 'touch') return
  pressFrom = { x: event.clientX, y: event.clientY }
  pressTimer = setTimeout(() => {
    pressTimer = null
    pressFrom = null
    pressed = key
    const end = seriesEnd(props.spec, key)
    setPreview({ key, index: end?.index ?? Math.max(0, props.spec.x.length - 1), mode: 'pinned' })
  }, LONG_PRESS_MS)
}

function onKeyMove(event: PointerEvent) {
  if (pressFrom && Math.hypot(event.clientX - pressFrom.x, event.clientY - pressFrom.y) > LONG_PRESS_SLOP) cancelPress()
}

/** Clic en un nombre: muestra u oculta su serie, salvo justo después de una pulsación larga (ya fijó la ficha). */
function onKeyClick(key: string) {
  if (pressed === key) {
    pressed = null
    return
  }
  emit('toggle', key)
}

/** El menú del navegador de una pulsación larga, no (la pulsación ya fija la ficha). */
function onKeyContext(event: Event) {
  if (pressed !== null || pressTimer !== null) event.preventDefault()
}

function onKeyLeave(event: PointerEvent, key: string) {
  if (event.pointerType !== 'touch') hideLegend(key)
}

/** Con el foco del teclado (no el de un clic o un toque), la ficha. */
function onKeyFocus(event: FocusEvent, key: string) {
  const el = event.target as HTMLElement
  let visible = true
  try {
    visible = el.matches(':focus-visible')
  } catch {
    // Sin `:focus-visible`: el foco vale.
  }
  if (visible) showFromLegend(key, true)
}

function hideLegend(key: string) {
  const p = preview.value
  if (p?.mode === 'legend' && p.key === key) setPreview(null)
}

function goFromCard() {
  const p = preview.value
  if (!p) return
  emit('pick', p.index)
  setPreview(null)
}

/**
 * Con la ficha del ratón a la vista, un movimiento fuera de la gráfica la quita. Respaldo de `pointerleave`, que puede no
 * llegar si la gráfica se rehace bajo el puntero (un clic que salta en el tiempo con «Sin spoilers» cambia los datos).
 */
function onMoveOutside(event: PointerEvent) {
  if (event.pointerType === 'touch' || preview.value?.mode !== 'hover') return
  if (!host.value?.contains(event.target as Node)) onPointerLeave(event)
}

/** Un toque fuera de la gráfica cierra la ficha fijada. */
function onOutside(event: PointerEvent) {
  if (preview.value?.mode !== 'pinned') return
  if (!figure.value?.contains(event.target as Node)) setPreview(null)
}

let outsideOn = false
let moveOn = false
/** Escuchas solo mientras hacen falta: un movimiento fuera con la ficha del ratón y un toque fuera con la fijada. */
function listen(p: ChartPreview | null) {
  const wantMove = p?.mode === 'hover'
  if (wantMove !== moveOn) {
    moveOn = wantMove
    if (wantMove) window.addEventListener('pointermove', onMoveOutside, true)
    else window.removeEventListener('pointermove', onMoveOutside, true)
  }
  const wantOutside = p?.mode === 'pinned'
  if (wantOutside !== outsideOn) {
    outsideOn = wantOutside
    if (wantOutside) document.addEventListener('pointerdown', onOutside, true)
    else document.removeEventListener('pointerdown', onOutside, true)
  }
}

const CARD_GAP = 12

/** El antepasado que recorta la figura (la hoja de análisis se desplaza): la ficha no pasa de lo que se ve de él. */
let clipEl: HTMLElement | null | undefined
function clipParent(fig: HTMLElement): HTMLElement | null {
  if (clipEl === null || clipEl?.isConnected) return clipEl
  let el = fig.parentElement
  while (el && el !== document.body && !/(auto|scroll|hidden)/.test(getComputedStyle(el).overflowY)) el = el.parentElement
  clipEl = el && el !== document.body ? el : null
  return clipEl
}
/** Lo que se agranda alrededor de lo que la ficha no debe tapar (px CSS): el dato señalado, el final y la sigla. */
const KEEP_PAD = 10

/** Un rectángulo de px CSS alrededor de un punto. */
const around = (x: number, y: number, pad: number): Rect => ({ x0: x - pad, y0: y - pad, x1: x + pad, y1: y + pad })

/**
 * Coloca la ficha (estilo escrito en el elemento, sin reactividad; coordenadas de la figura) donde menos tape de su
 * serie (`chooseCardSpot`). Candidatos, en orden: junto al dato (a la derecha y a la izquierda; debajo si el dato está
 * en la mitad de arriba del área de datos, si no encima), arriba o abajo del área de datos a esos dos lados y en las
 * esquinas (el margen derecho de las siglas y el principio del eje), y debajo del eje x (sobre la leyenda); desde la
 * leyenda, antes, encima o debajo de su nombre. Nunca tapa el dato señalado, el final de la serie, su raya ni su sigla
 * (ni el nombre de la leyenda que la muestra); los demás nombres de la leyenda pesan poco (`soft`), menos que un trozo
 * de su serie. Más alta que el área de datos, pasa antes a su forma corta (`compact`) y se vuelve a medir.
 */
function placeCard() {
  const card = cardEl.value
  const fig = figure.value
  const p = preview.value
  if (!card || !fig || !p) return
  const fr = fig.getBoundingClientRect()
  const W = fig.clientWidth
  // Hacia abajo puede salirse de la figura (sobre las notas), sin pasar de lo que se ve de la hoja.
  const clip = clipParent(fig)?.getBoundingClientRect()
  const H = Math.max(fig.clientHeight, Math.min(clip?.bottom ?? fr.bottom, window.innerHeight) - fr.top)
  const cw = card.offsetWidth
  const ch = card.offsetHeight
  const candidates: { left: number; top: number }[] = []
  const keep: Rect[] = []
  /** Los nombres de la leyenda: mejor no taparlos (pesan menos que la serie). */
  const soft: Rect[] = []
  let samples: { x: number; y: number }[] = []
  const rel = (r: DOMRect): Rect => ({ x0: r.left - fr.left, y0: r.top - fr.top, x1: r.right - fr.left, y1: r.bottom - fr.top })
  let legendKey: Rect | null = null
  for (const el of fig.querySelectorAll<HTMLElement>('[data-testid="analysis-legend-item"], [data-testid="analysis-legend-nodata"]')) {
    // La entrada entera (con su círculo para elegir, si lo hay).
    const r = rel((el.closest('.tz-achart__entry') ?? el).getBoundingClientRect())
    if (el.dataset.car === p.key && el.dataset.testid === 'analysis-legend-item') legendKey = r
    else soft.push(r)
  }
  // Su nombre en la leyenda, a la vista (con el recuadro de resaltado).
  if (legendKey) keep.push(legendKey)
  if (p.mode === 'legend') {
    if (!legendKey) return
    const key = legendKey
    for (const top of [key.y0 - ch - CARD_GAP / 2, key.y1 + CARD_GAP / 2]) candidates.push({ left: key.x0, top }, { left: key.x1 - cw, top })
  }
  if (plot) {
    const frame = hitFrame(plot)
    const { left: bl, top: bt, width: bw, height: bh } = frame.bbox
    if (!compact.value && ch > bh) {
      compact.value = true
      void nextTick(placeCard)
      return
    }
    const cr = plot.ctx.canvas.getBoundingClientRect()
    const ox = cr.left - fr.left
    const oy = cr.top - fr.top
    const spec = props.spec
    const clampY = (y: number) => Math.min(Math.max(y, bt), bt + bh)
    const end = seriesEnd(spec, p.key)
    if (end) {
      // El último dato y, pasado él, la raya de un detenido.
      const ex = ox + frame.xPos(spec.x[end.index]!)
      const ey = oy + clampY(frame.yPos(end.value))
      keep.push({ x0: ex - KEEP_PAD, y0: ey - KEEP_PAD, x1: ex + 2 * KEEP_PAD, y1: ey + KEEP_PAD })
    }
    for (const r of labelRects) if (r.key === p.key) keep.push({ x0: ox + r.x0 - 4, y0: oy + r.y0 - 4, x1: ox + r.x1 + 4, y1: oy + r.y1 + 4 })
    samples = seriesSamples(spec, frame, p.key).map((q) => ({ x: ox + q.x, y: oy + q.y }))
    const sides: number[] = []
    // Arriba y abajo del área de datos y, fuera de ella, debajo del eje x (sobre la leyenda).
    let tops: number[] = [oy + bt, oy + bt + bh - ch, oy + cr.height]
    if (p.mode !== 'legend') {
      const v = p.index < spec.x.length ? valueAt(spec, p.key, p.index) : null
      const ax = ox + (v !== null ? frame.xPos(spec.x[p.index]!) : pointerAt.x)
      const ay = oy + (v !== null ? clampY(frame.yPos(v)) : pointerAt.y)
      keep.push(around(ax, ay, KEEP_PAD))
      sides.push(ax + CARD_GAP, ax - CARD_GAP - cw)
      tops = [ay < oy + bt + bh / 2 ? ay + CARD_GAP : ay - CARD_GAP - ch, ...tops]
    }
    for (const top of tops) for (const left of [...sides, W - cw, ox + bl + bw - cw, ox + bl]) candidates.push({ left, top })
  }
  if (!candidates.length) return
  const at = chooseCardSpot({ w: cw, h: ch, W, H, candidates, samples, keep, soft })
  card.style.left = `${at.left}px`
  card.style.top = `${at.top}px`
}

/** Al cambiar la descripción: la ficha sigue si su serie sigue (visible, salvo desde la leyenda) y su vuelta existe. */
function refreshPreview(spec: ChartSpec) {
  const p = preview.value
  if (!p) return
  const g = spec.groups.find((x) => x.key === p.key)
  if (!g || (p.mode !== 'legend' && !g.visible) || p.index >= spec.x.length) {
    previewKey = null
    preview.value = null
    listen(null)
    return
  }
  if (p.mode === 'legend') {
    const index = seriesEnd(spec, p.key)?.index ?? Math.max(0, spec.x.length - 1)
    if (index !== p.index) {
      preview.value = { ...p, index }
      shown.value = preview.value
    }
  }
  previewKey = g.visible ? p.key : null
}

// --- Leyenda ---

/** Orden de la leyenda congelado mientras el puntero está encima (null: el de ahora). */
const frozenLegend = shallowRef<ChartLegend | null>(null)

interface LegendBlock {
  id: string
  label: string | null
  groups: ChartGroup[]
  noLaps: readonly ChartNoLaps[]
}

const legendBlocks = computed<LegendBlock[]>(() => {
  const spec = props.spec
  const legend = frozenLegend.value ?? spec.legend
  if (!legend) return [{ id: 'all', label: null, groups: [...spec.groups], noLaps: [] }]
  const byKey = new Map(spec.groups.map((g) => [g.key, g]))
  const keys = (list: readonly string[]) => list.map((k) => byKey.get(k)).filter((g): g is ChartGroup => !!g)
  const blocks: LegendBlock[] = [
    { id: 'running', label: t('analysis.legendGroups.running'), groups: keys(legend.running), noLaps: [] },
    { id: 'stopped', label: t('analysis.legendGroups.stopped'), groups: keys(legend.stopped), noLaps: [] },
    { id: 'noLaps', label: t('analysis.legendGroups.noLaps'), groups: [], noLaps: legend.noLaps },
  ]
  return blocks.filter((b) => b.groups.length > 0 || b.noLaps.length > 0)
})

function onLegendEnter() {
  frozenLegend.value = props.spec.legend ?? null
}

function onLegendLeave() {
  frozenLegend.value = null
}

let offEscape: (() => void) | null = null

function build() {
  destroy()
  const el = host.value
  if (!el || !canDraw2d()) return
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
      // Hueco a la derecha para las siglas (en la columna o junto al final de las series).
      padding: [PLOT_PAD_TOP, LABEL_PADDING, 0, 0],
      legend: { show: false },
      cursor: { x: true, y: false, points: { show: false }, drag: { x: false, y: false, setScale: false }, focus: { prox: -1 } },
      select: { show: false, left: 0, top: 0, width: 0, height: 0 },
      scales: {
        x: { time: false, ...(spec.xRange ? { range: spec.xRange } : {}) },
        y: { dir: spec.yDir, ...(spec.yRange ? { range: spec.yRange } : {}) },
      },
      axes: [
        { ...axis('x', spec.formatX), size: X_AXIS_SIZE, space: 56, ...(spec.xIncrs ? { incrs: [...spec.xIncrs] } : {}) },
        { ...axis('y', spec.formatY), size: 64 },
      ],
      series: seriesOptions(spec),
      hooks: {
        draw: [(u) => drawOverlay(u, spec), () => placeCursor()],
      },
    },
    [spec.x as number[], ...spec.series.map((s) => s.values as (number | null)[])],
    el,
  )
  cursorEl = document.createElement('div')
  cursorEl.className = 'tz-achart__cursor'
  cursorEl.setAttribute('data-testid', 'analysis-cursor')
  plot.over.append(cursorEl)
  placeCursor()
}

function resize() {
  cancelAnimationFrame(raf)
  raf = requestAnimationFrame(() => {
    const el = host.value
    if (plot && el) plot.setSize({ width: Math.max(1, el.clientWidth), height: Math.max(1, el.clientHeight) })
    if (preview.value) placeCard()
  })
}

watch(
  () => props.spec,
  (spec) => {
    refreshPreview(spec)
    build()
    if (preview.value) void nextTick(placeCard)
  },
)
watch(() => props.cursorX, placeCursor)

onMounted(() => {
  // Esc con una ficha a la vista la oculta y la hoja sigue abierta; con una pista o la paleta encima, antes ellas.
  offEscape = registerEscape(ESC_PRIORITY.analysisCard, { active: () => preview.value !== null, run: () => setPreview(null) })
  build()
  if (typeof ResizeObserver !== 'undefined' && host.value) {
    ro = new ResizeObserver(resize)
    ro.observe(host.value)
  }
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  cancelAnimationFrame(moveRaf)
  cancelPress()
  offEscape?.()
  listen(null)
  ro?.disconnect()
  destroy()
})
</script>

<template>
  <figure
    ref="figure"
    class="tz-achart"
    :data-testid="testid ?? 'analysis-chart'"
    :data-points="spec.x.length"
    :data-preview="preview?.key"
    :data-hit="preview?.mode === 'hover' ? 'true' : undefined"
  >
    <div
      ref="host"
      class="tz-achart__plot"
      role="img"
      :aria-label="label"
      @pointermove="onPointerMove"
      @pointerleave="onPointerLeave"
      @pointerdown="onPointerDown"
      @click="onClick"
    />
    <figcaption class="tz-achart__legend" role="group" :aria-label="legendLabel" @pointerenter="onLegendEnter" @pointerleave="onLegendLeave">
      <!--
        La leyenda solo muestra u oculta series (una casilla por piloto). Elegir un piloto es otra cosa y va aparte: un clic
        en su línea o «Elegir piloto», arriba en la hoja. Así nadie oculta queriendo elegir, ni al revés.
      -->
      <div class="tz-achart__legend-tools">
        <span class="tz-achart__legend-hint">{{ t('analysis.legendHint') }}</span>
        <button type="button" class="tz-achart__all" data-testid="analysis-legend-all" @click="emit('setAll', true)">
          {{ t('analysis.legendAll') }}
        </button>
        <button type="button" class="tz-achart__all" data-testid="analysis-legend-none" @click="emit('setAll', false)">
          {{ t('analysis.legendNone') }}
        </button>
      </div>
      <div
        v-for="block in legendBlocks"
        :key="block.id"
        class="tz-achart__block"
        :role="block.label ? 'group' : undefined"
        :aria-labelledby="block.label ? `${ids}-legend-${block.id}` : undefined"
        :data-testid="block.label ? 'analysis-legend-group' : undefined"
        :data-group="block.label ? block.id : undefined"
      >
        <span v-if="block.label" :id="`${ids}-legend-${block.id}`" class="tz-achart__group-label">{{ block.label }}</span>
        <span
          v-for="g in block.groups"
          :key="g.key"
          class="tz-achart__entry"
          :class="{ 'is-on': g.visible, 'is-emphasis': g.emphasis }"
          @pointerenter="onKeyEnter($event, g.key)"
          @pointerleave="onKeyLeave($event, g.key)"
        >
          <button
            type="button"
            class="tz-achart__key"
            :class="{ 'is-emphasis': g.emphasis }"
            :aria-pressed="g.visible"
            :aria-describedby="preview?.key === g.key ? cardId : undefined"
            :data-car="g.key"
            data-testid="analysis-legend-item"
            @click="onKeyClick(g.key)"
            @pointerdown="onKeyDown($event, g.key)"
            @pointermove="onKeyMove"
            @pointerup="cancelPress"
            @pointercancel="cancelPress"
            @contextmenu="onKeyContext"
            @focus="onKeyFocus($event, g.key)"
            @blur="hideLegend(g.key)"
          >
            <span
              class="tz-achart__swatch"
              :class="{ 'is-dash': g.dash, 'is-point': pointsOnly }"
              :style="{ '--swatch': g.color }"
              aria-hidden="true"
            />
            {{ g.label }}
            <span v-if="until.has(g.key)" class="tz-achart__until" data-testid="analysis-legend-until">{{ until.get(g.key) }}</span>
          </button>
        </span>
        <span v-for="n in block.noLaps" :key="n.key" class="tz-achart__key is-nodata" :data-car="n.key" data-testid="analysis-legend-nodata">
          <span class="tz-achart__swatch" :class="{ 'is-dash': n.dash }" aria-hidden="true" />
          {{ n.label }}
        </span>
      </div>
    </figcaption>
    <!-- Ficha de la serie resaltada (D49): detrás de la leyenda, dentro de la figura (el hueco de la gráfica recorta). -->
    <div
      :id="cardId"
      ref="cardEl"
      class="tz-achart__card"
      :class="{ 'is-visible': !!preview, 'is-pinned': preview?.mode === 'pinned', 'is-compact': compact }"
      :role="preview?.mode === 'pinned' ? 'group' : 'tooltip'"
      :aria-labelledby="preview?.mode === 'pinned' ? cardHeadId : undefined"
      data-testid="analysis-card"
      :data-shown="!!preview"
      :data-car="preview?.key"
      :data-index="preview?.index"
      :data-mode="preview?.mode"
      :data-compact="compact"
    >
      <template v-if="shown && shownGroup">
        <div class="tz-achart__card-top">
          <p :id="cardHeadId" class="tz-achart__card-head" data-testid="analysis-card-head">
            <span class="tz-achart__swatch" :class="{ 'is-dash': shownGroup.dash }" :style="{ '--swatch': shownGroup.color }" aria-hidden="true" />
            <span class="tz-achart__card-tla">{{ shownGroup.label }}</span>
            <span v-if="shownGroup.name" class="tz-achart__card-name">· {{ shownGroup.name }}</span>
          </p>
          <span v-if="shownGroup.emphasis" class="tz-achart__card-chosen" data-testid="analysis-card-chosen">{{ t('analysis.card.chosen') }}</span>
          <button
            v-else-if="selectable && preview?.mode === 'pinned'"
            type="button"
            class="tz-achart__card-choose"
            :aria-label="t('analysis.card.chooseLabel', { driver: shownGroup.label })"
            data-testid="analysis-card-choose"
            @click="chooseFromCard($event)"
          >
            {{ t('analysis.card.choose') }}
          </button>
          <button
            v-if="preview?.mode === 'pinned'"
            type="button"
            class="tz-iconbtn tz-achart__card-close"
            :aria-label="t('analysis.card.close', { driver: shownGroup.label })"
            data-testid="analysis-card-close"
            @click="setPreview(null)"
          >
            <TzIcon name="close" size="sm" />
          </button>
        </div>
        <div class="tz-achart__card-body">
          <slot name="card" :hit="shown" :compact="compact">
            <p>{{ defaultBody }}</p>
          </slot>
        </div>
        <p v-if="foot" class="tz-achart__card-foot" :data-testid="foot.testid">{{ foot.text }}</p>
        <button
          v-if="preview?.mode === 'pinned' && pickText"
          type="button"
          class="tz-button tz-button--quiet tz-achart__card-go"
          data-testid="analysis-card-go"
          @click="goFromCard()"
        >
          {{ pickText.button }}
        </button>
      </template>
    </div>
  </figure>
</template>

<style scoped>
.tz-achart {
  position: relative;
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
/* Con un halo del color del fondo: la pintura fuerte se distingue también sobre trazos claros (D47). */
.tz-achart__plot :deep(.tz-achart__cursor) {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 0;
  border-left: 2px solid var(--tz-accent-strong);
  box-shadow: 0 0 0 1px var(--tz-bg);
  pointer-events: none;
}

/* Un clic fuera de las series elige la vuelta más cercana (cruz); sobre una serie, a su piloto o esa vuelta (mano). */
.tz-achart__plot :deep(.u-over) {
  cursor: crosshair;
}

.tz-achart[data-hit] .tz-achart__plot :deep(.u-over) {
  cursor: pointer;
}

/* Línea del puntero de uPlot (qué vuelta se elige con un clic), con los tokens en lugar de su color propio. */
.tz-achart__plot :deep(.u-cursor-x) {
  border-right: 1px dashed var(--tz-text-faint);
}

.tz-achart__legend {
  display: flex;
  flex-direction: column;
  gap: var(--tz-space-1);
}

/* Un grupo de la leyenda: su rótulo al principio y sus nombres, en filas que se parten. */
.tz-achart__block {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--tz-space-1);
}

.tz-achart__group-label {
  margin-right: var(--tz-space-1);
  font-size: var(--tz-text-2xs);
  font-weight: var(--tz-weight-semibold);
  color: var(--tz-text-muted);
}

/* Ayuda y «Mostrar todos · Ocultar todos», encima de los nombres. */
.tz-achart__legend-tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--tz-space-1) var(--tz-space-2);
}

.tz-achart__legend-hint {
  margin-right: auto;
  font-size: var(--tz-text-2xs);
  color: var(--tz-text-muted);
}

.tz-achart__all {
  position: relative;
  padding: var(--tz-space-0-5) var(--tz-space-2);
  border: 0;
  border-radius: var(--tz-radius-md);
  background: transparent;
  color: var(--tz-text-muted);
  font-size: var(--tz-text-xs);
  cursor: pointer;
}

.tz-achart__all::after {
  content: '';
  position: absolute;
  inset: min(0px, calc((100% - var(--tz-hit-min)) / 2)) 0;
}

@media (hover: hover) {
  .tz-achart__all:hover {
    background: var(--tz-surface-2);
    color: var(--tz-text);
  }
}

/*
 * Entrada de un piloto: una píldora con su muestra y su nombre que solo muestra u oculta (elegir va aparte). Encendida:
 * sobre tono y con el texto claro; apagada: sin fondo, tenue y tachada. Del coche elegido, el nombre en seminegrita.
 */
.tz-achart__entry {
  display: inline-flex;
  align-items: stretch;
}

.tz-achart__key[aria-pressed='true'] {
  background: var(--tz-surface-3);
}

.tz-achart__key[aria-pressed='false'] {
  text-decoration: line-through;
}

.tz-achart__key.is-emphasis {
  font-weight: var(--tz-weight-bold);
}

.tz-achart__key {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: var(--tz-space-1);
  padding: var(--tz-space-0-5) var(--tz-space-2);
  border: 0;
  border-radius: var(--tz-radius-pill);
  background: transparent;
  color: var(--tz-text-faint);
  font-family: var(--tz-font-mono);
  font-size: var(--tz-text-xs);
  letter-spacing: var(--tz-tracking-mono);
  cursor: pointer;
  /* Mantener pulsado (con el dedo) fija la ficha: sin el menú ni la selección de texto del navegador. */
  -webkit-touch-callout: none;
  user-select: none;
  transition: color var(--tz-dur-fast) var(--tz-ease-standard);
}

/* Zona táctil: crece en vertical hasta --tz-hit-min sin mover el layout. */
.tz-achart__key::after {
  content: '';
  position: absolute;
  inset: min(0px, calc((100% - var(--tz-hit-min)) / 2)) 0;
}

.tz-achart__key[aria-pressed='true'] {
  color: var(--tz-text);
}

/* Piloto del manifest sin vueltas en los datos: no hay serie que mostrar u ocultar; contorno de «no disponible» (D44). */
.tz-achart__key.is-nodata {
  border: 1px dashed var(--tz-border-strong);
  color: var(--tz-text-faint);
  cursor: default;
}

.tz-achart__key.is-nodata::after {
  content: none;
}

.tz-achart__key.is-nodata .tz-achart__swatch {
  border-top-color: var(--tz-text-faint);
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

.tz-achart__until {
  color: var(--tz-text-muted);
  font-family: var(--tz-font-sans);
  letter-spacing: normal;
}

/* Gráfica solo de puntos: un punto, o un cuadrado para el segundo piloto (como sus marcadores). */
.tz-achart__swatch.is-point {
  width: 7px;
  height: 7px;
  border: 0;
  border-radius: 50%;
  background: var(--swatch, var(--tz-team-unknown));
}

.tz-achart__swatch.is-point.is-dash {
  width: 6px;
  height: 6px;
  border-radius: 0;
}

.tz-achart__key[aria-pressed='false'] .tz-achart__swatch {
  opacity: 0.4;
}

@media (hover: hover) {
  .tz-achart__key:hover:not(.is-nodata) {
    color: var(--tz-text);
  }
}

/*
 * Ficha de la serie resaltada (D49), como la de la vista previa del timeline. Solo cambia la opacidad (0 s con
 * movimiento reducido); `visibility` la saca del árbol de accesibilidad al acabar de desvanecerse.
 */
.tz-achart__card {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 2;
  display: grid;
  gap: var(--tz-space-1);
  width: max-content;
  max-width: min(320px, 100%);
  padding: var(--tz-space-2) var(--tz-space-3);
  border: 1px solid var(--tz-border-strong);
  border-radius: var(--tz-radius-md);
  background: var(--tz-surface-2);
  box-shadow: var(--tz-shadow-panel);
  color: var(--tz-text);
  font-size: var(--tz-text-xs);
  line-height: var(--tz-leading-normal);
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  transition:
    opacity var(--tz-dur-fast) var(--tz-ease-standard),
    visibility var(--tz-dur-fast) var(--tz-ease-standard);
}

/* Forma corta (más alta que el área de datos): más ancha, para que ocupe menos alto. */
.tz-achart__card.is-compact {
  max-width: min(420px, 100%);
}

.tz-achart__card.is-visible {
  opacity: 1;
  visibility: visible;
}

/* Fijada con un toque: se pulsa (× e «Ir al inicio de la Vn»). */
.tz-achart__card.is-pinned {
  pointer-events: auto;
}

.tz-achart__card :deep(p) {
  margin: 0;
}

.tz-achart__card-top {
  display: flex;
  align-items: center;
  gap: var(--tz-space-2);
}

.tz-achart__card-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--tz-space-1) var(--tz-space-2);
  min-width: 0;
}

.tz-achart__card-tla {
  font-family: var(--tz-font-mono);
  font-size: var(--tz-text-sm);
  font-weight: var(--tz-weight-semibold);
  letter-spacing: var(--tz-tracking-mono);
}

.tz-achart__card-name {
  color: var(--tz-text-muted);
}

.tz-achart__card-close {
  width: var(--tz-space-6);
  height: var(--tz-space-6);
  margin-left: auto;
}

/* «Elegido»: el borde de pintura del coche elegido (como el chip de la cabecera y su entrada de la leyenda). */
.tz-achart__card-chosen {
  flex: none;
  margin-left: auto;
  padding: 0 var(--tz-space-2);
  border: 1px solid var(--tz-accent);
  border-radius: var(--tz-radius-pill);
  color: var(--tz-text);
  font-size: var(--tz-text-2xs);
  font-weight: var(--tz-weight-semibold);
}

/*
 * «Elegir» (ficha fijada con el dedo): contorno. Su zona táctil es toda la fila del piloto (su ::after la cubre, con
 * --tz-hit-min de alto): tocar el nombre también lo elige. El × va después en el DOM y queda encima.
 */
.tz-achart__card-top:has(.tz-achart__card-choose) {
  position: relative;
}

.tz-achart__card-choose {
  position: static;
  flex: none;
  margin-left: auto;
  padding: var(--tz-space-0-5) var(--tz-space-2);
  border: 1px solid var(--tz-border-strong);
  border-radius: var(--tz-radius-pill);
  background: transparent;
  color: var(--tz-text);
  font-size: var(--tz-text-xs);
  font-weight: var(--tz-weight-semibold);
  cursor: pointer;
}

.tz-achart__card-choose::after {
  content: '';
  position: absolute;
  inset: min(0px, calc((100% - var(--tz-hit-min)) / 2)) 0;
}

/* Con «Elegido» o «Elegir» delante, el × va pegado a ellos. */
.tz-achart__card-chosen + .tz-achart__card-close,
.tz-achart__card-choose + .tz-achart__card-close {
  margin-left: 0;
}

.tz-achart__card-body {
  display: grid;
  gap: var(--tz-space-1);
}

.tz-achart__card-foot {
  color: var(--tz-text-muted);
}

.tz-achart__card-go {
  justify-content: center;
  width: 100%;
  min-height: var(--tz-hit-min);
  font-size: var(--tz-text-sm);
}
</style>
