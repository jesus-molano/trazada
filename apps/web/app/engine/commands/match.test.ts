import { describe, expect, it } from 'vitest'
import { PALETTE_DRIVERS } from '../../testing/commands'
import { allTokens, completion, editDistance, findDrivers, findPhrase, matchWord, phrases } from './match'
import { parseQuery } from './parse'

describe('matchWord', () => {
  it('igual: 1; principio a medio escribir: más cuanto más completo', () => {
    expect(matchWord('seguir', 'seguir', false)).toBe(1)
    const a = matchWord('seg', 'seguir', true)
    const b = matchWord('segui', 'seguir', true)
    expect(a).toBeGreaterThanOrEqual(0.5)
    expect(b).toBeGreaterThan(a)
    expect(b).toBeLessThan(1)
  })

  it('abreviatura ya cerrada: solo con 3 letras o más', () => {
    expect(matchWord('sig', 'siguiente', false)).toBeGreaterThanOrEqual(0.5)
    expect(matchWord('si', 'siguiente', false)).toBe(0)
  })

  it('una errata en palabras de 4 letras o más; dos en las de 7 o más', () => {
    expect(matchWord('verstapen', 'verstappen', false)).toBe(0.7)
    expect(matchWord('vertsappen', 'verstappen', false)).toBe(0.7) // trasposición
    expect(matchWord('vrstapen', 'verstappen', false)).toBe(0.6)
    expect(matchWord('xyz', 'xya', false)).toBe(0)
  })

  it('distancia de edición con trasposiciones, cortada', () => {
    expect(editDistance('ab', 'ba')).toBe(1)
    expect(editDistance('kitten', 'sitting')).toBe(3)
    expect(editDistance('a', 'abcdef', 2)).toBe(3)
  })
})

describe('findPhrase', () => {
  const SC = phrases('coche de seguridad', 'safety car', 'sc')

  it('frase de varias palabras, en cualquier sitio de la consulta', () => {
    const q = parseQuery('siguiente coche de seguridad')
    expect(findPhrase(q.tokens, SC)).toEqual({ score: 1, used: [1, 2] })
  })

  it('a medio escribir cuenta, con menos puntuación', () => {
    const full = findPhrase(parseQuery('coche de seguridad').tokens, SC)!
    const part = findPhrase(parseQuery('coche de seg').tokens, SC)!
    const first = findPhrase(parseQuery('coche').tokens, SC)!
    expect(part.score).toBeLessThan(full.score)
    expect(first.score).toBeLessThan(full.score)
    expect(first.score).toBeGreaterThan(0.3)
  })

  it('una frase a medias en mitad de la consulta no cuenta', () => {
    expect(findPhrase(parseQuery('coche nor').tokens, SC)).toBeNull()
  })

  it('solo entre los tokens libres', () => {
    const q = parseQuery('sc sc')
    expect(findPhrase(q.tokens, SC, new Set([1]))!.used).toEqual([1])
  })
})

describe('findDrivers', () => {
  const refs = (raw: string, max = 2) => {
    const q = parseQuery(raw)
    return findDrivers(q.tokens, PALETTE_DRIVERS, allTokens(q.tokens), max).map((r) => ({
      cars: r.candidates.map((c) => c.car),
      used: r.used,
    }))
  }

  it('por sigla, dorsal, apellido y nombre; sin tildes ni mayúsculas', () => {
    expect(refs('VER')).toEqual([{ cars: ['3'], used: [0] }])
    expect(refs('81')).toEqual([{ cars: ['81'], used: [0] }])
    expect(refs('verstappen')).toEqual([{ cars: ['3'], used: [0] }])
    expect(refs('Pérez')).toEqual([{ cars: ['11'], used: [0] }])
    expect(refs('hulkenberg')).toEqual([{ cars: ['27'], used: [0] }])
    expect(refs('lando')).toEqual([{ cars: ['1'], used: [0] }])
  })

  it('nombre y apellido seguidos son una sola referencia', () => {
    expect(refs('carlos sainz')).toEqual([{ cars: ['55'], used: [0, 1] }])
  })

  it('con una errata', () => {
    expect(refs('verstapen')[0]!.cars).toEqual(['3'])
  })

  it('ambiguo mientras se escribe: «sa» son Sainz y Sargeant', () => {
    expect(refs('sa')[0]!.cars.sort()).toEqual(['2', '55'])
  })

  it('dos pilotos: «nor pia»', () => {
    expect(refs('nor pia')).toEqual([
      { cars: ['1'], used: [0] },
      { cars: ['81'], used: [1] },
    ])
  })

  it('un número sin coche no es un piloto; una palabra cualquiera, tampoco', () => {
    expect(refs('99')).toEqual([])
    expect(refs('xyz')).toEqual([])
  })
})

describe('completion', () => {
  it('cambia la última palabra o añade, con un espacio detrás', () => {
    expect(completion('sigue a verst', 'VER', true)).toBe('sigue a VER ')
    expect(completion('seguir', 'NOR', false)).toBe('seguir NOR ')
    expect(completion('', 'NOR', false)).toBe('NOR ')
  })
})
