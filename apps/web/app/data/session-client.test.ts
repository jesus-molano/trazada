import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadSessionInWorker } from './session-client'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('cliente del Web Worker de carga', () => {
  it('con la señal ya cancelada, rechaza sin crear el worker (su evento abort no volvería a saltar)', async () => {
    const Worker = vi.fn()
    vi.stubGlobal('Worker', Worker)
    await expect(loadSessionInWorker('/data/v1/x/manifest.json', '2026/10-spa-francorchamps/fp1', '1.2.0', { signal: AbortSignal.abort() })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(Worker).not.toHaveBeenCalled()
  })
})
