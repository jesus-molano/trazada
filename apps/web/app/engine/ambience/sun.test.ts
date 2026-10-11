import { describe, expect, it } from 'vitest'
import { julianDay, solarElevationDeg, solarPosition } from './sun'

const at = (iso: string) => Date.parse(iso)

/**
 * Referencias calculadas aparte con el algoritmo de baja precisión del Astronomical Almanac (independiente del de la
 * NOAA: ascensión recta y tiempo sidéreo en lugar de la ecuación del tiempo). Los dos coinciden a ~0,01°.
 */
const REFERENCES: { name: string; utc: string; lat: number; lon: number; deg: number }[] = [
  { name: 'Spa, FP1 2026 (t0)', utc: '2026-07-17T11:16:23Z', lat: 50.44, lon: 5.97, deg: 60.262 },
  { name: 'Spa, FP1 2026 (inicio)', utc: '2026-07-17T12:26:53Z', lat: 50.44, lon: 5.97, deg: 59.411 },
  { name: 'Marina Bay, carrera 2025', utc: '2025-10-05T12:00:00Z', lat: 1.29, lon: 103.86, deg: -16.826 },
  { name: 'Yas Marina, carrera 2025 (salida)', utc: '2025-12-07T13:00:00Z', lat: 24.47, lon: 54.61, deg: 5.961 },
  { name: 'Yas Marina, carrera 2025 (final)', utc: '2025-12-07T14:30:00Z', lat: 24.47, lon: 54.61, deg: -12.788 },
  { name: 'Suzuka, carrera 2026', utc: '2026-03-29T05:00:00Z', lat: 34.84, lon: 136.53, deg: 47.812 },
  { name: 'Las Vegas, carrera 2024', utc: '2024-11-24T06:00:00Z', lat: 36.12, lon: -115.17, deg: -65.426 },
  { name: 'Sakhir, carrera 2024', utc: '2024-03-02T15:00:00Z', lat: 26.03, lon: 50.51, deg: -5.251 },
  { name: 'Interlagos, carrera 2024', utc: '2024-11-03T17:30:00Z', lat: -23.7, lon: -46.7, deg: 51.607 },
]

describe('altura del sol (NOAA)', () => {
  it('día juliano: J2000.0 es el 1 de enero de 2000 a las 12:00 UTC', () => {
    expect(julianDay(at('2000-01-01T12:00:00Z'))).toBe(2_451_545)
    expect(julianDay(0)).toBe(2_440_587.5)
  })

  for (const r of REFERENCES) {
    it(`${r.name}: ${r.deg}° (±0,2°)`, () => {
      expect(Math.abs(solarElevationDeg(at(r.utc), r.lat, r.lon) - r.deg)).toBeLessThan(0.2)
    })
  }

  it('casos del estudio: Singapur de noche, Spa de día alto, Abu Dabi entre el día y la noche', () => {
    expect(solarElevationDeg(at('2025-10-05T12:00:00Z'), 1.29, 103.86)).toBeLessThan(-6)
    expect(solarElevationDeg(at('2026-07-17T11:16:23Z'), 50.44, 5.97)).toBeGreaterThan(40)
    const abuDhabi = solarElevationDeg(at('2025-12-07T13:30:00Z'), 24.47, 54.61)
    expect(abuDhabi).toBeGreaterThan(-3)
    expect(abuDhabi).toBeLessThan(5)
  })

  it('en el polo, la altura es la declinación a cualquier hora (solsticio de junio: ±23,44°)', () => {
    for (const hour of ['00', '06', '12', '18']) {
      const t = at(`2026-06-21T${hour}:00:00Z`)
      expect(solarElevationDeg(t, 90, 0)).toBeCloseTo(23.44, 1)
      expect(solarElevationDeg(t, -90, 0)).toBeCloseTo(-23.44, 1)
      expect(solarPosition(t, 0, 0).declinationDeg).toBeCloseTo(23.44, 1)
    }
  })

  it('mediodía solar: ángulo horario 0 y sol casi en el cénit en el trópico de Cáncer en el solsticio', () => {
    let best = -90
    for (let min = 0; min < 1440; min++) best = Math.max(best, solarElevationDeg(at('2026-06-21T00:00:00Z') + min * 60_000, 23.44, 0))
    expect(best).toBeGreaterThan(89.5)
    // A 15° de longitud por hora: el mismo sol una hora antes, 15° más al este.
    const t = at('2026-03-10T10:00:00Z')
    expect(solarElevationDeg(t, 40, 30)).toBeCloseTo(solarElevationDeg(t + 3_600_000, 40, 15), 1)
  })

  it('el huso horario no interviene: solo el instante UTC y la posición', () => {
    const utc = solarElevationDeg(at('2025-12-07T13:00:00Z'), 24.47, 54.61)
    expect(solarElevationDeg(at('2025-12-07T17:00:00+04:00'), 24.47, 54.61)).toBe(utc)
  })

  it('sin un instante o una posición válidos, NaN (nunca un sol inventado)', () => {
    expect(solarElevationDeg(Number.NaN, 50, 5)).toBeNaN()
    expect(solarElevationDeg(0, Number.NaN, 5)).toBeNaN()
    expect(solarElevationDeg(0, 50, Number.POSITIVE_INFINITY)).toBeNaN()
  })
})
