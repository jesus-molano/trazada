import { describe, expect, it } from 'vitest'
import { FrameWindow, percentile, summarize } from './frames'
import { DPR_STEPS, QualityGovernor } from './QualityGovernor'

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
  const feed = (g: QualityGovernor, ms: number, n: number) => {
    let last: number | null = null
    for (let i = 0; i < n; i++) last = g.frame(ms) ?? last
    return last
  }

  it('empieza en el DPR del dispositivo (tope 2, en escalones)', () => {
    expect(new QualityGovernor(3).dpr).toBe(2)
    expect(new QualityGovernor(1.75).dpr).toBe(1.5)
    expect(new QualityGovernor(1).dpr).toBe(1)
  })

  it('con frames lentos baja un escalón por ventana hasta el mínimo', () => {
    const g = new QualityGovernor(2, { windowFrames: 30 })
    expect(feed(g, 45, 30)).toBe(1.5)
    feed(g, 45, 30 * 10)
    expect(g.dpr).toBe(DPR_STEPS[DPR_STEPS.length - 1])
  })

  it('con margen sube, pero solo tras varias ventanas seguidas y nunca por encima del dispositivo', () => {
    const g = new QualityGovernor(1.5, { windowFrames: 30, recoverWindows: 3 })
    feed(g, 45, 60) // 1.5 → 1.25 → 1
    expect(g.dpr).toBe(1)
    feed(g, 10, 60)
    expect(g.dpr).toBe(1) // dos ventanas buenas: aún no
    feed(g, 10, 30)
    expect(g.dpr).toBe(1.25)
    feed(g, 10, 30 * 20)
    expect(g.dpr).toBe(1.5)
  })

  it('sin oscilar en la zona intermedia (entre 20 y 33 ms no cambia)', () => {
    const g = new QualityGovernor(2, { windowFrames: 30 })
    feed(g, 45, 30)
    const before = g.changes.length
    feed(g, 25, 30 * 50)
    expect(g.changes.length).toBe(before)
  })

  it('ignora frames anómalos (pestaña en segundo plano)', () => {
    const g = new QualityGovernor(2, { windowFrames: 30 })
    feed(g, 5000, 100)
    expect(g.dpr).toBe(2)
  })
})
