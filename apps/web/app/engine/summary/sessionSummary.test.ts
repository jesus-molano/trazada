import type { DriverInfo } from '@trazada/schema'
import { describe, expect, it } from 'vitest'
import { loadFixture } from '../../testing/fixture'
import { lapDeletedMessage, rcMessage, sessionEvents, timingBuilder } from '../../testing/laps'
import { buildLapTable } from '../analysis/lapTable'
import { LeaderboardEngine } from '../leaderboard/leaderboard'
import { carTracks } from '../replay/motion'
import { ReplayModel } from '../replay/ReplayModel'
import { circuitModel } from '../track/circuit'
import {
  crossedSummary,
  FLAG_LINE_TOLERANCE_MS,
  fastestLap,
  pitVisits,
  SUMMARY_PLACES,
  sessionEnd,
  sessionSummary,
  stintCompounds,
} from './sessionSummary'

const drivers: DriverInfo[] = [
  ['1', 'AAA'],
  ['44', 'BBB'],
  ['16', 'CCC'],
  ['5', 'DDD'],
].map(([number, tla]) => ({ number: number!, tla: tla!, first: 'Nombre', last: tla!, team: 'Equipo', color: '#123456' }))

const playback = { startMs: 0, endMs: 400_000 }

/**
 * Carrera de 3 vueltas (~90 s): 1 cruza la meta con la bandera en 270 000; 44, en 272 000; 16, en 275 000; 5 va
 * detrás. 44 para en la vuelta 2 (cambia de stint: M → H); 16 pasa por el pit lane sin cambiar de neumáticos (un
 * drive-through: el stint no cambia). La vuelta 1 no tiene tiempo oficial (salida parada).
 */
function race(opts: { tower?: boolean; finished?: boolean; chequered?: boolean; swap?: boolean } = {}) {
  const { tower = true, finished = true, chequered = true, swap = false } = opts
  const end16 = swap ? 271_500 : 275_000
  const b = timingBuilder()
    .run(1, 0, [90_000, 90_000, 90_000], { lap1NoTime: true, compound: 'MEDIUM', stint: 1 })
    .run(44, 0, [91_000, 90_500, 90_500], {
      lap1NoTime: true,
      each: (i) =>
        i === 0
          ? { compound: 'MEDIUM', stint: 1 }
          : i === 1
            ? { compound: 'MEDIUM', stint: 1, pitInMs: 175_000 }
            : { compound: 'HARD', stint: 2, pitOutMs: 196_000 },
    })
    .run(16, 0, [92_000, 91_000, end16 - 183_000], {
      lap1NoTime: true,
      each: (i) =>
        i === 0
          ? { compound: 'SOFT', stint: 1 }
          : i === 1
            ? { compound: 'SOFT', stint: 1, pitInMs: 178_000 }
            : { compound: 'SOFT', stint: 1, pitOutMs: 199_000 },
    })
    .run(5, 0, [93_000, 93_000, 94_000], { lap1NoTime: true, compound: 'HARD', stint: 1 })
  if (tower) {
    b.order(1_000, [1, 44, 16, 5])
    b.towerAt(272_000, 44, { position: 2, gapMs: 2_000, intervalMs: 2_000 })
    b.towerAt(275_000, 16, { position: 3, gapMs: 5_000, intervalMs: 3_000 })
  }
  if (finished) b.sessionStatus(10, 'Started').sessionStatus(270_500, 'Finished').sessionStatus(390_000, 'Finalised')
  const events = sessionEvents({ raceControl: chequered ? [rcMessage(270_400, 'chequered_flag')] : [] })
  return { timing: b.build(), events }
}

const summaryOf = (type: 'race' | 'fp1' | 'q', data: ReturnType<typeof race>, pb = playback) =>
  sessionSummary({ type, timing: data.timing, events: data.events, drivers, playback: pb })

describe('fin de la sesión (D40)', () => {
  it('el último «Finished» del estado de sesión; sin él, la última bandera a cuadros; sin nada, el fin de los datos', () => {
    const withAll = race()
    expect(sessionEnd(withAll.timing, withAll.events.raceControl, playback)).toEqual({ t: 270_500, source: 'finished' })
    const flagOnly = race({ finished: false })
    const twoFlags = [rcMessage(100_000, 'chequered_flag'), ...flagOnly.events.raceControl]
    expect(sessionEnd(flagOnly.timing, twoFlags, playback)).toEqual({ t: 270_400, source: 'chequered' })
    const nothing = race({ finished: false, chequered: false })
    expect(sessionEnd(nothing.timing, nothing.events.raceControl, playback)).toEqual({ t: 400_000, source: 'data-end' })
  })

  it('si el fin cae después de los datos, la tarjeta es al fin de los datos (y lo dice)', () => {
    const d = race()
    expect(sessionEnd(d.timing, d.events.raceControl, { startMs: 0, endMs: 200_000 })).toEqual({ t: 200_000, source: 'data-end' })
    const s = summaryOf('race', d, { startMs: 0, endMs: 200_000 })
    expect(s.end.source).toBe('data-end')
    expect(s.showMs).toBe(200_000)
  })
})

describe('carrera: los tres primeros cuando han tomado la bandera', () => {
  it('con la torre: posiciones y gaps de la torre, y la tarjeta cuando cruza el 3.º', () => {
    const s = summaryOf('race', race())
    expect(s.race).toBe(true)
    expect(s.end).toEqual({ t: 270_500, source: 'finished' })
    expect(s.showMs).toBe(275_000)
    expect(s.rows.map((r) => [r.position, r.car, r.gapMs, r.lapsBehind])).toEqual([
      [1, '1', 0, 0],
      [2, '44', 2_000, 0],
      [3, '16', 5_000, 0],
    ])
    expect(s.rows[0]!.driver?.tla).toBe('AAA')
    expect(s.rows.map((r) => r.laps)).toEqual([3, 3, 3])
    expect(SUMMARY_PLACES).toBe(3)
  })

  it('sin torre, el orden en la línea; si el orden cambia en la última vuelta, se espera al nuevo podio', () => {
    const s = summaryOf('race', race({ tower: false, swap: true }))
    expect(s.showMs).toBe(272_000)
    expect(s.rows.map((r) => [r.position, r.car, r.gapMs])).toEqual([
      [1, '1', 0],
      [2, '16', 1_500],
      [3, '44', 2_000],
    ])
    // Igual que la clasificación del replay en ese instante.
    const lb = new LeaderboardEngine('race', race({ tower: false, swap: true }).timing, sessionEvents(), drivers)
    expect(lb.compute(s.showMs, []).slice(0, 3).map((r) => r.car)).toEqual(s.rows.map((r) => r.car))
  })

  it('el paso por meta del primero un poco antes del mensaje cuenta como el de la bandera', () => {
    // El estado «Finished» llega 10 s después del paso por meta del líder (dentro del margen).
    const d = race()
    const late = sessionSummary({
      type: 'race',
      timing: timingBuilder()
        .run(1, 0, [90_000, 90_000, 90_000, 90_000], { lap1NoTime: true })
        .run(44, 0, [91_000, 90_500, 90_500], { lap1NoTime: true })
        .sessionStatus(280_000, 'Finished')
        .build(),
      events: d.events,
      drivers,
      playback,
    })
    expect(280_000 - 270_000).toBeLessThan(FLAG_LINE_TOLERANCE_MS)
    // El líder tomó la bandera en 270 000 (su vuelta 4, en 360 000, no cuenta); 44, en 272 000.
    expect(late.showMs).toBe(280_000)
    expect(late.rows.map((r) => r.car)).toEqual(['1', '44'])
  })

  it('menos de tres coches con posición: solo los que la tienen (la interfaz pone «sin dato» en el resto)', () => {
    const timing = timingBuilder()
      .run(1, 0, [90_000, 90_000], { lap1NoTime: true })
      .sessionStatus(180_100, 'Finished')
      .build()
    const s = sessionSummary({ type: 'race', timing, events: sessionEvents(), drivers, playback })
    expect(s.rows.map((r) => r.car)).toEqual(['1'])
    expect(s.rows[0]!.gapMs).toBe(0)
  })

  it('paradas: cuenta la que cambia el stint; un drive-through no es parada; tiempo en el pit lane (salida − entrada)', () => {
    const s = summaryOf('race', race())
    const [p1, p2, p3] = s.rows
    expect(p1!.pits).toEqual([])
    expect(p1!.stints).toEqual(['MEDIUM'])
    expect(p2!.pits).toEqual([{ lap: 2, inMs: 175_000, outMs: 196_000, pitLaneMs: 21_000, kind: 'stop' }])
    expect(p2!.stints).toEqual(['MEDIUM', 'HARD'])
    expect(p3!.pits).toEqual([{ lap: 2, inMs: 178_000, outMs: 199_000, pitLaneMs: 21_000, kind: 'pass' }])
    expect(p3!.stints).toEqual(['SOFT'])
  })
})

describe('pasos por el pit lane', () => {
  const table = (b: ReturnType<typeof timingBuilder>) => buildLapTable('race', b.build(), [])

  it('sin stint, el cambio de compuesto dice que hubo parada; sin ninguno de los dos, sin dato', () => {
    const t = table(
      timingBuilder()
        .lap(1, 1, { startMs: 0, endMs: 90_000, compound: 'SOFT', pitInMs: 85_000 })
        .lap(1, 2, { startMs: 90_000, endMs: 200_000, compound: 'HARD', pitOutMs: 108_000, pitInMs: 195_000 })
        .lap(1, 3, { startMs: 200_000, endMs: 300_000, compound: 'HARD', pitOutMs: 220_000 }),
    )
    expect(pitVisits(t.cars.get('1')!, Infinity).map((v) => [v.lap, v.kind, v.pitLaneMs])).toEqual([
      [1, 'stop', 23_000],
      [2, 'unknown', 25_000],
    ])
  })

  it('sin salida hasta el fin: tiempo sin dato; las entradas después del fin no cuentan; la salida del pit lane en la vuelta 1 no es parada', () => {
    const t = table(
      timingBuilder()
        .lap(1, 1, { startMs: 0, endMs: 90_000, stint: 1, pitOutMs: 5_000 })
        .lap(1, 2, { startMs: 90_000, endMs: 180_000, stint: 1, pitInMs: 175_000 })
        .lap(1, 3, { startMs: 180_000, endMs: 270_000, stint: 2, pitOutMs: 200_000, pitInMs: 265_000 }),
    )
    const laps = t.cars.get('1')!
    expect(pitVisits(laps, 190_000)).toEqual([{ lap: 2, inMs: 175_000, outMs: null, pitLaneMs: null, kind: 'stop' }])
    expect(pitVisits(laps, 300_000).map((v) => [v.lap, v.outMs, v.kind])).toEqual([
      [2, 200_000, 'stop'],
      [3, null, 'unknown'],
    ])
  })

  it('compuestos por stint, en orden, hasta el fin (S → M → H); el compuesto desconocido se rellena con el primero conocido', () => {
    const t = table(
      timingBuilder()
        .lap(1, 1, { startMs: 0, endMs: 90_000, stint: 1 })
        .lap(1, 2, { startMs: 90_000, endMs: 180_000, stint: 1, compound: 'SOFT' })
        .lap(1, 3, { startMs: 180_000, endMs: 270_000, stint: 2, compound: 'MEDIUM' })
        .lap(1, 4, { startMs: 270_000, endMs: 360_000, stint: 3, compound: 'HARD' })
        .lap(1, 5, { startMs: 360_000, endMs: 450_000, stint: 4, compound: 'HARD' }),
    )
    const laps = t.cars.get('1')!
    expect(stintCompounds(laps, Infinity)).toEqual(['SOFT', 'MEDIUM', 'HARD', 'HARD'])
    expect(stintCompounds(laps, 300_000)).toEqual(['SOFT', 'MEDIUM', 'HARD'])
  })
})

describe('vuelta rápida', () => {
  it('salta las anuladas antes del fin y las vueltas 1 sin tiempo; una anulada después del fin aún cuenta; a igualdad, la primera', () => {
    const timing = timingBuilder()
      .run(1, 0, [80_000, 90_000, 89_000], { lap1NoTime: true, each: (i) => (i === 2 ? { deleted: true } : {}) })
      .run(44, 0, [81_000, 89_500, 89_500], { lap1NoTime: true })
      .run(16, 0, [82_000, 89_400, 95_000], { lap1NoTime: true, each: (i) => (i === 1 ? { deleted: true } : {}) })
      .build()
    // 1 (89,000, vuelta 3) se anula en 270 000; 16 (89,400, vuelta 2) se anula en 300 000, después del fin.
    const rc = [lapDeletedMessage(270_000, '1', 89_000), lapDeletedMessage(300_000, '16', 89_400)]
    const t = buildLapTable('race', timing, rc)
    expect(fastestLap(t, drivers, 280_000)).toMatchObject({ car: '16', lap: 2, lapMs: 89_400, atMs: 171_400 })
    expect(fastestLap(t, drivers, 280_000)!.driver?.tla).toBe('CCC')
    // Después de anularse la de 16: empate a 89,500 de 44 (vueltas 2 y 3): la primera.
    expect(fastestLap(t, drivers, 310_000)).toMatchObject({ car: '44', lap: 2, lapMs: 89_500 })
    // Antes de que acabe ninguna vuelta con tiempo: sin dato.
    expect(fastestLap(t, drivers, 100_000)).toBeNull()
  })
})

describe('libres y clasificación: por mejor vuelta', () => {
  it('la tarjeta espera a las vueltas cronometradas empezadas antes de la bandera; mejor vuelta, gap y vueltas', () => {
    // Bandera a cuadros en 300 000 (sin «Finished»). 44 empezó en 255 000 una vuelta que acaba en 340 000 y es la
    // mejor; la de 16 empezó después de la bandera y no se espera.
    const timing = timingBuilder()
      .run(1, 0, [100_000, 92_000, 91_000], { firstLap: 1 })
      .run(44, 10_000, [100_000, 93_000, 52_000], { each: (i) => (i === 2 ? { lapMs: -1 } : {}) })
      .lap(44, 4, { startMs: 255_000, endMs: 340_000, lapMs: 85_000 })
      .run(16, 0, [100_000, 95_000], {})
      .lap(16, 3, { startMs: 301_000, endMs: 381_000, lapMs: 80_000 })
      .build()
    const events = sessionEvents({ raceControl: [rcMessage(300_000, 'chequered_flag')] })
    const s = sessionSummary({ type: 'fp1', timing, events, drivers, playback })
    expect(s.race).toBe(false)
    expect(s.end).toEqual({ t: 300_000, source: 'chequered' })
    expect(s.showMs).toBe(340_000)
    expect(s.rows.map((r) => [r.position, r.car, r.bestLapMs, r.gapMs, r.laps, r.pits])).toEqual([
      [1, '44', 85_000, 0, 4, null],
      [2, '1', 91_000, 6_000, 3, null],
      [3, '16', 95_000, 10_000, 2, null],
    ])
    expect(s.fastest).toMatchObject({ car: '44', lap: 4, lapMs: 85_000 })
  })
})

describe('apertura de la tarjeta', () => {
  it('solo al cruzar el instante reproduciendo, nunca con un salto del reloj', () => {
    expect(crossedSummary(999, 1_000, 1_000, false)).toBe(true)
    expect(crossedSummary(900, 1_100, 1_000, false)).toBe(true)
    expect(crossedSummary(900, 1_100, 1_000, true)).toBe(false)
    expect(crossedSummary(1_000, 1_100, 1_000, false)).toBe(false)
    expect(crossedSummary(900, 999, 1_000, false)).toBe(false)
    expect(crossedSummary(Number.NaN, 1_100, 1_000, false)).toBe(false)
  })
})

describe('fixture e2e (Spa 2026, libres 1)', () => {
  it('fin por «Finished» dentro de la reproducción; los tres primeros, los de la clasificación en ese instante', async () => {
    const data = await loadFixture()
    const { playback: pb, type } = data.manifest.session
    const lb = new LeaderboardEngine(type, data.timing, data.events, data.manifest.drivers)
    const t0 = performance.now()
    const s = sessionSummary({ type, timing: data.timing, events: data.events, drivers: data.manifest.drivers, playback: pb, leaderboard: lb })
    // Se calcula en el hilo principal al abrir el replay: barato (< 10 ms).
    expect(performance.now() - t0).toBeLessThan(50)
    expect(s.end).toEqual({ t: 4_416_887, source: 'finished' })
    expect(s.showMs).toBeGreaterThan(s.end.t)
    expect(s.showMs).toBeLessThan(pb.endMs)
    const model = new ReplayModel(carTracks(data.motion, data.tangents), circuitModel(data.circuit), data.manifest.drivers)
    model.update(s.showMs)
    const shown = lb.compute(s.showMs, model.states).slice(0, 3)
    expect(s.rows.map((r) => r.car)).toEqual(shown.map((r) => r.car))
    expect(s.rows.map((r) => r.bestLapMs)).toEqual(shown.map((r) => r.bestLapMs))
    expect(s.rows.every((r) => r.laps !== null && r.laps > 0 && r.pits === null)).toBe(true)
    expect(s.fastest).toMatchObject({ car: '3', lap: 9, lapMs: 107_070 })
  })
})
