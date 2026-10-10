/** Comprobaciones con sesiones completas de data/ (solo en local; se saltan si no existen). */
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LOCAL_DATA_ROOT, loadLocal } from '../../testing/fixture'
import { buildTimelineMarkers } from './markers'

const JAPAN = '2026/03-suzuka/race'
const hasJapan = existsSync(`${LOCAL_DATA_ROOT}v1/sessions/${JAPAN}/manifest.json`)

describe.skipIf(!hasJapan)('marcadores con la carrera de Japón (local)', () => {
  it('una marca de vuelta por cada vuelta oficial', async () => {
    const s = await loadLocal(JAPAN)
    const m = buildTimelineMarkers('race', s.timing, s.events, s.manifest.session.playback.endMs)
    expect(m.laps.length).toBe(s.manifest.session.totalLaps)
    expect(m.laps[0]!.t).toBe(s.manifest.session.playback.lightsOutMs)
    for (let i = 1; i < m.laps.length; i++) expect(m.laps[i]!.t).toBeGreaterThan(m.laps[i - 1]!.t)
  })
})
