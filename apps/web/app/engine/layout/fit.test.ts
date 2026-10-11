import { describe, expect, it } from 'vitest'
import { firstFittingLevel, fitAttribute, HEADER_FIT_MAX } from './fit'

/** Una cabecera falsa: cabe a partir del nivel `fromLevel` (lo secundario libera sitio en cada nivel). */
function header(fromLevel: number) {
  const applied: number[] = []
  let level = -1
  return {
    applied,
    apply: (l: number) => {
      level = l
      applied.push(l)
    },
    fits: () => level >= fromLevel,
  }
}

describe('prioridad del título en la cabecera (D44)', () => {
  it('si cabe tal cual, nivel 0: no se acorta nada más de lo que digan las media queries', () => {
    const h = header(0)
    expect(firstFittingLevel(HEADER_FIT_MAX, h.apply, h.fits)).toBe(0)
    expect(h.applied).toEqual([0])
  })

  it('lo secundario se acorta por niveles hasta que el título cabe entero', () => {
    const h = header(2)
    expect(firstFittingLevel(HEADER_FIT_MAX, h.apply, h.fits)).toBe(2)
    expect(h.applied).toEqual([0, 1, 2])
  })

  it('si ni lo más compacto basta, se queda en el último nivel (y el título lleva «…»)', () => {
    const h = header(99)
    expect(firstFittingLevel(HEADER_FIT_MAX, h.apply, h.fits)).toBe(HEADER_FIT_MAX)
    expect(h.applied.at(-1)).toBe(HEADER_FIT_MAX)
  })

  it('el atributo acumula los niveles alcanzados (para los selectores [data-fit~="n"])', () => {
    expect(fitAttribute(0)).toBeNull()
    expect(fitAttribute(1)).toBe('1')
    expect(fitAttribute(3)).toBe('1 2 3')
  })
})
