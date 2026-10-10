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
  /** Alimenta n frames; `ms` puede depender del DPR actual (modelo de carga). */
  const feed = (g: QualityGovernor, ms: number | ((dpr: number, i: number) => number), n: number) => {
    for (let i = 0; i < n; i++) g.frame(typeof ms === 'number' ? ms : ms(g.dpr, i))
  }
  /** GPU limitada por píxeles: el frame escala con el área de render (DPR²). */
  const fillBound = (dpr: number) => 12 + 20 * dpr * dpr

  it('empieza en el DPR del dispositivo (tope 2, en escalones)', () => {
    expect(new QualityGovernor(3).dpr).toBe(2)
    expect(new QualityGovernor(1.75).dpr).toBe(1.5)
    expect(new QualityGovernor(1).dpr).toBe(1)
  })

  it('GPU limitada por píxeles: baja escalón a escalón mientras ayuda y se queda donde cabe en 33 ms', () => {
    const g = new QualityGovernor(2, { windowFrames: 30 })
    feed(g, fillBound, 30 * 20)
    // 2 → 92 ms, 1,5 → 57, 1,25 → 43, 1 → 32: se para en 1 (ya dentro del presupuesto).
    expect(g.dpr).toBe(1)
    expect(g.changes.map((c) => c.dpr)).toEqual([1.5, 1.25, 1])
  })

  it('pantalla o navegador a 30 Hz: prueba una bajada, ve que no sirve y vuelve al DPR del dispositivo', () => {
    for (const vsync of [
      (_: number, i: number) => 33.333 + Math.sin(i) * 0.4, // con jitter
      (_: number, i: number) => (i % 3 === 0 ? 34 : 33), // reloj cuantizado a 1 ms
    ]) {
      const g = new QualityGovernor(2, { windowFrames: 30 })
      feed(g, vsync, 30 * 40)
      expect(g.dpr).toBe(2)
      expect(g.changes.length).toBe(2) // una bajada y su vuelta, nada más
    }
  })

  it('limitado por CPU (bajar no ayuda): no se queda borroso', () => {
    const g = new QualityGovernor(1.5, { windowFrames: 30 })
    feed(g, 45, 30 * 40)
    expect(g.dpr).toBe(1.5)
  })

  it('si la carga empeora claramente tras un bloqueo, vuelve a intentarlo', () => {
    const g = new QualityGovernor(2, { windowFrames: 30 })
    feed(g, 40, 30 * 6) // bajar no ayuda: bloqueado en 40 ms
    expect(g.dpr).toBe(2)
    feed(g, fillBound, 30 * 20) // ahora sí depende de los píxeles (92 ms > 40 × 1,25)
    expect(g.dpr).toBe(1)
  })

  it('con margen sube, pero solo tras varias ventanas seguidas y nunca por encima del dispositivo', () => {
    const g = new QualityGovernor(1.5, { windowFrames: 30, recoverWindows: 3 })
    feed(g, fillBound, 30 * 10) // 1,5 → 57 ms … baja hasta 1
    expect(g.dpr).toBe(1)
    const before = g.changes.length
    feed(g, 10, 30 * 2)
    expect(g.changes.length).toBe(before) // como mucho dos ventanas buenas: aún no
    feed(g, 10, 30 * 3)
    expect(g.dpr).toBe(1.25)
    feed(g, 10, 30 * 20)
    expect(g.dpr).toBe(1.5)
  })

  it('sin oscilar en la zona intermedia (entre 20 y 33 ms no cambia)', () => {
    const g = new QualityGovernor(2, { windowFrames: 30 })
    feed(g, 25, 30 * 50)
    expect(g.changes.length).toBe(0)
  })

  it('ignora frames anómalos (pestaña en segundo plano)', () => {
    const g = new QualityGovernor(2, { windowFrames: 30 })
    feed(g, 5000, 100)
    expect(g.dpr).toBe(2)
  })
})
