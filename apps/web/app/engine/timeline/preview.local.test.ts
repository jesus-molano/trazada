/** Vista previa del timeline con la carrera de Japón de data/ (solo en local; se salta si no existe). */
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LOCAL_DATA_ROOT, loadLocal } from '../../testing/fixture'
import { LeaderboardEngine } from '../leaderboard/leaderboard'
import { carTracks } from '../replay/motion'
import { ReplayModel } from '../replay/ReplayModel'
import { circuitModel } from '../track/circuit'
import { buildTimelineMarkers, leaderLapAt } from './markers'
import { createTimelinePreview } from './preview'

const JAPAN = '2026/03-suzuka/race'
const hasJapan = existsSync(`${LOCAL_DATA_ROOT}v1/sessions/${JAPAN}/manifest.json`)

describe.skipIf(!hasJapan)('vista previa de la carrera de Japón (local)', () => {
  it('se construye en el hilo principal en poco tiempo y cada consulta es barata', async () => {
    const s = await loadLocal(JAPAN)
    const { type, playback } = s.manifest.session
    const lb = new LeaderboardEngine(type, s.timing, s.events, s.manifest.drivers)
    const markers = buildTimelineMarkers(type, s.timing, s.events, playback.endMs)
    const t0 = performance.now()
    const p = createTimelinePreview({ session: s, markers, leaderboard: lb })
    // Plan §5: < 10 ms con Japón; margen para máquinas lentas.
    expect(performance.now() - t0).toBeLessThan(50)
    const t1 = performance.now()
    const n = 2000
    for (let i = 0; i < n; i++) p.at(playback.startMs + ((playback.endMs - playback.startMs) * i) / n, 30_000)
    expect((performance.now() - t1) / n).toBeLessThan(0.5)
  })

  it('«Líder» igual que el primero de la clasificación; vuelta del dock; SC con su estado deducido', async () => {
    const s = await loadLocal(JAPAN)
    const { type, playback } = s.manifest.session
    const lb = new LeaderboardEngine(type, s.timing, s.events, s.manifest.drivers)
    const markers = buildTimelineMarkers(type, s.timing, s.events, playback.endMs)
    const p = createTimelinePreview({ session: s, markers, leaderboard: lb })
    expect(p.role).toBe('leader')
    const model = new ReplayModel(carTracks(s.motion, s.tangents), circuitModel(s.circuit), s.manifest.drivers)
    let compared = 0
    for (let t = playback.startMs; t <= playback.endMs; t += 20_000) {
      model.update(t)
      const row = lb.compute(t, model.states)[0]!
      const at = p.at(t)
      expect(at.lap ?? 0).toBe(leaderLapAt(markers, t))
      if (row.positionKnown && at.leader.car !== null) {
        expect(at.leader.car, `t=${t}`).toBe(row.car)
        compared++
      }
    }
    expect(compared).toBeGreaterThan(50)
    const sc = markers.windows.find((w) => w.kind === 'sc')
    expect(sc).toBeDefined()
    const inSc = p.at(sc!.fromMs + 1000)
    expect(inSc.track.neutral).toBe('sc')
    expect(inSc.trackInferred).toBe(s.manifest.quality.estimated.includes('trackStatus'))
  })
})
