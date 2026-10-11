/**
 * Siglas al final de las series de una gráfica de análisis (Canvas 2D, en el gancho `draw` de uPlot; ver
 * `TzAnalysisChart.vue`). Junto con la leyenda, identifican cada serie por su piloto, nunca solo por el color:
 *
 * - Por vuelta (`ChartSpec.labelColumn`): en el margen derecho, fuera del área de datos, a la altura del último dato de
 *   cada serie o una separación más arriba o más abajo (con un trazo corto en el margen hasta esa altura). Si no cabe
 *   ni así, esa serie no lleva sigla: la leyenda la nombra. Ninguna sigla queda lejos de su dato, y dentro del área de
 *   datos no se dibuja nada que pueda leerse como dato (ni guías ni puntos).
 * - Por hora: junto al final de su serie, con la misma regla (solo chocan las que se solapan en horizontal).
 * - Último dato fuera de la escala del eje y: la sigla va en el borde, con un triángulo hacia donde queda el dato.
 * - Serie de un coche que dejó de pasar por meta (`ChartGroup.stopped`): una raya justo después de su último dato, sin
 *   sigla (la leyenda dice hasta qué vuelta llega), salvo destacada: entonces, junto a su final.
 * - El coche destacado siempre lleva su sigla (se coloca el primero).
 *
 * La marca de color de cada sigla repite el trazo de su serie: línea continua o discontinua (segundo piloto de su
 * equipo) y, en las gráficas solo de puntos, círculo o cuadrado. Todo en píxeles del lienzo (`r` por píxel CSS).
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

/** En el margen (px CSS desde el borde derecho del área de datos): trazo (codo), marca de color y sigla. */
const MARGIN = { from: 1, elbow: 4, to: 9, mark: 11, text: 19 } as const
/** Junto a su final (px CSS desde el final): marca de color y sigla. */
const INLINE = { mark: 6, text: 13 } as const
/** Raya de fin de un coche detenido (px CSS): después del marcador del último dato (el más ancho, 4 px). */
const BAR = { offset: 6, half: 5, width: 2 } as const

/** Margen derecho con las siglas en el margen: hasta el final de una sigla de tres letras (px CSS). */
export const COLUMN_PADDING = 48
/** Margen derecho con las siglas junto a su final (px CSS). */
export const INLINE_PADDING = 44

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
  /** Color del trazo que une una sigla del margen con la altura de su dato (de la interfaz, nunca de un equipo). */
  connector: string
}

interface Label {
  text: string
  color: string
  dash: boolean
  alpha: number
  column: boolean
  /** Altura de su dato, ya dentro de la escala (px). */
  home: number
  /** −1 / 1: el dato queda por encima / por debajo de la escala; 0 dentro. */
  off: -1 | 0 | 1
  spot: LabelSpot
}

/** Marca de color de una sigla: el trazo de su serie, o un triángulo hacia el dato si se sale de la escala. */
function mark(ctx: CanvasRenderingContext2D, l: Label, x: number, y: number, r: number, points: boolean) {
  ctx.fillStyle = l.color
  if (l.off !== 0) {
    // Base del lado de la sigla y punta hacia el dato (arriba si `off` es −1).
    ctx.beginPath()
    ctx.moveTo(x, y - l.off * 3 * r)
    ctx.lineTo(x + 6 * r, y - l.off * 3 * r)
    ctx.lineTo(x + 3 * r, y + l.off * 3 * r)
    ctx.closePath()
    ctx.fill()
  } else if (points && l.dash) {
    ctx.fillRect(x + r, y - 2 * r, 4 * r, 4 * r)
  } else if (points) {
    ctx.beginPath()
    ctx.arc(x + 3 * r, y, 2.5 * r, 0, 2 * Math.PI)
    ctx.fill()
  } else if (l.dash) {
    ctx.fillRect(x, y - r, 2 * r, 2 * r)
    ctx.fillRect(x + 4 * r, y - r, 2 * r, 2 * r)
  } else {
    ctx.fillRect(x, y - r, 6 * r, 2 * r)
  }
}

export function drawEndLabels(ctx: CanvasRenderingContext2D, frame: LabelFrame, spec: ChartSpec, style: LabelStyle): void {
  const { r, bbox } = frame
  const dimmed = spec.groups.some((g) => g.visible && g.emphasis)
  const points = !spec.series.some((s) => s.mark === 'line' || s.mark === 'lineDot')
  const right = bbox.left + bbox.width
  const lo = bbox.top + LABEL_INSET * r
  const hi = bbox.top + bbox.height - LABEL_INSET * r
  ctx.save()
  // Explícitos: uPlot deja el estado de su último eje (el y, alineado a la derecha).
  ctx.font = style.font
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  const labels: Label[] = []
  for (const e of endPoints(spec)) {
    const x = frame.xPos(spec.x[e.index]!)
    const y = frame.yPos(e.value)
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    const off = y < bbox.top ? -1 : y > bbox.top + bbox.height ? 1 : 0
    const alpha = dimmed && !e.group.emphasis ? DIM_ALPHA : 1
    // La raya, solo si se ve su último dato (fuera de la escala no hay dónde ponerla).
    if (e.group.stopped && off === 0) {
      ctx.globalAlpha = alpha
      ctx.fillStyle = e.group.color
      ctx.fillRect(x + (BAR.offset - BAR.width / 2) * r, y - BAR.half * r, BAR.width * r, 2 * BAR.half * r)
    }
    if (e.place === 'none') continue
    const column = e.place === 'column'
    const home = Math.min(Math.max(y, lo), hi)
    const text = ctx.measureText(e.group.label).width + r
    const sx = column ? right : x + (e.group.stopped ? BAR.offset * r : 0)
    labels.push({
      text: e.group.label,
      color: e.group.color,
      dash: e.group.dash,
      alpha,
      column,
      home,
      off,
      spot: { x: sx, y: home, w: (column ? MARGIN.text : INLINE.text) * r + text, first: e.group.emphasis },
    })
  }
  const placed = placeLabels(
    labels.map((l) => l.spot),
    { gap: LABEL_GAP * r, lo, hi },
  )
  labels.forEach((l, k) => {
    const p = placed[k]
    if (!p) return
    const off = l.column ? MARGIN : INLINE
    ctx.globalAlpha = l.alpha
    if (l.column && p.moved) {
      // Codo corto en el margen: horizontal a la altura del dato y luego hasta la sigla.
      ctx.strokeStyle = style.connector
      ctx.lineWidth = r
      ctx.beginPath()
      ctx.moveTo(right + MARGIN.from * r, l.home)
      ctx.lineTo(right + MARGIN.elbow * r, l.home)
      ctx.lineTo(right + MARGIN.to * r, p.y)
      ctx.stroke()
    }
    mark(ctx, l, l.spot.x + off.mark * r, p.y, r, points)
    ctx.fillStyle = style.text
    ctx.fillText(l.text, l.spot.x + off.text * r, p.y)
  })
  ctx.restore()
}
