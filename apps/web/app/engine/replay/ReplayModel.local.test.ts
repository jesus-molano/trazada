/**
 * Motor frente al cronometraje (local): en el instante en que cada piloto termina cada vuelta, su puesto
 * por distancia recorrida coincide con Laps.Position (sin contar a quien está en el pit lane).
 */
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LOCAL_DATA_ROOT, loadLocal } from '../../testing/fixture'
import { lapsView } from '../data/columns'
import { circuitModel } from '../track/circuit'
import { carTracks } from './motion'
import { ReplayModel } from './ReplayModel'

const RACE = '2026/03-suzuka/race'
const hasRace = existsSync(`${LOCAL_DATA_ROOT}v1/sessions/${RACE}/manifest.json`)

describe.skipIf(!hasRace)('orden del motor frente a Laps.Position (local)', () => {
  it('≥ 95 % de los pares piloto-vuelta coinciden', async () => {
    const s = await loadLocal(RACE)
    const model = new ReplayModel(carTracks(s.motion, s.tangents), circuitModel(s.circuit), s.manifest.drivers)
    const laps = lapsView(s.timing)
    let total = 0
    let ok = 0
    for (let i = 0; i < laps.rows; i++) {
      const end = laps.endMs[i]!
      const position = laps.position[i]!
      if (end <= 0 || position <= 0 || laps.lap[i]! < 2) continue
      model.update(end)
      const car = String(laps.car[i])
      const me = model.states.find((st) => st.car === car)
      if (!me?.visible || me.inPit) continue
      const rank = model.orderByDistance().findIndex((st) => st.car === car) + 1
      total++
      if (rank === position) ok++
    }
    console.log(`orden por s = Laps.Position en ${ok}/${total} (${((100 * ok) / total).toFixed(1)} %)`)
    expect(total).toBeGreaterThan(500)
    expect(ok / total).toBeGreaterThanOrEqual(0.95)
  })
})
