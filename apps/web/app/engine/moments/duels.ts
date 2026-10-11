/**
 * Duelos (ítem 5, D35): dos coches seguidos en la línea de meta a menos de `DUEL_MAX_GAP_MS` durante
 * `DUEL_MIN_LAPS` vueltas seguidas o más. Dato real: los pasos por meta del cronometraje (`crossMs` del índice de
 * vueltas). TS puro, sin Vue ni three.
 *
 * - «Seguidos»: en el orden de paso por la línea de esa vuelta (mismo número de vuelta), sin nadie en medio. Un coche
 *   que acaba la vuelta entrando en boxes cruza la línea en el pit lane: no cuenta como «en medio».
 * - Una vuelta cuenta si ninguno de los dos entra ni sale de boxes en ella y si no hubo SC, VSC ni bandera roja en la
 *   vuelta de ninguno (con neutralización las diferencias se comprimen y no son un duelo).
 * - Sin el estado de pista por vuelta en los datos (`trackStatusKnown`), no se puede descartar una neutralización: no
 *   se afirma ningún duelo.
 * - Corte («Sin spoilers»): solo los pasos por meta hasta `cutoffMs`. Un duelo cuya vuelta siguiente aún no se
 *   conoce en el corte queda «en curso» (`open`).
 * - Solo en carrera y sprint.
 */
import { type CarLaps, LAP_NEUTRALISED, LAP_PIT, LAP_PIT_IN, type LapTable, lapIndex } from '../analysis/lapTable'
import type { Overtake } from './overtakes'

/** Separación máxima en la línea (ms) entre los dos coches. */
export const DUEL_MAX_GAP_MS = 1000
/** Vueltas seguidas mínimas a esa distancia. */
export const DUEL_MIN_LAPS = 3

export interface Duel {
  /** El de delante y el que le persigue (números como texto). */
  leader: string
  chaser: string
  /** Primera y última vuelta a menos de 1 s (hasta el corte). */
  firstLap: number
  lastLap: number
  /** Inicio: el paso por meta del de delante en la primera vuelta (ms de sesión). */
  startMs: number
  /** Último paso por meta del perseguidor dentro del duelo (ms de sesión). */
  endMs: number
  /** Cuándo es un duelo: el paso por meta del perseguidor en su tercera vuelta (ms de sesión). */
  confirmedMs: number
  /** Menor separación en la línea (ms) y en qué vuelta. */
  minGapMs: number
  minGapLap: number
  /** En el corte aún no se sabe si sigue: los dos tienen paso por meta de la vuelta siguiente, pero después. */
  open: boolean
  /** Acabó con el perseguidor adelantando en la vuelta siguiente (confirmado hasta el corte). */
  endedInOvertake: boolean
}

export type DuelsStatus = 'ok' | 'notRace' | 'noTrackStatus'

export interface DuelsResult {
  status: DuelsStatus
  duels: Duel[]
}

interface Run {
  leader: string
  chaser: string
  firstLap: number
  lastLap: number
  startMs: number
  endMs: number
  crossings: number[]
  minGapMs: number
  minGapLap: number
}

/** Paso por meta real de la vuelta `lap` hasta el corte, con la clasificación de la vuelta; null si no lo hay. */
function crossAt(laps: CarLaps, lap: number, cutoffMs: number): { ms: number; kind: number } | null {
  const k = lapIndex(laps, lap)
  if (k < 0) return null
  const x = laps.crossMs[k]!
  return x > 0 && x <= cutoffMs ? { ms: x, kind: laps.kind[k]! } : null
}

export function duels(table: LapTable, cutoffMs = Infinity, overtakes: readonly Overtake[] = []): DuelsResult {
  if (!table.race) return { status: 'notRace', duels: [] }
  if (!table.trackStatusKnown) return { status: 'noTrackStatus', duels: [] }
  const cars = [...table.cars.values()]
  let maxLap = 0
  for (const c of cars) for (const lap of c.lap) if (lap > maxLap) maxLap = lap

  const done: Run[] = []
  let active = new Map<string, Run>()
  for (let lap = 1; lap <= maxLap; lap++) {
    // Orden de paso por la línea de esta vuelta, sin los que la acaban en el pit lane.
    const line: { car: string; ms: number; kind: number }[] = []
    for (const c of cars) {
      const x = crossAt(c, lap, cutoffMs)
      if (x && !(x.kind & LAP_PIT_IN)) line.push({ car: c.car, ...x })
    }
    line.sort((a, b) => a.ms - b.ms)
    const next = new Map<string, Run>()
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1]!
      const b = line[i]!
      const gap = b.ms - a.ms
      if (!(gap > 0 && gap < DUEL_MAX_GAP_MS)) continue
      if ((a.kind | b.kind) & (LAP_PIT | LAP_NEUTRALISED)) continue
      const key = `${a.car}>${b.car}`
      const run = active.get(key)
      if (run && run.lastLap === lap - 1) {
        run.lastLap = lap
        run.endMs = b.ms
        run.crossings.push(b.ms)
        if (gap < run.minGapMs) {
          run.minGapMs = gap
          run.minGapLap = lap
        }
        next.set(key, run)
      } else {
        next.set(key, {
          leader: a.car,
          chaser: b.car,
          firstLap: lap,
          lastLap: lap,
          startMs: a.ms,
          endMs: b.ms,
          crossings: [b.ms],
          minGapMs: gap,
          minGapLap: lap,
        })
      }
    }
    for (const [key, run] of active) if (!next.has(key)) done.push(run)
    active = next
  }
  done.push(...active.values())

  const lapsOf = new Map(cars.map((c) => [c.car, c]))
  const result: Duel[] = []
  for (const run of done) {
    if (run.lastLap - run.firstLap + 1 < DUEL_MIN_LAPS) continue
    const after = run.lastLap + 1
    const nextOf = (car: string) => {
      const laps = lapsOf.get(car)
      const k = laps ? lapIndex(laps, after) : -1
      return k < 0 ? -1 : laps!.crossMs[k]!
    }
    const la = nextOf(run.leader)
    const lb = nextOf(run.chaser)
    const open = cutoffMs !== Infinity && la > 0 && lb > 0 && Math.max(la, lb) > cutoffMs
    const endedInOvertake = overtakes.some(
      (o) => o.passer === run.chaser && o.passed === run.leader && o.lap === after && o.confirmedMs <= cutoffMs,
    )
    result.push({
      leader: run.leader,
      chaser: run.chaser,
      firstLap: run.firstLap,
      lastLap: run.lastLap,
      startMs: run.startMs,
      endMs: run.endMs,
      confirmedMs: run.crossings[DUEL_MIN_LAPS - 1]!,
      minGapMs: run.minGapMs,
      minGapLap: run.minGapLap,
      open,
      endedInOvertake,
    })
  }
  result.sort((a, b) => a.startMs - b.startMs || a.leader.localeCompare(b.leader))
  return { status: 'ok', duels: result }
}
