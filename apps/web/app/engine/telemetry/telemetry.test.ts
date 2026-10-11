import { describe, expect, it } from 'vitest'
import { loadFixture } from '../../testing/fixture'
import { drsState, MAX_SAMPLE_AGE_MS, Telemetry } from './telemetry'

describe('telemetría: la muestra cruda vigente', () => {
  it('coincide con la última muestra con t ≤ reloj, sin interpolar', async () => {
    const s = await loadFixture()
    const tel = new Telemetry(s.car)
    const cars = s.car.tables.cars!
    const T = s.car.tables.tel!.columns
    let checked = 0
    for (let k = 0; k < cars.rows; k++) {
      const car = String(cars.columns.car![k])
      const start = cars.columns.start![k]!
      const count = cars.columns.count![k]!
      for (let i = start + 1; i < start + count - 1; i += 97) {
        const mid = (T.t![i]! + T.t![i + 1]!) / 2 // entre dos muestras: vale la anterior
        const smp = tel.sampleAt(car, mid)
        if (T.t![i + 1]! - T.t![i]! > MAX_SAMPLE_AGE_MS) continue
        expect(smp).not.toBeNull()
        expect(smp!.t).toBe(T.t![i])
        expect(smp!.speedKmh).toBe(T.speed![i])
        expect(smp!.rpm).toBe(T.rpm![i])
        expect(smp!.gear).toBe(T.gear![i])
        expect(smp!.throttle).toBe(T.throttle![i] === 255 ? null : T.throttle![i])
        expect(smp!.brake).toBe(T.brake![i]! > 0)
        expect(smp!.drsRaw).toBeNull() // 2026: sin canal DRS
        checked++
      }
    }
    expect(checked).toBeGreaterThan(100)
  })

  it('sin muestra reciente → null; ventana de gráficas por índices', async () => {
    const s = await loadFixture()
    const tel = new Telemetry(s.car)
    const car = String(s.car.tables.cars!.columns.car![0])
    const series = tel.seriesOf(car)!
    expect(tel.sampleAt(car, series.t[0]! - 1)).toBeNull()
    expect(tel.sampleAt(car, series.t[series.t.length - 1]! + MAX_SAMPLE_AGE_MS + 1)).toBeNull()
    const t1 = series.t[200]!
    const [from, to] = tel.windowOf(car, t1 - 20_000, t1)
    expect(series.t[from]!).toBeGreaterThanOrEqual(t1 - 20_000)
    expect(series.t[to - 1]!).toBe(t1)
    expect(from === 0 || series.t[from - 1]! < t1 - 20_000).toBe(true)
  })

  it('estados del DRS', () => {
    expect(drsState(null)).toBeNull()
    expect([0, 1, 8, 10, 12, 14].map(drsState)).toEqual(['closed', 'closed', 'available', 'open', 'open', 'open'])
  })

  it('un código de DRS sin significado conocido es «sin dato», nunca «cerrado» ni «abierto»', () => {
    expect([2, 3, 9, 11, 13, 15, 254].map(drsState)).toEqual(Array(7).fill('unknown'))
  })
})
