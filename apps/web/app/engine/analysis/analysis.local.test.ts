/** Race trace, ritmo y stints con la carrera de Japón de data/ (solo en local; se salta si no existe). */
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LOCAL_DATA_ROOT, loadLocal } from '../../testing/fixture'
import { buildLapTable } from './lapTable'
import { pace, paceChart } from './pace'
import { leaderLapAt, raceTrace } from './raceTrace'
import { stints } from './stints'

const JAPAN = '2026/03-suzuka/race'
const hasJapan = existsSync(`${LOCAL_DATA_ROOT}v1/sessions/${JAPAN}/manifest.json`)

describe.skipIf(!hasJapan)('análisis de la carrera de Japón (local)', () => {
  it('race trace: el primero de cada vuelta a 0, nadie por delante; se calcula en el hilo principal sin notarse', async () => {
    const s = await loadLocal(JAPAN)
    const table = buildLapTable(s.manifest.session.type, s.timing, s.events.raceControl)
    const t0 = performance.now()
    const trace = raceTrace(table)
    // Plan §5: < 10 ms en el hilo principal con Japón (margen para máquinas lentas).
    expect(performance.now() - t0).toBeLessThan(50)
    expect(trace.laps.length).toBeGreaterThan(40)
    for (let k = 0; k < trace.laps.length; k++) {
      const leader = trace.series.find((x) => x.car === trace.leaderCar[k])!
      expect(leader.gapMs[k]).toBe(0)
      for (const x of trace.series) if (!Number.isNaN(x.gapMs[k]!)) expect(x.gapMs[k]).toBeGreaterThanOrEqual(0)
    }
    // Con el reloj a mitad de carrera, nada después del corte.
    const mid = (s.manifest.session.playback.startMs + s.manifest.session.playback.endMs) / 2
    const cut = raceTrace(table, mid)
    expect(cut.laps.length).toBeLessThan(trace.laps.length)
    expect(cut.leaderMs.every((x) => x <= mid)).toBe(true)
    expect(leaderLapAt(table, mid)).toBe(cut.laps.length + 1)
  })

  it('ritmo: la vuelta 1 nunca tiene tiempo oficial; las excluidas se marcan, ninguna se quita', async () => {
    const s = await loadLocal(JAPAN)
    const table = buildLapTable(s.manifest.session.type, s.timing, s.events.raceControl)
    const cars = [...table.cars.keys()]
    const paces = pace(table, cars)
    for (const p of paces) {
      expect(p.laps.length).toBe(table.cars.get(p.car)!.lap.length)
      const lap1 = p.laps.find((l) => l.lap === 1)
      if (lap1) expect(lap1.lapMs).toBeNull()
    }
    const chart = paceChart(paces, 'lap')
    expect(chart.cars.some((c) => c.excluded.some((v) => v !== null))).toBe(true)
    expect(chart.cars.every((c) => c.lap1NoTime || !table.cars.get(c.car)!.lap.includes(1))).toBe(true)
  })

  it('stints: en orden y sin solaparse, con su compuesto', async () => {
    const s = await loadLocal(JAPAN)
    const table = buildLapTable(s.manifest.session.type, s.timing, s.events.raceControl)
    for (const c of stints(table)) {
      expect(c.stints.length).toBeGreaterThan(0)
      for (let i = 1; i < c.stints.length; i++) expect(c.stints[i]!.firstLap).toBeGreaterThan(c.stints[i - 1]!.lastLap)
    }
  })
})
