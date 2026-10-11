/**
 * Resumen de fin de sesión (ítem 12, D40), solo con datos reales de cronometraje (TS puro, sin Vue ni three):
 *
 * - Fin de la sesión: el último «Finished» del estado de sesión; si no lo hay, el último mensaje de bandera a cuadros
 *   de dirección de carrera; si no, el fin de los datos (`endMs`). Si ese fin cae después de los datos, también el
 *   fin de los datos: la reproducción no llega más allá.
 * - Momento de la tarjeta (`showMs`): cuando el resultado ya está asentado, para que la tarjeta diga lo mismo que la
 *   clasificación en ese instante. En carrera y sprint, cuando los tres primeros han cruzado la línea con la bandera;
 *   en libres y clasificación, cuando acaban las vueltas cronometradas que empezaron antes del fin (cuentan). Nunca
 *   después del fin de los datos.
 * - Los tres primeros: los de la clasificación del replay (`LeaderboardEngine`: torre oficial, orden en la línea o
 *   mejor vuelta) en `showMs`, solo con posición conocida. Es el cronometraje al terminar: no incluye sanciones
 *   posteriores (serían resultados de Jolpica, que no se usan).
 * - Vuelta rápida: la mejor vuelta con tiempo oficial completada hasta `showMs` y no anulada a esa hora. La vuelta 1
 *   de una carrera no tiene tiempo oficial y nunca se estima aquí.
 * - Paradas (carrera y sprint): cada entrada al pit lane hasta `showMs`, con su salida (la primera posterior). Es
 *   parada si cambia el stint (o, sin stint, el compuesto); si el stint no cambia, es un paso por el pit lane sin
 *   cambio de neumáticos (p. ej. un drive-through); si no se sabe, sin dato. El tiempo es el que pasa en el pit lane
 *   (salida − entrada), no el de la parada en el box, que no está en los datos.
 *
 * Lo que falta es `null` (o una lista vacía): la interfaz lo muestra como «sin dato», nunca con un valor inventado.
 */
import { type DecodedTrzb, type DriverInfo, ENUMS, type RaceControlEvent, type SessionEvents, type SessionType } from '@trazada/schema'
import type { CarLaps, LapTable } from '../analysis/lapTable'
import { LeaderboardEngine, type LeaderboardRow } from '../leaderboard/leaderboard'

/** Puestos de la tarjeta. */
export const SUMMARY_PLACES = 3
/**
 * Margen antes del fin de la sesión para el paso por meta con el que un coche toma la bandera: el mensaje y el estado
 * «Finished» llegan un poco después de que el primero cruce la línea. Una vuelta dura mucho más, así que el paso
 * anterior de un coche de cabeza nunca cae dentro.
 */
export const FLAG_LINE_TOLERANCE_MS = 15_000

const STATUS_FINISHED = ENUMS.sessionStatus.indexOf('Finished')

/** De dónde sale el fin de la sesión: estado «Finished», bandera a cuadros o fin de los datos. */
export type SessionEndSource = 'finished' | 'chequered' | 'data-end'

export interface SessionEnd {
  /** ms de sesión. */
  t: number
  source: SessionEndSource
}

/** Paso por el pit lane: parada (cambia el stint), paso sin cambio de neumáticos o sin dato. */
export type PitVisitKind = 'stop' | 'pass' | 'unknown'

export interface PitVisit {
  /** Vuelta en la que entra en el pit lane. */
  lap: number
  inMs: number
  /** Salida del pit lane; null si no la hay hasta el fin (sin dato). */
  outMs: number | null
  /** Tiempo en el pit lane (salida − entrada); null sin salida. No es el tiempo de la parada en el box. */
  pitLaneMs: number | null
  kind: PitVisitKind
}

export interface SummaryRow {
  /** Posición en el cronometraje al terminar (siempre conocida: las desconocidas no entran). */
  position: number
  car: string
  driver: DriverInfo | null
  /** ms al primero (torre, pasos por meta o mejor vuelta); null sin dato. 0 para el primero. */
  gapMs: number | null
  /** Vueltas perdidas con el primero (carrera). */
  lapsBehind: number
  /** Mejor vuelta válida (en clasificación, de la última tanda); null sin dato. */
  bestLapMs: number | null
  /** Vueltas completadas (pasos por meta reales) hasta el fin; null si el coche no tiene vueltas en los datos. */
  laps: number | null
  /** Compuestos de cada stint, en orden (`ENUMS.compound`, UNKNOWN sin dato); vacía sin vueltas. */
  stints: string[]
  /** Pasos por el pit lane hasta el fin (carrera y sprint); null fuera de carrera o sin vueltas en los datos. */
  pits: PitVisit[] | null
}

export interface FastestLap {
  car: string
  driver: DriverInfo | null
  lap: number
  lapMs: number
  /** Paso por meta con el que cerró la vuelta. */
  atMs: number
}

export interface SessionSummary {
  type: SessionType
  /** Carrera o sprint. */
  race: boolean
  end: SessionEnd
  /** Instante en que aparece la tarjeta (≥ `end.t` salvo si los datos acaban antes, ≤ fin de los datos). */
  showMs: number
  /** Los primeros con posición conocida, como mucho `SUMMARY_PLACES` (menos si no hay más con posición). */
  rows: SummaryRow[]
  /** null: ninguna vuelta con tiempo oficial válida hasta el fin. */
  fastest: FastestLap | null
}

export interface SummaryInput {
  type: SessionType
  timing: DecodedTrzb
  events: SessionEvents
  drivers: readonly DriverInfo[]
  /** Intervalo de reproducción (los datos). */
  playback: { startMs: number; endMs: number }
  /** La clasificación del replay, si ya existe (no se rehace el índice de vueltas). */
  leaderboard?: LeaderboardEngine
}

/** Fin de la sesión según los datos (ver arriba). */
export function sessionEnd(
  timing: DecodedTrzb,
  raceControl: readonly RaceControlEvent[],
  playback: { startMs: number; endMs: number },
): SessionEnd {
  let t = -Infinity
  let source: SessionEndSource = 'data-end'
  const status = timing.tables.sessionStatus
  const st = status?.columns.t
  const code = status?.columns.status
  if (status && st && code) {
    for (let i = 0; i < status.rows; i++) if (code[i] === STATUS_FINISHED && st[i]! > t) t = st[i]!
    if (t > -Infinity) source = 'finished'
  }
  if (source === 'data-end') {
    for (const e of raceControl) if (e.parsed.kind === 'chequered_flag' && e.t > t) t = e.t
    if (t > -Infinity) source = 'chequered'
  }
  if (source === 'data-end' || t > playback.endMs) return { t: playback.endMs, source: 'data-end' }
  return { t: Math.max(t, playback.startMs), source }
}

/** Inicio de la vuelta k: el oficial o, si falta, el fin menos el tiempo de vuelta; −1 si no se sabe. */
function lapStart(laps: CarLaps, k: number): number {
  const start = laps.startMs[k]!
  if (start >= 0) return start
  const end = laps.endMs[k]!
  const ms = laps.lapMs[k]!
  return end > 0 && ms > 0 ? end - ms : -1
}

/** Libres y clasificación: fin de las vueltas cronometradas que empezaron antes del fin y acaban después. */
function settleTimed(table: LapTable, endT: number): number {
  let at = endT
  for (const laps of table.cars.values()) {
    for (let k = 0; k < laps.lap.length; k++) {
      const cross = laps.crossMs[k]!
      if (cross > at && laps.lapMs[k]! > 0) {
        const start = lapStart(laps, k)
        if (start >= 0 && start < endT) at = cross
      }
    }
  }
  return at
}

/** Primer paso por meta de un coche con la bandera (desde un poco antes del fin), o null. */
function flagCrossing(laps: CarLaps | undefined, endT: number): number | null {
  if (!laps) return null
  for (let k = 0; k < laps.lap.length; k++) {
    const cross = laps.crossMs[k]!
    if (cross > 0 && cross >= endT - FLAG_LINE_TOLERANCE_MS) return cross
  }
  return null
}

const topRows = (rows: readonly LeaderboardRow[]) => rows.filter((r) => r.positionKnown).slice(0, SUMMARY_PLACES)

/**
 * Carrera y sprint: el instante en que los tres primeros (del orden en ese instante) han tomado la bandera. Si al
 * llegar ahí el orden de cabeza es otro, se repite (pocas veces: converge enseguida).
 */
function settleRace(lb: LeaderboardEngine, endT: number, limit: number): number {
  let at = endT
  for (let i = 0; i < 4; i++) {
    let next = endT
    for (const r of topRows(lb.compute(at, []))) {
      const cross = flagCrossing(lb.lapTable.cars.get(r.car), endT)
      if (cross !== null && cross > next) next = cross
    }
    next = Math.min(next, limit)
    if (next === at) break
    at = next
  }
  return at
}

/** Pasos por el pit lane de un coche hasta `untilMs` (ver arriba). */
export function pitVisits(laps: CarLaps, untilMs: number): PitVisit[] {
  const out: PitVisit[] = []
  const n = laps.lap.length
  for (let k = 0; k < n; k++) {
    const inMs = laps.pitInMs[k]!
    if (inMs < 0 || inMs > untilMs) continue
    // Salida: la primera posterior a la entrada (en la vuelta siguiente, normalmente), y la vuelta con la que sale.
    let exit = -1
    for (let j = k; j < n; j++) {
      const o = laps.pitOutMs[j]!
      if (o > inMs) {
        exit = j
        break
      }
    }
    const outMs = exit >= 0 && laps.pitOutMs[exit]! <= untilMs ? laps.pitOutMs[exit]! : null
    // Neumáticos antes (vuelta de entrada) y después (vuelta de salida o, sin salida conocida, la siguiente).
    const after = exit >= 0 ? exit : k + 1 < n ? k + 1 : -1
    let kind: PitVisitKind = 'unknown'
    if (after >= 0 && after !== k) {
      const s0 = laps.stint[k]!
      const s1 = laps.stint[after]!
      const c0 = laps.compound[k]!
      const c1 = laps.compound[after]!
      if (s0 > 0 && s1 > 0) kind = s1 !== s0 ? 'stop' : 'pass'
      else if (c0 > 0 && c1 > 0 && c0 !== c1) kind = 'stop'
    }
    out.push({ lap: laps.lap[k]!, inMs, outMs, pitLaneMs: outMs !== null ? outMs - inMs : null, kind })
  }
  return out
}

/**
 * Compuestos de cada stint hasta `untilMs` (vueltas empezadas hasta entonces), en orden. Un stint nuevo empieza
 * cuando cambia el número de stint o, sin él, el compuesto. El compuesto de un stint es el primero conocido.
 */
export function stintCompounds(laps: CarLaps, untilMs: number): string[] {
  const out: number[] = []
  let stint = -1
  let compound = -1
  for (let k = 0; k < laps.lap.length; k++) {
    const start = lapStart(laps, k)
    if (start < 0 || start > untilMs) continue
    const s = laps.stint[k]!
    const c = laps.compound[k]!
    const fresh = out.length === 0 || (s > 0 && stint > 0 ? s !== stint : c > 0 && compound > 0 && c !== compound)
    if (fresh) out.push(c)
    else if (out[out.length - 1] === 0 && c > 0) out[out.length - 1] = c
    if (s > 0) stint = s
    if (c > 0) compound = c
  }
  return out.map((c) => ENUMS.compound[c] ?? 'UNKNOWN')
}

/** Vueltas completadas (pasos por meta reales) hasta `untilMs`. */
function completedLaps(laps: CarLaps, untilMs: number): number {
  let n = 0
  for (let k = 0; k < laps.lap.length; k++) {
    const cross = laps.crossMs[k]!
    if (cross > 0 && cross <= untilMs) n++
  }
  return n
}

/** Mejor vuelta de la sesión hasta `untilMs`: con tiempo oficial, paso por meta real y sin anular a esa hora. */
export function fastestLap(table: LapTable, drivers: readonly DriverInfo[], untilMs: number): FastestLap | null {
  let best: FastestLap | null = null
  for (const [car, laps] of table.cars) {
    for (let k = 0; k < laps.lap.length; k++) {
      const ms = laps.lapMs[k]!
      const cross = laps.crossMs[k]!
      if (!(ms > 0) || !(cross > 0) || cross > untilMs || laps.deletedFrom[k]! <= untilMs) continue
      // A igual tiempo, la que se hizo antes.
      if (best === null || ms < best.lapMs || (ms === best.lapMs && cross < best.atMs)) {
        best = { car, driver: null, lap: laps.lap[k]!, lapMs: ms, atMs: cross }
      }
    }
  }
  if (best) best.driver = drivers.find((d) => d.number === best!.car) ?? null
  return best
}

export function sessionSummary(input: SummaryInput): SessionSummary {
  const { type, timing, events, drivers, playback } = input
  const lb = input.leaderboard ?? new LeaderboardEngine(type, timing, events, [...drivers])
  const table = lb.lapTable
  const race = table.race
  const end = sessionEnd(timing, events.raceControl, playback)
  const settled = race ? settleRace(lb, end.t, playback.endMs) : settleTimed(table, end.t)
  const showMs = Math.min(Math.max(settled, end.t), playback.endMs)

  const rows = topRows(lb.compute(showMs, [])).map((r): SummaryRow => {
    const laps = table.cars.get(r.car)
    return {
      position: r.position,
      car: r.car,
      driver: r.driver,
      gapMs: r.position === 1 ? 0 : r.gapMs,
      lapsBehind: r.lapsBehind,
      bestLapMs: r.bestLapMs,
      laps: laps ? completedLaps(laps, showMs) : null,
      stints: laps ? stintCompounds(laps, showMs) : [],
      pits: race && laps ? pitVisits(laps, showMs) : null,
    }
  })
  return { type, race, end, showMs, rows, fastest: fastestLap(table, drivers, showMs) }
}

/**
 * ¿La reproducción acaba de cruzar el instante de la tarjeta? Solo al avanzar sin salto del reloj (un seek, un
 * arrastre del timeline o la vuelta al inicio no la abren): de `prevMs` < `showMs` a `timeMs` ≥ `showMs`.
 */
export function crossedSummary(prevMs: number, timeMs: number, showMs: number, jumped: boolean): boolean {
  return !jumped && prevMs < showMs && timeMs >= showMs
}
