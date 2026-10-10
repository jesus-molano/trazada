import type { DriverInfo } from '@trazada/schema'
import { describe, expect, it } from 'vitest'
import { driverStyles, lastValueIndex, nearestIndex, spreadLabels } from './chart'

const driver = (number: string, tla: string, team: string, color = '#123456'): DriverInfo => ({
  number,
  tla,
  first: '',
  last: '',
  team,
  color,
})

describe('gráficas de análisis', () => {
  it('estilo por piloto: sigla, color de equipo y discontinuo para el segundo de cada equipo', () => {
    const styles = driverStyles([driver('1', 'AAA', 'X'), driver('44', 'BBB', 'Y'), driver('16', 'CCC', 'X'), driver('9', '', 'Z')])
    expect(styles.get('1')).toEqual({ label: 'AAA', color: '#123456', dash: false })
    expect(styles.get('16')!.dash).toBe(true)
    expect(styles.get('44')!.dash).toBe(false)
    // Sin sigla, el número (la serie nunca queda sin nombre).
    expect(styles.get('9')!.label).toBe('9')
  })

  it('índice más cercano (a igual distancia, el anterior)', () => {
    expect(nearestIndex([], 3)).toBe(-1)
    expect(nearestIndex([1, 2, 3, 4], 2.4)).toBe(1)
    expect(nearestIndex([1, 2, 3, 4], 2.5)).toBe(1)
    expect(nearestIndex([1, 2, 3, 4], 2.6)).toBe(2)
    expect(nearestIndex([1, 2, 3, 4], -10)).toBe(0)
    expect(nearestIndex([1, 2, 3, 4], 99)).toBe(3)
    expect(nearestIndex([10, 20], Number.NaN)).toBe(-1)
  })

  it('rótulos sin pisarse, dentro del rango y en el orden de entrada', () => {
    expect(spreadLabels([50, 10, 52], 10, 0, 100)).toEqual([50, 10, 60])
    // Al fondo no caben: se empujan hacia arriba.
    expect(spreadLabels([98, 99, 100], 10, 0, 100)).toEqual([80, 90, 100])
    expect(spreadLabels([], 10, 0, 100)).toEqual([])
  })

  it('último índice con valor', () => {
    expect(lastValueIndex([[1, null, null], [null, 2, null]])).toBe(1)
    expect(lastValueIndex([[null], [null]])).toBe(-1)
  })
})
