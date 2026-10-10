import { describe, expect, it } from 'vitest'
import type { TowerEntry } from '../leaderboard/leaderboard'
import type { NeutralKind } from '../trackstate/TrackState'
import {
  CORNER_APPROACH_M,
  CORNER_EXIT_M,
  CUT_MIN_MS,
  Director,
  type DirectorCar,
  type DirectorInput,
  SHOT_MIN_MS,
  trackGap,
} from './Director'

const L = 5000

/** Coche en pista a `s` m (acumulados) y `v` m/s. */
const car = (id: string, s: number, over: Partial<DirectorCar> = {}): DirectorCar => ({
  car: id,
  visible: true,
  inPit: false,
  transition: false,
  s,
  speedMps: 70,
  ...over,
})

/** Torre: [coche, posición, intervalo ms o null]. */
const tower = (rows: [string, number, number | null][]): TowerEntry[] =>
  rows.map(([c, position, intervalMs]) => ({ car: c, position, intervalMs }))

function input(over: Partial<DirectorInput> & { cars: DirectorCar[] }): DirectorInput {
  return {
    wallMs: 0,
    timeMs: 1_000_000,
    rate: 1,
    race: true,
    tower: [],
    leader: () => null,
    neutral: null,
    trackLength: L,
    corners: [],
    ...over,
  }
}

/** Avanza `ms` de pared (y lo mismo ×rate de sesión, con los coches a su velocidad) y decide. */
function step(d: Director, base: DirectorInput, ms: number): boolean {
  base.wallMs += ms
  base.timeMs += ms * base.rate
  for (const c of base.cars as DirectorCar[]) if (c.visible && !c.inPit) c.s += (c.speedMps * ms * base.rate) / 1000
  return d.update(base)
}

describe('director: qué elige', () => {
  it('con la torre (carrera): el intervalo más corto entre consecutivos, con ventaja para los de delante', () => {
    const cars = [car('1', 900), car('2', 880), car('3', 600), car('4', 590), car('5', 300), car('6', 290)]
    const d = new Director()
    d.update(
      input({
        cars,
        tower: tower([
          ['1', 1, null],
          ['2', 2, 400], // 0,4 + 0,05 × 1 = 0,45
          ['3', 3, 4000],
          ['4', 4, 150], // 0,15 + 0,05 × 3 = 0,30 ← el mejor
          ['5', 5, 3000],
          ['6', 6, 300], // 0,30 + 0,05 × 5 = 0,55
        ]),
      }),
    )
    expect(d.shot).toMatchObject({ kind: 'duel', cars: ['3', '4'], basis: 'tower', reason: 'duel' })
    expect(d.live).toEqual({ intervalMs: 150, positions: [3, 4], ahead: '3' })
    expect(d.camera.kind).toBe('chase')
  })

  it('ignora coches en el pit, sin señal o en transición, y parejas que no son consecutivas en la torre', () => {
    const cars = [
      car('1', 900),
      car('2', 880, { inPit: true }),
      car('3', 600),
      car('4', 590, { visible: false }),
      car('5', 300),
      car('7', 295, { transition: true }),
      car('6', 290),
    ]
    const d = new Director()
    d.update(
      input({
        cars,
        tower: tower([
          ['1', 1, null],
          ['2', 2, 100],
          ['3', 3, 2000],
          ['4', 4, 100],
          ['5', 5, 3000],
          ['7', 6, 100],
          // 6 va a 0,2 s de 5 en pista, pero la torre pone a 7 entre los dos: no es un duelo.
          ['6', 8, 200],
        ]),
      }),
    )
    // Ningún duelo válido; en carrera, sin líder conocido, la vista general.
    expect(d.shot).toMatchObject({ kind: 'overview', reason: 'noDuel', cars: [] })
    expect(d.camera.kind).toBe('overview')
  })

  it('sin intervalos en la torre: por cercanía en pista, sin cifra', () => {
    const cars = [car('1', 900), car('2', 860), car('3', 600), car('4', 585)]
    const d = new Director()
    d.update(
      input({
        cars,
        tower: tower([
          ['1', 1, null],
          ['2', 2, null],
          ['3', 3, null],
          ['4', 4, null],
        ]),
      }),
    )
    // 15 m a 70 m/s (0,21 s) gana a 40 m (0,57 s).
    expect(d.shot).toMatchObject({ kind: 'duel', cars: ['3', '4'], basis: 'proximity' })
    expect(d.live).toEqual({ intervalMs: null, positions: null, ahead: null })
  })

  it('fuera de carrera, los intervalos de la torre (de mejor vuelta) no cuentan: cercanía en pista', () => {
    const cars = [car('1', 100), car('2', 2000), car('3', 2020)]
    const d = new Director()
    d.update(
      input({
        race: false,
        cars,
        tower: tower([
          ['1', 1, null],
          ['2', 2, 50], // a 0,05 s de 1 en mejor vuelta, pero lejos en pista
          ['3', 3, 900],
        ]),
      }),
    )
    expect(d.shot).toMatchObject({ kind: 'duel', basis: 'proximity' })
    expect([...d.shot!.cars].sort()).toEqual(['2', '3'])
    expect(d.live.intervalMs).toBeNull()
  })

  it('fuera de carrera, la vuelta es un círculo: dos coches a ambos lados de la línea están juntos', () => {
    // Cada coche lleva su cuenta de vueltas: 4990 y 10 (otra vuelta) están a 20 m.
    const cars = [car('1', 4990), car('2', 2 * L + 10), car('3', 2500)]
    const d = new Director()
    d.update(input({ race: false, cars }))
    expect(d.shot).toMatchObject({ kind: 'duel', cars: ['2', '1'] })
  })

  it('en carrera, un doblado no está en duelo con quien lo dobla (s acumulada)', () => {
    const cars = [car('1', L + 1000), car('2', 1010)]
    const d = new Director()
    d.update(input({ cars, leader: () => '1' }))
    expect(d.shot).toMatchObject({ kind: 'leader', cars: ['1'], reason: 'noDuel' })
    expect(trackGap(cars[0]!, cars[1]!, true, L)).toEqual({ gapM: L - 10, aheadIsA: true })
  })

  it('por cercanía, ni parados ni lentos (saliendo del garaje, en la parrilla)', () => {
    const cars = [car('1', 1000, { speedMps: 2 }), car('2', 995, { speedMps: 3 })]
    const d = new Director()
    d.update(input({ race: false, cars }))
    expect(d.shot?.kind).toBe('overview')
  })

  it('bajo coche de seguridad, el líder; con bandera roja, la vista general', () => {
    const cars = [car('1', 900), car('2', 880), car('3', 600)]
    for (const neutral of ['sc', 'vsc', 'vsc-ending'] as NeutralKind[]) {
      const d = new Director()
      d.update(input({ cars, neutral, leader: () => '1' }))
      expect(d.shot, neutral).toMatchObject({ kind: 'leader', cars: ['1'], reason: 'neutral', neutral })
    }
    const red = new Director()
    red.update(input({ cars, neutral: 'red', leader: () => '1' }))
    expect(red.shot).toMatchObject({ kind: 'overview', reason: 'neutral', neutral: 'red' })
    // Con el líder en el pit, la vista general.
    const pit = new Director()
    pit.update(input({ cars: [car('1', 900, { inPit: true }), car('2', 880)], neutral: 'sc', leader: () => '1' }))
    expect(pit.shot).toMatchObject({ kind: 'overview', reason: 'neutral' })
  })

  it('el líder solo se pide cuando hace falta, y nunca fuera de carrera', () => {
    let calls = 0
    const leader = () => {
      calls++
      return '1'
    }
    new Director().update(input({ cars: [car('1', 900), car('2', 880)], leader }))
    expect(calls).toBe(0) // hay duelo: no hace falta el líder
    new Director().update(input({ race: false, neutral: 'vsc', cars: [car('1', 900)], leader }))
    expect(calls).toBe(0)
  })
})

describe('director: cuándo corta', () => {
  it('no cambia entre dos duelos casi iguales (histéresis), y nunca antes de SHOT_MIN_MS', () => {
    const cars = [car('1', 900), car('2', 890), car('3', 600), car('4', 588)]
    const towerOf = (i12: number, i34: number) =>
      tower([
        ['1', 1, null],
        ['2', 2, i12],
        ['3', 3, 4000],
        ['4', 4, i34],
      ])
    const d = new Director()
    const base = input({ cars, tower: towerOf(300, 500) })
    d.update(base)
    expect(d.shot!.cars).toEqual(['1', '2'])
    const first = d.shot!.id
    // 3–4 pasa a ser algo mejor (0,18 + 0,15 = 0,33 frente a 0,30 + 0,05 = 0,35): no basta.
    base.tower = towerOf(300, 180)
    for (let i = 0; i < 40; i++) step(d, base, 250)
    expect(d.shot!.id).toBe(first)
    // Mucho mejor (0,02 + 0,15 = 0,17 < 0,7 × 0,35): cambia, pero solo pasado el mínimo del plano.
    const d2 = new Director()
    const b2 = input({ cars: cars.map((c) => ({ ...c })), tower: towerOf(300, 500) })
    d2.update(b2)
    b2.tower = towerOf(300, 20)
    let switchedAt = -1
    for (let i = 0; i < 60 && switchedAt < 0; i++) {
      step(d2, b2, 250)
      if (d2.shot!.cars.includes('3')) switchedAt = b2.wallMs
    }
    expect(switchedAt).toBeGreaterThanOrEqual(SHOT_MIN_MS)
    expect(switchedAt).toBeLessThan(SHOT_MIN_MS + 500)
  })

  it('un duelo que se rompe (pit, sin señal, intervalo grande) se deja, pero tampoco antes de tiempo', () => {
    const cars = [car('1', 900), car('2', 890), car('3', 600), car('4', 590)]
    const base = input({
      cars,
      tower: tower([
        ['1', 1, null],
        ['2', 2, 200],
        ['3', 3, 4000],
        ['4', 4, 400],
      ]),
    })
    const d = new Director()
    d.update(base)
    expect(d.shot!.cars).toEqual(['1', '2'])
    cars[1]!.inPit = true
    step(d, base, 1000)
    expect(d.shot!.cars).toEqual(['1', '2']) // nunca corta antes de tiempo
    while (base.wallMs < SHOT_MIN_MS) step(d, base, 250)
    expect(d.shot!.cars).toEqual(['3', '4'])
  })

  it('con neutralización, del duelo al líder; al acabar, otra vez a los duelos', () => {
    const cars = [car('1', 900), car('2', 890), car('3', 600)]
    const base = input({
      cars,
      leader: () => '1',
      tower: tower([
        ['1', 1, null],
        ['2', 2, 200],
        ['3', 3, 4000],
      ]),
    })
    const d = new Director()
    d.update(base)
    expect(d.shot!.kind).toBe('duel')
    base.neutral = 'sc'
    while (base.wallMs < SHOT_MIN_MS + 250) step(d, base, 250)
    expect(d.shot).toMatchObject({ kind: 'leader', cars: ['1'], neutral: 'sc' })
    base.neutral = null
    const since = base.wallMs
    while (base.wallMs < since + SHOT_MIN_MS + 250) step(d, base, 250)
    expect(d.shot!.kind).toBe('duel')
  })

  it('en pausa no corta; tras un seek elige de cero y corta al momento', () => {
    const cars = [car('1', 900), car('2', 890), car('3', 600), car('4', 595)]
    const t1 = tower([
      ['1', 1, null],
      ['2', 2, 200],
      ['3', 3, 4000],
      ['4', 4, 900],
    ])
    const base = input({ cars, tower: t1 })
    const d = new Director()
    d.update(base)
    const id = d.shot!.id
    // En pausa (el reloj de sesión no avanza) y con el duelo roto: nada.
    cars[1]!.visible = false
    for (let i = 0; i < 80; i++) {
      base.wallMs += 250
      expect(d.update(base)).toBe(false)
    }
    expect(d.shot!.id).toBe(id)
    // Seek: plano nuevo en el acto.
    d.jump()
    base.timeMs += 60_000
    expect(d.update(base)).toBe(true)
    expect(d.shot!.cars).toEqual(['3', '4'])
    // Hacia atrás también es un salto.
    cars[1]!.visible = true
    base.tower = tower([
      ['1', 1, null],
      ['2', 2, 100],
      ['3', 3, 4000],
      ['4', 4, 900],
    ])
    base.timeMs -= 120_000
    base.wallMs += 10
    expect(d.update(base)).toBe(true)
    expect(d.shot!.cars).toEqual(['1', '2'])
  })

  it('el plano dice en cada momento lo que dice la torre: si adelanta, delante va el otro, sin corte', () => {
    const cars = [car('1', 900), car('2', 890)]
    const base = input({
      cars,
      tower: tower([
        ['1', 1, null],
        ['2', 2, 300],
      ]),
    })
    const d = new Director()
    d.update(base)
    const id = d.shot!.id
    base.tower = tower([
      ['2', 1, null],
      ['1', 2, 120],
    ])
    expect(step(d, base, 250)).toBe(false)
    expect(d.shot!.id).toBe(id)
    expect(d.live).toEqual({ intervalMs: 120, positions: [1, 2], ahead: '2' })
  })

  it('el mismo plano por otro motivo no corta (fin del coche de seguridad con el líder solo)', () => {
    const cars = [car('1', 900)]
    const base = input({ cars, neutral: 'sc', leader: () => '1' })
    const d = new Director()
    d.update(base)
    expect(d.shot).toMatchObject({ kind: 'leader', reason: 'neutral', neutral: 'sc' })
    base.neutral = null
    expect(step(d, base, 250)).toBe(false)
    expect(d.shot).toMatchObject({ kind: 'leader', reason: 'noDuel', neutral: null })
  })
})

describe('director: cámaras de curva', () => {
  const corners = [1000, 3000]

  it('a ×1, corta a la cámara de la curva antes del vértice y vuelve a la persecución pasada la salida', () => {
    // Pareja lejos de la curva; el mínimo entre cortes ya ha pasado cuando se acerca.
    const cars = [car('1', 300, { speedMps: 60 }), car('2', 290, { speedMps: 60 })]
    const base = input({ race: false, cars, corners })
    const d = new Director()
    d.update(base)
    expect(d.camera.kind).toBe('chase')
    const log: { wall: number; kind: string; behind: number }[] = []
    for (let i = 0; i < 200; i++) {
      if (step(d, base, 100)) log.push({ wall: base.wallMs, kind: d.camera.kind, behind: cars[1]!.s })
    }
    const corner = log.find((l) => l.kind === 'corner')!
    expect(corner).toBeDefined()
    // El corte a la curva, con el de detrás a CORNER_APPROACH_M o menos del vértice (y aún antes de él).
    expect(1000 - corner.behind).toBeLessThanOrEqual(CORNER_APPROACH_M)
    expect(1000 - corner.behind).toBeGreaterThan(0)
    const back = log.find((l) => l.wall > corner.wall && l.kind === 'chase')!
    expect(back).toBeDefined()
    expect(back.behind - 1000).toBeGreaterThan(CORNER_EXIT_M)
    // Nunca dos cortes a menos de CUT_MIN_MS.
    for (let i = 1; i < d.cuts.length; i++) expect(d.cuts[i]! - d.cuts[i - 1]!).toBeGreaterThanOrEqual(CUT_MIN_MS)
  })

  it('a ×16 no hay cámaras de curva: pasarían en un instante', () => {
    const cars = [car('1', 300, { speedMps: 60 }), car('2', 290, { speedMps: 60 })]
    const base = input({ race: false, cars, corners, rate: 16 })
    const d = new Director()
    d.update(base)
    for (let i = 0; i < 200; i++) step(d, base, 100)
    expect(d.cuts.length).toBe(1)
    expect(d.camera.kind).toBe('chase')
  })

  it('el plan es determinista para un guion fijo', () => {
    const run = () => {
      const cars = [car('1', 300, { speedMps: 60 }), car('2', 285, { speedMps: 61 }), car('3', 2000), car('4', 1990, { speedMps: 69 })]
      const base = input({ race: false, cars, corners })
      const d = new Director()
      d.update(base)
      const out: string[] = []
      for (let i = 0; i < 800; i++) {
        if (i === 120) cars[3]!.inPit = true
        if (step(d, base, 100)) out.push(`${base.wallMs}:${d.shot!.id}:${d.shot!.cars.join('-')}:${d.camera.kind}:${d.camera.corner}`)
      }
      return out
    }
    const a = run()
    expect(a.length).toBeGreaterThan(2)
    expect(run()).toEqual(a)
  })
})
