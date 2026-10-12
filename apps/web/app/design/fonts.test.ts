import { describe, expect, it, vi } from 'vitest'
import { coversCodePoint, warmLatinFonts } from './fonts'

describe('unicode-range', () => {
  it('rangos, puntos sueltos y comodines, con o sin ceros', () => {
    expect(coversCodePoint('U+0-FF, U+131, U+2000-206F', 0x41)).toBe(true)
    expect(coversCodePoint('U+0000-00FF', 0xff)).toBe(true)
    expect(coversCodePoint('U+??', 0x41)).toBe(true)
    expect(coversCodePoint('U+4??', 0x4ff)).toBe(true)
    expect(coversCodePoint('U+131', 0x131)).toBe(true)
    // El subconjunto latino extendido y el vietnamita no llevan la «A».
    expect(coversCodePoint('U+100-2BA, U+2BD-2C5, U+1E00-1E9F', 0x41)).toBe(false)
    expect(coversCodePoint('U+102-103, U+110-111, U+1EA0-1EF9, U+20AB', 0x41)).toBe(false)
    expect(coversCodePoint('', 0x41)).toBe(false)
  })
})

describe('warmLatinFonts', () => {
  it('carga solo las caras latinas sin cargar', () => {
    const face = (unicodeRange: string, status: FontFaceLoadStatus) => ({ unicodeRange, status, load: vi.fn(() => Promise.resolve()) })
    const faces = [face('U+0-FF, U+131', 'unloaded'), face('U+0-FF', 'loaded'), face('U+100-2BA', 'unloaded')]
    warmLatinFonts({ forEach: (cb: (f: (typeof faces)[number]) => void) => faces.forEach(cb) } as unknown as FontFaceSet)
    expect(faces.map((f) => f.load.mock.calls.length)).toEqual([1, 0, 0])
  })
})
