import { describe, expect, it } from 'vitest'
import { CAR_DETAIL_OFF_PX, CAR_DETAIL_ON_PX, carSizeScale, nextDetail, screenLengthPx } from './carLod'

describe('nivel de detalle de los coches', () => {
  it('cuña de lejos, detalle de cerca, con histéresis', () => {
    expect(nextDetail(false, CAR_DETAIL_OFF_PX - 1)).toBe(false)
    expect(nextDetail(false, 48)).toBe(false) // entre umbrales: conserva el estado
    expect(nextDetail(true, 48)).toBe(true)
    expect(nextDetail(false, CAR_DETAIL_ON_PX + 1)).toBe(true)
    expect(nextDetail(true, CAR_DETAIL_OFF_PX - 1)).toBe(false)
  })

  it('tamaño real de cerca; de lejos crece con la distancia', () => {
    expect(carSizeScale(70)).toBe(1)
    expect(carSizeScale(900)).toBe(2)
  })

  it('píxeles en pantalla: a escala de mapa, cuña; siguiendo a un coche, detalle', () => {
    const projY = 1 / Math.tan((17.5 * Math.PI) / 180) // fov 35°
    // Vista general (~3 km): coche de 5,25 m × k.
    const far = 3000
    expect(nextDetail(false, screenLengthPx(5.25 * carSizeScale(far), far, projY, 900))).toBe(false)
    // Seguimiento a 70 m, ventana de 900 px de alto.
    expect(nextDetail(false, screenLengthPx(5.25, 70, projY, 900))).toBe(true)
  })
})
