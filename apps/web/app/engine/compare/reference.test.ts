import { describe, expect, it } from 'vitest'
import { lapDeletedMessage, timingBuilder } from '../../testing/laps'
import { buildLapTable } from '../analysis/lapTable'
import { COMPARE_REFS, defaultCompareRef, isCompareRef, referenceLap } from './reference'

describe('referencia por defecto', () => {
  it('misma vuelta en carrera y sprint; mejor vuelta en libres y clasificación', () => {
    expect(defaultCompareRef('race')).toBe('same')
    expect(defaultCompareRef('sprint')).toBe('same')
    for (const type of ['fp1', 'fp2', 'fp3', 'q', 'sq'] as const) expect(defaultCompareRef(type)).toBe('best')
    expect(COMPARE_REFS.every(isCompareRef)).toBe(true)
    expect(isCompareRef('fastest')).toBe(false)
  })
})

describe('vuelta de referencia de B', () => {
  // B: vuelta 1 (la más rápida, pero es la 1), 2 sin tiempo oficial, 3 la mejor válida, 4 más rápida pero anulada a
  // los 500 s, 5 lenta, 6 empieza a los 600 s y acaba a los 690 s.
  const timing = timingBuilder()
    .lap(2, 1, { startMs: 0, endMs: 80_000, lapMs: 80_000 })
    .lap(2, 2, { startMs: 80_000, endMs: 175_000 })
    .lap(2, 3, { startMs: 175_000, endMs: 265_000, lapMs: 90_000 })
    .lap(2, 4, { startMs: 265_000, endMs: 350_000, lapMs: 85_000, deleted: true })
    .lap(2, 5, { startMs: 350_000, endMs: 600_000, lapMs: 250_000 })
    .lap(2, 6, { startMs: 600_000, endMs: 690_000, lapMs: 90_000 })
    .build()
  const laps = buildLapTable('fp1', timing, [lapDeletedMessage(500_000, '2', 85_000)]).cars.get('2')!
  const lapOf = (r: ReturnType<typeof referenceLap>) => (r.ok ? laps.lap[r.j] : r.reason)

  it('misma vuelta: la de B con el mismo número, si ya había empezado', () => {
    expect(lapOf(referenceLap(laps, 'same', 3, 0, 200_000))).toBe(3)
    expect(lapOf(referenceLap(laps, 'same', 6, 0, 599_999))).toBe('notStarted')
    expect(lapOf(referenceLap(laps, 'same', 6, 0, 600_000))).toBe(6)
    expect(lapOf(referenceLap(laps, 'same', 9, 0, 1e9))).toBe('noLap')
  })

  it('mejor vuelta: la más rápida con tiempo oficial completada al empezar A; nunca la 1 ni una anulada', () => {
    // Al empezar A su vuelta a los 400 s: la 4 (85 s) aún no está anulada, pero en el instante actual (550 s) sí.
    expect(lapOf(referenceLap(laps, 'best', 7, 400_000, 450_000))).toBe(4)
    expect(lapOf(referenceLap(laps, 'best', 7, 400_000, 550_000))).toBe(3)
    // Fijada al empezar A: la 6 (cerrada a los 690 s) no cuenta para una vuelta de A empezada a los 650 s.
    expect(lapOf(referenceLap(laps, 'best', 7, 650_000, 1e9))).toBe(3)
    // Solo la vuelta 1 completada: no hay mejor vuelta.
    expect(lapOf(referenceLap(laps, 'best', 2, 100_000, 100_000))).toBe('noLap')
    expect(lapOf(referenceLap(laps, 'best', 2, 0, 100_000))).toBe('noLap')
  })

  it('última vuelta: la última completada al empezar A (también sin tiempo oficial), nunca la 1', () => {
    expect(lapOf(referenceLap(laps, 'last', 7, 180_000, 200_000))).toBe(2)
    expect(lapOf(referenceLap(laps, 'last', 7, 700_000, 750_000))).toBe(6)
    expect(lapOf(referenceLap(laps, 'last', 7, 100_000, 100_000))).toBe('noLap')
    // Nada del futuro: ni lo cerrado después del instante actual.
    expect(lapOf(referenceLap(laps, 'last', 7, 700_000, 650_000))).toBe(5)
  })
})
