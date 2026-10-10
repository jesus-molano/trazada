import { describe, expect, it } from 'vitest'
import { FrameWindow, percentile, summarize } from './frames'
import { QualityGovernor } from './QualityGovernor'

describe('estadística de frames', () => {
  it('percentiles por rango más cercano y frames de más de 50 ms', () => {
    const v = Array.from({ length: 100 }, (_, i) => i + 1) // 1..100
    expect(percentile(v, 50)).toBe(50)
    expect(percentile(v, 95)).toBe(95)
    expect(percentile(v, 99)).toBe(99)
    expect(percentile([], 95)).toBeNaN()
    const s = summarize([...v, 120])
    expect(s).toMatchObject({ frames: 101, max: 120, over50: 51 })
  })

  it('ventana circular: solo los últimos N', () => {
    const w = new FrameWindow(3)
    for (const x of [100, 1, 2, 3]) w.push(x)
    expect(w.full).toBe(true)
    expect(w.percentile(100)).toBe(3)
  })
})

describe('gobernador de calidad', () => {
  /** Alimenta n frames; `ms` puede depender del DPR actual (modelo de carga) y del índice del frame. */
  const feed = (g: QualityGovernor, ms: number | ((dpr: number, i: number) => number), n: number) => {
    for (let i = 0; i < n; i++) g.frame(typeof ms === 'number' ? ms : ms(g.dpr, i))
  }
  /** Intervalo de rAF a 60 Hz: el coste de render redondeado al vsync siguiente, con algo de jitter. */
  const vsync60 = (cost: (dpr: number) => number) => (dpr: number, i: number) =>
    Math.ceil(cost(dpr) / 16.667) * 16.667 + Math.sin(i * 1.7) * 0.3
  const windows = (n: number) => 30 * n
  const opts = { windowFrames: 30 }

  it('empieza en el DPR del dispositivo (tope 2, en escalones)', () => {
    expect(new QualityGovernor(3).dpr).toBe(2)
    expect(new QualityGovernor(1.75).dpr).toBe(1.5)
    expect(new QualityGovernor(1).dpr).toBe(1)
  })

  it('GPU limitada por píxeles (sin cuantizar): baja hasta entrar en presupuesto y se queda ahí', () => {
    const g = new QualityGovernor(2, opts)
    feed(g, (d) => 12 + 20 * d * d, windows(30))
    // 2 → 92 ms, 1,5 → 57, 1,25 → 43, 1 → 32: se para en 1.
    expect(g.changes.map((c) => c.dpr)).toEqual([1.5, 1.25, 1])
  })

  it('60 Hz cuantizado: un escalón que no cambia de "cubo" de vsync no detiene el sondeo', () => {
    const g = new QualityGovernor(2, opts)
    // Coste 24 + 5·dpr²: 44 ms → 50 (DPR 2), 35 → 50 (1,5), 32 → 33,3 (1,25)
    feed(g, vsync60((d) => 24 + 5 * d * d), windows(30))
    expect(g.dpr).toBe(1.25)
  })

  it('una bajada que entra en presupuesto se mantiene aunque la mejora sea pequeña', () => {
    const g = new QualityGovernor(2, opts)
    feed(g, (d, i) => 28 + 6 * d * d + Math.sin(i) * 0.2, windows(30)) // 52 → 41,5 → 37,4 → 34
    expect(g.dpr).toBe(1)
    const g2 = new QualityGovernor(2, opts)
    feed(g2, (d, i) => 30 + 1.5 * d * d + Math.sin(i) * 0.2, windows(30)) // 36 → 33,4
    expect(g2.dpr).toBe(1.5)
  })

  it('pantalla o navegador a 30 Hz: no toca la resolución', () => {
    for (const cap of [
      (_: number, i: number) => 33.333 + Math.sin(i) * 0.4, // con jitter
      (_: number, i: number) => (i % 3 === 0 ? 34 : 33), // reloj cuantizado a 1 ms
    ]) {
      const g = new QualityGovernor(2, opts)
      feed(g, cap, windows(40))
      expect(g.changes).toEqual([])
    }
  })

  it('limitado por CPU (bajar no ayuda): sondea una vez y vuelve al DPR del dispositivo, sin reintentar', () => {
    const g = new QualityGovernor(2, opts)
    feed(g, 45, windows(60))
    expect(g.dpr).toBe(2)
    expect(g.changes.length).toBe(5) // 1,5 · 1,25 · 1 · 0,75 · vuelta a 2
  })

  it('si la carga empeora claramente tras un sondeo sin solución, vuelve a sondear', () => {
    const g = new QualityGovernor(2, opts)
    feed(g, 40, windows(10))
    expect(g.dpr).toBe(2)
    feed(g, (d) => 12 + 20 * d * d, windows(30)) // ahora sí depende de los píxeles (92 > 40 × 1,25)
    expect(g.dpr).toBe(1)
  })

  it('60 Hz con coste justo en el límite: no oscila subiendo y bajando', () => {
    // Coste 5·dpr²: 20 ms → 33,3 (DPR 2, dentro de presupuesto); 11 ms → 16,7 (1,5)
    const g = new QualityGovernor(2, opts)
    feed(g, vsync60((d) => 5 * d * d), windows(200))
    expect(g.changes.length).toBe(0)
  })

  it('una subida que se pasa de presupuesto se deshace, y cada reintento espera el doble', () => {
    // Por encima de DPR 1 hay un precipicio: 40 ms; en 1 o menos, 15 ms.
    const cliff = (d: number) => (d > 1 ? 40 : 15)
    const g = new QualityGovernor(2, { windowFrames: 30, recoverWindows: 3 })
    feed(g, cliff, windows(200))
    expect(g.dpr).toBe(1)
    // Sondeo (3 bajadas) y, después, intentos de subida cada vez más espaciados (3, 6, 12, 24, 48, 96…).
    expect(g.changes.length).toBeLessThan(20)
  })

  it('con margen sube, pero solo tras varias ventanas seguidas y nunca por encima del dispositivo', () => {
    const g = new QualityGovernor(1.5, { windowFrames: 30, recoverWindows: 3 })
    feed(g, (d) => 12 + 20 * d * d, windows(10)) // 1,5 → 57 ms … baja hasta 1
    expect(g.dpr).toBe(1)
    const before = g.changes.length
    feed(g, 10, windows(2))
    expect(g.changes.length).toBe(before) // como mucho dos ventanas buenas: aún no
    feed(g, 10, windows(3))
    expect(g.dpr).toBe(1.25)
    feed(g, 10, windows(20))
    expect(g.dpr).toBe(1.5)
  })

  it('ignora frames anómalos (pestaña en segundo plano)', () => {
    const g = new QualityGovernor(2, opts)
    feed(g, 5000, 100)
    expect(g.dpr).toBe(2)
  })
})
