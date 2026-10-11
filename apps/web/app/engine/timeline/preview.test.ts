/** Vista previa del timeline (ítem 16): primero en cada instante, vuelta, estado de pista y marcadores cercanos. */
import type { DecodedTrzb, SessionEvents, SessionType } from '@trazada/schema'
import { describe, expect, it } from 'vitest'
import { lapDeletedMessage, rcMessage, sessionEvents, timingBuilder } from '../../testing/laps'
import { loadFixture } from '../../testing/fixture'
import { LeaderboardEngine } from '../leaderboard/leaderboard'
import { carTracks } from '../replay/motion'
import { ReplayModel } from '../replay/ReplayModel'
import { circuitModel } from '../track/circuit'
import { TrackState } from '../trackstate/TrackState'
import { buildTimelineMarkers } from './markers'
import { createTimelinePreview, TimelinePreview } from './preview'

const END = 1_000_000

function preview(
  type: SessionType,
  timing: DecodedTrzb,
  events: SessionEvents = sessionEvents(),
  over: { lightsOutMs?: number | null; totalLaps?: number | null; estimated?: string[]; startMs?: number } = {},
) {
  const playback = { startMs: over.startMs ?? 0, endMs: END, lightsOutMs: over.lightsOutMs ?? null }
  return new TimelinePreview({
    type,
    timing,
    events,
    playback,
    totalLaps: over.totalLaps ?? null,
    estimated: over.estimated ?? [],
    markers: buildTimelineMarkers(type, timing, events, END),
  })
}

describe('primero con la torre oficial', () => {
  it('el P1 de la torre manda, también en carrera; el relevo llega con su fila', () => {
    const timing = timingBuilder()
      .run(1, 0, [90_000, 90_000])
      .run(44, 0, [91_000, 89_000])
      .order(1000, [1, 44])
      .towerAt(150_000, 44, { position: 1 })
      .towerAt(150_000, 1, { position: 2 })
      .build()
    const p = preview('race', timing)
    expect(p.at(500).leader).toEqual({ basis: 'line', car: null, lapMs: null }) // antes de la torre y de la línea
    expect(p.at(2000).leader).toEqual({ basis: 'tower', car: '1', lapMs: null })
    expect(p.at(149_999).leader.car).toBe('1')
    expect(p.at(150_000).leader).toEqual({ basis: 'tower', car: '44', lapMs: null })
    expect(p.role).toBe('leader')
  })

  it('dos coches reclaman el P1: manda el mensaje más reciente; a la misma hora, sin dato', () => {
    const timing = timingBuilder()
      .run(1, 0, [90_000])
      .run(44, 0, [91_000])
      .towerAt(1000, 1, { position: 1 })
      .towerAt(5000, 44, { position: 1 }) // la fila del 1 sigue diciendo P1 (desacompasada)
      .towerAt(9000, 16, { position: 1 })
      .towerAt(9000, 44, { position: 1 })
      .build()
    const p = preview('race', timing)
    expect(p.at(4000).leader.car).toBe('1')
    expect(p.at(6000).leader.car).toBe('44')
    expect(p.at(9500).leader).toEqual({ basis: 'tower', car: null, lapMs: null })
  })

  it('una torre sin posiciones (todas 0) no manda: se usa la línea de meta', () => {
    const timing = timingBuilder()
      .run(1, 0, [90_000, 90_000])
      .run(44, 0, [91_000, 90_000])
      .towerAt(1000, 1, { position: 0 })
      .towerAt(1000, 44, { position: 0 })
      .build()
    const p = preview('race', timing)
    expect(p.at(95_000).leader).toEqual({ basis: 'line', car: '1', lapMs: null })
  })

  it('torre sin P1 pero con otras posiciones: sin dato (nunca el siguiente de la lista)', () => {
    const timing = timingBuilder().run(1, 0, [90_000]).towerAt(1000, 44, { position: 2 }).build()
    expect(preview('race', timing).at(95_000).leader).toEqual({ basis: 'tower', car: null, lapMs: null })
  })

  it('solo cuentan los coches de la lista de pilotos (como en la clasificación)', () => {
    const timing = timingBuilder()
      .run(1, 0, [90_000, 90_000])
      .run(99, 0, [89_000, 89_000])
      .towerAt(1000, 99, { position: 1 })
      .build()
    const events = sessionEvents()
    const only = new TimelinePreview({
      type: 'race',
      timing,
      events,
      playback: { startMs: 0, endMs: END },
      estimated: [],
      cars: ['1'],
      markers: buildTimelineMarkers('race', timing, events, END),
    })
    expect(only.at(95_000).leader).toEqual({ basis: 'line', car: '1', lapMs: null })
    expect(preview('race', timing).at(95_000).leader).toEqual({ basis: 'tower', car: '99', lapMs: null })
  })

  it('fuera de carrera, la torre da el coche y su mejor vuelta de la tanda en curso', () => {
    const timing = timingBuilder()
      .run(1, 0, [100_000, 95_000])
      .run(44, 0, [101_000, 94_000])
      .towerAt(196_000, 1, { position: 1 })
      .build()
    const p = preview('fp1', timing)
    expect(p.role).toBe('bestLap')
    expect(p.at(197_000).leader).toEqual({ basis: 'tower', car: '1', lapMs: 95_000 })
  })
})

describe('primero en carrera sin torre: orden en la línea de meta', () => {
  it('el cambio llega al cruzar la línea, no antes; antes de la primera, sin dato', () => {
    // 44 va detrás en la vuelta 1 y adelanta en la 2: lo cuenta su paso por meta (181 000), no antes.
    const timing = timingBuilder()
      .run(1, 0, [90_000, 92_000], { lap1NoTime: true })
      .run(44, 0, [91_000, 90_000], { lap1NoTime: true })
      .build()
    const p = preview('race', timing, sessionEvents(), { lightsOutMs: 0 })
    expect(p.at(89_999).leader).toEqual({ basis: 'line', car: null, lapMs: null })
    expect(p.at(90_000).leader.car).toBe('1')
    expect(p.at(180_999).leader.car).toBe('1')
    expect(p.at(181_000).leader.car).toBe('44')
    expect(p.leaders.fallback.map((c) => [c.t, c.car])).toEqual([
      [90_000, '1'],
      [181_000, '44'],
    ])
  })

  it('la vuelta residual de un retirado no cuenta como paso por meta', () => {
    // 16 se retira: su «vuelta 3» dura 5 s (registro residual) y no le da la cabeza con 3 vueltas.
    const timing = timingBuilder()
      .run(1, 0, [90_000, 90_000, 90_000])
      .run(16, 0, [91_000, 90_000])
      .lap(16, 3, { startMs: 181_000, endMs: 186_000, lapMs: 5_000 })
      .build()
    const p = preview('race', timing)
    expect(p.at(186_500).leader.car).toBe('1')
    expect(p.at(270_000).leader.car).toBe('1')
  })

  it('un empate exacto en la línea es sin dato (no se deshace con la posición en pista)', () => {
    const timing = timingBuilder().run(1, 0, [90_000]).run(44, 0, [90_000]).build()
    expect(preview('race', timing).at(95_000).leader).toEqual({ basis: 'line', car: null, lapMs: null })
  })

  it('coincide con el primero de la clasificación en cada instante', () => {
    const timing = timingBuilder()
      .run(1, 0, [90_000, 92_000, 95_000, 90_000], { lap1NoTime: true })
      .run(44, 0, [91_000, 90_000, 91_000, 99_000], { lap1NoTime: true })
      .run(16, 0, [92_000, 89_500, 90_000, 90_000], { lap1NoTime: true })
      .build()
    const events = sessionEvents()
    const drivers = ['1', '44', '16'].map((number) => ({ number, tla: number, first: '', last: '', team: '', color: '#000000' }))
    const lb = new LeaderboardEngine('race', timing, events, drivers)
    const p = preview('race', timing, events)
    for (let t = 0; t <= 400_000; t += 1000) {
      const row = lb.compute(t, [])[0]!
      expect(p.at(t).leader.car, `t=${t}`).toBe(row.positionKnown ? row.car : null)
    }
  })
})

describe('fuera de carrera sin torre: «Mejor vuelta»', () => {
  it('la mejor vuelta válida hasta t; una anulación la quita desde su mensaje; antes, sin dato', () => {
    const timing = timingBuilder()
      .run(1, 0, [100_000, 95_000])
      .run(44, 0, [101_000, 94_000], { each: (i) => (i === 1 ? { deleted: true } : {}) })
      .build()
    const events = sessionEvents({ raceControl: [lapDeletedMessage(250_000, '44', 94_000)] })
    const p = preview('fp2', timing, events)
    expect(p.role).toBe('bestLap')
    expect(p.at(99_999).leader).toEqual({ basis: 'bestLap', car: null, lapMs: null })
    expect(p.at(100_000).leader).toEqual({ basis: 'bestLap', car: '1', lapMs: 100_000 })
    expect(p.at(195_000).leader).toEqual({ basis: 'bestLap', car: '44', lapMs: 94_000 })
    expect(p.at(250_000).leader).toEqual({ basis: 'bestLap', car: '1', lapMs: 95_000 })
  })

  it('clasificación: en Q2, sin dato hasta el primer tiempo de Q2 (los de Q1 ya no cuentan)', () => {
    const timing = timingBuilder()
      .run(1, 0, [90_000])
      .run(44, 0, [91_000])
      .lap(44, 2, { startMs: 400_000, endMs: 492_000, lapMs: 92_000 })
      .build()
    const events = sessionEvents({ raceControl: [rcMessage(200_000, 'chequered_flag'), rcMessage(300_000, 'green_light')] })
    const p = preview('q', timing, events)
    expect(p.at(250_000).leader).toEqual({ basis: 'bestLap', car: '1', lapMs: 90_000 })
    expect(p.at(300_000).leader).toEqual({ basis: 'bestLap', car: null, lapMs: null })
    expect(p.at(492_000).leader).toEqual({ basis: 'bestLap', car: '44', lapMs: 92_000 })
  })

  it('a igual mejor vuelta, sin dato', () => {
    const timing = timingBuilder().run(1, 0, [100_000]).run(44, 0, [100_000, 100_000]).build()
    expect(preview('fp1', timing).at(150_000).leader.car).toBeNull()
  })
})

describe('vuelta, reloj, estado de pista y marcadores', () => {
  const events = sessionEvents({
    raceControl: [rcMessage(50_000, 'sector_yellow'), rcMessage(52_000, 'red_flag'), rcMessage(5_000_000, 'sector_yellow')],
    sectorFlags: [{ sector: 5, flag: 'YELLOW', fromMs: 50_000, toMs: 60_000 }],
    windows: [
      { kind: 'sc', fromMs: 100_000, toMs: 200_000 },
      { kind: 'red', fromMs: 150_000, toMs: 160_000 },
    ],
  })
  events.raceControl[0]!.sector = 5
  const timing = timingBuilder()
    .run(1, 10_000, [90_000, 90_000, 90_000], { lap1NoTime: true, each: (i) => (i === 1 ? { pitInMs: 175_000 } : {}) })
    .build()

  it('carrera: vuelta del líder con las totales y reloj desde la salida', () => {
    const p = preview('race', timing, events, { lightsOutMs: 10_000, totalLaps: 53 })
    expect(p.at(5_000)).toMatchObject({ lap: null, totalLaps: 53, clockMs: -5_000 })
    expect(p.at(120_000)).toMatchObject({ lap: 2, totalLaps: 53, clockMs: 110_000 })
    expect(preview('race', timing, events, { totalLaps: 0 }).at(120_000).totalLaps).toBeNull()
  })

  it('fuera de carrera, sin vuelta de sesión ni totales', () => {
    expect(preview('fp1', timing, events, { totalLaps: 53 }).at(120_000)).toMatchObject({ lap: null, totalLaps: null })
  })

  it('estado de pista en t (la roja manda sobre el SC), con su propio TrackState: el del reloj no cambia', () => {
    const live = new TrackState(events, END)
    live.update(55_000)
    const before = live.snapshot
    const version = live.version
    const p = preview('race', timing, events)
    expect(p.at(155_000).track.neutral).toBe('red')
    expect(p.at(120_000).track.neutral).toBe('sc')
    expect(p.at(55_000).track.sectors).toEqual({ 5: 'YELLOW' })
    expect(p.at(300_000).track).toMatchObject({ neutral: null, sectors: {}, yellow: false })
    expect(live.snapshot).toBe(before)
    expect(live.version).toBe(version)
  })

  it('estado de pista deducido: trackInferred (la tarjeta lo marca como Estimado)', () => {
    expect(preview('race', timing, events).at(0).trackInferred).toBe(false)
    expect(preview('race', timing, events, { estimated: ['trackStatus'] }).at(0).trackInferred).toBe(true)
  })

  it('marcadores a menos de la tolerancia, del más cercano al más lejano, solo dentro de la reproducción', () => {
    const p = preview('race', timing, events)
    expect(p.at(51_500, 2_000).markers).toEqual([
      { kind: 'flag', t: 52_000, flag: 'red_flag', sector: null },
      { kind: 'flag', t: 50_000, flag: 'sector_yellow', sector: 5 },
    ])
    expect(p.at(176_000, 2_000).markers).toEqual([{ kind: 'pit', t: 175_000, car: '1' }])
    expect(p.at(100_500, 1_000).markers).toEqual([{ kind: 'window', t: 100_000, window: 'sc' }])
    expect(p.at(51_500, 0).markers).toEqual([])
    expect(p.at(5_000_000, 10_000).markers).toEqual([]) // fuera de la reproducción
  })
})

describe('con el fixture (Spa, libres 1)', () => {
  it('desde el runtime; coincide con el primero de la clasificación y se construye rápido', async () => {
    const s = await loadFixture()
    const { type, playback } = s.manifest.session
    const lb = new LeaderboardEngine(type, s.timing, s.events, s.manifest.drivers)
    const markers = buildTimelineMarkers(type, s.timing, s.events, playback.endMs)
    const t0 = performance.now()
    const p = createTimelinePreview({ session: s, markers, leaderboard: lb })
    expect(performance.now() - t0).toBeLessThan(50)
    expect(p.role).toBe('bestLap')
    const model = new ReplayModel(carTracks(s.motion, s.tangents), circuitModel(s.circuit), s.manifest.drivers)
    let compared = 0
    for (let t = playback.startMs; t <= playback.endMs; t += 10_000) {
      model.update(t)
      const rows = lb.compute(t, model.states)
      const at = p.at(t)
      if (rows[0]!.positionKnown && at.leader.car !== null) {
        expect(at.leader.car, `t=${t}`).toBe(rows[0]!.car)
        compared++
      }
    }
    expect(compared).toBeGreaterThan(0)
  })
})
