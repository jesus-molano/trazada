import { describe, expect, it } from 'vitest'
import { mapHalfWidth, MIN_TRACK_PX } from './mapWidth'

describe('anchura de mapa', () => {
  it('de cerca, la anchura en metros (la genérica de 14 m)', () => {
    // 20 px por metro: 14 m son 280 px, muy por encima del mínimo.
    expect(mapHalfWidth(7, MIN_TRACK_PX, 20, 20)).toBe(7)
  })

  it('de lejos, el mínimo en píxeles (también en escorzo)', () => {
    // 0,25 px por metro: la pista real serían 3,5 px; se dibuja con 7.
    const half = mapHalfWidth(7, MIN_TRACK_PX, 0.25, 0.25)
    expect(2 * half * 0.25).toBeCloseTo(MIN_TRACK_PX)
    // Un tramo lejano visto en escorzo (la mitad de píxeles por metro a lo ancho) también llega a 7 px.
    const foreshortened = mapHalfWidth(7, MIN_TRACK_PX, 0.125, 0.25)
    expect(2 * foreshortened * 0.125).toBeCloseTo(MIN_TRACK_PX)
  })

  it('casi de canto no crece sin límite', () => {
    const edgeOn = mapHalfWidth(7, MIN_TRACK_PX, 0.001, 0.25)
    expect(edgeOn).toBeCloseTo(mapHalfWidth(7, MIN_TRACK_PX, 0.3 * 0.25, 0.25))
    expect(mapHalfWidth(7, MIN_TRACK_PX, 0, 0)).toBe(7)
  })
})
