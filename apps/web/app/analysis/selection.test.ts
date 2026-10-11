import type { DriverInfo } from '@trazada/schema'
import { describe, expect, it } from 'vitest'
import { driverStyles } from './chart'
import { pickerOptions, typeahead } from './selection'

const driver = (number: string, tla: string, team: string, first = '', last = ''): DriverInfo => ({
  number,
  tla,
  first,
  last,
  team,
  color: '#123456',
})

describe('selector de piloto de la hoja de análisis (D49)', () => {
  const drivers = [
    driver('1', 'NOR', 'A', 'Lando', 'Norris'),
    driver('14', 'ALO', 'B', 'Fernando', 'Alonso'),
    driver('81', 'PIA', 'A', 'Oscar', 'Piastri'),
    driver('18', 'STR', 'B', 'Lance', 'Stroll'),
  ]
  const styles = driverStyles(drivers)

  it('en el orden de la clasificación del instante, con su puesto solo si se conoce; después, el resto del manifest', () => {
    const rows = [
      { car: '81', position: 1, positionKnown: true },
      { car: '14', position: 2, positionKnown: true },
      { car: '1', position: 3, positionKnown: false },
      // Un coche que no está en el manifest no sale (no hay piloto que elegir).
      { car: '99', position: 4, positionKnown: true },
    ]
    const out = pickerOptions(rows, drivers, styles)
    expect(out.map((o) => o.car)).toEqual(['81', '14', '1', '18'])
    expect(out.map((o) => o.position)).toEqual([1, 2, null, null])
    expect(out[1]).toEqual({ car: '14', tla: 'ALO', name: 'Fernando Alonso', color: '#123456', dash: false, position: 2 })
    // El segundo piloto de cada equipo, discontinuo (como en las gráficas y en la leyenda).
    expect(out.find((o) => o.car === '81')!.dash).toBe(true)
    expect(out.find((o) => o.car === '18')!.dash).toBe(true)
    // Sin clasificación: el orden del manifest, sin puestos.
    expect(pickerOptions([], drivers, styles).map((o) => [o.car, o.position])).toEqual([
      ['1', null],
      ['14', null],
      ['81', null],
      ['18', null],
    ])
  })

  it('búsqueda al teclear: la siguiente que empieza por lo tecleado, dando la vuelta; la misma letra recorre las suyas', () => {
    const labels = ['Ninguno', 'PIA', 'ALO', 'NOR', 'STR', 'PER']
    expect(typeahead(labels, 0, 'a')).toBe(2)
    expect(typeahead(labels, 2, 'n')).toBe(3)
    // La misma letra otra vez: la siguiente que empieza por ella (y da la vuelta hasta «Ninguno»).
    expect(typeahead(labels, 3, 'n')).toBe(0)
    expect(typeahead(labels, 3, 'nn')).toBe(0)
    // Varias letras: desde la actual.
    expect(typeahead(labels, 1, 'pe')).toBe(5)
    expect(typeahead(labels, 1, 'pi')).toBe(1)
    // Sin mayúsculas ni acentos.
    expect(typeahead(['Ninguno', 'Ángel'], 0, 'a')).toBe(1)
    expect(typeahead(labels, 0, 'x')).toBe(-1)
    expect(typeahead([], 0, 'a')).toBe(-1)
    expect(typeahead(labels, -1, 'n')).toBe(0)
  })
})
