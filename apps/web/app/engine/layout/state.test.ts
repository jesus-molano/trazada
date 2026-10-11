import { describe, expect, it } from 'vitest'
import { defaultLayoutState, isCustomized, sanitizeLayout } from './state'

describe('lo guardado del diseño (trazada.layout)', () => {
  it('por defecto: Espectador, sin anchos elegidos y con la dirección de carrera abierta', () => {
    const s = defaultLayoutState()
    expect(s.preset).toBe('spectator')
    expect(s.presets.spectator).toEqual({ lb: null, side: null, rcOpen: true })
    expect(s.presets.analysis).toEqual({ lb: null, side: null, rcOpen: true })
    expect(isCustomized(s.presets.spectator)).toBe(false)
  })

  it('ida y vuelta de un estado válido', () => {
    const raw = {
      preset: 'analysis',
      presets: { spectator: { lb: 320, side: null, rcOpen: false }, analysis: { lb: 300, side: 400, rcOpen: true } },
    }
    const s = sanitizeLayout(JSON.parse(JSON.stringify(raw)))
    expect(s).toEqual(raw)
    expect(isCustomized(s.presets.analysis)).toBe(true)
  })

  it('lo corrupto vuelve al valor por defecto campo a campo, sin tocar lo demás', () => {
    const s = sanitizeLayout({
      preset: 'tv',
      presets: {
        spectator: { lb: 'ancho', side: 9999, rcOpen: 'sí' },
        analysis: { lb: 350, side: Number.NaN, rcOpen: false },
        otro: { lb: 300 },
      },
    })
    expect(s.preset).toBe('spectator')
    expect(s.presets.spectator).toEqual({ lb: null, side: null, rcOpen: true })
    expect(s.presets.analysis).toEqual({ lb: 350, side: null, rcOpen: false })
    expect(Object.keys(s.presets)).toEqual(['spectator', 'analysis'])
  })

  it('algo que no es un objeto: todo por defecto', () => {
    for (const raw of [null, undefined, 42, 'analysis', [1, 2], { presets: [] }]) {
      expect(sanitizeLayout(raw), JSON.stringify(raw)).toEqual(defaultLayoutState())
    }
  })
})
