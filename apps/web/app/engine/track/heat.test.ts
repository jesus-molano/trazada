import { describe, expect, it } from 'vitest'
import { loadFixture } from '../../testing/fixture'
import {
  HEAT_TEST_L as L,
  heatTestCircuit as circuit,
  heatTestKmh as kmhAt,
  heatTestLapMs as lapMsOf,
  heatTestSource as source,
} from '../../testing/heat'
import { type LapInput, timingBuilder } from '../../testing/laps'
import { buildLapTable } from '../analysis/lapTable'
import { carTracks } from '../replay/motion'
import { circuitModel } from './circuit'
import {
  createHeat,
  HEAT_MINISECTORS,
  HEAT_SETTLE_MS,
  HEAT_TIE_MS,
  type HeatPalette,
  heatLapIndex,
  heatPointColors,
  heatRibbon,
  lineCrossingS,
  minisectorOf,
  minisectorWinners,
  MS_A,
  MS_B,
  MS_NONE,
  MS_TIE,
  rampAt,
  sessionBestLap,
} from './heat'
import { buildRibbon, TRACK_WIDTH_M } from './ribbon'

/** Rampa gris de 5 paradas (0, 0,25… 1): el color de un punto es su fracción de la escala. */
const GREY: HeatPalette = {
  ramp: [0, 0.25, 0.5, 0.75, 1].map((v) => [v, v, v] as const),
  a: [1, 0, 0],
  b: [0, 0, 1],
  tie: [0.5, 0.5, 0.5],
}

const A = { car: 1, mps: 50 }
const LAP_A = lapMsOf(A)
/** Instante en que la vuelta n (1…) de A ya cuenta: su paso por meta más el margen. */
const seenA = (lap: number) => LAP_A * lap + HEAT_SETTLE_MS + 1e-6

describe('qué vuelta se pinta', () => {
  it('solo vueltas representativas, completas y vistas hace 2 s; la última o la más rápida', () => {
    const src = source([
      {
        ...A,
        laps: 6,
        each: (i) => ([{}, { pitInMs: 1 }, { status: ['sc'] }, { deleted: true }, {}, { status: ['yellow'] }] as LapInput[])[i]!,
      },
    ])
    const laps = src.leaderboard.lapTable.cars.get('1')!
    // Vuelta 1 (salida del box o de la parrilla), nunca; la 2 entra al box, la 3 con SC y la 4 anulada.
    expect(heatLapIndex(laps, 'last', seenA(4) + 10_000)).toBe(-1)
    // La 5 cuenta 2 s después de cruzar la línea, no antes.
    expect(heatLapIndex(laps, 'last', seenA(5) - 2)).toBe(-1)
    expect(laps.lap[heatLapIndex(laps, 'last', seenA(5))]).toBe(5)
    // Con amarilla sí cuenta (la 6).
    expect(laps.lap[heatLapIndex(laps, 'last', seenA(6))]).toBe(6)
  })

  it('«mejor»: la de menor tiempo oficial; sin coche, la más rápida de la sesión hasta ese instante', () => {
    const b = timingBuilder()
      .run(1, 0, [100_000, 90_000, 95_000, 92_000])
      .run(2, 0, [100_000, 93_000, 89_000, 99_000])
      .build()
    const table = buildLapTable('fp1', b, [])
    const one = table.cars.get('1')!
    expect(one.lap[heatLapIndex(one, 'best', 400_000)]).toBe(2)
    expect(one.lap[heatLapIndex(one, 'last', 400_000)]).toBe(4)
    // A los 200 s solo cuenta la vuelta 2 de 1 (190 000 + 2000 ≤ 200 000); la 2 de 2 cierra a los 193 s.
    expect(sessionBestLap(table, 194_000)).toEqual({ car: '1', k: 1 })
    expect(sessionBestLap(table, 195_000)).toEqual({ car: '1', k: 1 })
    // La 3 de 2 (89 s) cierra a los 282 s: desde 284 s es la más rápida.
    expect(sessionBestLap(table, 283_999)).toEqual({ car: '1', k: 1 })
    expect(sessionBestLap(table, 284_000)).toEqual({ car: '2', k: 2 })
    expect(sessionBestLap(table, 100_000)).toBeNull()
  })

  it('el paso por meta de la vuelta: el múltiplo de L más cercano a donde empezó (±8 m de GPS)', () => {
    expect(lineCrossingS(2 * L + 6, L)).toBeCloseTo(2 * L)
    expect(lineCrossingS(3 * L - 7, L)).toBeCloseTo(3 * L)
    expect(lineCrossingS(0, L)).toBe(0)
  })
})

describe('velocidad', () => {
  it('cada punto con la velocidad medida (interpolada entre muestras seguidas) y su color en la rampa', () => {
    const heat = createHeat(source([A]))
    const v = heat.view({ mode: 'speed', a: '1', b: null, pick: 'last', t: seenA(3) })
    expect(v).toMatchObject({ mode: 'speed', status: 'ok', carA: '1', sessionBest: false })
    expect(v.a).toMatchObject({ car: '1', lap: 3, lapMs: LAP_A })
    // Una vuelta limpia: todos los puntos con color; escala de 100 a 300 km/h (lo que midió en la vuelta).
    expect(v.colored).toBe(circuit.centerline.count)
    expect(v.minKmh).toBeGreaterThanOrEqual(100)
    expect(v.minKmh).toBeLessThan(102)
    expect(v.maxKmh).toBeGreaterThan(298)
    expect(v.maxKmh).toBeLessThanOrEqual(300)
    // El punto de mitad de vuelta: 200 km/h, y su color, esa fracción de la rampa.
    const mid = circuit.centerline.count / 2
    expect(circuit.centerline.vertexS(mid)).toBeCloseTo(L / 2, 0)
    expect(v.speed![mid]).toBeCloseTo(kmhAt(circuit.centerline.vertexS(mid)), 3)
    const rgb = new Float32Array(circuit.centerline.count * 3)
    const valid = new Uint8Array(circuit.centerline.count)
    expect(heatPointColors(v, circuit.centerline, GREY, rgb, valid)).toBe(circuit.centerline.count)
    const f = (v.speed![mid]! - v.minKmh) / (v.maxKmh - v.minKmh)
    expect(f).toBeCloseTo(0.5, 2)
    expect(rgb[mid * 3]).toBeCloseTo(f, 5)
  })

  it('sin muestra en 2 s, ese tramo queda sin color (nunca se interpola a través del hueco); con 1,5 s, sí', () => {
    const lap3 = LAP_A * 2
    const src = source([
      {
        ...A,
        // Telemetría: 3 s sin muestras a mitad de la vuelta 3 y 1,5 s en otro sitio.
        telHoles: [
          [lap3 + 30_000, lap3 + 33_000],
          [lap3 + 10_000, lap3 + 11_500],
        ],
      },
    ])
    const v = createHeat(src).view({ mode: 'speed', a: '1', b: null, pick: 'last', t: seenA(3) })
    const at = (ms: number) => Math.round(((A.mps * ms) / 1000 / L) * circuit.centerline.count) % circuit.centerline.count
    expect(Number.isNaN(v.speed![at(31_500)])).toBe(true)
    expect(Number.isNaN(v.speed![at(10_750)])).toBe(false)
    // Lo que falta es el tramo entre las dos muestras del hueco (≈ 3,25 s a 50 m/s ≈ 163 m ≈ 37 puntos).
    const missing = circuit.centerline.count - v.colored
    expect(missing).toBeGreaterThan(30)
    expect(missing).toBeLessThan(45)
  })

  it('un hueco de posición (más de 2 s sin señal) también deja el tramo sin color', () => {
    const lap3 = LAP_A * 2
    const v = createHeat(source([{ ...A, posHoles: [[lap3 + 20_000, lap3 + 23_000]] }])).view({
      mode: 'speed',
      a: '1',
      b: null,
      pick: 'last',
      t: seenA(3),
    })
    expect(v.status).toBe('ok')
    const i = Math.round(((A.mps * 21_500) / 1000 / L) * circuit.centerline.count)
    expect(Number.isNaN(v.speed![i])).toBe(true)
    expect(v.colored).toBeLessThan(circuit.centerline.count)
  })

  it('sin coche: la vuelta más rápida de la sesión hasta ese momento; sin ninguna, «noLap»', () => {
    const heat = createHeat(source([A, { car: 2, mps: 45 }]))
    expect(heat.view({ mode: 'speed', a: null, b: null, pick: 'last', t: 1000 })).toMatchObject({ status: 'noLap', sessionBest: true })
    const v = heat.view({ mode: 'speed', a: null, b: null, pick: 'last', t: seenA(4) })
    expect(v).toMatchObject({ status: 'ok', sessionBest: true, carA: '1' })
    expect(v.a!.lap).toBe(2)
  })

  it('el mismo objeto mientras no cambia la vuelta; otro (con otra versión) al cerrarse la siguiente', () => {
    const heat = createHeat(source([A]))
    const v1 = heat.view({ mode: 'speed', a: '1', b: null, pick: 'last', t: seenA(3) })
    expect(heat.view({ mode: 'speed', a: '1', b: null, pick: 'last', t: seenA(3) + 20_000 })).toBe(v1)
    const v2 = heat.view({ mode: 'speed', a: '1', b: null, pick: 'last', t: seenA(4) })
    expect(v2).not.toBe(v1)
    expect(v2.version).toBeGreaterThan(v1.version)
    expect(v2.a!.lap).toBe(4)
    expect(heat.view({ mode: 'speed', a: '1', b: null, pick: 'last', t: 10 })).toMatchObject({ status: 'noLap', missing: 'a' })
  })
})

describe('minisectores', () => {
  it('25 tramos iguales; gana el que tarda menos; con menos de 50 ms, «igual»', () => {
    // A a 50 m/s, B a 48 m/s (≈ 105 ms más por tramo de ~126 m) y C a 49,6 m/s (≈ 20 ms más).
    const heat = createHeat(source([A, { car: 2, mps: 48 }, { car: 3, mps: 49.6 }]))
    const t = (L / 48) * 1000 * 3 + HEAT_SETTLE_MS
    const v = heat.view({ mode: 'minisectors', a: '1', b: '2', pick: 'last', t })
    expect(v.status).toBe('ok')
    expect(v.winners).toHaveLength(HEAT_MINISECTORS)
    expect(v.counts).toEqual({ a: HEAT_MINISECTORS, b: 0, tie: 0, none: 0 })
    const step = L / HEAT_MINISECTORS
    expect(v.msA![7]).toBeCloseTo((step / 50) * 1000, 0)
    expect(v.msB![7]).toBeCloseTo((step / 48) * 1000, 0)
    const tie = heat.view({ mode: 'minisectors', a: '1', b: '3', pick: 'last', t })
    expect(tie.counts).toEqual({ a: 0, b: 0, tie: HEAT_MINISECTORS, none: 0 })
    // Con B como A, gana el otro color.
    expect(heat.view({ mode: 'minisectors', a: '2', b: '1', pick: 'last', t }).counts).toMatchObject({ b: HEAT_MINISECTORS })
  })

  it('banda de empate: |Δ| < 50 ms → igual; sin tiempo de alguno → sin dato', () => {
    const a = Float64Array.from([2500, 2500, 2500, 2500, Number.NaN])
    const b = Float64Array.from([2549.9, 2550, 2440, 2450.1, 2500])
    expect(Array.from(minisectorWinners(a, b))).toEqual([MS_TIE, MS_A, MS_B, MS_TIE, MS_NONE])
    expect(HEAT_TIE_MS).toBe(50)
  })

  it('un hueco de posición dentro de un tramo lo deja sin color; nunca se adivina', () => {
    const lap3 = LAP_A * 2
    const heat = createHeat(source([{ ...A, posHoles: [[lap3 + 20_000, lap3 + 23_000]] }, { car: 2, mps: 48 }]))
    const t = (L / 48) * 1000 * 3 + HEAT_SETTLE_MS
    const v = heat.view({ mode: 'minisectors', a: '1', b: '2', pick: 'last', t })
    // 1000–1150 m de la vuelta: el tramo 7 (126 m cada uno) y quizá el 8.
    const k = minisectorOf(((20_000 + 21_500) / 2000) * A.mps, L)
    expect(v.winners![k]).toBe(MS_NONE)
    expect(v.counts!.none).toBeGreaterThanOrEqual(1)
    expect(v.counts!.none).toBeLessThanOrEqual(3)
    expect(v.counts!.a).toBe(HEAT_MINISECTORS - v.counts!.none)
    // Sus puntos no tienen color.
    const rgb = new Float32Array(circuit.centerline.count * 3)
    const valid = new Uint8Array(circuit.centerline.count)
    heatPointColors(v, circuit.centerline, GREY, rgb, valid)
    for (let i = 0; i < valid.length; i++) {
      const w = v.winners![minisectorOf(circuit.centerline.vertexS(i), L)]
      expect(valid[i], `punto ${i}`).toBe(w === MS_NONE ? 0 : 1)
      if (w === MS_A) expect(Array.from(rgb.subarray(i * 3, i * 3 + 3))).toEqual([1, 0, 0])
    }
  })

  it('sin comparación, «noPair»; sin vuelta de alguno, «noLap» y de quién', () => {
    const heat = createHeat(source([A, { car: 2, mps: 48 }]))
    expect(heat.view({ mode: 'minisectors', a: '1', b: null, pick: 'last', t: seenA(3) }).status).toBe('noPair')
    expect(heat.view({ mode: 'minisectors', a: null, b: '2', pick: 'last', t: seenA(3) }).status).toBe('noPair')
    // A cierra su vuelta 2 antes que B: durante un rato, a B le falta.
    const v = heat.view({ mode: 'minisectors', a: '1', b: '2', pick: 'last', t: seenA(2) })
    expect(v).toMatchObject({ status: 'noLap', missing: 'b' })
    expect(heat.view({ mode: 'minisectors', a: '9', b: '2', pick: 'last', t: seenA(3) })).toMatchObject({ status: 'noLap', missing: 'a' })
  })
})

describe('cinta', () => {
  it('dos vértices por punto (los de buildRibbon) y solo los cuadriláteros con color en los dos extremos', () => {
    const path = circuit.centerline
    const ribbon = buildRibbon(path, TRACK_WIDTH_M, true)
    const n = path.count
    const colors = new Float32Array(n * 6)
    expect(colors.length).toBe(ribbon.positions.length)
    expect(ribbon.positions.length / 3).toBe(2 * n)
    const index = new Uint32Array(ribbon.indices.length)
    const rgb = new Float32Array(n * 3).fill(0.25)
    const valid = new Uint8Array(n).fill(1)
    // Todo con color: los mismos índices que la pista (también el cuadrilátero que cierra la vuelta).
    expect(heatRibbon(rgb, valid, true, colors, index)).toBe(ribbon.indices.length)
    expect(Array.from(index)).toEqual(Array.from(ribbon.indices))
    expect(colors[0]).toBe(0.25)
    expect(colors[(2 * n - 1) * 3 + 2]).toBe(0.25)
    // Un punto sin color quita los dos cuadriláteros que lo tocan.
    valid[10] = 0
    expect(heatRibbon(rgb, valid, true, colors, index)).toBe(ribbon.indices.length - 12)
    valid[0] = 0
    expect(heatRibbon(rgb, valid, true, colors, index)).toBe(ribbon.indices.length - 24)
  })

  it('rampa: interpolación lineal entre paradas, saturada en los extremos', () => {
    const out = new Float32Array(3)
    rampAt(GREY.ramp, 0.375, out, 0)
    expect(out[0]).toBeCloseTo(0.375)
    rampAt(GREY.ramp, -1, out, 0)
    expect(out[0]).toBe(0)
    rampAt(GREY.ramp, 2, out, 0)
    expect(out[0]).toBe(1)
    rampAt(GREY.ramp, Number.NaN, out, 0)
    expect(out[0]).toBe(0)
  })
})

describe('con el fixture de Spa (libres 1, extracto de 9 min)', () => {
  it('velocidad de la última vuelta del 10 y minisectores 10 frente a 44, con datos reales', async () => {
    const s = await loadFixture()
    const c = circuitModel(s.circuit)
    const tracks = carTracks(s.motion, s.tangents)
    const heat = createHeat({
      session: { manifest: s.manifest, car: s.car },
      model: { tracks },
      leaderboard: { lapTable: buildLapTable(s.manifest.session.type, s.timing, s.events.raceControl) },
      circuit: c,
    })
    expect(heat.defaultPick).toBe('best')
    const t = 4_700_000
    const v = heat.view({ mode: 'speed', a: '10', b: null, pick: 'last', t })
    expect(v.status).toBe('ok')
    expect(v.a!.lap).toBe(22)
    // Casi toda la vuelta con color (el extracto tiene posiciones y telemetría de toda ella); escala plausible.
    expect(v.colored / c.centerline.count).toBeGreaterThan(0.9)
    expect(v.minKmh).toBeGreaterThan(50)
    expect(v.maxKmh).toBeLessThan(360)
    // Su mejor vuelta (la 12) es de antes del extracto: sin posiciones, «sin dato», nunca otra vuelta.
    const best = heat.view({ mode: 'speed', a: '10', b: null, pick: 'best', t })
    expect(best).toMatchObject({ status: 'noData', colored: 0 })
    expect(best.a!.lap).toBe(12)

    const ms = heat.view({ mode: 'minisectors', a: '10', b: '44', pick: 'last', t })
    expect(ms.status).toBe('ok')
    expect(ms.b!.lap).toBe(20)
    const n = ms.counts!
    expect(n.a + n.b + n.tie + n.none).toBe(HEAT_MINISECTORS)
    expect(n.none).toBeLessThan(5)
  })
})
