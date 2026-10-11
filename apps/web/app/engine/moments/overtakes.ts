/**
 * Adelantamientos (ítem 5, D35): cambios del orden oficial en la línea de meta entre dos vueltas seguidas de dos
 * coches. Dato real: los pasos por meta del cronometraje (`crossMs` del índice de vueltas). TS puro, sin Vue ni three.
 *
 * Se confirma un adelantamiento de P sobre Q en la vuelta k (≥ 2) si:
 * - los dos tienen paso por meta real en las vueltas k − 1 y k (si a uno le falta, ahí no se afirma nada);
 * - Q cruzó antes en la vuelta k − 1 y P antes en la k (mismo número de vuelta: doblar a un coche no es adelantarlo);
 * - ninguno de los dos entra ni sale de boxes en esas dos vueltas (perder puestos parando no es un adelantamiento);
 * - en las dos líneas se separan menos de `OVERTAKE_MAX_GAP_MS` (un cambio de orden a más distancia no es una
 *   maniobra en pista, sino un coche con problemas o un dato raro).
 *
 * La vuelta 1 nunca: no hay un orden oficial anterior (la parrilla no está en los datos). Pasar y volver a pasar dentro
 * de la misma vuelta no se ve (la resolución es por vuelta).
 *
 * El instante (`atMs`) es aproximado: el GPS de los dos coches dentro de esa vuelta, cuando la distancia recorrida de
 * P supera por última vez a la de Q (muestreo cada `OVERTAKE_SAMPLE_MS`). Lleva «Estimado» (`overtakeTime`). Si no hay
 * cruce entre dos muestras con dato de los dos (un hueco del GPS, o el GPS no ve el cambio), null: «momento exacto:
 * sin dato».
 */
import { type CarLaps, LAP_PIT, type LapTable, lapIndex } from '../analysis/lapTable'
import { type CarTrack, newCarSample, sampleCar } from '../replay/motion'

/** Separación máxima en la línea (ms), en las dos vueltas, para contar el cambio de orden como adelantamiento. */
export const OVERTAKE_MAX_GAP_MS = 30_000
/** Paso del muestreo GPS que sitúa el instante (ms). */
export const OVERTAKE_SAMPLE_MS = 250

export interface Overtake {
  /** Quien adelanta (número como texto). */
  passer: string
  /** Quien es adelantado. */
  passed: string
  /** Vuelta en la que adelanta (≥ 2): el orden cambia entre el paso por meta de la anterior y el de esta. */
  lap: number
  /** Ventana en la que los dos van en esa vuelta: del paso por meta anterior de P a su paso al acabarla (ms). */
  fromMs: number
  toMs: number
  /** Cuándo lo confirma la línea: el paso por meta de Q al acabar la vuelta (el último de los dos). */
  confirmedMs: number
  /** Cuánto iba P detrás de Q en la línea anterior y cuánto delante en la de esta vuelta (ms, > 0). */
  gapBeforeMs: number
  gapAfterMs: number
  /** Instante aproximado (GPS, ms de sesión) o null: «momento exacto: sin dato». */
  atMs: number | null
}

/** Paso por meta real de la vuelta `lap` de un coche (ms), o null si no lo hay o entra o sale de boxes en ella. */
function cleanCross(laps: CarLaps, lap: number): number | null {
  const k = lapIndex(laps, lap)
  if (k < 0) return null
  const x = laps.crossMs[k]!
  if (!(x > 0) || laps.kind[k]! & LAP_PIT) return null
  return x
}

/**
 * Cambios de orden confirmados en la línea (sin situar en el GPS: `atMs` null). Solo en carrera y sprint; en el resto
 * de sesiones, ninguno. Ordenados por confirmación.
 */
export function lineSwaps(table: LapTable): Overtake[] {
  if (!table.race) return []
  const cars = [...table.cars.values()]
  let maxLap = 0
  for (const c of cars) for (const lap of c.lap) if (lap > maxLap) maxLap = lap
  const out: Overtake[] = []
  const prev: (number | null)[] = new Array<number | null>(cars.length)
  const cur: (number | null)[] = new Array<number | null>(cars.length)
  for (let lap = 2; lap <= maxLap; lap++) {
    for (let i = 0; i < cars.length; i++) {
      prev[i] = cleanCross(cars[i]!, lap - 1)
      cur[i] = cleanCross(cars[i]!, lap)
    }
    for (let i = 0; i < cars.length; i++) {
      const pi = prev[i]
      const ci = cur[i]
      if (pi == null || ci == null) continue
      for (let j = 0; j < cars.length; j++) {
        if (j === i) continue
        const pj = prev[j]
        const cj = cur[j]
        if (pj == null || cj == null) continue
        // i adelanta a j: detrás en la línea anterior (estrictamente) y delante en la de esta vuelta.
        if (!(pi > pj && ci < cj)) continue
        const gapBeforeMs = pi - pj
        const gapAfterMs = cj - ci
        if (gapBeforeMs >= OVERTAKE_MAX_GAP_MS || gapAfterMs >= OVERTAKE_MAX_GAP_MS) continue
        out.push({
          passer: cars[i]!.car,
          passed: cars[j]!.car,
          lap,
          fromMs: pi,
          toMs: ci,
          confirmedMs: cj,
          gapBeforeMs,
          gapAfterMs,
          atMs: null,
        })
      }
    }
  }
  return out.sort((a, b) => a.confirmedMs - b.confirmedMs || a.toMs - b.toMs)
}

/**
 * Instante aproximado en el que P pasa a Q dentro de [fromMs, toMs] con el GPS: el último cruce de la distancia
 * recorrida (de P detrás a P delante) entre dos muestras seguidas con dato de los dos, interpolado entre ellas. null
 * si ese último cruce cae en un hueco del GPS, si no lo hay o si al final de la ventana el GPS no pone a P delante.
 */
export function locateOvertake(
  passer: CarTrack,
  passed: CarTrack,
  fromMs: number,
  toMs: number,
  stepMs = OVERTAKE_SAMPLE_MS,
): number | null {
  if (!(toMs > fromMs) || !(stepMs > 0)) return null
  const a = newCarSample()
  const b = newCarSample()
  let at: number | null = null
  /** Última muestra con dato de los dos (su instante y P − Q) y si la anterior del muestreo también lo tenía. */
  let lastT = Number.NaN
  let lastD = Number.NaN
  let prevOk = false
  const n = Math.ceil((toMs - fromMs) / stepMs)
  for (let i = 0; i <= n; i++) {
    const t = i === n ? toMs : fromMs + i * stepMs
    const sa = sampleCar(passer, t, a)
    const sb = sampleCar(passed, t, b)
    if (sa.state === 'hidden' || sb.state === 'hidden') {
      prevOk = false
      continue
    }
    const d = sa.s - sb.s
    if (lastD < 0 && d >= 0) {
      // Cruce: entre dos muestras seguidas, interpolado; si en medio hubo un hueco, no se sabe cuándo.
      at = prevOk ? lastT + (-lastD / (d - lastD)) * (t - lastT) : null
    }
    lastT = t
    lastD = d
    prevOk = true
  }
  return lastD >= 0 ? at : null
}

/**
 * Adelantamientos confirmados por la línea y situados con el GPS (`tracks`: las pistas de movimiento de los coches).
 * Un coche sin pista de movimiento deja su instante sin dato.
 */
export function overtakes(table: LapTable, tracks: ReadonlyMap<string, CarTrack>): Overtake[] {
  const list = lineSwaps(table)
  for (const o of list) {
    const p = tracks.get(o.passer)
    const q = tracks.get(o.passed)
    o.atMs = p && q ? locateOvertake(p, q, o.fromMs, o.toMs) : null
  }
  return list
}
