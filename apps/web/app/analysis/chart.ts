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
  /** Color de equipo (#rrggbb) o el de «equipo desconocido». */
  color: string
  /** Segundo piloto de su equipo: discontinuo. */
  dash: boolean
  visible: boolean
  /** Destacado (coche elegido); con alguno destacado, el resto se atenúa. */
  emphasis: boolean
  /**
   * El coche dejó de pasar por meta antes del corte (`stoppedCars`): su serie acaba antes que las demás. Su sigla no
   * se queda a media gráfica (salvo si está destacado): una marca de fin, y en la leyenda «hasta V30».
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
 * marca de fin, salvo destacada (entonces, junto a su final: con el resto atenuado no hay confusión); las demás, en el
 * margen (`ChartSpec.labelColumn`) o junto a su final.
 */
export function endPoints(spec: ChartSpec): EndPoint[] {
  const out: EndPoint[] = []
  for (const group of spec.groups) {
    if (!group.visible) continue
    const end = seriesEnd(spec, group.key)
    if (!end) continue
    const place: LabelPlace = group.stopped ? (group.emphasis ? 'inline' : 'none') : spec.labelColumn ? 'column' : 'inline'
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
  /** El coche destacado: se coloca el primero, así que siempre lleva su sigla. */
  first: boolean
}

/**
 * Altura de cada sigla (en el orden de entrada), o null si no lleva: cada una va exactamente a la altura de su dato (dentro
 * de [lo, hi]) o no va, porque una sigla movida acaba a la altura de otra serie y se lee como suya. Se colocan de una en
 * una, primero la del coche destacado (siempre lleva) y luego de arriba abajo; una que pisaría a otra ya colocada (a
 * menos de `gap` en vertical y solapadas en horizontal) se queda sin sigla: la leyenda la nombra.
 */
export function placeLabels(spots: readonly LabelSpot[], o: { gap: number; lo: number; hi: number }): (number | null)[] {
  const order = spots
    .map((_, i) => i)
    .sort((a, b) => Number(spots[b]!.first) - Number(spots[a]!.first) || spots[a]!.y - spots[b]!.y)
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
