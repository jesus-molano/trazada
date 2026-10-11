import { afterEach, describe, expect, it } from 'vitest'
import { registerSceneStat, sceneStats } from './debug'

const offs: (() => void)[] = []
afterEach(() => {
  for (const off of offs.splice(0)) off()
})

describe('registerSceneStat (D29)', () => {
  it('publica la estadística con su nombre, leída en el momento y también en las copias de los e2e', () => {
    let points = 0
    offs.push(registerSceneStat('trails', () => ({ cars: 2, points })))
    points = 64
    expect((sceneStats as Record<string, unknown>).trails).toEqual({ cars: 2, points: 64 })
    expect(({ ...sceneStats } as Record<string, unknown>).trails).toEqual({ cars: 2, points: 64 })
    expect(JSON.parse(JSON.stringify(sceneStats)).trails).toEqual({ cars: 2, points: 64 })
  })

  it('las que llevan coste cuentan como capas; el resto, no', () => {
    expect(sceneStats.layers).toEqual([])
    let on = true
    offs.push(registerSceneStat('heat', () => ({ mode: 'speed', drawCalls: on ? 1 : 0, triangles: on ? 14_000 : 0 })))
    offs.push(registerSceneStat('tv', () => ({ shot: 'chase' })))
    expect(sceneStats.layers).toEqual([{ name: 'heat', drawCalls: 1, triangles: 14_000 }])
    on = false
    expect(sceneStats.layers[0]!.drawCalls).toBe(0)
    expect({ ...sceneStats }.layers).toHaveLength(1)
  })

  it('la baja la quita; un nombre fijo de sceneStats no se puede registrar', () => {
    const off = registerSceneStat('ghost', () => ({ visible: false, drawCalls: 0, triangles: 0 }))
    off()
    expect('ghost' in sceneStats).toBe(false)
    expect(sceneStats.layers).toEqual([])
    for (const name of ['renders', 'drawCalls', 'layers']) expect(() => registerSceneStat(name, () => ({}))).toThrow(/ya existe/)
  })

  it('con el mismo nombre manda el último registro, y la baja del anterior no lo borra', () => {
    const offOld = registerSceneStat('drsSpans', () => ({ n: 1 }))
    offs.push(registerSceneStat('drsSpans', () => ({ n: 2 })))
    offOld()
    expect((sceneStats as Record<string, unknown>).drsSpans).toEqual({ n: 2 })
  })
})
