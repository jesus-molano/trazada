import { describe, expect, it } from 'vitest'
import type { ChartGroup, ChartSpec } from './chart'
import { DIM_ALPHA } from './chart'
import { COLUMN, CURSOR_REACH, drawEndLabels, drawPreviewLine, LABEL_GAP, LABEL_PADDING, type LabelFrame, PREVIEW_WIDTH } from './endLabels'

type Pt = { x: number; y: number }

/** Lienzo 2D que graba lo que se dibuja (con la alineación del texto en cada `fillText`). */
function recorder() {
  const log = {
    text: [] as { text: string; x: number; y: number; align: string; baseline: string; alpha: number }[],
    rects: [] as { x: number; y: number; w: number; h: number; fill: string; alpha: number }[],
    /** Trazos (`stroke`): la polilínea, su color, su grosor, su discontinuo y si iba recortado. */
    strokes: [] as { pts: Pt[]; color: string; width: number; dash: number[]; clipped: boolean }[],
    /** Rellenos de un camino (`fill`): sus puntos (los arcos, por su centro) y su color. */
    fills: [] as { pts: Pt[]; arcs: number; color: string }[],
    saves: 0,
    restores: 0,
    clips: 0,
  }
  let path: Pt[] = []
  let arcs = 0
  let dash: number[] = []
  let clipped = false
  const ctx = {
    // Lo que dejaría uPlot tras dibujar su eje y.
    textAlign: 'right',
    textBaseline: 'alphabetic',
    font: '',
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: 'miter',
    save: () => log.saves++,
    restore: () => {
      log.restores++
      clipped = false
      dash = []
    },
    measureText: (s: string) => ({ width: s.length * 6 }),
    fillText(text: string, x: number, y: number) {
      log.text.push({ text, x, y, align: this.textAlign, baseline: this.textBaseline, alpha: this.globalAlpha })
    },
    fillRect(x: number, y: number, w: number, h: number) {
      log.rects.push({ x, y, w, h, fill: this.fillStyle, alpha: this.globalAlpha })
    },
    rect: (x: number, y: number, w: number, h: number) => path.push({ x, y }, { x: x + w, y: y + h }),
    clip: () => {
      log.clips++
      clipped = true
    },
    setLineDash: (d: number[]) => (dash = [...d]),
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
      log.strokes.push({ pts: [...path], color: this.strokeStyle, width: this.lineWidth, dash: [...dash], clipped })
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

/**
 * Marco de una gráfica de 200 px de alto (el mínimo de la hoja), r = 1; `lastX`: la x del borde derecho; `width`: el
 * ancho del área de datos (800 px; unos 450 en un iPad en vertical y 650 en horizontal).
 */
function frame(yMax = 200, lastX = LAPS, width = 800): LabelFrame & { right: number; bottom: number } {
  const bbox = { left: 64, top: 8, width, height: 142 }
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
/**
 * Carrera con «Sin spoilers» en la vuelta `lead` de una de `laps`: cinco coches con datos hasta la vuelta `done` (uno por
 * cada 40 s de diferencia, para que lleven todos su sigla).
 */
function raceTo(done: number, laps: number): ChartSpec {
  const keys = ['NOR', 'PIA', 'VER', 'LEC', 'HAM']
  return {
    x: Array.from({ length: laps }, (_, i) => i + 1),
    series: keys.map((k, j) => ({
      group: k,
      mark: 'line' as const,
      values: Array.from({ length: laps }, (_, i) => (i < done ? (40 * j * (i + 1)) / done : null)),
    })),
    groups: keys.map((k) => group(k)),
    xRange: [1, laps],
    yRange: [0, 200],
    yDir: -1,
    xIncrs: null,
    formatX: String,
    formatY: String,
    labelColumn: true,
  }
}

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

  it('con «Sin spoilers» y la vuelta en curso estrecha, la columna va pasada la línea del instante actual (el final del eje)', () => {
    const { ctx, log } = recorder()
    // El eje acaba en la vuelta 54, sin datos y a 15 px de la 53: la columna no cabe antes de la línea, que va en la 54.
    const f = frame(200, LAPS + 1)
    drawEndLabels(ctx, f, race(), style)
    expect(log.text.length).toBeGreaterThan(0)
    for (const t of log.text) expect(t.x, t.text).toBeGreaterThanOrEqual(f.right + CURSOR_REACH.after)
    for (const m of log.rects.filter((r) => r.x >= f.xPos(LAPS) + 1)) expect(m.x).toBeGreaterThanOrEqual(f.right + CURSOR_REACH.after)
  })

  it('con «Sin spoilers» y la vuelta en curso ancha, la columna va justo tras el último dato, antes de la línea', () => {
    const { ctx, log } = recorder()
    // Cinco vueltas en 200 px: datos hasta la 4 y la línea en la 5, 50 px más allá; la columna cabe entre medias.
    const f = frame(200, 5, 200)
    drawEndLabels(ctx, f, raceTo(4, 5), style)
    expect(log.text.length).toBeGreaterThan(0)
    for (const t of log.text) {
      expect(t.x, t.text).toBeGreaterThan(f.xPos(4))
      expect(t.x + t.text.length * 6 + 1, t.text).toBeLessThanOrEqual(f.xPos(5) - CURSOR_REACH.before)
    }
  })

  it('en un iPad (450 y 650 px de datos), ninguna sigla de la columna cruza la línea del instante actual', () => {
    for (const width of [450, 650]) {
      for (const lead of [20, 40, LAPS]) {
        const { ctx, log } = recorder()
        // Con «Sin spoilers», datos hasta la vuelta anterior y el eje (y la línea) hasta la vuelta en curso.
        const f = frame(200, lead, width)
        drawEndLabels(ctx, f, raceTo(lead - 1, lead), style)
        const cursor = f.xPos(lead)
        expect(log.text.length, `${width} px, V${lead}`).toBeGreaterThan(0)
        for (const t of log.text) {
          const mark = t.x - COLUMN.text
          const end = t.x + t.text.length * 6 + 1
          // La caja de la sigla (marca y texto) no toca la línea con su halo: [cursor − 1, cursor + 3].
          expect(end <= cursor - 1 || mark >= cursor + CURSOR_REACH.after, `${t.text} a ${width} px, V${lead}`).toBe(true)
        }
      }
    }
  })

  it('el margen derecho de la gráfica cabe la columna pasada la línea con una sigla de tres letras', () => {
    // Tres letras de la condensada de 10 px: menos de 24 px.
    expect(LABEL_PADDING).toBeGreaterThanOrEqual(COLUMN.gap + CURSOR_REACH.after + COLUMN.text + 24)
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

  it('resaltada (D49): su sigla a la altura exacta de su dato, opaca, y el resto atenuado; la que choca pierde su sitio', () => {
    const { ctx, log } = recorder()
    const f = frame()
    // CH queda en medio del pelotón (sin resaltar, no lleva sigla) y CA sí la lleva.
    const spec = race()
    const rects = drawEndLabels(ctx, f, spec, style, 'CH')
    const ch = log.text.find((t) => t.text === 'CH')!
    expect(ch.y).toBeCloseTo(home(f, 7))
    expect(ch.alpha).toBe(1)
    for (const t of log.text.filter((t) => t.text !== 'CH')) expect(t.alpha, t.text).toBe(DIM_ALPHA)
    // CA (a 0 s) queda a menos de 11 px de CH (a 7 s): pierde su sitio.
    expect(log.text.some((t) => t.text === 'CA')).toBe(false)
    expect(rects.map((r) => r.key)).toContain('CH')
  })

  it('resaltado un detenido: su sigla después de su raya, a su altura; la raya, opaca', () => {
    const { ctx, log } = recorder()
    const f = frame()
    drawEndLabels(ctx, f, race(), style, 'STR')
    const str = log.text.find((t) => t.text === 'STR')!
    expect(str.x).toBeCloseTo(f.xPos(30) + 6 + 7)
    expect(str.y).toBeCloseTo(f.yPos(40))
    const bar = log.rects.find((r) => r.x < f.right && r.h === 10)!
    expect(bar.alpha).toBe(1)
  })

  it('el coche elegido conserva su sigla pero se atenúa si se resalta otro', () => {
    const { ctx, log } = recorder()
    drawEndLabels(ctx, frame(), race({ ALB: { emphasis: true } }), style, 'BOT')
    expect(log.text.find((t) => t.text === 'ALB')!.alpha).toBe(DIM_ALPHA)
    expect(log.text.find((t) => t.text === 'BOT')!.alpha).toBe(1)
  })

  it('los rótulos devueltos (px CSS) son los del texto dibujado', () => {
    for (const r of [1, 2]) {
      const { ctx, log } = recorder()
      const f = frame()
      const scaled: LabelFrame = {
        r,
        bbox: { left: f.bbox.left * r, top: f.bbox.top * r, width: f.bbox.width * r, height: f.bbox.height * r },
        xPos: (v) => f.xPos(v) * r,
        yPos: (v) => f.yPos(v) * r,
      }
      const rects = drawEndLabels(ctx, scaled, race(), style)
      expect(rects.map((x) => x.key).sort()).toEqual(log.text.map((t) => t.text).sort())
      for (const t of log.text) {
        const rect = rects.find((x) => x.key === t.text)!
        // El texto (en px del lienzo) cae dentro de su rótulo (en px CSS), y el rótulo empieza en su marca.
        expect(t.x / r).toBeGreaterThan(rect.x0)
        expect(t.x / r + (t.text.length * 6) / r).toBeLessThanOrEqual(rect.x1 + 1e-9)
        expect(t.y / r).toBeGreaterThan(rect.y0)
        expect(t.y / r).toBeLessThan(rect.y1)
      }
    }
  })

  it('la serie resaltada se vuelve a trazar exactamente por sus puntos, sin unir huecos, recortada; nada más', () => {
    const { ctx, log } = recorder()
    const f = frame()
    // Una serie con un hueco (vueltas 1–3 y 5–6) y un punto suelto (vuelta 9), del segundo piloto de su equipo.
    const values = [1, 2, 3, null, 5, 6, null, null, 9, ...Array.from({ length: LAPS - 9 }, () => null)]
    const spec: ChartSpec = {
      ...race(),
      series: [...race().series, { group: 'GAP', mark: 'line', values }],
      groups: [...race().groups, group('GAP', { dash: true })],
    }
    drawPreviewLine(ctx, f, spec, 'GAP')
    expect(log.clips).toBe(1)
    expect(log.strokes).toHaveLength(2)
    expect(log.strokes[0]!.pts).toEqual([1, 2, 3].map((v) => ({ x: f.xPos(v), y: f.yPos(v) })))
    expect(log.strokes[1]!.pts).toEqual([5, 6].map((v) => ({ x: f.xPos(v), y: f.yPos(v) })))
    for (const st of log.strokes) {
      expect(st.width).toBe(PREVIEW_WIDTH)
      expect(st.dash).toEqual([6, 4])
      expect(st.clipped).toBe(true)
      expect(st.color).toBe(color('GAP'))
    }
    // El punto suelto, relleno en su sitio (un cuadrado: segundo piloto).
    expect(log.fills).toHaveLength(1)
    expect(log.fills[0]!.pts[0]!.x).toBeCloseTo(f.xPos(9) - 3)
    expect(log.fills[0]!.pts[1]!.y).toBeCloseTo(f.yPos(9) + 3)
    expect(log.text).toHaveLength(0)
    expect(log.saves).toBe(log.restores)

    // Sin resaltar, oculta o de puntos: nada.
    const { ctx: c2, log: l2 } = recorder()
    drawPreviewLine(c2, f, spec, null)
    drawPreviewLine(c2, f, { ...spec, groups: spec.groups.map((g) => ({ ...g, visible: g.key !== 'GAP' })) }, 'GAP')
    drawPreviewLine(c2, f, race({}, { mark: 'dot', labelColumn: false }), 'ALB')
    expect(l2.strokes).toHaveLength(0)
    expect(l2.fills).toHaveLength(0)
  })
})
