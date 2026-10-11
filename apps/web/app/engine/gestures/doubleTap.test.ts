import { describe, expect, it } from 'vitest'
import { DOUBLE_TAP, DoubleTap } from './doubleTap'

/**
 * Orden real de los avisos: la escena ve el toque (`tap`, al levantar el dedo) antes que el coche tocado (`car`: el
 * lienzo lo da en el frame siguiente, con la hora del mismo evento; la sigla, con su clic, unos ms después). Si los dos
 * toques caen en el mismo frame, los avisos del lienzo llegan juntos después de los dos de la escena.
 */
describe('DoubleTap', () => {
  it('dos toques rápidos sobre el mismo coche: el segundo lo sigue y su aviso del coche ya no cuenta', () => {
    const d = new DoubleTap()
    expect(d.tap(100, 100, 1000)).toBeNull()
    expect(d.car('44', 100, 100, 1000)).toEqual({ kind: 'single', car: '44' }) // lo elige, como siempre
    expect(d.tap(104, 98, 1250)).toBe('44')
    expect(d.car('44', 104, 98, 1250).kind).toBe('consumed') // no lo deselecciona
  })

  it('el segundo toque vale aunque no acierte al coche (se ha movido), si cae cerca y pronto', () => {
    const d = new DoubleTap()
    d.tap(300, 200, 0)
    d.car('16', 300, 200, 0)
    expect(d.tap(300 + 30, 200 - 20, 380)).toBe('16')
  })

  it('con la sigla, el clic llega unos ms después del toque: también se descarta', () => {
    const d = new DoubleTap()
    d.tap(50, 50, 500)
    expect(d.car('1', 50, 50, 508).kind).toBe('single')
    expect(d.tap(51, 50, 700)).toBe('1')
    expect(d.car('1', 51, 50, 709).kind).toBe('consumed')
  })

  it('los dos toques en el mismo frame: lo completa el aviso del coche del segundo', () => {
    const d = new DoubleTap()
    expect(d.tap(100, 100, 1000)).toBeNull()
    expect(d.tap(100, 100, 1012)).toBeNull() // el coche del primero aún no ha llegado
    expect(d.car('44', 100, 100, 1000).kind).toBe('single')
    expect(d.car('44', 100, 100, 1012)).toEqual({ kind: 'double', car: '44' })
  })

  it('si el segundo toque cae en otro coche cercano, se sigue el del primero', () => {
    const d = new DoubleTap()
    d.car('44', 100, 100, 0)
    expect(d.car('63', 110, 100, 200)).toEqual({ kind: 'double', car: '44' })
  })

  it('dos toques lentos: seleccionar y deseleccionar como siempre', () => {
    const d = new DoubleTap()
    d.tap(100, 100, 0)
    expect(d.car('44', 100, 100, 0).kind).toBe('single')
    expect(d.tap(100, 100, DOUBLE_TAP.maxMs + 1)).toBeNull()
    expect(d.car('44', 100, 100, DOUBLE_TAP.maxMs + 1).kind).toBe('single')
  })

  it('dos toques lejos el uno del otro no son un doble toque', () => {
    const d = new DoubleTap()
    d.car('44', 100, 100, 0)
    expect(d.tap(100 + DOUBLE_TAP.maxPx + 1, 100, 200)).toBeNull()
    expect(d.car('44', 100 + DOUBLE_TAP.maxPx + 1, 100, 200).kind).toBe('single')
  })

  it('un primer toque que no cayó en ningún coche no sigue a nadie', () => {
    const d = new DoubleTap()
    expect(d.tap(100, 100, 0)).toBeNull()
    expect(d.tap(100, 100, 200)).toBeNull()
  })

  it('el mismo toque no se completa a sí mismo (la escena puede verlo después que el coche)', () => {
    const d = new DoubleTap()
    d.car('44', 100, 100, 1000)
    expect(d.tap(100, 100, 1000)).toBeNull()
  })

  it('un tercer toque seguido no deselecciona; después, todo vuelve a empezar', () => {
    const d = new DoubleTap()
    d.car('44', 100, 100, 0)
    expect(d.tap(100, 100, 200)).toBe('44')
    expect(d.tap(100, 100, 380)).toBeNull()
    expect(d.car('44', 100, 100, 380).kind).toBe('consumed')
    expect(d.car('44', 100, 100, 2000).kind).toBe('single')
  })

  it('sin coordenadas (p. ej., un clic con el teclado) nunca completa un doble toque', () => {
    const d = new DoubleTap()
    d.car('44', Number.NaN, Number.NaN, 0)
    expect(d.tap(0, 0, 100)).toBeNull()
    expect(d.car('44', Number.NaN, Number.NaN, 100).kind).toBe('single')
  })

  it('reset olvida el primer toque', () => {
    const d = new DoubleTap()
    d.car('44', 100, 100, 0)
    d.reset()
    expect(d.tap(100, 100, 100)).toBeNull()
  })
})
