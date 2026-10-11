import { describe, expect, it, vi } from 'vitest'
import { MAX_DELTA_MS, SessionClock } from './SessionClock'

describe('SessionClock', () => {
  it('no avanza en pausa y avanza a la velocidad elegida', () => {
    const c = new SessionClock(1000, 100_000)
    expect(c.tick(16)).toBe(1000)
    c.play()
    expect(c.tick(16)).toBe(1016)
    c.setRate(16)
    expect(c.tick(10)).toBe(1016 + 160)
    c.pause()
    expect(c.tick(50)).toBe(1176)
  })

  it('limita el delta de cada frame', () => {
    const c = new SessionClock(0, 1e6)
    c.play()
    c.setRate(4)
    c.tick(5000) // pestaña en segundo plano
    expect(c.timeMs).toBe(MAX_DELTA_MS * 4)
    c.tick(-20)
    c.tick(Number.NaN)
    expect(c.timeMs).toBe(MAX_DELTA_MS * 4)
  })

  it('seek con límites y eventos', () => {
    const c = new SessionClock(1000, 2000)
    const events: string[] = []
    c.on((e) => events.push(e))
    c.seek(5000)
    expect(c.timeMs).toBe(2000)
    c.seek(-5)
    expect(c.timeMs).toBe(1000)
    c.seekBy(250)
    expect(c.timeMs).toBe(1250)
    c.seekToFraction(0.5)
    expect(c.timeMs).toBe(1500)
    c.seek(Number.NaN)
    expect(c.timeMs).toBe(1500)
    expect(events).toEqual(['seek', 'seek', 'seek', 'seek'])
    expect(c.progress).toBe(0.5)
  })

  it('al llegar al final se pausa, y play vuelve a empezar', () => {
    const c = new SessionClock(0, 150)
    const onEvent = vi.fn()
    c.on(onEvent)
    c.play()
    c.tick(100)
    c.tick(100)
    expect(c.timeMs).toBe(150)
    expect(c.playing).toBe(false)
    expect(onEvent).toHaveBeenCalledWith('end', c)
    c.play()
    expect(c.timeMs).toBe(0)
    expect(c.playing).toBe(true)
  })

  it('valida velocidad e intervalo; los listeners se pueden quitar', () => {
    expect(() => new SessionClock(10, 10)).toThrow(RangeError)
    const c = new SessionClock(0, 10)
    // @ts-expect-error velocidad fuera del conjunto
    expect(() => c.setRate(3)).toThrow(RangeError)
    const l = vi.fn()
    const off = c.on(l)
    c.toggle()
    off()
    c.toggle()
    expect(l).toHaveBeenCalledTimes(1)
  })
})
