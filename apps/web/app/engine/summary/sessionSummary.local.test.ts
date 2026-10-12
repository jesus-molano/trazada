/** Resumen de fin de sesión con la carrera de Japón de data/ (solo en local; se salta si no existe). */
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LOCAL_DATA_ROOT, loadLocal } from '../../testing/fixture'
import { LeaderboardEngine } from '../leaderboard/leaderboard'
import { carTracks } from '../replay/motion'
import { ReplayModel } from '../replay/ReplayModel'
import { buildTimelineMarkers } from '../timeline/markers'
import { circuitModel } from '../track/circuit'
import { sessionSummary } from './sessionSummary'

const JAPAN = '2026/03-suzuka/race'
const hasJapan = existsSync(`${LOCAL_DATA_ROOT}v1/sessions/${JAPAN}/manifest.json`)

describe.skipIf(!hasJapan)('resumen de la carrera de Japón (local)', () => {
  it('fin con la bandera (sin «Finished» en la fuente dev) y podio igual que la clasificación en ese instante', async () => {
    const s = await loadLocal(JAPAN)
    const { type, playback } = s.manifest.session
    const lb = new LeaderboardEngine(type, s.timing, s.events, s.manifest.drivers)
    const t0 = performance.now()
    const summary = sessionSummary({ type, timing: s.timing, events: s.events, drivers: s.manifest.drivers, playback, leaderboard: lb })
    // En el hilo principal al abrir el replay (< 10 ms con Japón; margen para máquinas lentas).
    expect(performance.now() - t0).toBeLessThan(50)
    expect(['finished', 'chequered']).toContain(summary.end.source)
    expect(summary.showMs).toBeGreaterThanOrEqual(summary.end.t)
    expect(summary.showMs).toBeLessThanOrEqual(playback.endMs)
    expect(summary.rows).toHaveLength(3)

    const model = new ReplayModel(carTracks(s.motion, s.tangents), circuitModel(s.circuit), s.manifest.drivers)
    model.update(summary.showMs)
    const shown = lb.compute(summary.showMs, model.states).slice(0, 3)
    expect(summary.rows.map((r) => r.car)).toEqual(shown.map((r) => r.car))
    // La vuelta 1 de una carrera no tiene tiempo oficial: nunca es la vuelta rápida.
    expect(summary.fastest?.lap).toBeGreaterThan(1)
  })

  it('las entradas al pit lane de cada uno del podio son las de los marcadores del timeline', async () => {
    const s = await loadLocal(JAPAN)
    const { type, playback } = s.manifest.session
    const summary = sessionSummary({ type, timing: s.timing, events: s.events, drivers: s.manifest.drivers, playback })
    const markers = buildTimelineMarkers(type, s.timing, s.events, playback.endMs)
    for (const r of summary.rows) {
      const expected = markers.pits.filter((p) => p.car === r.car && p.inMs <= summary.showMs)
      expect(r.pits!.map((v) => v.inMs)).toEqual(expected.map((p) => p.inMs))
      expect(r.pits!.map((v) => v.outMs)).toEqual(expected.map((p) => (p.outMs !== null && p.outMs <= summary.showMs ? p.outMs : null)))
      // Cada parada cambia de stint: al menos un compuesto más por parada.
      expect(r.stints.length).toBeGreaterThanOrEqual(1 + r.pits!.filter((v) => v.kind === 'stop').length)
    }
  })
})
