/** Leaderboard frente al cronometraje en una carrera completa (local). */
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LOCAL_DATA_ROOT, loadLocal } from '../../testing/fixture'
import { lapsView } from '../data/columns'
import { carTracks } from '../replay/motion'
import { ReplayModel } from '../replay/ReplayModel'
import { circuitModel } from '../track/circuit'
import { LeaderboardEngine } from './leaderboard'

const RACE = '2026/03-suzuka/race'
const hasRace = existsSync(`${LOCAL_DATA_ROOT}v1/sessions/${RACE}/manifest.json`)

describe.skipIf(!hasRace)('leaderboard en Japón 2026 (local)', () => {
  it('al final de cada vuelta, la posición = Laps.Position', async () => {
    const s = await loadLocal(RACE)
    const model = new ReplayModel(carTracks(s.motion, s.tangents), circuitModel(s.circuit), s.manifest.drivers)
    const lb = new LeaderboardEngine('race', s.timing, s.events, s.manifest.drivers)
    const laps = lapsView(s.timing)
    let total = 0
    let ok = 0
    const misses: string[] = []
    for (let i = 0; i < laps.rows; i++) {
      const end = laps.endMs[i]!
      const pos = laps.position[i]!
      if (end <= 0 || pos <= 0) continue
      model.update(end)
      const row = lb.compute(end, model.states).find((r) => r.car === String(laps.car[i]))!
      total++
      if (row.position === pos) ok++
      else if (misses.length < 5) misses.push(`${laps.car[i]} v${laps.lap[i]}: ${row.position} ≠ ${pos}`)
    }
    console.log(`posición = Laps.Position en ${ok}/${total}`, misses)
    expect(ok / total).toBeGreaterThanOrEqual(0.99)
  })
})
