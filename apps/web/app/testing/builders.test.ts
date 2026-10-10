/** Los constructores de datos sintéticos para tests dan lo mismo que el pipeline (columnas, centinelas, orden). */
import { ENUMS, LAYOUTS } from '@trazada/schema'
import { describe, expect, it } from 'vitest'
import { quotedLapMs } from '../engine/timing/deletions'
import { lapDeletedMessage, rcMessage, sessionEvents, timingBuilder } from './laps'
import { fakeMotion, ringCircuit, syntheticTracks } from './motion'

describe('timingBuilder', () => {
  it('todas las tablas y columnas del layout timing, con sus centinelas de «sin dato»', () => {
    const t = timingBuilder().lap(7, 1).build()
    for (const [table, spec] of Object.entries(LAYOUTS.timing.tables)) {
      expect(Object.keys(t.tables[table]!.columns).sort()).toEqual(Object.keys(spec.columns).sort())
    }
    const c = t.tables.laps!.columns
    const row = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v[0]]))
    expect(row).toEqual({
      car: 7,
      lap: 1,
      startMs: -1,
      endMs: -1,
      lapMs: -1,
      s1Ms: -1,
      s2Ms: -1,
      s3Ms: -1,
      compound: 0,
      tyreLife: 255,
      fresh: 255,
      stint: 0,
      pitInMs: -1,
      pitOutMs: -1,
      position: 0,
      trackStatusMask: 0,
      deleted: 0,
    })
  })

  it('tandas de vueltas seguidas (vuelta 1 de carrera sin tiempo), estado de pista y anulada', () => {
    const t = timingBuilder()
      .run(1, 1000, [100_000, 90_000, 91_000], {
        lap1NoTime: true,
        compound: 'SOFT',
        each: (i) => (i === 2 ? { status: ['sc', 'vsc-ending'], deleted: true } : {}),
      })
      .build()
    const c = t.tables.laps!.columns
    expect([...c.lap!]).toEqual([1, 2, 3])
    expect([...c.startMs!]).toEqual([1000, 101_000, 191_000])
    expect([...c.endMs!]).toEqual([101_000, 191_000, 282_000])
    expect([...c.lapMs!]).toEqual([-1, 90_000, 91_000])
    expect([...c.compound!]).toEqual([1, 1, 1].map(() => ENUMS.compound.indexOf('SOFT')))
    expect([...c.trackStatusMask!]).toEqual([0, 0, 2 | 16])
    expect([...c.deleted!]).toEqual([0, 0, 1])
  })

  it('torre, estado de pista y de sesión ordenados por tiempo, con los códigos del layout', () => {
    const t = timingBuilder()
      .order(5000, [44, 1])
      .towerAt(1000, 1, { position: 1, gapMs: 0, intervalMs: 0 })
      .trackStatus(9000, 'vsc')
      .trackStatus(2000, 'green')
      .sessionStatus(100, 'Started')
      .sessionStatus(9999, 'Finished')
      .build()
    const st = t.tables.stream!.columns
    expect([...st.t!]).toEqual([1000, 5000, 5000])
    expect([...st.car!]).toEqual([1, 1, 44])
    expect([...st.position!]).toEqual([1, 2, 1])
    expect([...st.gapToLeaderMs!]).toEqual([0, -1, -1])
    expect([...t.tables.trackStatus!.columns.code!]).toEqual([1, 6])
    expect([...t.tables.sessionStatus!.columns.status!]).toEqual(['Started', 'Finished'].map((s) => ENUMS.sessionStatus.indexOf(s)))
    expect(() => timingBuilder().sessionStatus(0, 'Nope')).toThrow()
    expect(() => timingBuilder().lap(1, 1, { compound: 'Nope' }).build()).toThrow()
  })

  it('mensajes de dirección de carrera con el formato real', () => {
    const m = lapDeletedMessage(250_000, '1', 89_007)
    expect(m.text).toBe('CAR 1 (AAA) TIME 1:29.007 DELETED - TRACK LIMITS')
    expect(quotedLapMs(m.text)).toBe(89_007)
    expect(m.parsed).toMatchObject({ kind: 'lap_deleted', cars: ['1'] })
    expect(quotedLapMs(lapDeletedMessage(0, '1', null).text)).toBeNull()
    expect(rcMessage(1, 'chequered_flag').text).toBe('CHEQUERED FLAG')
    expect(sessionEvents({ raceControl: [m] }).raceControl).toHaveLength(1)
  })
})

describe('movimiento y circuito sintéticos', () => {
  it('motion con las columnas del layout y pistas con segmentos y tangentes', () => {
    const m = fakeMotion([{ car: 3, t: [0, 250, 500], s: [0, 10, 20] }])
    for (const [table, spec] of Object.entries(LAYOUTS.motion.tables)) {
      expect(Object.keys(m.tables[table]!.columns).sort()).toEqual(Object.keys(spec.columns).sort())
    }
    const [tr] = syntheticTracks([{ car: 3, t: [0, 250, 500, 5000, 5250], s: [0, 10, 20, 30, 40] }])
    expect(tr!.car).toBe('3')
    expect([...tr!.seg]).toEqual([0, 0, 0, 3, 3])
    expect(tr!.m[1]).toBeCloseTo(10 / 250, 12)
    expect(() => fakeMotion([{ car: 1, t: [0], s: [] }])).toThrow()
  })

  it('anillo: longitud de un polígono de radio dado, s = 0 en (radio, 0) y pit lane opcional', () => {
    const ring = ringCircuit({ radius: 100, vertices: 360 })
    expect(ring.centerline.length).toBeCloseTo(2 * 360 * 100 * Math.sin(Math.PI / 360), 6)
    const p = ring.centerline.sample(0, { x: 0, y: 0, z: 0, tx: 0, ty: 0 })
    expect([p.x, p.y]).toEqual([100, 0])
    expect(ring.pitlane).toBeNull()
    expect(ringCircuit({ pit: { entryS: 10, exitS: 20, lengthM: 50 } }).pitlane!.length).toBeCloseTo(50, 9)
  })
})
