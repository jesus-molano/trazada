/**
 * Telemetría de coche (layout `car`): la **muestra cruda vigente** en t (la última con t_muestra ≤ t),
 * sin interpolar: es lo que midió el coche. Las ventanas para las gráficas son vistas sin copia.
 */
import type { DecodedTrzb } from '@trazada/schema'
import { column } from '../data/columns'
import { findInterval } from '../replay/motion'

/** Antigüedad máxima de la muestra vigente: más allá, "sin dato". */
export const MAX_SAMPLE_AGE_MS = 2000

export type DrsState = 'open' | 'available' | 'closed' | 'unknown'

export interface TelemetrySample {
  t: number
  speedKmh: number
  rpm: number
  gear: number
  /** % (0–100) o null si el feed no da dato (código 255; el 104 del feed ya llega como 255). */
  throttle: number | null
  /** Pisa o no el freno: el canal es de encendido/apagado, no da la presión. */
  brake: boolean
  /** Código crudo del canal DRS (null si el canal no existe: 2026). */
  drsRaw: number | null
}

/**
 * Códigos documentados del canal DRS (FastF1): 0/1 = cerrado, 8 = disponible (dentro de la zona), 10/12/14 =
 * abierto. Cualquier otro código (2, 3, 9…) no tiene significado conocido: 'unknown' (sin dato), nunca «cerrado».
 * null si el canal no existe (2026).
 */
export function drsState(raw: number | null): DrsState | null {
  if (raw === null) return null
  if (raw === 10 || raw === 12 || raw === 14) return 'open'
  if (raw === 8) return 'available'
  if (raw === 0 || raw === 1) return 'closed'
  return 'unknown'
}

export interface CarSeries {
  t: Float64Array
  speed: ArrayLike<number>
  rpm: ArrayLike<number>
  gear: ArrayLike<number>
  throttle: ArrayLike<number>
  brake: ArrayLike<number>
  drs: ArrayLike<number>
}

export class Telemetry {
  private readonly series = new Map<string, CarSeries>()
  private readonly cursors = new Map<string, number>()

  constructor(car: DecodedTrzb) {
    const cars = car.tables.cars!
    const c = (n: string) => column(car, 'tel', n)
    for (let k = 0; k < cars.rows; k++) {
      const start = cars.columns.start![k]!
      const count = cars.columns.count![k]!
      const sub = (n: string) => (c(n) as Uint8Array).subarray(start, start + count)
      this.series.set(String(cars.columns.car![k]), {
        t: (c('t') as Float64Array).subarray(start, start + count),
        speed: (c('speed') as Float32Array).subarray(start, start + count),
        rpm: (c('rpm') as Float32Array).subarray(start, start + count),
        gear: sub('gear'),
        throttle: sub('throttle'),
        brake: sub('brake'),
        drs: sub('drs'),
      })
    }
  }

  seriesOf(car: string): CarSeries | null {
    return this.series.get(car) ?? null
  }

  /** Muestra vigente en t, o null si no hay ninguna en los últimos MAX_SAMPLE_AGE_MS. */
  sampleAt(car: string, t: number, out?: TelemetrySample): TelemetrySample | null {
    const s = this.series.get(car)
    if (!s || s.t.length === 0) return null
    const i = findInterval(s.t, t, this.cursors.get(car) ?? 0)
    this.cursors.set(car, Math.max(0, i))
    if (i < 0 || t - s.t[i]! > MAX_SAMPLE_AGE_MS) return null
    const o = out ?? ({} as TelemetrySample)
    o.t = s.t[i]!
    o.speedKmh = s.speed[i]!
    o.rpm = s.rpm[i]!
    o.gear = s.gear[i]!
    const th = s.throttle[i]!
    o.throttle = th === 255 ? null : th
    o.brake = s.brake[i]! > 0
    const d = s.drs[i]!
    o.drsRaw = d === 255 ? null : d
    return o
  }

  /** Índices [from, to) de las muestras con t en [t0, t1] (para las mini gráficas). */
  windowOf(car: string, t0: number, t1: number): [number, number] {
    const s = this.series.get(car)
    if (!s) return [0, 0]
    const lower = (x: number) => {
      let lo = 0
      let hi = s.t.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (s.t[mid]! < x) lo = mid + 1
        else hi = mid
      }
      return lo
    }
    return [lower(t0), lower(t1 + 1e-6)]
  }
}
