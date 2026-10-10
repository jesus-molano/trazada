/** Colores de sector con la carrera de Japón de data/ (solo en local; se salta si no existe). */
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LOCAL_DATA_ROOT, loadLocal } from '../../testing/fixture'
import { buildLapTable } from '../analysis/lapTable'
import { SectorTimes } from './sectors'

const JAPAN = '2026/03-suzuka/race'
const hasJapan = existsSync(`${LOCAL_DATA_ROOT}v1/sessions/${JAPAN}/manifest.json`)

describe.skipIf(!hasJapan)('colores de sector de la carrera de Japón (local)', () => {
  it('precálculo dentro del presupuesto del hilo principal; morados en los tres sectores', async () => {
    const s = await loadLocal(JAPAN)
    const table = buildLapTable(s.manifest.session.type, s.timing, s.events.raceControl)
    const t0 = performance.now()
    const st = new SectorTimes(table)
    // Plan §5: < 10 ms con Japón en el hilo principal al abrir el replay; margen para máquinas lentas.
    expect(performance.now() - t0).toBeLessThan(50)
    // ~1100 vueltas con sus tres sectores (faltan muy pocos).
    expect(st.timedSectors).toBeGreaterThan(2500)

    const best = [0, 0, 0]
    for (const [car, laps] of table.cars) {
      for (let k = 0; k < laps.lap.length; k++) {
        const cross = laps.crossMs[k]!
        if (!(cross > 0)) continue
        const x = st.lastLap(car, cross)!
        x.sectors.forEach((c, i) => {
          if (c.status === 'best') best[i]!++
          // Sin tiempo, siempre «sin dato»; con tiempo, nunca.
          expect(c.status === 'none').toBe(c.ms === null)
        })
      }
    }
    for (const n of best) expect(n).toBeGreaterThan(0)
  })
})
