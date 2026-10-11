/** Estado de pista en Japón 2026 (local; fuente dev, no publicable). */
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LOCAL_DATA_ROOT, loadLocal } from '../../testing/fixture'
import { TrackState } from './TrackState'

const RACE = '2026/03-suzuka/race'
const hasRace = existsSync(`${LOCAL_DATA_ROOT}v1/sessions/${RACE}/manifest.json`)

describe.skipIf(!hasRace)('estado de pista en Japón 2026 (local)', () => {
  it('sector 21: amarillo 1 s después del mensaje y neutro 1 s después del CLEAR', async () => {
    const s = await loadLocal(RACE)
    const rc = s.events.raceControl
    const yellow = rc.find((e) => e.text === 'YELLOW IN TRACK SECTOR 21')!
    const clear = rc.find((e) => e.text === 'CLEAR IN TRACK SECTOR 21' && e.t > yellow.t)!
    const ts = new TrackState(s.events, s.manifest.session.playback.endMs)
    ts.update(yellow.t + 1000)
    expect(ts.snapshot.sectors[21]).toMatch(/YELLOW/)
    ts.update(clear.t + 1000)
    expect(ts.snapshot.sectors[21]).toBeUndefined()
  })

  it('cada ventana de SC, VSC o roja está activa 100 ms después de empezar', async () => {
    const s = await loadLocal(RACE)
    const ts = new TrackState(s.events, s.manifest.session.playback.endMs)
    const neutral = s.events.windows.filter((w) => w.kind === 'sc' || w.kind === 'vsc' || w.kind === 'red')
    expect(neutral.length).toBeGreaterThan(0)
    for (const w of neutral) {
      ts.update(w.fromMs + 100)
      expect(ts.snapshot.neutral).toBe(w.kind)
    }
  })

  it('OVERTAKE: el safety car cierra la ventana y el segundo ENABLED la reabre', async () => {
    const s = await loadLocal(RACE)
    const sc = s.events.windows.find((w) => w.kind === 'sc')!
    const ts = new TrackState(s.events, s.manifest.session.playback.endMs)
    ts.update(sc.fromMs - 1000)
    expect(ts.snapshot.overtake).toBe(true)
    ts.update(sc.fromMs + 100)
    expect(ts.snapshot.overtake).toBe(false)
    const again = s.events.raceControl.find((e) => e.parsed.kind === 'overtake_enabled' && e.t > sc.fromMs)!
    ts.update(again.t + 100)
    expect(ts.snapshot.overtake).toBe(true)
  })
})
