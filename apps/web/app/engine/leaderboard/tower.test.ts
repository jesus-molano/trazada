/**
 * La torre oficial tal cual (`LeaderboardEngine.towerAt`), para la realización automática (ítem 9): su intervalo es la
 * única cifra que puede enseñar, así que aquí no entra nada calculado con pasos por meta ni con mejores vueltas.
 */
import type { DriverInfo } from '@trazada/schema'
import { describe, expect, it } from 'vitest'
import { sessionEvents, timingBuilder } from '../../testing/laps'
import { LeaderboardEngine } from './leaderboard'

const drivers: DriverInfo[] = ['1', '44', '16'].map((number) => ({
  number,
  tla: `T${number}`,
  first: '',
  last: '',
  team: '',
  color: '#123456',
}))

describe('torre oficial en un instante', () => {
  const timing = timingBuilder()
    .run(1, 0, [90_000, 90_000], { lap1NoTime: true })
    .run(44, 0, [91_000, 91_000], { lap1NoTime: true })
    .run(16, 0, [92_000, 92_000], { lap1NoTime: true })
    .towerAt(10_000, 1, { position: 1 })
    .towerAt(10_000, 44, { position: 2, intervalMs: 800, gapMs: 800 })
    .towerAt(10_000, 16, { position: 3, intervalMs: 1200, gapMs: 2000 })
    .towerAt(50_000, 44, { position: 1 })
    .towerAt(50_000, 1, { position: 2, intervalMs: 300, gapMs: 300 })
    .build()

  it('posición e intervalo de la última fila de cada coche hasta t; −1 es sin dato (null)', () => {
    const lb = new LeaderboardEngine('race', timing, sessionEvents(), drivers)
    expect(lb.hasTower).toBe(true)
    const at = (t: number) => Object.fromEntries(lb.towerAt(t).map((e) => [e.car, [e.position, e.intervalMs]]))
    expect(lb.towerAt(5_000)).toEqual([])
    expect(at(20_000)).toEqual({ '1': [1, null], '44': [2, 800], '16': [3, 1200] })
    expect(at(60_000)).toEqual({ '1': [2, 300], '44': [1, null], '16': [3, 1200] })
  })

  it('sin torre, vacía (aunque la clasificación calcule intervalos con los pasos por meta)', () => {
    const noTower = timingBuilder()
      .run(1, 0, [90_000, 90_000], { lap1NoTime: true })
      .run(44, 0, [91_000, 91_000], { lap1NoTime: true })
      .build()
    const lb = new LeaderboardEngine('race', noTower, sessionEvents(), drivers)
    expect(lb.hasTower).toBe(false)
    expect(lb.towerAt(200_000)).toEqual([])
    const rows = lb.compute(200_000, [])
    expect(rows.find((r) => r.car === '44')!.intervalMs).toBe(2000)
  })
})
