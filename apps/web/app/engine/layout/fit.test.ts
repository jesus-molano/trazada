import { describe, expect, it } from 'vitest'
import { chooseLevel, fitAttribute, HEADER_FIT_MAX } from './fit'

/**
 * Una cabecera falsa: cabe a partir del nivel `fromLevel` (lo secundario libera sitio en cada nivel); si no, mide lo que
 * diga `heights` para cada nivel (por defecto, una fila de 48 px).
 */
function header(fromLevel: number, heights: number[] = []) {
  const applied: number[] = []
  let level = -1
  return {
    applied,
    apply: (l: number) => {
      level = l
      applied.push(l)
    },
    measure: () => ({ fits: level >= fromLevel, height: heights[level] ?? 48 }),
    get current() {
      return level
    },
  }
}

describe('prioridad del título en la cabecera (D44)', () => {
  it('si cabe tal cual, nivel 0: no se acorta nada más de lo que digan las media queries', () => {
    const h = header(0)
    expect(chooseLevel(HEADER_FIT_MAX, h.apply, h.measure)).toBe(0)
    expect(h.applied).toEqual([0])
  })

  it('lo secundario se acorta por niveles hasta que el título cabe entero', () => {
    const h = header(2)
    expect(chooseLevel(HEADER_FIT_MAX, h.apply, h.measure)).toBe(2)
    expect(h.applied).toEqual([0, 1, 2])
  })

  it('si ninguno cabe y todos van en una fila, se queda en el más compacto (y el título lleva «…»)', () => {
    const h = header(99)
    expect(chooseLevel(HEADER_FIT_MAX, h.apply, h.measure)).toBe(HEADER_FIT_MAX)
    expect(h.current).toBe(HEADER_FIT_MAX)
  })

  it('el estado de pista no pasa a su fila si eso añade una fila: mejor el título con «…» en una sola', () => {
    // Niveles 0 a 3 en una fila con el título acortado; con el 4, dos filas.
    const h = header(99, [48, 48, 48, 48, 80])
    expect(chooseLevel(HEADER_FIT_MAX, h.apply, h.measure)).toBe(3)
    // Se mide el 4 y se vuelve al 3: lo que queda aplicado es lo elegido.
    expect(h.applied).toEqual([0, 1, 2, 3, 4, 3])
    expect(h.current).toBe(3)
  })

  it('si la fila se parte igual, el estado de pista va en su propia fila (nunca una columna de chips)', () => {
    // Con el 3, el estado de pista parte la fila (dos filas, 84 px); con el 4, en la suya, igual o menos.
    const h = header(99, [158, 120, 96, 84, 80])
    expect(chooseLevel(HEADER_FIT_MAX, h.apply, h.measure)).toBe(4)
    const same = header(99, [158, 120, 96, 84, 85])
    expect(chooseLevel(HEADER_FIT_MAX, same.apply, same.measure)).toBe(4)
  })

  it('gana el nivel con menos alto: lo que le queda a la escena', () => {
    const h = header(99, [120, 84, 84, 120, 120])
    expect(chooseLevel(HEADER_FIT_MAX, h.apply, h.measure)).toBe(2)
    expect(h.current).toBe(2)
  })

  it('el atributo acumula los niveles alcanzados (para los selectores [data-fit~="n"])', () => {
    expect(fitAttribute(0)).toBeNull()
    expect(fitAttribute(1)).toBe('1')
    expect(fitAttribute(3)).toBe('1 2 3')
    expect(fitAttribute(4)).toBe('1 2 3 4')
  })
})

describe('desde el nivel actual (tarea 1: menos layouts forzados)', () => {
  it('el mismo nivel que desde cero, con menos medidas', () => {
    for (let fromLevel = 0; fromLevel <= HEADER_FIT_MAX; fromLevel++) {
      for (let current = 0; current <= HEADER_FIT_MAX; current++) {
        const fresh = header(fromLevel)
        const expected = chooseLevel(HEADER_FIT_MAX, fresh.apply, fresh.measure)
        const h = header(fromLevel)
        expect(chooseLevel(HEADER_FIT_MAX, h.apply, h.measure, current), `cabe desde ${fromLevel}, ahora ${current}`).toBe(expected)
        // Lo último aplicado es el nivel elegido.
        expect(h.current).toBe(expected)
      }
    }
  })

  it('sin cambios (cabe con el actual y no con el de debajo): dos medidas, no cinco', () => {
    const h = header(3)
    expect(chooseLevel(HEADER_FIT_MAX, h.apply, h.measure, 3)).toBe(3)
    expect(h.applied).toEqual([3, 2, 3])
  })

  it('si ya no cabe ni con el actual, sube desde él (con el alto más bajo si no cabe ninguno)', () => {
    const h = header(HEADER_FIT_MAX + 1, [60, 60, 56, 56, 56])
    expect(chooseLevel(HEADER_FIT_MAX, h.apply, h.measure, 2)).toBe(HEADER_FIT_MAX)
    expect(h.applied[0]).toBe(2)
  })
})
