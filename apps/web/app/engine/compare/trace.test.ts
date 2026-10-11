import { describe, expect, it } from 'vitest'
import { constantSpeed, syntheticTrack } from '../../testing/motion'
import type { CarSeries } from '../telemetry/telemetry'
import { alignTraces, lapTrace, traceCount } from './trace'

/** Telemetría sintética: muestras en `t`, con el acelerador y el freno dados (velocidad = índice). */
function series(t: number[], throttle: (i: number) => number = () => 80, brake: (i: number) => number = () => 0): CarSeries {
  return {
    t: Float64Array.from(t),
    speed: Float32Array.from(t, (_, i) => 100 + i),
    rpm: Float32Array.from(t, () => 10_000),
    gear: Uint8Array.from(t, () => 7),
    throttle: Uint8Array.from(t, (_, i) => throttle(i)),
    brake: Uint8Array.from(t, (_, i) => brake(i)),
    drs: Uint8Array.from(t, () => 255),
  }
}

const L = 1000

describe('traza de una vuelta por distancia', () => {
  // A 50 m/s desde s = 0 a los 0 s: la vuelta (1000 m) dura 20 s.
  const track = syntheticTrack(constantSpeed(1, { fromMs: 0, toMs: 40_000, stepMs: 250, speedMps: 50 }))

  it('muestras crudas en su distancia dentro de la vuelta, en [0, L); acelerador 255 → sin dato (NaN)', () => {
    const times = Array.from({ length: 50 }, (_, i) => i * 1000 - 3000) // de −3 s a 46 s, una por segundo
    const tr = lapTrace(series(times, (i) => (i === 10 ? 255 : 60), (i) => i % 2), track, { t: 0, s: 0 }, 20_000, L)
    expect([...tr.t]).toEqual(Array.from({ length: 20 }, (_, i) => i * 1000))
    for (let i = 0; i < tr.d.length; i++) {
      expect(tr.d[i]!).toBeCloseTo(50 * i, 6)
      expect(tr.d[i]!).toBeGreaterThanOrEqual(0)
      expect(tr.d[i]!).toBeLessThan(L)
    }
    // Velocidad tal cual (sin interpolar ni suavizar): la de la muestra.
    expect(tr.speed[0]).toBe(103)
    expect(tr.throttle[7]).toBeNaN() // la muestra de los 7 s (índice 10 de la serie)
    expect(tr.throttle[6]).toBe(60)
    expect([...tr.brake.slice(0, 4)]).toEqual([1, 0, 1, 0])
    expect([...tr.cut].every((c) => c === 0)).toBe(true)
  })

  it('vuelta abierta (sin fin): hasta la longitud de la vuelta; el resto no entra', () => {
    const times = Array.from({ length: 40 }, (_, i) => i * 1000)
    const tr = lapTrace(series(times), track, { t: 0, s: 0 }, Number.NaN, L)
    expect(tr.d.length).toBe(20)
    expect(tr.d.at(-1)!).toBeCloseTo(950, 6)
  })

  it('se corta en un hueco de posición y entre muestras separadas más de 2 s; no se inventa nada', () => {
    // Sin posición entre 5 s y 9 s.
    const gap = syntheticTrack({
      car: 1,
      t: [0, 1000, 2000, 3000, 4000, 5000, 9000, 10_000, 11_000, 12_000],
      s: [0, 50, 100, 150, 200, 250, 450, 500, 550, 600],
    })
    const tr = lapTrace(series([0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 9500, 10_000, 14_000]), gap, { t: 0, s: 0 }, 20_000, L)
    // Como en el replay, el hueco empieza en la última muestra con posición (5 s): de 5 s a 7 s, fuera; y la muestra de
    // 14 s tampoco tiene posición (fuera de los datos).
    expect([...tr.t]).toEqual([0, 1000, 2000, 3000, 4000, 9500, 10_000])
    expect([...tr.cut]).toEqual([0, 0, 0, 0, 0, 1, 0])
    // Hueco de telemetría (sin muestras entre 1 s y 4 s): corte, aunque haya posición.
    const tel = lapTrace(series([0, 1000, 4000, 5000]), track, { t: 0, s: 0 }, 20_000, L)
    expect([...tel.cut]).toEqual([0, 0, 1, 0])
  })

  it('sin telemetría o sin posición al empezar la vuelta: traza vacía', () => {
    expect(lapTrace(null, track, { t: 0, s: 0 }, 20_000, L).d.length).toBe(0)
    expect(lapTrace(series([0, 1000]), track, { t: 0, s: Number.NaN }, 20_000, L).d.length).toBe(0)
  })

  it('una vuelta en curso se recorta al instante actual (sin futuro)', () => {
    const tr = lapTrace(series(Array.from({ length: 20 }, (_, i) => i * 1000)), track, { t: 0, s: 0 }, 20_000, L)
    expect(traceCount(tr, -1)).toBe(0)
    expect(traceCount(tr, 0)).toBe(1)
    expect(traceCount(tr, 4500)).toBe(5)
    expect(traceCount(tr, 1e9)).toBe(20)
  })
})

describe('trazas de A y B en un eje común (uPlot)', () => {
  const track = syntheticTrack(constantSpeed(1, { fromMs: 0, toMs: 40_000, stepMs: 250, speedMps: 50 }))
  const slow = syntheticTrack(constantSpeed(2, { fromMs: 0, toMs: 40_000, stepMs: 250, speedMps: 40 }))

  it('x ordenada; cada serie con sus valores en sus distancias y undefined en las del otro coche', () => {
    const a = lapTrace(series([0, 1000, 2000, 3000]), track, { t: 0, s: 0 }, 20_000, L) // 0, 50, 100, 150 m
    const b = lapTrace(series([500, 1500, 2500], (i) => (i === 1 ? 255 : 30)), slow, { t: 0, s: 0 }, 30_000, L) // 20, 60, 100 m
    const al = alignTraces(a, 3, b, 3)
    expect(al.x.map((x) => Math.round(x))).toEqual([0, 20, 50, 60, 100, 100])
    expect(al.speed[0]).toEqual([100, undefined, 101, undefined, 102, undefined])
    expect(al.speed[1]).toEqual([undefined, 100, undefined, 101, undefined, 102])
    // Acelerador sin dato: null (la línea se corta), nunca un 0.
    expect(al.throttle[1]).toEqual([undefined, 30, undefined, null, undefined, 30])
    expect(al.brake[0]).toEqual([0, undefined, 0, undefined, 0, undefined])
  })

  it('un corte es un punto nulo entre las dos muestras; sin B, solo A', () => {
    const a = lapTrace(series([0, 1000, 4000]), track, { t: 0, s: 0 }, 20_000, L) // corte antes de 4 s
    const al = alignTraces(a, 3, null, 0)
    expect(al.x.map((x) => Math.round(x))).toEqual([0, 50, 125, 200])
    expect(al.speed[0]).toEqual([100, 101, null, 102])
    expect(al.speed[1]).toEqual([undefined, undefined, undefined, undefined])
  })
})
