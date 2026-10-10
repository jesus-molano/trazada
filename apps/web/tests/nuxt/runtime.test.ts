/**
 * Runtime del replay, puntos de extensión (D29): instante inicial, escena tapada y `rt.ext`. El bucle de frames va
 * a mano (requestAnimationFrame sustituido) para que cada paso sea determinista.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LoadedSession } from '~/data/types'
import { createReplayRuntime, defaultInitialMs, type ReplayRuntime } from '~/replay/runtime'
import { loadFixture } from '~/testing/fixture'

let pending: FrameRequestCallback | null = null
let now = 0
/** Un frame del bucle (avanza 16 ms de reloj de pared). */
function frame() {
  const cb = pending
  pending = null
  now += 16
  cb?.(now)
}

beforeEach(() => {
  pending = null
  now = 0
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => ((pending = cb), 1))
  vi.stubGlobal('cancelAnimationFrame', () => (pending = null))
})
let rt: ReplayRuntime | null = null
afterEach(() => {
  rt?.dispose()
  rt = null
  vi.unstubAllGlobals()
})

let session: LoadedSession
beforeEach(async () => {
  session ??= await loadFixture()
})

describe('instante inicial (initialMs)', () => {
  it('por defecto, el de siempre', () => {
    rt = createReplayRuntime(session)
    expect(rt.clock.timeMs).toBe(defaultInitialMs(session.manifest.session.playback))
  })

  it('con initialMs, el primer frame ya es ese instante', () => {
    const { startMs } = session.manifest.session.playback
    rt = createReplayRuntime(session, { initialMs: startMs + 60_000 })
    const seen: number[] = []
    rt.onFrame((t) => seen.push(t))
    frame()
    expect(seen).toEqual([startMs + 60_000])
  })

  it('se ajusta al intervalo de reproducción; si no es un número finito, el de por defecto', () => {
    const { startMs, endMs } = session.manifest.session.playback
    expect(createReplayRuntime(session, { initialMs: endMs + 1e9 }).clock.timeMs).toBe(endMs)
    expect(createReplayRuntime(session, { initialMs: startMs - 1e9 }).clock.timeMs).toBe(startMs)
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(createReplayRuntime(session, { initialMs: bad }).clock.timeMs).toBe(
        defaultInitialMs(session.manifest.session.playback),
      )
    }
  })
})

describe('escena tapada (setSceneHidden)', () => {
  it('no pide frames a la escena, pero el reloj y los oyentes siguen; al destaparla, uno', () => {
    rt = createReplayRuntime(session)
    const invalidate = vi.fn()
    const listener = vi.fn()
    rt.setInvalidate(invalidate)
    rt.onFrame(listener)
    frame()
    expect(invalidate).toHaveBeenCalledTimes(1)

    rt.setSceneHidden(true)
    expect(rt.sceneHidden).toBe(true)
    rt.clock.play()
    const t0 = rt.clock.timeMs
    for (let i = 0; i < 5; i++) frame()
    expect(rt.clock.timeMs).toBeGreaterThan(t0)
    expect(listener.mock.calls.length).toBeGreaterThan(4)
    rt.requestFrame()
    frame()
    expect(invalidate).toHaveBeenCalledTimes(1)

    rt.clock.pause()
    frame()
    rt.setSceneHidden(false)
    frame()
    expect(invalidate).toHaveBeenCalledTimes(2)
    frame()
    expect(invalidate).toHaveBeenCalledTimes(2) // en pausa y sin cambios, nada más
  })
})

describe('rt.ext', () => {
  it('perezoso y memoizado: la fábrica se llama una vez, con el runtime', () => {
    rt = createReplayRuntime(session)
    const factory = vi.fn((r: ReplayRuntime) => ({ drivers: r.drivers.length }))
    expect(factory).not.toHaveBeenCalled()
    const a = rt.ext('moments', factory)
    const b = rt.ext('moments', factory)
    expect(a).toBe(b)
    expect(a.drivers).toBe(session.manifest.drivers.length)
    expect(factory).toHaveBeenCalledTimes(1)
    expect(factory).toHaveBeenCalledWith(rt)
  })

  it('al desechar el runtime, llama a dispose() de cada extensión que lo tenga', () => {
    rt = createReplayRuntime(session)
    const dispose = vi.fn()
    rt.ext('drs', () => ({ dispose }))
    rt.ext('plain', () => 42)
    rt.ext('null', () => null)
    rt.dispose()
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(() => rt!.ext('late', () => 1)).toThrow(/desechó/)
    rt = null
  })

  it('una fábrica que falla no deja nada a medias; una que se pide a sí misma es un error', () => {
    rt = createReplayRuntime(session)
    expect(() =>
      rt!.ext('boom', () => {
        throw new Error('fallo')
      }),
    ).toThrow('fallo')
    expect(rt.ext('boom', () => 'ok')).toBe('ok')
    expect(() => rt!.ext('loop', (r) => r.ext('loop', () => 1))).toThrow(/a sí misma/)
  })
})
