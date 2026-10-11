import type { DriverInfo } from '@trazada/schema'
import { describe, expect, it } from 'vitest'
import {
  type ChartGroup,
  type ChartSpec,
  driverStyles,
  endPoints,
  HIT_PX,
  type HitFrame,
  hitTest,
  lastValueIndex,
  nearestIndex,
  placeLabels,
  spreadLabels,
} from './chart'

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
    const col = (y: number, first = false) => ({ x: 500, y, w: 40, rank: first ? (1 as const) : (2 as const) })
    expect(
      placeLabels(
        [
          col(100), // a su altura
          col(104), // pisaría a la anterior: sin sigla (movida, se leería como de otra serie)
          col(111), // a 11 de la primera: cabe
          col(300), // sola
          { x: 200, y: 102, w: 30, rank: 2 }, // junto a su final, lejos en horizontal: no choca con la columna
          { x: 220, y: 104, w: 30, rank: 2 }, // se solapa con la anterior: sin sigla
          { x: 260, y: 104, w: 30, rank: 2 }, // ya no se solapa en horizontal: a su altura
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

  it('resaltada (D49): un detenido va junto a su final; se coloca antes que la destacada y que el resto', () => {
    const group = (key: string, extra: Partial<ChartGroup> = {}): ChartGroup => ({
      key,
      label: key.toUpperCase(),
      color: '#123456',
      dash: false,
      visible: true,
      emphasis: false,
      ...extra,
    })
    const spec: ChartSpec = {
      x: [1, 2, 3],
      series: [
        { group: 'a', mark: 'line', values: [0, 0, 0] },
        { group: 'b', mark: 'line', values: [1, null, null] },
      ],
      groups: [group('a'), group('b', { stopped: true })],
      xRange: null,
      yRange: null,
      yDir: 1,
      xIncrs: null,
      formatX: String,
      formatY: String,
      labelColumn: true,
    }
    expect(endPoints(spec).map((e) => e.place)).toEqual(['column', 'none'])
    expect(endPoints(spec, 'b').map((e) => e.place)).toEqual(['column', 'inline'])
    // Orden de colocación: la resaltada, la destacada y luego de arriba abajo, aunque estén más abajo.
    const spots = [
      { x: 0, y: 10, w: 40, rank: 2 as const },
      { x: 0, y: 14, w: 40, rank: 1 as const },
      { x: 0, y: 18, w: 40, rank: 0 as const },
    ]
    expect(placeLabels(spots, { gap: 11, lo: 0, hi: 400 })).toEqual([null, null, 18])
    expect(placeLabels(spots.slice(0, 2), { gap: 11, lo: 0, hi: 400 })).toEqual([null, 14])
    expect(placeLabels([spots[0]!, { ...spots[1]!, y: 30 }], { gap: 11, lo: 0, hi: 400 })).toEqual([10, 30])
  })
})

describe('qué serie toca el puntero (D49)', () => {
  const group = (key: string, extra: Partial<ChartGroup> = {}): ChartGroup => ({
    key,
    label: key.toUpperCase(),
    color: '#123456',
    dash: false,
    visible: true,
    emphasis: false,
    ...extra,
  })
  /** Un px por segundo en y (de 0 a 100 s en 100 px) y 50 px por vuelta en x, con el área de datos en (64, 8). */
  const frame: HitFrame = {
    bbox: { left: 64, top: 8, width: 450, height: 100 },
    xPos: (v) => 64 + (v - 1) * 50,
    yPos: (v) => 8 + v,
    xVal: (px) => (px - 64) / 50 + 1,
  }
  const base = (series: ChartSpec['series'], groups: ChartGroup[], extra: Partial<ChartSpec> = {}): ChartSpec => ({
    x: Array.from({ length: 10 }, (_, i) => i + 1),
    series,
    groups,
    xRange: null,
    yRange: null,
    yDir: 1,
    xIncrs: null,
    formatX: String,
    formatY: String,
    labelColumn: true,
    ...extra,
  })

  // ALB cae 40 s en una vuelta (de la 6 a la 7); NOR va plano a 10 s; COL solo tiene la vuelta 1 (un punto suelto);
  // BOT se detiene en la 4 (a 60 s).
  const spec = base(
    [
      { group: 'NOR', mark: 'line', values: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10] },
      { group: 'ALB', mark: 'line', values: [20, 20, 20, 20, 20, 20, 60, 60, null, null] },
      { group: 'COL', mark: 'line', values: [90, null, null, null, null, null, null, null, null, null] },
      { group: 'BOT', mark: 'line', values: [70, 70, 70, 60, null, null, null, null, null, null] },
    ],
    [group('NOR'), group('ALB'), group('COL'), group('BOT', { stopped: true })],
  )

  it('en un tramo empinado se toca a 1 px de la recta, con el índice que elegiría un clic', () => {
    // Entre la vuelta 6 (x 314, y 28) y la 7 (x 364, y 68): en x 339 la recta pasa por y 48.
    const hit = hitTest(spec, frame, 339, 49, HIT_PX.fine)
    expect(hit?.key).toBe('ALB')
    expect(hit?.index).toBe(nearestIndex(spec.x, frame.xVal(339)))
    // Lejos de cualquier serie (más de 12 px), nada.
    expect(hitTest(spec, frame, 339, 49 + 30, HIT_PX.fine)).toBeNull()
    // Con el dedo (22 px), algo más lejos sí.
    expect(hitTest(spec, frame, 339, 48 + 20, HIT_PX.coarse)?.key).toBe('ALB')
    expect(hitTest(spec, frame, 339, 48 + 20, HIT_PX.fine)).toBeNull()
  })

  it('las series ocultas no cuentan', () => {
    const hidden = { ...spec, groups: spec.groups.map((g) => (g.key === 'ALB' ? { ...g, visible: false } : g)) }
    expect(hitTest(hidden, frame, 339, 49, HIT_PX.fine)).toBeNull()
  })

  it('un punto suelto (vuelta 1) se toca; y el final de un detenido hasta su raya', () => {
    expect(hitTest(spec, frame, 66, 99, HIT_PX.fine)).toEqual({ key: 'COL', index: 0 })
    // BOT acaba en la vuelta 4 (x 214, y 68): su raya va 6 px a la derecha.
    expect(hitTest(spec, frame, 220, 69, HIT_PX.fine)).toEqual({ key: 'BOT', index: 3 })
    // Más allá de la raya y de 12 px, nada.
    expect(hitTest(spec, frame, 240, 69, HIT_PX.fine)).toBeNull()
  })

  it('a igual distancia gana la destacada; si no, la primera de la lista', () => {
    // Dos series iguales.
    const twin = base(
      [
        { group: 'A', mark: 'line', values: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10] },
        { group: 'B', mark: 'line', values: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10] },
      ],
      [group('A'), group('B')],
    )
    expect(hitTest(twin, frame, 200, 18, HIT_PX.fine)?.key).toBe('A')
    const emph = { ...twin, groups: [group('A'), group('B', { emphasis: true })] }
    expect(hitTest(emph, frame, 200, 18, HIT_PX.fine)?.key).toBe('B')
  })

  it('una sigla dibujada gana a una línea más cercana (con el final de su serie como índice)', () => {
    const rects = [{ key: 'BOT', x0: 330, x1: 360, y0: 13, y1: 24 }]
    // En (339, 18) NOR está a 0 px; la sigla de BOT lo contiene.
    expect(hitTest(spec, frame, 339, 18, HIT_PX.fine)?.key).toBe('NOR')
    expect(hitTest(spec, frame, 339, 18, HIT_PX.fine, rects)).toEqual({ key: 'BOT', index: 3 })
    // La sigla de una serie oculta, no.
    const hidden = { ...spec, groups: spec.groups.map((g) => (g.key === 'BOT' ? { ...g, visible: false } : g)) }
    expect(hitTest(hidden, frame, 339, 18, HIT_PX.fine, rects)?.key).toBe('NOR')
  })

  it('gráficas de puntos: el punto más cercano; el índice, el suyo si en el x más cercano no tiene valor', () => {
    // Por hora: un x por vuelta de cualquier coche (aquí, 3,4 entre la 3 y la 5). A tiene puntos en los índices 0, 2 y
    // 4; B (aspas) en 1 y 3.
    const dots = base(
      [
        { group: 'A', mark: 'dot', values: [30, null, 40, null, 50, null, null, null, null, null] },
        { group: 'A', mark: 'hollow', values: [null, null, null, null, null, 80, null, null, null, null] },
        { group: 'B', mark: 'cross', values: [null, 35, null, 80, null, null, null, null, null, null] },
      ],
      [group('A'), group('B')],
      { labelColumn: false, x: [1, 2, 3, 3.4, 5, 6, 7, 8, 9, 10] },
    )
    // A 14 px del punto de A en el índice 2 (x 164, y 48), pero más cerca en x del índice 3 (x 184), donde A no tiene
    // valor: índice 2.
    expect(nearestIndex(dots.x, frame.xVal(178))).toBe(3)
    expect(hitTest(dots, frame, 178, 48, HIT_PX.coarse)).toEqual({ key: 'A', index: 2 })
    expect(hitTest(dots, frame, 184, 86, HIT_PX.fine)).toEqual({ key: 'B', index: 3 })
    // El punto hueco cuenta como uno más de A.
    expect(hitTest(dots, frame, 314, 88, HIT_PX.fine)).toEqual({ key: 'A', index: 5 })
    // Un punto fuera del área de datos (recortado) no se toca.
    const off = { ...dots, series: [{ group: 'A', mark: 'dot' as const, values: [200, null, null, null, null, null, null, null, null, null] }] }
    expect(hitTest(off, frame, 64, 108, HIT_PX.coarse)).toBeNull()
  })
})
