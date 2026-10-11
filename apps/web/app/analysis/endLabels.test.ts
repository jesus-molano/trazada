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
function race(extra: Partial<Record<string, Partial<ChartGroup>>> = {}, o: { labelColumn?: boolean; yMax?: number; mark?: 'line' | 'dot' } = {}): ChartSpec {
  const ends: [string, number, number][] = [...CLOSE.map((k, i): [string, number, number] => [k, LAPS, i]), ['ALB', 51, 190], ['BOT', 52, 150], ['STR', 30, 40]]
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

/** Marco de una gráfica de 200 px de alto (el mínimo de la hoja), r = 1. */
function frame(yMax = 200): LabelFrame & { right: number; bottom: number } {
  const bbox = { left: 64, top: 8, width: 800, height: 142 }
  return {
    r: 1,
    bbox,
    right: bbox.left + bbox.width,
    bottom: bbox.top + bbox.height,
    xPos: (v) => bbox.left + ((v - 1) / (LAPS - 1)) * bbox.width,
    yPos: (v) => bbox.top + (v / yMax) * bbox.height,
  }
}

const style = { font: '10px sans', text: '#ffffff', connector: '#384150' }
/** Altura de su dato (dentro del área de las siglas, a 5 px de los bordes). */
const home = (f: ReturnType<typeof frame>, v: number) => Math.min(Math.max(f.yPos(v), f.bbox.top + 5), f.bottom - 5)
const lastValue = (spec: ChartSpec, key: string) => {
  const v = spec.series.find((s) => s.group === key)!.values
  return v.filter((x) => x !== null).at(-1)!
}

describe('siglas de las gráficas de análisis', () => {
  it('por vuelta: en el margen, alineadas a la izquierda, sin pisarse y cada una a su altura o una separación al lado', () => {
    const { ctx, log } = recorder()
    const f = frame()
    const spec = race()
    drawEndLabels(ctx, f, spec, style)
    // El primero, el siguiente una separación más abajo y los dos doblados (el resto del pelotón no cabe cerca de su dato).
    expect(log.text.map((t) => t.text).sort()).toEqual(['ALB', 'BOT', 'CA', 'CB'])
    for (const t of log.text) {
      expect(t.align, t.text).toBe('left')
      expect(t.baseline).toBe('middle')
      expect(t.x, t.text).toBeGreaterThanOrEqual(f.right)
      expect(Math.abs(t.y - home(f, lastValue(spec, t.text))), t.text).toBeLessThanOrEqual(LABEL_GAP + 1e-9)
    }
    const ys = log.text.map((t) => t.y).sort((a, b) => a - b)
    for (let i = 1; i < ys.length; i++) expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(LABEL_GAP - 1e-9)
    expect(log.saves).toBe(1)
    expect(log.restores).toBe(1)
  })

  it('las que no caben cerca de su dato no llevan sigla (la leyenda las nombra); el detenido, tampoco', () => {
    const { ctx, log } = recorder()
    drawEndLabels(ctx, frame(), race(), style)
    const drawn = new Set(log.text.map((t) => t.text))
    // 17 coches en 12 px: no caben todos.
    expect(CLOSE.filter((k) => drawn.has(k)).length).toBeLessThan(CLOSE.length)
    expect(drawn.has('CA')).toBe(true)
    expect(drawn.has('STR')).toBe(false)
  })

  it('el coche destacado siempre lleva su sigla, a la altura de su dato', () => {
    const { ctx, log } = recorder()
    const f = frame()
    // CH queda en medio del pelotón: sin destacar, no tendría sitio.
    drawEndLabels(ctx, f, race({ CH: { emphasis: true } }), style)
    expect(log.text.find((t) => t.text === 'CH')!.y).toBeCloseTo(home(f, 7))
  })

  it('nada en el área de datos que parezca un dato; los trazos, cortos, en el margen y del color de la interfaz', () => {
    const { ctx, log } = recorder()
    const f = frame()
    drawEndLabels(ctx, f, race(), style)
    // Dentro del área de datos solo está la raya del detenido, justo después de su último dato (vuelta 30).
    const inside = log.rects.filter((r) => r.x < f.right)
    expect(inside).toHaveLength(1)
    expect(inside[0]!.x).toBeGreaterThan(f.xPos(30))
    expect(inside[0]!.x).toBeLessThan(f.xPos(31))
    expect(log.fills.every((p) => p.pts.every((pt) => pt.x >= f.right))).toBe(true)
    expect(log.strokes.length).toBeGreaterThan(0)
    for (const s of log.strokes) {
      expect(s.color).toBe(style.connector)
      const ys = s.pts.map((p) => p.y)
      expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(LABEL_GAP + 1e-9)
      for (const p of s.pts) expect(p.x).toBeGreaterThanOrEqual(f.right)
    }
  })

  it('el primero, pegado al borde de arriba, no lleva trazo; un doblado solo, a la altura de su dato', () => {
    const { ctx, log } = recorder()
    const f = frame()
    drawEndLabels(ctx, f, race(), style)
    const ca = log.text.find((t) => t.text === 'CA')!
    expect(ca.y).toBeCloseTo(f.bbox.top + 5)
    expect(log.strokes.some((s) => Math.abs(s.pts.at(-1)!.y - ca.y) < 1e-6)).toBe(false)
    expect(log.text.find((t) => t.text === 'ALB')!.y).toBeCloseTo(f.yPos(190))
    expect(log.text.find((t) => t.text === 'BOT')!.y).toBeCloseTo(f.yPos(150))
  })

  it('último dato fuera de la escala: la sigla en el borde con un triángulo hacia el dato; sin la raya del detenido', () => {
    const { ctx, log } = recorder()
    // Escala hasta 100 s: ALB (+190) y BOT (+150) quedan por debajo; STR (+40) dentro.
    const f = frame(100)
    drawEndLabels(ctx, f, race({ STR: { emphasis: true } }, { yMax: 100 }), style)
    const alb = log.text.find((t) => t.text === 'ALB')!
    expect(alb.y).toBeGreaterThan(f.bottom - 5 - LABEL_GAP - 1e-9)
    const triangles = log.fills.filter((p) => p.arcs === 0 && p.pts.length === 3)
    expect(triangles).toHaveLength(2)
    // Punta hacia abajo (hacia el dato): el tercer punto, por debajo de la base.
    for (const t of triangles) expect(t.pts[2]!.y).toBeGreaterThan(t.pts[0]!.y)
    // La raya de STR (10 px de alto) sigue: su dato se ve. Con su dato fuera de la escala, no hay raya.
    const bars = (rects: typeof log.rects, right: number) => rects.filter((r) => r.x < right && r.h === 10)
    expect(bars(log.rects, f.right)).toHaveLength(1)
    const { ctx: ctx2, log: log2 } = recorder()
    drawEndLabels(ctx2, frame(30), race({}, { yMax: 30 }), style)
    expect(bars(log2.rects, frame(30).right)).toHaveLength(0)
  })

  it('la marca de color repite el trazo de la serie: continua o discontinua (segundo piloto)', () => {
    const { ctx, log } = recorder()
    const f = frame()
    drawEndLabels(ctx, f, race({ ALB: { dash: true } }), style)
    const at = (y: number) => log.rects.filter((r) => r.x >= f.right && Math.abs(r.y + r.h / 2 - y) < 1e-6)
    expect(at(log.text.find((t) => t.text === 'ALB')!.y)).toHaveLength(2)
    expect(at(log.text.find((t) => t.text === 'BOT')!.y)).toHaveLength(1)
  })

  it('el detenido destacado lleva su sigla junto a su final, después de su raya', () => {
    const { ctx, log } = recorder()
    const f = frame()
    drawEndLabels(ctx, f, race({ STR: { emphasis: true } }), style)
    const str = log.text.find((t) => t.text === 'STR')!
    expect(str.align).toBe('left')
    // Raya a 6 px de su último dato; la sigla, 13 px después (como cualquier sigla junto a su final).
    expect(str.x).toBeCloseTo(f.xPos(30) + 6 + 13)
    expect(str.y).toBeCloseTo(f.yPos(40))
  })

  it('por hora (solo puntos): junto a su final, sin trazos; marca redonda o cuadrada (segundo piloto)', () => {
    const { ctx, log } = recorder()
    const f = frame()
    drawEndLabels(ctx, f, race({ BOT: { dash: true } }, { labelColumn: false, mark: 'dot' }), style)
    const alb = log.text.find((t) => t.text === 'ALB')!
    expect(alb.align).toBe('left')
    expect(alb.x).toBeCloseTo(f.xPos(51) + 13)
    expect(alb.y).toBeCloseTo(f.yPos(190))
    expect(log.strokes).toHaveLength(0)
    // ALB: un punto; BOT: un cuadrado.
    expect(log.fills.some((p) => p.arcs === 1 && Math.abs(p.pts[0]!.y - alb.y) < 1e-6)).toBe(true)
    const bot = log.text.find((t) => t.text === 'BOT')!
    expect(log.rects.some((r) => r.w === r.h && Math.abs(r.y + r.h / 2 - bot.y) < 1e-6)).toBe(true)
  })
})
