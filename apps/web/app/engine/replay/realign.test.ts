import type { DecodedTrzb } from '@trazada/schema'
import { describe, expect, it } from 'vitest'
import { REALIGN_MAX_SHIFT_MS, realignPositionTimes } from './realign'

const HEADER = { layout: 'x', revision: 1, schemaVersion: '1.0.0', tables: [], meta: {} }

/** Velocidad real de un coche (km/h) y su distancia exacta (m) en el instante τ (ms): 230 ± 60 km/h, periodo 20 s. */
const W = (2 * Math.PI) / 20_000
const kmh = (car: number, tau: number) => 230 + 60 * Math.sin(W * tau + car)
const dist = (car: number, tau: number) => (230 * tau - (60 / W) * (Math.cos(W * tau + car) - Math.cos(car))) / 3600

/** Desplazamiento del envío k (ms), el mismo para todos los coches: determinista, en ±120 ms. */
const jitter = (k: number) => Math.round(120 * Math.sin(k * 12.9898 + 4.1414) * Math.cos(k * 3.7))

interface Feed {
  /** Instante real de cada envío (ms). */
  tau: number[]
  /** Desplazamiento de la hora publicada de cada envío: t = τ − j. */
  j: number[]
}

function feed(n: number, step = 300, jit = jitter): Feed {
  const tau = Array.from({ length: n }, (_, k) => 2000 + step * k)
  return { tau, j: tau.map((_, k) => jit(k)) }
}

/** Sesión sintética: `cars` coches en pista con las horas del feed desplazadas y telemetría limpia a 4 Hz. */
function session(f: Feed, cars = 8, opts: { path?: (car: number, k: number) => number } = {}) {
  const n = f.tau.length
  const T = new Float64Array(cars * n)
  const S = new Float64Array(cars * n)
  const P = new Uint8Array(cars * n)
  const telT: number[] = []
  const telV: number[] = []
  const telStart: number[] = []
  const telCount: number[] = []
  for (let c = 0; c < cars; c++) {
    for (let k = 0; k < n; k++) {
      T[c * n + k] = f.tau[k]! - f.j[k]!
      S[c * n + k] = dist(c, f.tau[k]!)
      P[c * n + k] = opts.path?.(c, k) ?? 0
    }
    telStart.push(telT.length)
    for (let t = 1000 + 9 * c; t <= f.tau[n - 1]! + 1000; t += 250) {
      telT.push(t)
      telV.push(kmh(c, t))
    }
    telCount.push(telT.length - telStart[c]!)
  }
  const numbers = Uint8Array.from({ length: cars }, (_, c) => c + 1)
  const motion: DecodedTrzb = {
    header: HEADER,
    tables: {
      cars: {
        rows: cars,
        columns: { car: numbers, start: Uint32Array.from({ length: cars }, (_, c) => c * n), count: new Uint32Array(cars).fill(n) },
      },
      pos: { rows: cars * n, columns: { t: T, s: S, path: P } },
    },
  }
  const car: DecodedTrzb = {
    header: HEADER,
    tables: {
      cars: { rows: cars, columns: { car: numbers, start: Uint32Array.from(telStart), count: Uint32Array.from(telCount) } },
      tel: { rows: telT.length, columns: { t: Float64Array.from(telT), speed: Float32Array.from(telV) } },
    },
  }
  return { motion, car, T, S, n, cars }
}

/**
 * Error de hora de un coche, sin los dos envíos de cada extremo: `local` = el mayor de un envío respecto a la media de
 * sus dos vecinos (lo que se ve como tirón); `worst` = el mayor en valor absoluto.
 */
function errors(e: number[], n: number) {
  let local = 0
  let worst = 0
  for (let k = 2; k < n - 2; k++) {
    local = Math.max(local, Math.abs(e[k]! - (e[k - 1]! + e[k + 1]!) / 2))
    worst = Math.max(worst, Math.abs(e[k]!))
  }
  return { local, worst }
}

describe('hora de las posiciones por consenso entre coches (D52)', () => {
  it('recupera el desplazamiento común del envío con unos pocos ms de error', () => {
    const f = feed(200)
    const { motion, car, T, n, cars } = session(f)
    const stats = realignPositionTimes(motion, car)
    expect(stats.shifted).toBeGreaterThan(150)
    // Lo que da tirones es el error de un envío respecto a sus vecinos; un desfase común y lento (decenas de envíos) no
    // se ve en los datos ni en el dibujo, y queda dentro de unos ms. Los dos primeros y los dos últimos envíos no tienen
    // vecinas a los dos lados: se quedan como estaban.
    for (let c = 0; c < cars; c++) {
      const e = errors(Array.from({ length: n }, (_, k) => T[c * n + k]! - f.tau[k]!), n)
      expect(e.local).toBeLessThanOrEqual(5)
      expect(e.worst).toBeLessThanOrEqual(15)
    }
  })

  it('sin reajuste, el error local sería el del feed (decenas de ms)', () => {
    const f = feed(200)
    const { T, n } = session(f)
    expect(errors(Array.from({ length: n }, (_, k) => T[k]! - f.tau[k]!), n).local).toBeGreaterThan(60)
  })

  it('no cambia s y ningún coche va hacia atrás', () => {
    const f = feed(200)
    const { motion, car, T, S, n, cars } = session(f)
    const before = Float64Array.from(S)
    realignPositionTimes(motion, car)
    expect(S).toEqual(before)
    for (let c = 0; c < cars; c++) for (let k = 1; k < n; k++) expect(T[c * n + k]! - T[c * n + k - 1]!).toBeGreaterThanOrEqual(20)
  })

  it('si un δ deja la hora de un coche hacia atrás o con muestras pegadas, ese δ no se aplica', () => {
    // Envíos 50 y 51 publicados con 30 ms entre ellos, pero el 50 (de verdad, el más tardío) llegó 150 ms antes de su
    // hora real: corregido quedaría detrás del 51.
    const tau = Array.from({ length: 120 }, (_, k) => 2000 + 300 * k)
    const j = tau.map(() => 0)
    tau[50] = tau[51]! + 120
    j[50] = tau[50]! - (tau[51]! - 30)
    const { motion, car, T, n, cars } = session({ tau, j })
    const published = Float64Array.from(T)
    const stats = realignPositionTimes(motion, car)
    expect(stats.dropped).toBeGreaterThan(0)
    for (let c = 0; c < cars; c++) {
      expect(T[c * n + 50]).toBe(published[c * n + 50])
      for (let k = 1; k < n; k++) expect(T[c * n + k]!).toBeGreaterThan(T[c * n + k - 1]!)
    }
  })

  it(`un desplazamiento de más de ${REALIGN_MAX_SHIFT_MS} ms no es el del envío: no se toca`, () => {
    const f = feed(120, 600, (k) => (k === 60 ? 260 : 0))
    const { motion, car, T, n } = session(f)
    const published = Float64Array.from(T)
    const stats = realignPositionTimes(motion, car)
    expect(stats.dropped).toBe(1)
    expect(T[60]).toBe(published[60])
    expect(stats.maxAbsMs).toBeLessThanOrEqual(5)
    expect(T[n + 60]).toBe(published[n + 60])
  })

  it('sin opinión de suficientes coches (en pit, despacio o sin telemetría), no se mueve nada', () => {
    const f = feed(100)
    // Todos en el pit lane: ninguna muestra vale como dato.
    const pit = session(f, 8, { path: () => 1 })
    const before = Float64Array.from(pit.T)
    expect(realignPositionTimes(pit.motion, pit.car).shifted).toBe(0)
    expect(pit.T).toEqual(before)
    // Dos coches: menos que el mínimo para un consenso.
    const two = session(f, 2)
    const published = Float64Array.from(two.T)
    expect(realignPositionTimes(two.motion, two.car).shifted).toBe(0)
    expect(two.T).toEqual(published)
    // Sin telemetría.
    const none = session(f)
    expect(realignPositionTimes(none.motion, null)).toEqual({ instants: 0, shifted: 0, dropped: 0, maxAbsMs: 0 })
  })

  it('en pit también se mueve con el instante (el desplazamiento es del envío, no del coche)', () => {
    const f = feed(150)
    // El coche 8 va por el pit lane en los envíos 60–90: no opina, pero su hora se corrige igual.
    const { motion, car, T, n } = session(f, 8, { path: (c, k) => (c === 7 && k >= 60 && k <= 90 ? 1 : 0) })
    realignPositionTimes(motion, car)
    // Igual que los que van en pista en esos mismos envíos.
    for (let k = 62; k <= 88; k++) expect(T[7 * n + k]).toBe(T[k])
    const e = errors(Array.from({ length: n }, (_, k) => T[7 * n + k]! - f.tau[k]!), n)
    expect(e.local).toBeLessThanOrEqual(5)
  })
})
