import type { SessionEvents } from '@trazada/schema'
import { describe, expect, it } from 'vitest'
import { fakeTrzb, loadFixture } from '../../testing/fixture'
import { buildTimelineMarkers, FLAG_KINDS, leaderLapAt, WINDOW_KINDS } from './markers'

const events = (over: Partial<SessionEvents> = {}): SessionEvents => ({
  schema: 'trazada.events',
  schemaVersion: '1.0.0',
  raceControl: [],
  sectorFlags: [],
  windows: [],
  ...over,
})

// 3 coches, 3 vueltas; el coche 44 para en la vuelta 2 (entra en la 2, sale en la 3).
const timing = fakeTrzb('timing', {
  laps: {
    car: [1, 1, 1, 44, 44, 44, 16, 16],
    lap: [1, 2, 3, 1, 2, 3, 1, 2],
    startMs: [1000, 91000, 181000, 1000, 92000, 190000, 1000, 93000],
    endMs: [91000, 181000, 271000, 92000, 190000, 285000, 93000, 200000],
    lapMs: [-1, 90000, 90000, -1, 98000, 95000, -1, 107000],
    pitInMs: [-1, -1, -1, -1, 185000, -1, -1, -1],
    pitOutMs: [-1, -1, -1, -1, -1, 195000, -1, -1],
    position: [1, 1, 1, 2, 2, 2, 3, 3],
    compound: [2, 2, 2, 2, 2, 3, 2, 2],
    deleted: [0, 0, 0, 0, 0, 0, 0, 0],
  },
})

describe('marcadores del timeline', () => {
  it('una marca por vuelta del líder en carrera; ninguna en libres', () => {
    const m = buildTimelineMarkers('race', timing, events(), 300_000)
    expect(m.laps).toEqual([
      { lap: 1, t: 1000 },
      { lap: 2, t: 91000 },
      { lap: 3, t: 181000 },
    ])
    expect(leaderLapAt(m, 500)).toBe(0)
    expect(leaderLapAt(m, 91000)).toBe(2)
    expect(leaderLapAt(m, 1e9)).toBe(3)
    expect(buildTimelineMarkers('fp1', timing, events(), 300_000).laps).toEqual([])
  })

  it('paradas emparejadas entrada/salida y recuentos de ventanas y banderas', () => {
    const ev = events({
      windows: [
        { kind: 'sc', fromMs: 10, toMs: 20 },
        { kind: 'red', fromMs: 30, toMs: null },
        { kind: 'overtake', fromMs: 0, toMs: 5 },
        { kind: 'yellow', fromMs: 1, toMs: 2 },
      ],
      raceControl: (['red_flag', 'blue_flag', 'chequered_flag', 'sector_yellow'] as const).map((kind, i) => ({
        t: i * 100,
        lap: null,
        category: 'Flag',
        flag: null,
        scope: null,
        sector: kind === 'sector_yellow' ? 7 : null,
        car: null,
        text: kind,
        parsed: { kind, cars: [], turn: null, lap: null },
      })),
    })
    const m = buildTimelineMarkers('race', timing, ev, 300_000)
    expect(m.pits).toEqual([{ car: '44', inMs: 185000, outMs: 195000 }])
    expect(m.windows).toEqual([
      { kind: 'sc', fromMs: 10, toMs: 20 },
      { kind: 'red', fromMs: 30, toMs: 300_000 },
    ])
    expect(m.flags.map((f) => f.kind)).toEqual(['red_flag', 'chequered_flag', 'sector_yellow'])
  })

  it('en el fixture real, los recuentos coinciden con timing y events', async () => {
    const s = await loadFixture()
    const m = buildTimelineMarkers(s.manifest.session.type, s.timing, s.events, s.manifest.session.playback.endMs)
    const pitIns = Array.from(s.timing.tables.laps!.columns.pitInMs!).filter((v) => v >= 0).length
    expect(m.pits.length).toBe(pitIns)
    expect(m.windows.length).toBe(s.events.windows.filter((w) => WINDOW_KINDS.includes(w.kind)).length)
    expect(m.flags.length).toBe(
      s.events.raceControl.filter((e) => (FLAG_KINDS as readonly string[]).includes(e.parsed.kind)).length,
    )
    for (const p of m.pits) if (p.outMs !== null) expect(p.outMs).toBeGreaterThan(p.inMs)
  })
})

describe('origen del reloj', async () => {
  const { clockOrigin } = await import('./markers')
  const status = fakeTrzb('timing', { sessionStatus: { t: [100, 5000, 9000], status: [1, 2, 4] } })
  it('carrera: la salida; libres: el primer Started', () => {
    expect(clockOrigin('race', status, { startMs: 0, lightsOutMs: 7000 })).toBe(7000)
    expect(clockOrigin('fp1', status, { startMs: 0, lightsOutMs: null })).toBe(5000)
    expect(clockOrigin('fp1', fakeTrzb('timing', {}), { startMs: 42 })).toBe(42)
  })
})
