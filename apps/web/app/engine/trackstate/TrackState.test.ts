import type { SessionEvents } from '@trazada/schema'
import { describe, expect, it } from 'vitest'
import { loadFixture } from '../../testing/fixture'
import { TrackState, visibleCount } from './TrackState'

const events = (over: Partial<SessionEvents>): SessionEvents => ({
  schema: 'trazada.events',
  schemaVersion: '1.0.0',
  raceControl: [],
  sectorFlags: [],
  windows: [],
  ...over,
})

describe('TrackState (sintético)', () => {
  const ts = new TrackState(
    events({
      sectorFlags: [
        { sector: 3, flag: 'YELLOW', fromMs: 1000, toMs: 5000 },
        { sector: 3, flag: 'DOUBLE YELLOW', fromMs: 2000, toMs: 3000 },
        { sector: 9, flag: 'RED', fromMs: 4000, toMs: null },
      ],
      windows: [
        { kind: 'yellow', fromMs: 1000, toMs: 5000 },
        { kind: 'vsc', fromMs: 6000, toMs: 7000 },
        { kind: 'vsc-ending', fromMs: 7000, toMs: 7500 },
        { kind: 'sc', fromMs: 8000, toMs: 9000 },
        { kind: 'red', fromMs: 8500, toMs: null },
        { kind: 'overtake', fromMs: 0, toMs: 6000 },
        { kind: 'drs', fromMs: 9500, toMs: 9800 },
      ],
    }),
    10_000,
  )

  it('sectores: intervalo semiabierto, la bandera más grave manda y un toMs nulo dura hasta el final', () => {
    ts.update(999)
    expect(ts.snapshot.sectors).toEqual({})
    ts.update(1000)
    expect(ts.snapshot.sectors).toEqual({ 3: 'YELLOW' })
    ts.update(2500)
    expect(ts.snapshot.sectors).toEqual({ 3: 'DOUBLE YELLOW' })
    ts.update(3000)
    expect(ts.snapshot.sectors).toEqual({ 3: 'YELLOW' })
    ts.update(4500)
    expect(ts.snapshot.sectors).toEqual({ 3: 'YELLOW', 9: 'RED' })
    ts.update(9999)
    expect(ts.snapshot.sectors).toEqual({ 9: 'RED' })
    ts.update(10_000)
    expect(ts.snapshot.sectors).toEqual({})
  })

  it('neutralizaciones con prioridad roja > SC > VSC > fin de VSC; amarilla, overtake y DRS aparte', () => {
    const at = (t: number) => (ts.update(t), ts.snapshot)
    expect(at(500)).toMatchObject({ neutral: null, yellow: false, overtake: true, drs: false })
    expect(at(1500)).toMatchObject({ neutral: null, yellow: true, overtake: true })
    expect(at(6100).neutral).toBe('vsc')
    expect(at(6100).overtake).toBe(false)
    expect(at(7100).neutral).toBe('vsc-ending')
    expect(at(7600).neutral).toBe(null)
    expect(at(8100).neutral).toBe('sc')
    expect(at(8600).neutral).toBe('red')
    expect(at(9600)).toMatchObject({ neutral: 'red', drs: true })
  })

  it('solo cambia de versión (y de objeto) cuando cambia el estado', () => {
    ts.update(100)
    const v = ts.version
    const snap = ts.snapshot
    expect(ts.update(200)).toBe(false)
    expect(ts.version).toBe(v)
    expect(ts.snapshot).toBe(snap)
    expect(ts.update(1100)).toBe(true)
    expect(ts.version).toBe(v + 1)
    expect(ts.snapshot).not.toBe(snap)
  })
})

describe('visibleCount', () => {
  it('cuenta los t ≤ reloj (empates incluidos)', () => {
    const t = [10, 20, 20, 30]
    expect([0, 10, 19, 20, 29, 30, 99].map((x) => visibleCount(t, x))).toEqual([0, 1, 1, 3, 3, 4, 4])
    expect(visibleCount([], 5)).toBe(0)
  })
})

describe('TrackState sobre el fixture (Bélgica FP1)', () => {
  it('1 s después de DOUBLE YELLOW IN TRACK SECTOR 7, el 7 está en doble amarilla; 1 s después del CLEAR, neutro', async () => {
    const s = await loadFixture()
    const rc = s.events.raceControl
    const on = rc.find((e) => e.text === 'DOUBLE YELLOW IN TRACK SECTOR 7')!
    const off = rc.find((e) => e.text === 'CLEAR IN TRACK SECTOR 7' && e.t > on.t)!
    const ts = new TrackState(s.events, s.manifest.session.playback.endMs)
    ts.update(on.t + 1000)
    expect(ts.snapshot.sectors[7]).toBe('DOUBLE YELLOW')
    ts.update(off.t + 1000)
    expect(ts.snapshot.sectors[7]).toBeUndefined()
  })
})
