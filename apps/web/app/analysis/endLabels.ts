/**
 * Siglas al final de las series de una gráfica de análisis (Canvas 2D, en el gancho `draw` de uPlot; ver
 * `TzAnalysisChart.vue`). Cada piloto se identifica por su sigla, nunca solo por el color:
 *
 * - Por vuelta (`ChartSpec.labelColumn`): en el margen derecho, fuera del área de datos, a la altura del último dato de
 *   cada serie. Si hay que separar una sigla de otras, un trazo corto y neutro en el margen la une con esa altura. Una
 *   serie que acaba antes (un doblado) no lleva nada dentro del área de datos: ni guía ni punto, que podrían leerse
 *   como datos que no hay.
 * - Por hora: junto al final de su serie (solo se separan las que se pisarían).
 * - Serie de un coche que dejó de pasar por meta (`ChartGroup.stopped`): una raya justo después de su último dato, sin
 *   sigla (la leyenda dice hasta qué vuelta llega), salvo destacada: entonces, junto a su final.
 *
 * Todo en píxeles del lienzo (`r` píxeles por píxel CSS). Nunca dibuja fuera del lienzo: si no caben, las siglas se
 * juntan lo justo (el componente da a la gráfica el alto en el que caben, `columnPlotHeight`).
 */
import { type ChartSpec, DIM_ALPHA, endPoints, type LabelSpot, placeLabels } from './chart'

/** Hueco arriba del área de datos (px CSS; `padding` de uPlot). */
export const PLOT_PAD_TOP = 8
/** Alto del eje x (px CSS). */
export const X_AXIS_SIZE = 50
/** Separación vertical entre siglas (px CSS). */
export const LABEL_GAP = 11
/** Margen de las siglas respecto al borde de arriba y de abajo del área de datos (px CSS). */
const LABEL_INSET = 5

/** En el margen (px CSS desde el borde derecho del área de datos): trazo, marca de color y sigla. */
const MARGIN = { from: 2, to: 9, swatch: 11, text: 19 } as const
/** Junto a su final (px CSS desde el final): marca de color y sigla. */
const INLINE = { swatch: 6, text: 13 } as const
/** Raya de fin de un coche detenido (px CSS): después del marcador del último dato (el más ancho, 4 px). */
const BAR = { offset: 6, half: 5, width: 2 } as const

/** Margen derecho con las siglas en el margen: hasta el final de una sigla de tres letras (px CSS). */
export const COLUMN_PADDING = 48
/** Margen derecho con las siglas junto a su final (px CSS). */
export const INLINE_PADDING = 44

/** Alto (px CSS) del área de la gráfica en el que caben `n` siglas en el margen sin pisarse. */
export function columnPlotHeight(n: number): number {
  return Math.max(0, n - 1) * LABEL_GAP + 2 * LABEL_INSET + PLOT_PAD_TOP + X_AXIS_SIZE
}

export interface LabelFrame {
  /** Píxeles del lienzo por píxel CSS. */
  r: number
  /** Área de datos, en píxeles del lienzo. */
  bbox: { left: number; top: number; width: number; height: number }
  xPos: (v: number) => number
  yPos: (v: number) => number
}

export interface LabelStyle {
  /** `font` del lienzo, ya escalado. */
  font: string
  /** Color del texto de las siglas. */
  text: string
  /** Color del trazo que une una sigla del margen con la altura de su dato. */
  connector: string
}

interface Label {
  text: string
  color: string
  alpha: number
  /** Altura del último dato (px). */
  y: number
  spot: LabelSpot
}

export function drawEndLabels(ctx: CanvasRenderingContext2D, frame: LabelFrame, spec: ChartSpec, style: LabelStyle): void {
  const { r, bbox } = frame
  const dimmed = spec.groups.some((g) => g.visible && g.emphasis)
  const right = bbox.left + bbox.width
  ctx.save()
  // Explícitos: uPlot deja el estado de su último eje (el y, alineado a la derecha).
  ctx.font = style.font
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  const labels: Label[] = []
  for (const e of endPoints(spec)) {
    const x = frame.xPos(spec.x[e.index]!)
    const y = frame.yPos(e.value)
    // Fuera del área visible (rango fijo del eje y): sin rótulo; la leyenda lo nombra.
    if (!(y >= bbox.top && y <= bbox.top + bbox.height)) continue
    const alpha = dimmed && !e.group.emphasis ? DIM_ALPHA : 1
    if (e.group.stopped) {
      ctx.globalAlpha = alpha
      ctx.fillStyle = e.group.color
      ctx.fillRect(x + (BAR.offset - BAR.width / 2) * r, y - BAR.half * r, BAR.width * r, 2 * BAR.half * r)
    }
    if (e.place === 'none') continue
    const w = (INLINE.text + 1) * r + ctx.measureText(e.group.label).width
    const sx = e.place === 'column' ? right : x + (e.group.stopped ? BAR.offset * r : 0)
    labels.push({ text: e.group.label, color: e.group.color, alpha, y, spot: { x: sx, y, w, place: e.place } })
  }
  const placed = placeLabels(
    labels.map((l) => l.spot),
    { gap: LABEL_GAP * r, lo: bbox.top + LABEL_INSET * r, hi: bbox.top + bbox.height - LABEL_INSET * r, moved: 1.5 * r },
  )
  labels.forEach((l, k) => {
    const p = placed[k]!
    const column = l.spot.place === 'column'
    const off = column ? MARGIN : INLINE
    ctx.globalAlpha = l.alpha
    if (column && p.moved) {
      ctx.strokeStyle = style.connector
      ctx.lineWidth = r
      ctx.beginPath()
      ctx.moveTo(right + MARGIN.from * r, l.y)
      ctx.lineTo(right + MARGIN.to * r, p.y)
      ctx.stroke()
    }
    ctx.fillStyle = l.color
    ctx.fillRect(p.x + off.swatch * r, p.y - r, 5 * r, 2 * r)
    ctx.fillStyle = style.text
    ctx.fillText(l.text, p.x + off.text * r, p.y)
  })
  ctx.restore()
}
