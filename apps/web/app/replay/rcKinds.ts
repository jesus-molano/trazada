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
