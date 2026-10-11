/**
 * Anchos de los paneles laterales del replay (ítem 15, D41/D44): la clasificación a la izquierda y la columna derecha
 * (telemetría y dirección de carrera), con el mapa entre los dos. El usuario los cambia con un asa; aquí se decide qué
 * ancho es seguro: cada panel dentro de sus límites y, entre los dos (más las columnas extra de la clasificación), sin
 * quitarle al mapa su mínimo. Lo guardado no se toca: se recorta al pintarlo, así una ventana más ancha lo recupera.
 *
 * En tablet vertical no hay anchos (los paneles van en la franja inferior): quien llama no usa esto ahí. TS puro.
 */

export const LAYOUT_PANELS = ['lb', 'side'] as const
export type LayoutPanel = (typeof LAYOUT_PANELS)[number]

export interface PanelLimits {
  readonly min: number
  readonly max: number
}
export type LayoutLimits = Readonly<Record<LayoutPanel, PanelLimits>>

/** Hasta este ancho de ventana (px), tablet en horizontal y portátiles pequeños: paneles estrechos (el CSS usa `width <= 1100px`). */
export const NARROW_MAX_PX = 1100

/**
 * Límites de cada panel (px). La clasificación no baja de lo que piden sus columnas fijas (puesto, siglas, gap y
 * neumático, con sitio para «PIT»; en tablet, su ancho estrecho de siempre); la columna derecha, de lo que pide la
 * rejilla de la telemetría.
 */
export const WIDE_LIMITS: LayoutLimits = { lb: { min: 280, max: 480 }, side: { min: 260, max: 480 } }
export const NARROW_LIMITS: LayoutLimits = { lb: { min: 256, max: 400 }, side: { min: 240, max: 400 } }

/** El mapa nunca baja de esto (px) ni de esta fracción del escenario, mientras los paneles quepan en su mínimo. */
export const SCENE_MIN_PX = 320
export const SCENE_MIN_SHARE = 0.35

/** Lo que vale como ancho guardado: dentro de los límites más amplios de cualquier ventana. */
const SAVED_MIN = Math.min(...[WIDE_LIMITS, NARROW_LIMITS].flatMap((l) => [l.lb.min, l.side.min]))
const SAVED_MAX = Math.max(...[WIDE_LIMITS, NARROW_LIMITS].flatMap((l) => [l.lb.max, l.side.max]))

export function limitsFor(viewportWidth: number): LayoutLimits {
  return viewportWidth <= NARROW_MAX_PX ? NARROW_LIMITS : WIDE_LIMITS
}

/** Ancho mínimo del mapa en un escenario de `stage` px. */
export function sceneMinWidth(stage: number): number {
  return Math.max(SCENE_MIN_PX, Math.round(stage * SCENE_MIN_SHARE))
}

/**
 * Un ancho guardado (de otra versión de la app o de otra mano): un número finito dentro de los límites más amplios,
 * redondeado; si no, null (el ancho por defecto del diseño).
 */
export function sanitizeWidth(x: unknown): number | null {
  if (typeof x !== 'number' || !Number.isFinite(x)) return null
  const px = Math.round(x)
  return px >= SAVED_MIN && px <= SAVED_MAX ? px : null
}

export interface StageGeometry {
  /** Ancho del escenario (px): los dos paneles y, entre ellos, el mapa. */
  readonly stage: number
  /** Lo que la clasificación ocupa además de su ancho: sus columnas extra (px). */
  readonly lbExtra: number
  readonly limits: LayoutLimits
}

export interface PanelWidths {
  readonly lb: number
  readonly side: number
}

const within = (x: number, l: PanelLimits) => Math.min(l.max, Math.max(l.min, x))

/** Lo que queda para los dos paneles (sin las columnas extra de la clasificación) dejando al mapa su mínimo. */
export function panelBudget(geo: StageGeometry): number {
  return geo.stage - sceneMinWidth(geo.stage) - geo.lbExtra
}

/**
 * Límites de un panel con el otro a `other` px (para el asa): el máximo deja al mapa su mínimo, sin bajar nunca del
 * mínimo del panel.
 */
export function rangeFor(panel: LayoutPanel, other: number, geo: StageGeometry): PanelLimits {
  const l = geo.limits[panel]
  const room = Math.floor(panelBudget(geo) - other)
  return { min: l.min, max: Math.max(l.min, Math.min(l.max, room)) }
}

/** Un ancho dentro de unos límites, en px enteros. */
export function clampTo(x: number, l: PanelLimits): number {
  return Math.round(within(x, l))
}

/**
 * Anchos que se pintan: cada uno dentro de sus límites y, si entre los dos (más las columnas extra) no le dejan al mapa
 * su mínimo, se recortan en proporción a lo que cada uno tiene por encima de su mínimo. Si ni con los dos al mínimo
 * cabe el mapa (ventana muy estrecha), los dos al mínimo: el mapa se queda con lo que haya y nada desborda la página.
 */
export function clampWidths(want: PanelWidths, geo: StageGeometry): PanelWidths {
  const lb = within(Number.isFinite(want.lb) ? want.lb : geo.limits.lb.min, geo.limits.lb)
  const side = within(Number.isFinite(want.side) ? want.side : geo.limits.side.min, geo.limits.side)
  const excess = lb + side - panelBudget(geo)
  if (excess <= 0) return { lb: Math.round(lb), side: Math.round(side) }
  const slackLb = lb - geo.limits.lb.min
  const slackSide = side - geo.limits.side.min
  const slack = slackLb + slackSide
  if (slack <= excess) return { lb: geo.limits.lb.min, side: geo.limits.side.min }
  const k = excess / slack
  return { lb: Math.floor(lb - slackLb * k), side: Math.floor(side - slackSide * k) }
}
