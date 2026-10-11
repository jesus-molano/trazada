/**
 * Siglas al final de las series de una gráfica de análisis (Canvas 2D, en el gancho `draw` de uPlot; ver
 * `TzAnalysisChart.vue`). Junto con la leyenda, identifican cada serie por su piloto, nunca solo por el color.
 *
 * Regla única (`placeLabels`): cada sigla va exactamente a la altura del último dato de su serie, o no va (la leyenda la
 * nombra). Una sigla movida acabaría a la altura de otra serie y se leería como suya. El coche destacado se coloca el
 * primero, así que siempre lleva la suya. Nada de lo que se dibuja aquí puede leerse como un dato: ni guías, ni trazos,
 * ni marcas con forma de punto.
 *
 * - Por vuelta (`ChartSpec.labelColumn`): en una columna a la derecha del último dato de todas las series, con una
 *   marca del trazo de su serie (continua o discontinua). Justo tras el último dato solo si la columna entera cabe antes
 *   del final del eje, donde va la línea del instante actual (con «Sin spoilers», el hueco de la vuelta en curso, que
 *   aún no tiene datos); si no, en el margen derecho, pasada esa línea (al final de la carrera, siempre ahí). La línea
 *   nunca cruza una sigla.
 * - Por hora: el texto junto al final de su serie, sin marca (su posición ya la une al punto).
 * - Último dato fuera de la escala del eje y: en el borde, con un triángulo hacia el dato (ningún marcador de datos es
 *   un triángulo).
 * - Serie de un coche que dejó de pasar por meta (`ChartGroup.stopped`): una raya justo después de su último dato, sin
 *   sigla (la leyenda dice hasta qué vuelta llega), salvo destacada: entonces, el texto después de la raya.
 *
 * - Serie resaltada (`preview`: ratón, foco o toque, D49): la suya se coloca la primera, exactamente a la altura de su
 *   dato (o tras su raya, si se detuvo), con opacidad completa y el resto atenuado (también el coche elegido, que
 *   conserva su grosor). `drawPreviewLine` la vuelve a trazar por encima, por sus mismos puntos.
 *
 * Todo en píxeles del lienzo (`r` por píxel CSS); los rótulos dibujados se devuelven en px CSS (`LabelRect`), para que
 * pasar el ratón por una sigla resalte su serie.
 */
import { type ChartSpec, DIM_ALPHA, endPoints, type LabelRect, type LabelSpot, placeLabels } from './chart'

/** Hueco arriba del área de datos (px CSS; `padding` de uPlot). */
export const PLOT_PAD_TOP = 8
/** Alto del eje x (px CSS). */
export const X_AXIS_SIZE = 50
/** Margen derecho de la gráfica: hasta el final de una sigla de tres letras en la columna o junto a su final (px CSS). */
export const LABEL_PADDING = 44
/** Separación vertical mínima entre siglas (px CSS). */
export const LABEL_GAP = 11
/** Margen de las siglas respecto al borde de arriba y de abajo del área de datos (px CSS). */
const LABEL_INSET = 5

/** En la columna (px CSS desde su x): marca del trazo y sigla. */
export const COLUMN = { gap: 4, mark: 0, text: 9 } as const
/**
 * Lo que ocupa la línea del instante actual pasado su x (px CSS; TzAnalysisChart: 2 px de borde y 1 px de halo): la
 * columna que va al margen derecho empieza más allá. Antes de su x, el halo ocupa 1 px; la columna que va antes del final
 * del eje deja 2 px.
 */
export const CURSOR_REACH = { after: 3, before: 2 } as const
/** Junto a su final (px CSS desde el último dato): triángulo (fuera de escala) y sigla, después del marcador del dato. */
const INLINE = { mark: 6, text: 7, offScaleText: 14 } as const
/** Raya de fin de un coche detenido (px CSS): después del marcador del último dato (el más ancho, 4 px). */
const BAR = { offset: 6, half: 5, width: 2 } as const

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
}

interface Label {
  key: string
  text: string
  color: string
  dash: boolean
  alpha: number
  column: boolean
  /** −1 / 1: el dato queda por encima / por debajo de la escala; 0 dentro. */
  off: -1 | 0 | 1
  spot: LabelSpot
}

/** Triángulo con la punta hacia el dato (arriba si `off` es −1), de 6 px de ancho desde `x`. */
function triangle(ctx: CanvasRenderingContext2D, x: number, y: number, off: -1 | 1, r: number) {
  ctx.beginPath()
  ctx.moveTo(x, y - off * 3 * r)
  ctx.lineTo(x + 6 * r, y - off * 3 * r)
  ctx.lineTo(x + 3 * r, y + off * 3 * r)
  ctx.closePath()
  ctx.fill()
}

/** Marca de una sigla en la columna: el trazo de su serie (continuo o discontinuo), o el triángulo fuera de escala. */
function columnMark(ctx: CanvasRenderingContext2D, l: Label, x: number, y: number, r: number) {
  ctx.fillStyle = l.color
  if (l.off !== 0) triangle(ctx, x, y, l.off, r)
  else if (l.dash) {
    ctx.fillRect(x, y - r, 2 * r, 2 * r)
    ctx.fillRect(x + 4 * r, y - r, 2 * r, 2 * r)
  } else ctx.fillRect(x, y - r, 6 * r, 2 * r)
}

/**
 * Dibuja las siglas y las rayas de fin. `preview`: la serie resaltada (o null). Devuelve los rótulos dibujados, en px
 * CSS del lienzo.
 */
export function drawEndLabels(
  ctx: CanvasRenderingContext2D,
  frame: LabelFrame,
  spec: ChartSpec,
  style: LabelStyle,
  preview: string | null = null,
): LabelRect[] {
  const { r, bbox } = frame
  const previewed = preview !== null && spec.groups.some((g) => g.visible && g.key === preview) ? preview : null
  const dimmed = spec.groups.some((g) => g.visible && g.emphasis)
  const alphaOf = (key: string, emphasis: boolean) =>
    previewed !== null ? (key === previewed ? 1 : DIM_ALPHA) : dimmed && !emphasis ? DIM_ALPHA : 1
  const lo = bbox.top + LABEL_INSET * r
  const hi = bbox.top + bbox.height - LABEL_INSET * r
  const ends = endPoints(spec, previewed)
  ctx.save()
  // Explícitos: uPlot deja el estado de su último eje (el y, alineado a la derecha).
  ctx.font = style.font
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  // La columna: justo después del último dato de todas las series visibles si cabe entera antes del final del eje (donde
  // va la línea del instante actual con «Sin spoilers»); si no, en el margen derecho, pasada esa línea.
  let dataRight = -Infinity
  let colW = 0
  for (const e of ends) {
    dataRight = Math.max(dataRight, frame.xPos(spec.x[e.index]!))
    if (e.place === 'column') colW = Math.max(colW, ctx.measureText(e.group.label).width + r)
  }
  colW += COLUMN.text * r
  const axisEnd = bbox.left + bbox.width
  const afterData = dataRight + COLUMN.gap * r
  const colX =
    afterData + colW <= axisEnd - CURSOR_REACH.before * r ? afterData : axisEnd + (COLUMN.gap + CURSOR_REACH.after) * r
  const labels: Label[] = []
  for (const e of ends) {
    const x = frame.xPos(spec.x[e.index]!)
    const y = frame.yPos(e.value)
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    const off = y < bbox.top ? -1 : y > bbox.top + bbox.height ? 1 : 0
    const alpha = alphaOf(e.group.key, e.group.emphasis)
    const stopped = !!e.group.stopped
    // La raya, solo si se ve su último dato (fuera de la escala no hay dónde ponerla).
    if (stopped && off === 0) {
      ctx.globalAlpha = alpha
      ctx.fillStyle = e.group.color
      ctx.fillRect(x + (BAR.offset - BAR.width / 2) * r, y - BAR.half * r, BAR.width * r, 2 * BAR.half * r)
    }
    if (e.place === 'none') continue
    const column = e.place === 'column'
    const textW = ctx.measureText(e.group.label).width + r
    const sx = column ? colX : x + (stopped ? BAR.offset * r : 0)
    const lead = column ? COLUMN.text : off !== 0 ? INLINE.offScaleText : INLINE.text
    labels.push({
      key: e.group.key,
      text: e.group.label,
      color: e.group.color,
      dash: e.group.dash,
      alpha,
      column,
      off,
      spot: {
        x: sx,
        y: Math.min(Math.max(y, lo), hi),
        w: lead * r + textW,
        rank: e.group.key === previewed ? 0 : e.group.emphasis ? 1 : 2,
      },
    })
  }
  const placed = placeLabels(
    labels.map((l) => l.spot),
    { gap: LABEL_GAP * r, lo, hi },
  )
  const rects: LabelRect[] = []
  labels.forEach((l, k) => {
    const y = placed[k]
    if (y === null || y === undefined) return
    ctx.globalAlpha = l.alpha
    rects.push({ key: l.key, x0: l.spot.x / r, x1: (l.spot.x + l.spot.w) / r, y0: y / r - LABEL_GAP / 2, y1: y / r + LABEL_GAP / 2 })
    if (l.column) {
      columnMark(ctx, l, l.spot.x + COLUMN.mark * r, y, r)
      ctx.fillStyle = style.text
      ctx.fillText(l.text, l.spot.x + COLUMN.text * r, y)
      return
    }
    if (l.off !== 0) {
      ctx.fillStyle = l.color
      triangle(ctx, l.spot.x + INLINE.mark * r, y, l.off, r)
    }
    ctx.fillStyle = style.text
    ctx.fillText(l.text, l.spot.x + (l.off !== 0 ? INLINE.offScaleText : INLINE.text) * r, y)
  })
  ctx.restore()
  return rects
}

/** Ancho del trazo de la serie resaltada (px CSS), como el del coche elegido. */
export const PREVIEW_WIDTH = 2.5
/** Radio del punto suelto de la serie resaltada (px CSS). */
const PREVIEW_DOT = 3
const PREVIEW_DASH = [6, 4]

/**
 * Vuelve a trazar la serie resaltada (D49) por encima de las demás, para que no quede enterrada: solo sus series de
 * línea, exactamente por sus puntos (sin unir huecos), con el grosor del coche elegido y discontinua si lo es la suya;
 * un punto suelto, como un punto (un cuadrado para el segundo piloto, como sus marcadores). Recortado al área de datos.
 * Nada más: ni guías ni marcas nuevas.
 */
export function drawPreviewLine(ctx: CanvasRenderingContext2D, frame: LabelFrame, spec: ChartSpec, preview: string | null): void {
  const group = preview === null ? undefined : spec.groups.find((g) => g.key === preview && g.visible)
  if (!group) return
  const { r, bbox } = frame
  const lists = spec.series.filter((s) => s.group === group.key && (s.mark === 'line' || s.mark === 'lineDot')).map((s) => s.values)
  if (!lists.length) return
  ctx.save()
  ctx.beginPath()
  ctx.rect(bbox.left, bbox.top, bbox.width, bbox.height)
  ctx.clip()
  ctx.globalAlpha = 1
  ctx.strokeStyle = group.color
  ctx.fillStyle = group.color
  ctx.lineWidth = PREVIEW_WIDTH * r
  ctx.lineJoin = 'round'
  ctx.setLineDash(group.dash ? PREVIEW_DASH.map((d) => d * r) : [])
  const has = (v: number | null | undefined): v is number => v !== null && v !== undefined
  for (const v of lists) {
    let i = 0
    while (i < v.length) {
      if (!has(v[i])) {
        i++
        continue
      }
      let j = i
      while (j + 1 < v.length && has(v[j + 1])) j++
      if (j === i) {
        const x = frame.xPos(spec.x[i]!)
        const y = frame.yPos(v[i]!)
        const h = PREVIEW_DOT * r
        ctx.beginPath()
        if (group.dash) ctx.rect(x - h, y - h, 2 * h, 2 * h)
        else ctx.arc(x, y, h, 0, 2 * Math.PI)
        ctx.fill()
      } else {
        ctx.beginPath()
        for (let k = i; k <= j; k++) {
          const x = frame.xPos(spec.x[k]!)
          const y = frame.yPos(v[k]!)
          if (k === i) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
      }
      i = j + 1
    }
  }
  ctx.restore()
}
