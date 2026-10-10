import { describe, expect, it } from 'vitest'
import { loadFixture } from '../../testing/fixture'
import { timingBuilder } from '../../testing/laps'
import { constantSpeed, syntheticTracks } from '../../testing/motion'
import { buildLapTable } from '../analysis/lapTable'
import { carTracks } from '../replay/motion'
import { circuitModel } from '../track/circuit'
import { timeAtS } from './distance'
import { carLapStarts, inLap, lapAtS, lapAtTime, lapStartsByCar, lapStartTime } from './laps'

describe('inicio de cada vuelta', () => {
  const timing = timingBuilder()
    .lap(1, 1, { startMs: 0, endMs: 100_000 })
    .lap(1, 2, { endMs: 190_000, lapMs: 90_000 }) // sin inicio: el paso por meta de la vuelta 1
    .lap(1, 4, { endMs: 380_000, lapMs: 95_000 }) // sin inicio ni vuelta 3: fin − tiempo
    .lap(1, 5, {}) // sin inicio ni fin: el paso por meta de la vuelta 4
    .lap(1, 6, {}) // sin inicio y la 5 sin paso por meta: sin dato
    .lap(1, 7, { startMs: 380_000, endMs: 470_000, lapMs: 90_000 }) // no avanza respecto a la 5
    .build()
  const laps = buildLapTable('race', timing, []).cars.get('1')!

  it('oficial; si falta, el paso por meta anterior; si no, fin − tiempo; si no, sin dato', () => {
    expect([0, 1, 2, 3, 4, 5].map((k) => lapStartTime(laps, k))).toEqual([0, 100_000, 285_000, 380_000, null, 380_000])
  })

  it('los inicios son estrictamente crecientes; sin pista de movimiento, distancia NaN', () => {
    const st = carLapStarts(laps, null)
    expect([...st.lap]).toEqual([1, 2, 4, 5])
    expect([...st.t]).toEqual([0, 100_000, 285_000, 380_000])
    expect([...st.s].every(Number.isNaN)).toBe(true)
    // La 5 no tiene paso por meta: fin NaN.
    expect([...st.end]).toEqual([100_000, 190_000, 380_000, NaN])
  })
})

describe('inicio de vuelta en distancia y búsquedas', () => {
  // Coche 1 a 50 m/s desde s = 0: vueltas de 60 s (3000 m). Coche 2 sin señal entre 55 y 65 s.
  const timing = timingBuilder()
    .run(1, 0, [60_000, 60_000, 60_000])
    .run(2, 0, [60_000, 60_000])
    .run(3, 0, [60_000]) // sin pista de movimiento
    .build()
  const a = constantSpeed(1, { fromMs: 0, toMs: 180_000, stepMs: 250, speedMps: 50 })
  const b1 = constantSpeed(2, { fromMs: 0, toMs: 55_000, stepMs: 250, speedMps: 50 })
  const b2 = constantSpeed(2, { fromMs: 65_000, toMs: 120_000, stepMs: 250, speedMps: 50, s0: 3250 })
  const tracks = syntheticTracks([a, { car: 2, t: [...b1.t, ...b2.t], s: [...b1.s, ...b2.s] }])
  const starts = lapStartsByCar(buildLapTable('race', timing, []), tracks)

  it('s del replay en el instante del inicio; NaN si en ese instante no hay posición', () => {
    expect([...starts.get('1')!.s].map((s) => Math.round(s * 1e6) / 1e6)).toEqual([0, 3000, 6000])
    const s2 = starts.get('2')!.s
    expect(s2[0]).toBeCloseTo(0, 9)
    expect(s2[1]).toBeNaN() // a los 60 s, sin señal
    expect(starts.get('3')!.s[0]).toBeNaN()
  })

  it('vuelta en curso por tiempo y por distancia', () => {
    const st = starts.get('1')!
    expect([-1, 0, 59_999, 60_000, 179_000, 1e9].map((t) => lapAtTime(st, t))).toEqual([-1, 0, 0, 1, 2, 2])
    expect([-1, 0, 2999, 3000, 7000].map((s) => lapAtS(st, s))).toEqual([-1, 0, 0, 1, 2])
    // Una vuelta sin distancia de inicio se salta: a 3500 m, el coche 2 sigue en la vuelta 1 por distancia.
    expect(lapAtS(starts.get('2')!, 3500)).toBe(0)
  })

  it('dentro de una vuelta: empezada y sin cerrar', () => {
    const st = starts.get('1')!
    expect(inLap(st, 0, 0)).toBe(true)
    expect(inLap(st, 0, 60_000)).toBe(false)
    expect(inLap(st, 1, 60_000)).toBe(true)
    expect(inLap(st, 2, 180_000)).toBe(false)
    expect(inLap(st, 3, 100)).toBe(false)
    expect(inLap(st, -1, 100)).toBe(false)
  })

  it('distancia dentro de la vuelta y tiempo de vuelta: base del delta por distancia', () => {
    const st = starts.get('1')!
    const tr = tracks[0]!
    // A 1500 m dentro de la vuelta 2: 30 s después de su inicio.
    const t = timeAtS(tr, st.s[1]! + 1500)!
    expect(t - st.t[1]!).toBeCloseTo(30_000, 6)
  })
})

describe('con el fixture real', () => {
  it('el inicio de vuelta del cronometraje cae sobre la línea de meta del GPS (s ≈ k·L, ±8 m típico)', async () => {
    const f = await loadFixture()
    const L = circuitModel(f.circuit).centerline.length
    const table = buildLapTable(f.manifest.session.type, f.timing, f.events.raceControl)
    const starts = lapStartsByCar(table, carTracks(f.motion, f.tangents))
    const errs: number[] = []
    for (const st of starts.values()) {
      for (let k = 0; k < st.t.length; k++) {
        if (k > 0) expect(st.t[k]!).toBeGreaterThan(st.t[k - 1]!)
        const s = st.s[k]!
        if (Number.isNaN(s)) continue
        errs.push(Math.abs(s - Math.round(s / L) * L))
      }
    }
    errs.sort((x, y) => x - y)
    // Spa FP1 (extracto): mediana ≈ 4 m y máximo ≈ 24 m.
    expect(errs.length).toBeGreaterThan(20)
    expect(errs[Math.floor(errs.length / 2)]!).toBeLessThan(8)
    expect(errs.at(-1)!).toBeLessThan(50)
  })
})
