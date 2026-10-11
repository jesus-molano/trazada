import type { DriverInfo } from '@trazada/schema'
import { describe, expect, it } from 'vitest'
import { type ChartGroup, type ChartSpec, driverStyles, endPoints, lastValueIndex, nearestIndex, placeLabels, spreadLabels } from './chart'

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

  it('final de cada serie visible y dónde va su sigla: la que acaba antes, solo marca de fin (destacada, junto a su final)', () => {
    const group = (key: string, extra: Partial<ChartGroup> = {}): ChartGroup => ({
      key,
      label: key.toUpperCase(),
      color: '#123456',
      dash: false,
      visible: true,
      emphasis: false,
      ...extra,
    })
    const spec = (groups: ChartGroup[], labelColumn?: boolean): ChartSpec => ({
      x: [1, 2, 3, 4],
      series: [
        { group: 'a', mark: 'line', values: [0, 0, 0, 0] },
        { group: 'b', mark: 'line', values: [1, 2, null, null] },
        { group: 'c', mark: 'lineDot', values: [3, 4, 5, null] },
        { group: 'c', mark: 'hollow', values: [null, null, null, 6] },
        { group: 'd', mark: 'line', values: [null, null, null, null] },
      ],
      groups,
      xRange: null,
      yRange: null,
      yDir: 1,
      xIncrs: null,
      formatX: String,
      formatY: String,
      labelColumn,
    })
    const ends = (groups: ChartGroup[], labelColumn?: boolean) =>
      endPoints(spec(groups, labelColumn)).map((e) => [e.group.key, e.index, e.value, e.place])
    const all = [group('a'), group('b', { stopped: true }), group('c'), group('d')]
    expect(ends(all)).toEqual([
      ['a', 3, 0, 'inline'],
      ['b', 1, 2, 'none'],
      ['c', 3, 6, 'inline'],
    ])
    expect(ends(all, true)).toEqual([
      ['a', 3, 0, 'column'],
      ['b', 1, 2, 'none'],
      ['c', 3, 6, 'column'],
    ])
    // Destacada, la serie que acaba antes lleva su sigla junto a su final (también con columna); oculta, nada.
    expect(ends([group('a', { visible: false }), group('b', { stopped: true, emphasis: true })], true)).toEqual([['b', 1, 2, 'inline']])
  })

  it('siglas: cada una exactamente a la altura de su dato o ninguna; la destacada, siempre', () => {
    const col = (y: number, first = false) => ({ x: 500, y, w: 40, first })
    expect(
      placeLabels(
        [
          col(100), // a su altura
          col(104), // pisaría a la anterior: sin sigla (movida, se leería como de otra serie)
          col(111), // a 11 de la primera: cabe
          col(300), // sola
          { x: 200, y: 102, w: 30, first: false }, // junto a su final, lejos en horizontal: no choca con la columna
          { x: 220, y: 104, w: 30, first: false }, // se solapa con la anterior: sin sigla
          { x: 260, y: 104, w: 30, first: false }, // ya no se solapa en horizontal: a su altura
        ],
        { gap: 11, lo: 0, hi: 400 },
      ),
    ).toEqual([100, null, 111, 300, 102, null, 104])
    // La destacada se coloca la primera: lleva su sigla aunque otra estuviera antes.
    expect(placeLabels([col(100), col(104, true)], { gap: 11, lo: 0, hi: 400 })).toEqual([null, 104])
    // Fuera de [lo, hi]: en el borde.
    expect(placeLabels([col(-20), col(450)], { gap: 11, lo: 5, hi: 395 })).toEqual([5, 395])
  })

  it('rótulos siempre dentro de [lo, hi]: si no caben a la separación pedida, se juntan lo justo', () => {
    const ys = Array.from({ length: 20 }, (_, i) => 50 + i)
    const out = spreadLabels(ys, 11, 10, 120)
    for (const y of out) {
      expect(y).toBeGreaterThanOrEqual(10)
      expect(y).toBeLessThanOrEqual(120)
    }
    // En orden y repartidos por todo el hueco.
    expect(out[0]).toBeCloseTo(10)
    expect(out[19]).toBeCloseTo(120)
    for (let i = 1; i < 20; i++) expect(out[i]! - out[i - 1]!).toBeCloseTo(110 / 19)
    // Un único rótulo fuera del hueco, al borde.
    expect(spreadLabels([-30], 11, 0, 100)).toEqual([0])
  })
})
