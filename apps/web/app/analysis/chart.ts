/**
 * Piezas comunes de las gráficas de la hoja de análisis (ítem 3, D33): la descripción de una gráfica (`ChartSpec`,
 * lo que pinta `TzAnalysisChart`) y utilidades sin estado. TS puro (sin Vue ni uPlot), con tests al lado.
 *
 * Cada serie se identifica por la sigla del piloto (leyenda y rótulo al final de la línea), nunca solo por el color;
 * el color de equipo sale del manifest y el segundo piloto de cada equipo va en discontinuo.
 */
import type { DriverInfo } from '@trazada/schema'

/**
 * Cómo se dibuja una serie: línea sola, línea con puntos, solo puntos, puntos huecos (vuelta excluida) o aspas
 * (vuelta anulada).
 */
export type ChartMark = 'line' | 'lineDot' | 'dot' | 'hollow' | 'cross'

/** Un piloto en la gráfica (una o varias series). */
export interface ChartGroup {
  /** Número del coche. */
  key: string
  /** Sigla (o el número si no hay piloto en el manifest). */
  label: string
  /** Nombre completo del manifest («Alexander Albon»), para la cabecera de la ficha (D49); sin piloto, nada. */
  name?: string
  /** Color de equipo (#rrggbb) o el de «equipo desconocido». */
  color: string
  /** Segundo piloto de su equipo: discontinuo. */
  dash: boolean
  visible: boolean
  /** Destacado (coche elegido); con alguno destacado, el resto se atenúa. */
  emphasis: boolean
  /**
   * El coche dejó de pasar por meta antes del corte (`stoppedCars`): el primero dio tres vueltas más sin que él cruzara
   * o, con todos los pasos a la vista, su último paso es anterior al último del primero (D49). Su serie acaba antes
   * que las demás y su sigla no se queda a media gráfica (salvo destacado o resaltado): una marca de fin, y en la
   * leyenda «hasta V30». La fuente no dice por qué.
   */
  stopped?: boolean
}

export interface ChartSeries {
  group: string
  mark: ChartMark
  /** Alineados con `ChartSpec.x`; null, sin punto. */
  values: readonly (number | null)[]
}

export interface ChartSpec {
  x: readonly number[]
  series: readonly ChartSeries[]
  groups: readonly ChartGroup[]
  /** Rango fijo del eje x (si no, el de los datos). */
  xRange: [number, number] | null
  /** Rango fijo del eje y (si no, el de los datos). */
  yRange: [number, number] | null
  /** −1: el eje y crece hacia abajo (el primero, arriba). */
  yDir: 1 | -1
  /** Pasos posibles entre marcas del eje x (vueltas enteras, minutos redondos…); null, los de uPlot. */
  xIncrs: readonly number[] | null
  formatX: (v: number) => string
  formatY: (v: number) => string
  /**
   * Siglas en columna, justo a la derecha del último dato (ejes por vuelta: las series avanzan juntas), cada una a la
   * altura del último dato de su serie (`placeLabels`). Sin columna (eje por hora), junto al final de su serie.
   */
  labelColumn?: boolean
  /**
   * Leyenda por grupos (race trace, D49): los que siguen, de arriba abajo (`legendOrder`); los que dejaron de pasar
   * por meta; y los pilotos del manifest sin ninguna vuelta en los datos (sin serie: solo su nombre). Sin ella, la
   * leyenda sigue el orden de `groups`.
   */
  legend?: ChartLegend
}

/** Un piloto del manifest sin vueltas en los datos: en la leyenda, sin botón. */
export interface ChartNoLaps {
  key: string
  label: string
  color: string
  dash: boolean
}

export interface ChartLegend {
  /** Claves de `groups`, en orden. */
  running: readonly string[]
  /** Claves de `groups`, en orden. */
  stopped: readonly string[]
  noLaps: readonly ChartNoLaps[]
}

/** Marcas del eje x por vuelta: vueltas enteras. */
export const LAP_INCRS: readonly number[] = [1, 2, 5, 10, 20, 50, 100]
/** Marcas del eje x por instante (ms del reloj del dock, no de la hora interna de la sesión): minutos redondos. */
export const TIME_INCRS: readonly number[] = [60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000, 3_600_000]

/** Opacidad de las series no destacadas cuando hay alguna destacada. */
export const DIM_ALPHA = 0.3

export interface DriverStyle {
  label: string
  color: string | null
  dash: boolean
}

/**
 * Estilo de cada coche del manifest: sigla, color de equipo y discontinuo para el segundo (y siguientes) de cada
 * equipo, en el orden del manifest.
 */
export function driverStyles(drivers: readonly DriverInfo[]): Map<string, DriverStyle> {
  const perTeam = new Map<string, number>()
  const out = new Map<string, DriverStyle>()
  for (const d of drivers) {
    const n = perTeam.get(d.team) ?? 0
    perTeam.set(d.team, n + 1)
    out.set(d.number, { label: d.tla || d.number, color: d.color || null, dash: n > 0 })
  }
  return out
}

/** Índice del valor de `x` (ascendente) más cercano a v; −1 si `x` está vacío. */
export function nearestIndex(x: readonly number[], v: number): number {
  if (x.length === 0 || Number.isNaN(v)) return -1
  let lo = 0
  let hi = x.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (x[mid]! < v) lo = mid + 1
    else hi = mid
  }
  if (lo > 0 && Math.abs(x[lo - 1]! - v) <= Math.abs(x[lo]! - v)) return lo - 1
  return lo
}

/**
 * Posiciones de rótulos sin pisarse: cada y se mueve lo mínimo para quedar a `gap` de sus vecinos, siempre dentro de
 * [lo, hi] (si no caben a `gap`, se juntan lo justo para caber). Devuelve las posiciones en el orden de entrada.
 */
export function spreadLabels(ys: readonly number[], gap: number, lo: number, hi: number): number[] {
  const order = ys.map((y, i) => [y, i] as const).sort((a, b) => a[0] - b[0])
  const step = order.length > 1 ? Math.min(gap, (hi - lo) / (order.length - 1)) : gap
  const pos = order.map(([y]) => Math.min(Math.max(y, lo), hi))
  for (let i = 1; i < pos.length; i++) pos[i] = Math.max(pos[i]!, pos[i - 1]! + step)
  if (pos.length && pos[pos.length - 1]! > hi) {
    pos[pos.length - 1] = hi
    for (let i = pos.length - 2; i >= 0; i--) pos[i] = Math.min(pos[i]!, pos[i + 1]! - step)
  }
  const out = new Array<number>(ys.length)
  order.forEach(([, i], k) => (out[i] = Math.min(Math.max(pos[k]!, lo), hi)))
  return out
}

/** Final de la serie de un grupo: su último punto con valor (en cualquiera de sus listas). */
export interface SeriesEnd {
  index: number
  value: number
}

export function seriesEnd(spec: ChartSpec, group: string): SeriesEnd | null {
  const lists = spec.series.filter((s) => s.group === group).map((s) => s.values)
  const index = lastValueIndex(lists)
  if (index < 0) return null
  const value = lists.map((l) => l[index]).find((v) => v !== null && v !== undefined)
  return value === null || value === undefined ? null : { index, value }
}

/** Dónde va la sigla de un final: en el margen derecho, junto al final, o ninguna (solo la marca de fin). */
export type LabelPlace = 'column' | 'inline' | 'none'

export interface EndPoint extends SeriesEnd {
  group: ChartGroup
  place: LabelPlace
}

/**
 * Final de cada serie visible, y dónde va su sigla: una serie que acaba antes (`ChartGroup.stopped`) solo lleva la
 * marca de fin, salvo destacada o resaltada (`preview`, D49): entonces, junto a su final (con el resto atenuado no hay
 * confusión); las demás, en el margen (`ChartSpec.labelColumn`) o junto a su final.
 */
export function endPoints(spec: ChartSpec, preview: string | null = null): EndPoint[] {
  const out: EndPoint[] = []
  for (const group of spec.groups) {
    if (!group.visible) continue
    const end = seriesEnd(spec, group.key)
    if (!end) continue
    const shown = group.emphasis || group.key === preview
    const place: LabelPlace = group.stopped ? (shown ? 'inline' : 'none') : spec.labelColumn ? 'column' : 'inline'
    out.push({ ...end, group, place })
  }
  return out
}

export interface LabelSpot {
  /** Donde empieza el rótulo (px). */
  x: number
  /** Altura de su dato (px): la del último dato de la serie, o el borde si se sale de la escala. */
  y: number
  /** Ancho del rótulo (px). */
  w: number
  /**
   * Orden de colocación: 0 la serie resaltada (ratón, foco o toque, D49), 1 el coche destacado (elegido), 2 el resto.
   * Las de rango menor se colocan antes, así que siempre llevan su sigla.
   */
  rank: 0 | 1 | 2
}

/**
 * Altura de cada sigla (en el orden de entrada), o null si no lleva: cada una va exactamente a la altura de su dato (dentro
 * de [lo, hi]) o no va, porque una sigla movida acaba a la altura de otra serie y se lee como suya. Se colocan de una en
 * una por rango (la resaltada, la del coche destacado y luego las demás) y, a igual rango, de arriba abajo; una que
 * pisaría a otra ya colocada (a menos de `gap` en vertical y solapadas en horizontal) se queda sin sigla: la leyenda la
 * nombra.
 */
export function placeLabels(spots: readonly LabelSpot[], o: { gap: number; lo: number; hi: number }): (number | null)[] {
  const order = spots
    .map((_, i) => i)
    .sort((a, b) => spots[a]!.rank - spots[b]!.rank || spots[a]!.y - spots[b]!.y)
  const taken: { x0: number; x1: number; y: number }[] = []
  const out = new Array<number | null>(spots.length).fill(null)
  for (const i of order) {
    const s = spots[i]!
    const y = Math.min(Math.max(s.y, o.lo), o.hi)
    if (taken.some((t) => t.x0 < s.x + s.w && s.x < t.x1 && Math.abs(t.y - y) < o.gap - 1e-6)) continue
    taken.push({ x0: s.x, x1: s.x + s.w, y })
    out[i] = y
  }
  return out
}

/** Rótulo dibujado (px CSS del lienzo): para que pasar el ratón por una sigla resalte su serie. */
export interface LabelRect {
  key: string
  x0: number
  x1: number
  y0: number
  y1: number
}

/** Distancia máxima (px CSS) para que el puntero «toque» una serie: ratón o lápiz, y dedo (la mitad de --tz-hit-min). */
export const HIT_PX = { fine: 12, coarse: 22 } as const
/** Lo que se alarga el final de un coche detenido hacia la derecha para tocarlo (cubre su raya, px CSS). */
export const STOPPED_HIT_EXTRA = 8

/** Geometría de la gráfica en px CSS del lienzo (origen: su esquina superior izquierda). */
export interface HitFrame {
  /** Área de datos. */
  bbox: { left: number; top: number; width: number; height: number }
  xPos(v: number): number
  yPos(v: number): number
  /** Inversa de `xPos`. */
  xVal(px: number): number
}

/** Lo que toca el puntero: el grupo y el índice del eje x. */
export interface ChartHit {
  key: string
  index: number
}

/**
 * Serie resaltada con su ficha (D49): al pasar el ratón o el lápiz (`hover`), con el foco o el ratón en su nombre de la
 * leyenda (`legend`) o fijada con un toque (`pinned`).
 */
export interface ChartPreview extends ChartHit {
  mode: 'hover' | 'legend' | 'pinned'
}

const LINE_MARKS = new Set<ChartMark>(['line', 'lineDot'])

/**
 * Serie que toca el puntero (px CSS), solo entre las visibles (D49):
 *
 * 1. Una sigla dibujada que lo contiene gana (índice: el final de su serie, que es lo que rotula).
 * 2. Series de línea: la distancia vertical a la recta entre dos puntos seguidos con valor que rodean al puntero; los
 *    puntos (sueltos, finales) por distancia euclídea; el final de un detenido se alarga `STOPPED_HIT_EXTRA` px a la
 *    derecha para cubrir su raya.
 * 3. Puntos, huecos y aspas: distancia euclídea a cada punto.
 *
 * Gana la menor si no pasa de `maxPx` (a igual distancia, la destacada y luego la primera de `groups`). Lo que queda
 * fuera del área de datos (recortado) no cuenta. Índice: el del eje x más cercano al puntero (el mismo que elige un
 * clic) si la serie tiene ahí un valor; si no (gráficas por hora, con un x por vuelta de cualquier coche), el del
 * punto tocado.
 */
export function hitTest(
  spec: ChartSpec,
  frame: HitFrame,
  px: number,
  py: number,
  maxPx: number,
  labelRects: readonly LabelRect[] = [],
): ChartHit | null {
  const visible = new Map(spec.groups.filter((g) => g.visible).map((g) => [g.key, g]))
  for (const r of labelRects) {
    if (!visible.has(r.key) || px < r.x0 || px > r.x1 || py < r.y0 || py > r.y1) continue
    const end = seriesEnd(spec, r.key)
    if (end) return { key: r.key, index: end.index }
  }
  const { bbox } = frame
  const top = bbox.top - 0.5
  const bottom = bbox.top + bbox.height + 0.5
  const inY = (y: number) => y >= top && y <= bottom
  const inX = (x: number) => x >= bbox.left - 0.5 && x <= bbox.left + bbox.width + 0.5
  let best: { key: string; d: number; point: number; rank: number } | null = null
  const order = new Map(spec.groups.map((g, i) => [g.key, i]))
  const consider = (key: string, d: number, point: number) => {
    if (d > maxPx) return
    const g = visible.get(key)!
    const rank = (g.emphasis ? 0 : 1) * 1e6 + order.get(key)!
    if (!best || d < best.d - 1e-9 || (Math.abs(d - best.d) <= 1e-9 && rank < best.rank)) best = { key, d, point, rank }
  }
  for (const s of spec.series) {
    const g = visible.get(s.group)
    if (!g) continue
    const v = s.values
    const xs = spec.x
    const isLine = LINE_MARKS.has(s.mark)
    let lastIdx = -1
    for (let i = 0; i < v.length; i++) {
      const y = v[i]
      if (y === null || y === undefined) continue
      lastIdx = i
      const X = frame.xPos(xs[i]!)
      const Y = frame.yPos(y)
      if (inX(X) && inY(Y)) consider(s.group, Math.hypot(px - X, py - Y), i)
      if (!isLine) continue
      const next = v[i + 1]
      if (next === null || next === undefined) continue
      const X2 = frame.xPos(xs[i + 1]!)
      if (px < Math.min(X, X2) || px > Math.max(X, X2) || X2 === X) continue
      const Y2 = frame.yPos(next)
      const yAt = Y + ((Y2 - Y) * (px - X)) / (X2 - X)
      if (inY(yAt)) consider(s.group, Math.abs(py - yAt), Math.abs(px - X) <= Math.abs(px - X2) ? i : i + 1)
    }
    // El final de un detenido llega hasta su raya.
    if (isLine && g.stopped && lastIdx >= 0) {
      const X = frame.xPos(xs[lastIdx]!)
      const Y = frame.yPos(v[lastIdx]!)
      if (px >= X && px <= X + STOPPED_HIT_EXTRA && inY(Y)) consider(s.group, Math.abs(py - Y), lastIdx)
    }
  }
  const hit = best as { key: string; d: number; point: number } | null
  if (!hit) return null
  const near = nearestIndex(spec.x, frame.xVal(px))
  const hasValue = near >= 0 && spec.series.some((s) => s.group === hit.key && s.values[near] !== null && s.values[near] !== undefined)
  return { key: hit.key, index: hasValue ? near : hit.point }
}

/** Rectángulo en px CSS (x0 < x1, y0 < y1). */
export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Paso (px CSS) entre las muestras de una línea para colocar la ficha (`seriesSamples`). */
export const SAMPLE_STEP_PX = 6

/**
 * Puntos por los que pasa lo que se dibuja de un grupo (px CSS del lienzo, dentro del área de datos): sus puntos y, en
 * las series de línea, muestras cada `step` px entre dos puntos seguidos con valor. Para que la ficha no tape la serie
 * que describe (`chooseCardSpot`).
 */
export function seriesSamples(spec: ChartSpec, frame: HitFrame, key: string, step = SAMPLE_STEP_PX): { x: number; y: number }[] {
  const { bbox } = frame
  const clampY = (y: number) => Math.min(Math.max(y, bbox.top), bbox.top + bbox.height)
  const out: { x: number; y: number }[] = []
  for (const s of spec.series) {
    if (s.group !== key) continue
    const isLine = LINE_MARKS.has(s.mark)
    const v = s.values
    for (let i = 0; i < v.length; i++) {
      const y = v[i]
      if (y === null || y === undefined) continue
      const X = frame.xPos(spec.x[i]!)
      const Y = clampY(frame.yPos(y))
      out.push({ x: X, y: Y })
      const next = v[i + 1]
      if (!isLine || next === null || next === undefined) continue
      const X2 = frame.xPos(spec.x[i + 1]!)
      const Y2 = clampY(frame.yPos(next))
      const n = Math.floor(Math.hypot(X2 - X, Y2 - Y) / step)
      for (let k = 1; k < n; k++) out.push({ x: X + ((X2 - X) * k) / n, y: Y + ((Y2 - Y) * k) / n })
    }
  }
  return out
}

/** Lo que pesa tapar algo que debe verse (el dato señalado, el final de la serie y su sigla) frente a una muestra. */
const KEEP_WEIGHT = 1000
/**
 * Lo que pesa tapar un nombre de la leyenda (`soft`): como dos muestras de la línea (12 px). Con la ficha a la vista,
 * la serie que describe importa más que la leyenda: si no cabe en ningún hueco del área de datos, va sobre la leyenda
 * antes que sobre un trozo largo de su serie.
 */
const SOFT_WEIGHT = 2

/**
 * Dónde va la ficha de una serie (D49): de los sitios candidatos (en orden de preferencia), el que menos tapa de esa
 * serie. Cada candidato se ajusta antes al contenedor ([0, W − w] × [0, H − h]). Coste: cada rectángulo de `keep` que
 * pisa (el dato señalado, el final de la serie, su sigla, el nombre de la leyenda que la muestra) pesa `KEEP_WEIGHT`;
 * cada uno de `soft` (los demás nombres de la leyenda), `SOFT_WEIGHT`; cada muestra de la línea (`seriesSamples`) que
 * queda debajo, 1. A igual coste, el primero. Así, si la serie sigue a la derecha del dato, la ficha va a la izquierda
 * o a una esquina libre, y una ficha más alta que el área de datos no tapa el final de la serie ni su sigla.
 */
export function chooseCardSpot(o: {
  w: number
  h: number
  W: number
  H: number
  candidates: readonly { left: number; top: number }[]
  samples: readonly { x: number; y: number }[]
  keep: readonly Rect[]
  soft?: readonly Rect[]
}): { left: number; top: number } {
  const fit = (c: { left: number; top: number }) => ({
    left: Math.min(Math.max(0, c.left), Math.max(0, o.W - o.w)),
    top: Math.min(Math.max(0, c.top), Math.max(0, o.H - o.h)),
  })
  let best: { left: number; top: number } | null = null
  let bestCost = Infinity
  for (const c of o.candidates) {
    const at = fit(c)
    const x1 = at.left + o.w
    const y1 = at.top + o.h
    let cost = 0
    const hits = (r: Rect) => r.x0 < x1 && at.left < r.x1 && r.y0 < y1 && at.top < r.y1
    for (const r of o.keep) if (hits(r)) cost += KEEP_WEIGHT
    for (const r of o.soft ?? []) if (hits(r)) cost += SOFT_WEIGHT
    for (const p of o.samples) if (p.x >= at.left && p.x <= x1 && p.y >= at.top && p.y <= y1) cost++
    if (cost < bestCost) {
      best = at
      bestCost = cost
    }
  }
  return best ?? fit({ left: 0, top: 0 })
}

/** Último índice con valor en alguna de las listas (−1 si ninguno). */
export function lastValueIndex(lists: readonly (readonly (number | null)[])[]): number {
  let last = -1
  for (const list of lists) {
    for (let i = list.length - 1; i > last; i--) {
      if (list[i] !== null && list[i] !== undefined) {
        last = i
        break
      }
    }
  }
  return last
}
