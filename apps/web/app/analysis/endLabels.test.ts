import { describe, expect, it } from 'vitest'
import type { ChartGroup, ChartSpec } from './chart'
import { columnPlotHeight, drawEndLabels, type LabelFrame, PLOT_PAD_TOP, X_AXIS_SIZE } from './endLabels'

/** Lienzo 2D que graba lo que se dibuja (con la alineación del texto en cada `fillText`). */
function recorder() {
  const log = {
    text: [] as { text: string; x: number; y: number; align: string; baseline: string }[],
    rects: [] as { x: number; y: number; w: number; h: number; fill: string }[],
    lines: [] as { x0: number; y0: number; x1: number; y1: number }[],
    saves: 0,
    restores: 0,
  }
  let from = { x: 0, y: 0 }
  const ctx = {
    // Lo que dejaría uPlot tras dibujar su eje y.
    textAlign: 'right',
    textBaseline: 'alphabetic',
    font: '',
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    save: () => log.saves++,
    restore: () => log.restores++,
    measureText: (s: string) => ({ width: s.length * 6 }),
    fillText(text: string, x: number, y: number) {
      log.text.push({ text, x, y, align: this.textAlign, baseline: this.textBaseline })
    },
    fillRect(x: number, y: number, w: number, h: number) {
      log.rects.push({ x, y, w, h, fill: this.fillStyle })
    },
    beginPath: () => {},
    moveTo: (x: number, y: number) => (from = { x, y }),
    lineTo: (x: number, y: number) => log.lines.push({ x0: from.x, y0: from.y, x1: x, y1: y }),
    stroke: () => {},
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, log }
}

const LAPS = 53
const group = (key: string, extra: Partial<ChartGroup> = {}): ChartGroup => ({
  key,
  label: key,
  color: `#0000${String(key.length).padStart(2, '0')}`,
  dash: false,
  visible: true,
  emphasis: false,
  ...extra,
})
/** Serie de gap que acaba en la vuelta `last` con el valor `end`. */
const values = (last: number, end: number) => Array.from({ length: LAPS }, (_, i) => (i < last ? (end * (i + 1)) / last : null))

/**
 * Final de una carrera: 17 coches apiñados arriba (0 a 16 s), dos doblados (ALB acaba en la 51 a +190 s, BOT en la 52
 * a +150 s) y STR, detenido en la 30.
 */
function race(extra: Partial<Record<string, Partial<ChartGroup>>> = {}, labelColumn = true): ChartSpec {
  const close = Array.from({ length: 17 }, (_, i) => `C${String(i).padStart(2, '0')}`)
  const ends: [string, number, number][] = [...close.map((k, i): [string, number, number] => [k, LAPS, i]), ['ALB', 51, 190], ['BOT', 52, 150], ['STR', 30, 40]]
  return {
    x: Array.from({ length: LAPS }, (_, i) => i + 1),
    series: ends.map(([k, last, end]) => ({ group: k, mark: 'line' as const, values: values(last, end) })),
    groups: ends.map(([k]) => group(k, { ...(k === 'STR' ? { stopped: true } : {}), ...extra[k] })),
    xRange: [1, LAPS],
    yRange: [0, 200],
    yDir: -1,
    xIncrs: null,
    formatX: String,
    formatY: String,
    labelColumn,
  }
}

/** Marco con el alto que da el componente para `n` siglas en el margen (r = 1). */
function frame(n: number): LabelFrame & { right: number } {
  const bbox = { left: 64, top: PLOT_PAD_TOP, width: 800, height: columnPlotHeight(n) - PLOT_PAD_TOP - X_AXIS_SIZE }
  return {
    r: 1,
    bbox,
    right: bbox.left + bbox.width,
    xPos: (v) => bbox.left + ((v - 1) / (LAPS - 1)) * bbox.width,
    yPos: (v) => bbox.top + (v / 200) * bbox.height,
  }
}

const style = { font: '10px sans', text: '#ffffff', connector: '#888888' }

describe('siglas de las gráficas de análisis', () => {
  it('por vuelta: todas en el margen derecho, alineadas a la izquierda, dentro del lienzo y sin pisarse', () => {
    const { ctx, log } = recorder()
    const f = frame(19)
    drawEndLabels(ctx, f, race(), style)
    // 19 siglas: todas menos la del detenido.
    expect(log.text.map((t) => t.text).sort()).toEqual(race().groups.filter((g) => !g.stopped).map((g) => g.label).sort())
    for (const t of log.text) {
      expect(t.align, t.text).toBe('left')
      expect(t.baseline).toBe('middle')
      expect(t.x, t.text).toBeGreaterThanOrEqual(f.right)
      expect(t.y, t.text).toBeGreaterThanOrEqual(f.bbox.top)
      expect(t.y, t.text).toBeLessThanOrEqual(f.bbox.top + f.bbox.height)
    }
    const ys = log.text.map((t) => t.y).sort((a, b) => a - b)
    for (let i = 1; i < ys.length; i++) expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(11 - 1e-9)
    expect(log.saves).toBe(1)
    expect(log.restores).toBe(1)
  })

  it('nada en el área de datos que parezca un dato: ni guías ni puntos; el trazo que une una sigla, solo en el margen', () => {
    const { ctx, log } = recorder()
    const f = frame(19)
    drawEndLabels(ctx, f, race(), style)
    // Dentro del área de datos solo está la raya del detenido, justo después de su último dato (vuelta 30).
    const inside = log.rects.filter((r) => r.x < f.right)
    expect(inside).toHaveLength(1)
    expect(inside[0]!.x).toBeGreaterThan(f.xPos(30))
    expect(inside[0]!.x).toBeLessThan(f.xPos(31))
    for (const l of log.lines) {
      expect(l.x0).toBeGreaterThanOrEqual(f.right)
      expect(l.x1).toBeGreaterThanOrEqual(f.right)
    }
    // Hay trazos (los coches apiñados se separan), y empiezan a la altura del dato de su serie.
    expect(log.lines.length).toBeGreaterThan(0)
  })

  it('un doblado lleva su sigla en el margen a la altura de su último dato; si se separa, un trazo la une con ella', () => {
    // Con sitio de sobra, a su altura y sin trazo.
    const roomy = recorder()
    const big = frame(40)
    drawEndLabels(roomy.ctx, big, race(), style)
    const albBig = roomy.log.text.find((t) => t.text === 'ALB')!
    expect(albBig.y).toBeCloseTo(big.yPos(190))
    expect(roomy.log.lines.some((l) => Math.abs(l.y0 - big.yPos(190)) < 1e-6)).toBe(false)
    // Con la columna llena, se separa: el trazo sale del margen a la altura de su dato y llega a la sigla.
    const { ctx, log } = recorder()
    const f = frame(19)
    drawEndLabels(ctx, f, race(), style)
    const alb = log.text.find((t) => t.text === 'ALB')!
    expect(alb.y).not.toBeCloseTo(f.yPos(190))
    const line = log.lines.find((l) => Math.abs(l.y0 - f.yPos(190)) < 1e-6)!
    expect(line.y1).toBeCloseTo(alb.y)
    expect(line.x1).toBeLessThan(alb.x)
  })

  it('si no caben (gráfica más baja de lo que pide `columnPlotHeight`), se juntan, pero nunca salen del lienzo', () => {
    const { ctx, log } = recorder()
    const f = frame(8)
    drawEndLabels(ctx, f, race(), style)
    expect(log.text).toHaveLength(19)
    for (const t of log.text) {
      expect(t.y, t.text).toBeGreaterThanOrEqual(f.bbox.top)
      expect(t.y, t.text).toBeLessThanOrEqual(f.bbox.top + f.bbox.height)
    }
  })

  it('el detenido destacado lleva su sigla junto a su final, después de su raya', () => {
    const { ctx, log } = recorder()
    const f = frame(19)
    drawEndLabels(ctx, f, race({ STR: { emphasis: true } }), style)
    const str = log.text.find((t) => t.text === 'STR')!
    expect(str.align).toBe('left')
    // Raya a 6 px de su último dato; la sigla, 13 px después (como cualquier sigla junto a su final).
    expect(str.x).toBeCloseTo(f.xPos(30) + 6 + 13)
    expect(str.y).toBeCloseTo(f.yPos(40))
  })

  it('por hora (sin margen): cada sigla empieza junto a su final; sin trazos', () => {
    const { ctx, log } = recorder()
    const f = frame(40)
    drawEndLabels(ctx, f, race({}, false), style)
    const alb = log.text.find((t) => t.text === 'ALB')!
    expect(alb.align).toBe('left')
    expect(alb.x).toBeCloseTo(f.xPos(51) + 13)
    expect(log.text.find((t) => t.text === 'C00')!.x).toBeCloseTo(f.xPos(LAPS) + 13)
    expect(log.lines).toHaveLength(0)
  })
})
