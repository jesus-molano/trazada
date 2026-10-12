/** Momentos con la carrera de Japón de data/ (solo en local; se salta si no existe). */
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LOCAL_DATA_ROOT, loadLocal } from '../../testing/fixture'
import { buildLapTable } from '../analysis/lapTable'
import { carTracks } from '../replay/motion'
import { duels } from './duels'
import { buildMoments, nextMoment } from './jumps'
import { lineSwaps, overtakes } from './overtakes'

const JAPAN = '2026/03-suzuka/race'
const hasJapan = existsSync(`${LOCAL_DATA_ROOT}v1/sessions/${JAPAN}/manifest.json`)

describe.skipIf(!hasJapan)('momentos de la carrera de Japón (local)', () => {
  it('adelantamientos confirmados en la línea y situados con el GPS; duelos; todo en pocos ms', async () => {
    const s = await loadLocal(JAPAN)
    const table = buildLapTable(s.manifest.session.type, s.timing, s.events.raceControl)
    const tracks = new Map(carTracks(s.motion, s.tangents).map((t) => [t.car, t]))
    const t0 = performance.now()
    const list = overtakes(table, tracks)
    const d = duels(table, Infinity, list)
    const { startMs, endMs } = s.manifest.session.playback
    const moments = buildMoments({
      overtakes: list,
      duels: d.duels,
      neutralisations: s.events.windows,
      raceControl: [...s.events.raceControl].sort((a, b) => a.t - b.t),
      startMs,
      endMs,
    })
    const ms = performance.now() - t0
    // Otra vez, ya en caliente (en la app el código ya se ha compilado al cargar la sesión).
    const t1 = performance.now()
    duels(table, Infinity, overtakes(table, tracks))
    const warm = performance.now() - t1
    // Presupuesto: < 10 ms en el hilo principal con Japón (margen para máquinas lentas).
    expect(ms).toBeLessThan(50)
    // Estudio del ítem 5: unos 50 cambios de orden en la línea sin boxes, 42 con cruce GPS; ~39 duelos.
    expect(list.length).toBeGreaterThan(20)
    expect(list.length).toBeLessThan(80)
    const located = list.filter((o) => o.atMs !== null)
    expect(located.length / list.length).toBeGreaterThan(0.6)
    for (const o of list) {
      expect(o.lap).toBeGreaterThanOrEqual(2)
      expect(o.gapBeforeMs).toBeLessThan(30_000)
      expect(o.gapAfterMs).toBeLessThan(30_000)
      if (o.atMs !== null) {
        expect(o.atMs).toBeGreaterThanOrEqual(o.fromMs)
        expect(o.atMs).toBeLessThanOrEqual(o.toMs)
      }
    }
    expect(lineSwaps(table).length).toBe(list.length)
    expect(d.status).toBe('ok')
    expect(d.duels.length).toBeGreaterThan(10)
    for (const x of d.duels) {
      expect(x.lastLap - x.firstLap + 1).toBeGreaterThanOrEqual(3)
      expect(x.minGapMs).toBeLessThan(1000)
    }
    expect(moments.length).toBeGreaterThan(list.length)
    expect(nextMoment(moments, startMs)).not.toBeNull()
    console.info(
      `Japón: ${list.length} adelantamientos (${located.length} con instante GPS), ${d.duels.length} duelos, ` +
        `${moments.length} momentos; ${ms.toFixed(1)} ms (${warm.toFixed(1)} ms en caliente)`,
    )
  })
})
