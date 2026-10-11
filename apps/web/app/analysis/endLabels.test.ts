import { describe, expect, it } from 'vitest'
import type { ChartGroup, ChartSpec } from './chart'
import { drawEndLabels, LABEL_GAP, type LabelFrame } from './endLabels'

type Pt = { x: number; y: number }

/** Lienzo 2D que graba lo que se dibuja (con la alineación del texto en cada `fillText`). */
function recorder() {
  const log = {
    text: [] as { text: string; x: number; y: number; align: string; baseline: string }[],
    rects: [] as { x: number; y: number; w: number; h: number; fill: string }[],
    /** Trazos (`stroke`): la polilínea y su color. */
    strokes: [] as { pts: Pt[]; color: string }[],
    /** Rellenos de un camino (`fill`): sus puntos (los arcos, por su centro) y su color. */
    fills: [] as { pts: Pt[]; arcs: number; color: string }[],
    saves: 0,
    restores: 0,
  }
  let path: Pt[] = []
  let arcs = 0
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
    beginPath: () => {
      path = []
      arcs = 0
    },
    moveTo: (x: number, y: number) => path.push({ x, y }),
    lineTo: (x: number, y: number) => path.push({ x, y }),
    arc: (x: number, y: number) => {
      path.push({ x, y })
      arcs++
    },
    closePath: () => {},
    stroke() {
      log.strokes.push({ pts: [...path], color: this.strokeStyle })
    },
    fill() {
      log.fills.push({ pts: [...path], arcs, color: this.fillStyle })
    },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, log }
}

const LAPS = 53
/** Color de cada equipo de mentira, distinto del de los trazos (`style.connector`). */
const color = (key: string) => `#00${key.charCodeAt(0).toString(16)}${key.charCodeAt(1).toString(16)}`.slice(0, 7).padEnd(7, '0')
const group = (key: string, extra: Partial<ChartGroup> = {}): ChartGroup => ({
  key,
  label: key,
  color: color(key),
  dash: false,
  visible: true,
  emphasis: false,
  ...extra,
})
/** Serie de gap que acaba en la vuelta `last` con el valor `end`. */
const values = (last: number, end: number) => Array.from({ length: LAPS }, (_, i) => (i < last ? (end * (i + 1)) / last : null))

/**
 * Final de una carrera: 17 coches apiñados arriba (0 a 16 s, uno por segundo), dos doblados (ALB acaba en la 51 a
 * +190 s, BOT en la 52 a +150 s) y STR, detenido en la 30.
 */
const CLOSE = Array.from({ length: 17 }, (_, i) => `C${String.fromCharCode(65 + i)}`)
type Opts = { labelColumn?: boolean; yMax?: number; mark?: 'line' | 'dot'; extraEnds?: [string, number, number][] }
function race(extra: Partial<Record<string, Partial<ChartGroup>>> = {}, o: Opts = {}): ChartSpec {
  const ends: [string, number, number][] = [
    ...CLOSE.map((k, i): [string, number, number] => [k, LAPS, i]),
    ['ALB', 51, 190],
    ['BOT', 52, 150],
    ['STR', 30, 40],
    ...(o.extraEnds ?? []),
  ]
  return {
    x: Array.from({ length: LAPS }, (_, i) => i + 1),
    series: ends.map(([k, last, end]) => ({ group: k, mark: o.mark ?? 'line', values: values(last, end) })),
    groups: ends.map(([k]) => group(k, { ...(k === 'STR' ? { stopped: true } : {}), ...extra[k] })),
    xRange: [1, LAPS],
    yRange: [0, o.yMax ?? 200],
    yDir: -1,
    xIncrs: null,
    formatX: String,
    formatY: String,
    labelColumn: o.labelColumn ?? true,
  }
}

/** Marco de una gráfica de 200 px de alto (el mínimo de la hoja), r = 1; `lastX`: la x del borde derecho. */
function frame(yMax = 200, lastX = LAPS): LabelFrame & { right: number; bottom: number } {
  const bbox = { left: 64, top: 8, width: 800, height: 142 }
  return {
    r: 1,
    bbox,
    right: bbox.left + bbox.width,
    bottom: bbox.top + bbox.height,
    xPos: (v) => bbox.left + ((v - 1) / (lastX - 1)) * bbox.width,
    yPos: (v) => bbox.top + (v / yMax) * bbox.height,
  }
}

const style = { font: '10px sans', text: '#ffffff' }
/** Altura de su dato (dentro del área de las siglas, a 5 px de los bordes). */
const home = (f: ReturnType<typeof frame>, v: number) => Math.min(Math.max(f.yPos(v), f.bbox.top + 5), f.bottom - 5)
const lastValue = (spec: ChartSpec, key: string) => {
  const v = spec.series.find((s) => s.group === key)!.values
  return v.filter((x) => x !== null).at(-1)!
}
const triangles = (log: ReturnType<typeof recorder>['log']) => log.fills.filter((p) => p.arcs === 0 && p.pts.length === 3)

describe('siglas de las gráficas de análisis', () => {
  it('por vuelta: en columna tras el último dato, alineadas a la izquierda, sin pisarse y exactamente a la altura de su dato', () => {
    const { ctx, log } = recorder()
    const f = frame()
    const spec = race()
    drawEndLabels(ctx, f, spec, style)
    expect(log.text.map((t) => t.text).sort()).toEqual(['ALB', 'BOT', 'CA'])
    for (const t of log.text) {
      expect(t.align, t.text).toBe('left')
      expect(t.baseline).toBe('middle')
      expect(t.x, t.text).toBeGreaterThanOrEqual(f.right)
      expect(t.y, t.text).toBeCloseTo(home(f, lastValue(spec, t.text)))
    }
    const ys = log.text.map((t) => t.y).sort((a, b) => a - b)
    for (let i = 1; i < ys.length; i++) expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(LABEL_GAP - 1e-9)
    expect(log.saves).toBe(1)
    expect(log.restores).toBe(1)
  })

  it('las que pisarían a otra no llevan sigla (la leyenda las nombra); el detenido, tampoco', () => {
    const { ctx, log } = recorder()
    drawEndLabels(ctx, frame(), race(), style)
    const drawn = new Set(log.text.map((t) => t.text))
    // 17 coches en 12 px: solo cabe uno a su altura.
    expect(CLOSE.filter((k) => drawn.has(k))).toEqual(['CA'])
    expect(drawn.has('ALB')).toBe(true)
    expect(drawn.has('BOT')).toBe(true)
    expect(drawn.has('STR')).toBe(false)
  })

  it('el coche destacado siempre lleva su sigla, a la altura de su dato', () => {
    const { ctx, log } = recorder()
    const f = frame()
    // CH queda en medio del pelotón: sin destacar, no tendría sitio.
    drawEndLabels(ctx, f, race({ CH: { emphasis: true } }), style)
    expect(log.text.find((t) => t.text === 'CH')!.y).toBeCloseTo(home(f, 7))
  })

  it('nada que pueda leerse como dato: ni trazos ni puntos; en el área de datos, solo la raya del detenido', () => {
    const { ctx, log } = recorder()
    const f = frame()
    drawEndLabels(ctx, f, race(), style)
    expect(log.strokes).toHaveLength(0)
    expect(log.fills).toHaveLength(0)
    const inside = log.rects.filter((r) => r.x < f.right)
    expect(inside).toHaveLength(1)
    expect(inside[0]!.h).toBe(10)
    expect(inside[0]!.x).toBeGreaterThan(f.xPos(30))
    expect(inside[0]!.x).toBeLessThan(f.xPos(31))
  })

  it('con «Sin spoilers» (el eje llega a la vuelta en curso), la columna va justo tras el último dato, no al borde', () => {
    const { ctx, log } = recorder()
    // El eje acaba en la vuelta 54, sin datos: la columna, tras la 53.
    const f = frame(200, LAPS + 1)
    drawEndLabels(ctx, f, race(), style)
    for (const t of log.text) {
      expect(t.x, t.text).toBeGreaterThan(f.xPos(LAPS))
      expect(t.x, t.text).toBeLessThan(f.xPos(LAPS) + 20)
    }
  })

  it('un doblado lleva su sigla a la altura de su dato (sin nada entre su final y la columna)', () => {
    const { ctx, log } = recorder()
    const f = frame()
    drawEndLabels(ctx, f, race(), style)
    expect(log.text.find((t) => t.text === 'ALB')!.y).toBeCloseTo(f.yPos(190))
    expect(log.text.find((t) => t.text === 'BOT')!.y).toBeCloseTo(f.yPos(150))
  })

  it('último dato fuera de la escala: en el borde con un triángulo hacia el dato (arriba o abajo); sin raya', () => {
    const { ctx, log } = recorder()
    // Escala hasta 100 s: ALB (+190) y BOT (+150) quedan por debajo; NEG (−20), por encima (destacado: si no, el borde
    // de arriba es de CA, que va antes).
    const f = frame(100)
    drawEndLabels(ctx, f, race({ NEG: { emphasis: true } }, { yMax: 100, extraEnds: [['NEG', LAPS, -20]] }), style)
    expect(log.text.find((t) => t.text === 'NEG')!.y).toBeCloseTo(f.bbox.top + 5)
    const tri = triangles(log)
    expect(tri).toHaveLength(2) // NEG y uno de los dos de abajo (el otro pisaría y no lleva)
    const up = tri.filter((t) => t.pts[2]!.y < t.pts[0]!.y)
    const down = tri.filter((t) => t.pts[2]!.y > t.pts[0]!.y)
    expect(up).toHaveLength(1)
    expect(down).toHaveLength(1)
    expect(up[0]!.pts[0]!.y).toBeLessThan(f.bbox.top + 15)
    expect(down[0]!.pts[0]!.y).toBeGreaterThan(f.bottom - 15)
    // STR (+40) se ve: su raya sigue. Con la escala hasta 30 s, su dato no se ve: sin raya.
    const bars = (rects: typeof log.rects, right: number) => rects.filter((r) => r.x < right && r.h === 10)
    expect(bars(log.rects, f.right)).toHaveLength(1)
    const { ctx: ctx2, log: log2 } = recorder()
    drawEndLabels(ctx2, frame(30), race({}, { yMax: 30 }), style)
    expect(bars(log2.rects, frame(30).right)).toHaveLength(0)
  })

  it('la marca de la columna repite el trazo de la serie: continua o discontinua (segundo piloto)', () => {
    const { ctx, log } = recorder()
    const f = frame()
    drawEndLabels(ctx, f, race({ ALB: { dash: true } }), style)
    const at = (y: number) => log.rects.filter((r) => r.x >= f.right && Math.abs(r.y + r.h / 2 - y) < 1e-6)
    expect(at(log.text.find((t) => t.text === 'ALB')!.y)).toHaveLength(2)
    expect(at(log.text.find((t) => t.text === 'BOT')!.y)).toHaveLength(1)
  })

  it('el detenido destacado lleva su sigla después de su raya, sin marca que alargue su línea', () => {
    const { ctx, log } = recorder()
    const f = frame()
    drawEndLabels(ctx, f, race({ STR: { emphasis: true } }), style)
    const str = log.text.find((t) => t.text === 'STR')!
    expect(str.align).toBe('left')
    expect(str.x).toBeCloseTo(f.xPos(30) + 6 + 7)
    expect(str.y).toBeCloseTo(f.yPos(40))
    expect(log.rects.filter((r) => r.x < f.right)).toHaveLength(1)
  })

  it('por hora (solo puntos): el texto junto a su último punto, sin marcas que parezcan vueltas ni trazos', () => {
    const { ctx, log } = recorder()
    const f = frame()
    drawEndLabels(ctx, f, race({ BOT: { dash: true } }, { labelColumn: false, mark: 'dot' }), style)
    const alb = log.text.find((t) => t.text === 'ALB')!
    expect(alb.align).toBe('left')
    expect(alb.x).toBeCloseTo(f.xPos(51) + 7)
    expect(alb.y).toBeCloseTo(f.yPos(190))
    expect(log.strokes).toHaveLength(0)
    expect(log.fills).toHaveLength(0)
    // Solo la raya del detenido; ninguna marca de color junto a las siglas.
    expect(log.rects).toHaveLength(1)
  })

  it('por hora, fuera de la escala: triángulo y luego el texto', () => {
    const { ctx, log } = recorder()
    const f = frame(100)
    drawEndLabels(ctx, f, race({}, { labelColumn: false, mark: 'dot', yMax: 100 }), style)
    const alb = log.text.find((t) => t.text === 'ALB')!
    expect(alb.x).toBeCloseTo(f.xPos(51) + 14)
    expect(triangles(log).some((t) => Math.abs(t.pts[0]!.x - (f.xPos(51) + 6)) < 1e-6)).toBe(true)
  })
})
