import { describe, expect, it } from 'vitest'
import { classify, normalize, parseClock, parseQuery, phraseWords } from './parse'

describe('normalize', () => {
  it('sin tildes, diéresis ni mayúsculas; ×, − y – como x y -; espacios simples', () => {
    expect(normalize('  Sigue a  PÉREZ ')).toBe('sigue a perez')
    expect(normalize('Hülkenberg')).toBe('hulkenberg')
    expect(normalize('Próxima parada')).toBe('proxima parada')
    expect(normalize('×4')).toBe('x4')
    expect(normalize('−0:30')).toBe('-0:30')
    expect(normalize('#30')).toBe('30')
    expect(normalize('NOR, PIA.')).toBe('nor pia')
  })
})

describe('parseClock', () => {
  it('h:mm:ss y m:ss (como el reloj del dock), con signo', () => {
    expect(parseClock('1:02:30')).toBe(3_750_000)
    expect(parseClock('2:30')).toBe(150_000)
    expect(parseClock('0:40')).toBe(40_000)
    expect(parseClock('-0:30')).toBe(-30_000)
  })

  it('minutos o segundos de 60 o más no son una hora', () => {
    expect(parseClock('1:75')).toBeNull()
    expect(parseClock('1:60:00')).toBeNull()
    expect(parseClock('130')).toBeNull()
  })
})

describe('classify', () => {
  const kind = (text: string) => {
    const tk = classify(text, false)
    return [tk.kind, tk.value]
  }

  it('velocidades: x4, 4x (y ×4, ya normalizado)', () => {
    expect(kind('x4')).toEqual(['rate', 4])
    expect(kind('4x')).toEqual(['rate', 4])
    expect(kind(normalize('×16'))).toEqual(['rate', 16])
  })

  it('vueltas: v30, l30, lap30, vuelta30', () => {
    for (const text of ['v30', 'l30', 'lap30', 'vuelta30']) expect(kind(text), text).toEqual(['lap', 30])
  })

  it('saltos relativos: +30, -10s, +2m, +1:30', () => {
    expect(kind('+30')).toEqual(['relative', 30_000])
    expect(kind('-10s')).toEqual(['relative', -10_000])
    expect(kind('+2m')).toEqual(['relative', 120_000])
    expect(kind('+1:30')).toEqual(['relative', 90_000])
  })

  it('una hora negativa es una hora del reloj (antes de la salida), no un salto', () => {
    expect(kind('-0:30')).toEqual(['time', -30_000])
  })

  it('números y palabras', () => {
    expect(kind('30')).toEqual(['number', 30])
    expect(kind('verstappen')).toEqual(['word', null])
  })
})

describe('parseQuery', () => {
  const texts = (raw: string) => parseQuery(raw).tokens.map((tk) => tk.text)

  it('quita los rellenos (es y en), también los verbos de ir', () => {
    expect(texts('sigue a VER')).toEqual(['sigue', 'ver'])
    expect(texts('vuelta 7 de VER')).toEqual(['vuelta', '7', 'ver'])
    expect(texts('go to lap 30')).toEqual(['lap', '30'])
    expect(texts('ir a la vuelta 30')).toEqual(['vuelta', '30'])
    expect(texts('lap 7 of VER')).toEqual(['lap', '7', 'ver'])
  })

  it('la última palabra sin espacio detrás está a medio escribir (y un relleno ahí se queda: puede ser «Albon»)', () => {
    const q = parseQuery('sigue al')
    expect(q.tokens.map((tk) => [tk.text, tk.open])).toEqual([
      ['sigue', false],
      ['al', true],
    ])
    expect(texts('sigue al ')).toEqual(['sigue'])
  })

  it('vacía o solo rellenos: consulta vacía (las destacadas)', () => {
    expect(parseQuery('').empty).toBe(true)
    expect(parseQuery('   ').empty).toBe(true)
    expect(parseQuery('ir a la ').empty).toBe(true)
    expect(parseQuery('x').empty).toBe(false)
  })

  it('los alias se normalizan igual que lo escrito', () => {
    expect(phraseWords('Coche de seguridad')).toEqual(['coche', 'seguridad'])
    expect(phraseWords('Volver a donde lo dejé')).toEqual(['volver', 'donde', 'deje'])
  })
})
