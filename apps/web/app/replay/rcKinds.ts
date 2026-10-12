/**
 * Tono de un mensaje de dirección de carrera por su clase (`parsed.kind`): la franja de color que lo acompaña en el
 * panel de dirección de carrera (`TzRaceControl`), en la ficha de una serie de las gráficas de análisis
 * (`TzCarStory`) y en la lista «Neutralizaciones y dirección de carrera» de «Momentos» (D49). El color nunca va solo:
 * siempre con el nombre de la clase. TS puro.
 *
 * - `is-neutral` (--tz-sc): coche de seguridad, virtual y bandera roja.
 * - `is-yellow` (--tz-flag-yellow): amarilla y doble amarilla.
 * - `is-flag` (--tz-flag-green): el resto de banderas y la luz verde.
 * - `is-stewards` (--tz-paint): comisarios (incidentes, sanciones, vueltas anuladas, límites de pista, banderas negras).
 * - '' (el borde por defecto): lo demás.
 */
export type RcTone = 'is-neutral' | 'is-yellow' | 'is-flag' | 'is-stewards' | ''

const FLAG_KINDS: ReadonlySet<string> = new Set([
  'sector_yellow',
  'sector_double_yellow',
  'sector_clear',
  'blue_flag',
  'chequered_flag',
  'green_light',
  'track_clear',
])
const NEUTRAL_KINDS: ReadonlySet<string> = new Set(['sc_deployed', 'sc_ending', 'sc_in_this_lap', 'vsc_deployed', 'vsc_ending', 'red_flag'])
const STEWARD_KINDS: ReadonlySet<string> = new Set([
  'incident',
  'penalty',
  'penalty_served',
  'lap_deleted',
  'lap_reinstated',
  'track_limits',
  'black_and_white_flag',
  'black_and_orange_flag',
  'black_flag',
])

export function rcTone(kind: string): RcTone {
  if (NEUTRAL_KINDS.has(kind)) return 'is-neutral'
  if (kind === 'sector_yellow' || kind === 'sector_double_yellow') return 'is-yellow'
  if (FLAG_KINDS.has(kind)) return 'is-flag'
  if (STEWARD_KINDS.has(kind)) return 'is-stewards'
  return ''
}

/**
 * Glifo de la columna de estado (D50, «hoja de tiempos»): un signo propio por clase, nunca una franja de color. Siempre
 * acompaña al tipo escrito (el glifo va con aria-hidden).
 *
 * - Banderas con mástil y paño en su color: verde (despejado, luz verde, pista libre), amarilla, doble amarilla (dos
 *   paños), azul, roja y a cuadros.
 * - Rótulos en condensada: SC, VSC y PIT.
 * - Comisarios (incidentes, sanciones, vueltas anuladas, límites de pista, banderas negras): un cuadrado hueco de pintura.
 * - Adelantamiento y DRS: «»».
 * - Lo demás: un punto tenue.
 */
export type RcGlyph =
  | 'flag-green'
  | 'flag-yellow'
  | 'flag-double-yellow'
  | 'flag-blue'
  | 'flag-red'
  | 'flag-chequered'
  | 'sc'
  | 'vsc'
  | 'pit'
  | 'stewards'
  | 'overtake'
  | 'dot'

const GREEN_KINDS: ReadonlySet<string> = new Set(['sector_clear', 'track_clear', 'green_light', 'pit_lane_clear'])

export function rcGlyph(kind: string): RcGlyph {
  if (GREEN_KINDS.has(kind)) return 'flag-green'
  if (kind === 'sector_yellow' || kind === 'yellow_pit_lane') return 'flag-yellow'
  if (kind === 'sector_double_yellow') return 'flag-double-yellow'
  if (kind === 'blue_flag') return 'flag-blue'
  if (kind === 'red_flag') return 'flag-red'
  if (kind === 'chequered_flag') return 'flag-chequered'
  if (kind.startsWith('vsc_')) return 'vsc'
  if (kind.startsWith('sc_')) return 'sc'
  if (kind.startsWith('pit_')) return 'pit'
  if (STEWARD_KINDS.has(kind)) return 'stewards'
  if (kind.startsWith('overtake_') || kind.startsWith('drs_') || kind === 'lapped_cars_overtake') return 'overtake'
  return 'dot'
}

/** Tinte de la fila entera: neutralizaciones (SC/VSC, 10 % ámbar) y bandera roja (12 % rojo); el resto, sin tinte. */
export type RcTint = 'is-neutral' | 'is-red' | ''

export function rcTint(kind: string): RcTint {
  if (kind === 'red_flag') return 'is-red'
  if (kind.startsWith('sc_') || kind.startsWith('vsc_')) return 'is-neutral'
  return ''
}
