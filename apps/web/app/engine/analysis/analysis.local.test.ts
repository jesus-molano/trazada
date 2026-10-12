/**
 * Race trace, ritmo y stints con la carrera de Japón de data/ y, si está, el sprint de Singapur 2026 (solo en local; se
 * salta lo que no exista).
 */
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LOCAL_DATA_ROOT, loadLocal } from '../../testing/fixture'
import { buildLapTable } from './lapTable'
import { pace, paceChart } from './pace'
import { carStory } from './carStory'
import { crossingTimes, lastCrossings, leaderLapAt, legendOrder, raceTrace, stoppedCars } from './raceTrace'
import { stints } from './stints'

const JAPAN = '2026/03-suzuka/race'
const hasJapan = existsSync(`${LOCAL_DATA_ROOT}v1/sessions/${JAPAN}/manifest.json`)
const SINGAPORE = '2026/18-marina-bay/sprint'
const hasSingapore = existsSync(`${LOCAL_DATA_ROOT}v1/sessions/${SINGAPORE}/manifest.json`)

describe.skipIf(!hasJapan)('análisis de la carrera de Japón (local)', () => {
  it('race trace: el primero de cada vuelta a 0, nadie por delante; se calcula en el hilo principal sin notarse', async () => {
    const s = await loadLocal(JAPAN)
    const table = buildLapTable(s.manifest.session.type, s.timing, s.events.raceControl)
    const t0 = performance.now()
    const trace = raceTrace(table)
    // Presupuesto: < 10 ms en el hilo principal con Japón (margen para máquinas lentas).
    expect(performance.now() - t0).toBeLessThan(50)
    expect(trace.laps.length).toBeGreaterThan(40)
    for (let k = 0; k < trace.laps.length; k++) {
      const leader = trace.series.find((x) => x.car === trace.leaderCar[k])!
      expect(leader.gapMs[k]).toBe(0)
      for (const x of trace.series) if (!Number.isNaN(x.gapMs[k]!)) expect(x.gapMs[k]).toBeGreaterThanOrEqual(0)
    }
    // Con el reloj a mitad de carrera, nada después del corte.
    const mid = (s.manifest.session.playback.startMs + s.manifest.session.playback.endMs) / 2
    const cut = raceTrace(table, mid)
    expect(cut.laps.length).toBeLessThan(trace.laps.length)
    expect(cut.leaderMs.every((x) => x <= mid)).toBe(true)
    expect(leaderLapAt(table, mid)).toBe(cut.laps.length + 1)
  })

  it('ritmo: la vuelta 1 nunca tiene tiempo oficial; las excluidas se marcan, ninguna se quita', async () => {
    const s = await loadLocal(JAPAN)
    const table = buildLapTable(s.manifest.session.type, s.timing, s.events.raceControl)
    const cars = [...table.cars.keys()]
    const paces = pace(table, cars)
    for (const p of paces) {
      expect(p.laps.length).toBe(table.cars.get(p.car)!.lap.length)
      const lap1 = p.laps.find((l) => l.lap === 1)
      if (lap1) expect(lap1.lapMs).toBeNull()
    }
    const chart = paceChart(paces, 'lap')
    expect(chart.cars.some((c) => c.excluded.some((v) => v !== null))).toBe(true)
    expect(chart.cars.every((c) => c.lap1NoTime || !table.cars.get(c.car)!.lap.includes(1))).toBe(true)
  })

  it('stints: en orden y sin solaparse, con su compuesto', async () => {
    const s = await loadLocal(JAPAN)
    const table = buildLapTable(s.manifest.session.type, s.timing, s.events.raceControl)
    for (const c of stints(table)) {
      expect(c.stints.length).toBeGreaterThan(0)
      for (let i = 1; i < c.stints.length; i++) expect(c.stints[i]!.firstLap).toBeGreaterThan(c.stints[i - 1]!.lastLap)
    }
  })

  it('detenidos (D49): solo STR y BEA; los doblados (ALO y BOT a V52, ALB a V51) cruzan tras la bandera y no cuentan', async () => {
    const s = await loadLocal(JAPAN)
    const table = buildLapTable(s.manifest.session.type, s.timing, s.events.raceControl)
    const tla = new Map(s.manifest.drivers.map((d) => [d.number, d.tla]))
    const stopped = stoppedCars(table)
    expect(new Set([...stopped.keys()].map((c) => tla.get(c)))).toEqual(new Set(['STR', 'BEA']))
    for (const name of ['ALO', 'BOT', 'ALB']) expect([...stopped.keys()].map((c) => tla.get(c))).not.toContain(name)
  })
})

describe.skipIf(!hasSingapore)('sprint de Singapur 2026 (local, D49)', () => {
  it('leyenda: 13 de arriba abajo, 8 detenidos en el orden de la clasificación y STR sin vueltas (22 pilotos)', async () => {
    const s = await loadLocal(SINGAPORE)
    const table = buildLapTable(s.manifest.session.type, s.timing, s.events.raceControl)
    const tla = new Map(s.manifest.drivers.map((d) => [d.number, d.tla]))
    const stopped = stoppedCars(table)
    // La sesión entera (todos los pasos por meta a la vista): los que no tienen ninguno, aparte.
    const order = legendOrder(raceTrace(table), stopped, lastCrossings(table), s.manifest.drivers.map((d) => d.number), true)
    expect(order.running).toHaveLength(13)
    expect(order.stopped.map((c) => `${tla.get(c)} V${stopped.get(c)}`)).toEqual([
      'PIA V19',
      'ALB V14',
      'BOR V6',
      'BOT V6',
      'HAD V2',
      'COL V2',
      'RUS V1',
      'PER V1',
    ])
    expect(order.none.map((c) => tla.get(c))).toEqual(['STR'])
    expect(order.running.length + order.stopped.length + order.none.length).toBe(s.manifest.drivers.length)
    // Con un corte (a mitad de carrera), nadie «sin vueltas»: STR, al final de los que siguen, como uno que aún no ha cruzado.
    const mid = crossingTimes(table)[Math.floor(crossingTimes(table).length / 2)]!
    const cut = legendOrder(raceTrace(table, mid), stoppedCars(table, mid), lastCrossings(table, mid), s.manifest.drivers.map((d) => d.number), false)
    expect(cut.none).toEqual([])
    expect(cut.running.at(-1)).toBe('18')
  })

  it('ficha de ALB: P15 a +74,2 s en la V10; último paso en la V14 con entrada al pit lane; dos incidentes y uno más', async () => {
    const s = await loadLocal(SINGAPORE)
    const table = buildLapTable(s.manifest.session.type, s.timing, s.events.raceControl)
    const alb = raceTrace(table).series.find((x) => x.car === '23')!
    expect(alb.posAtLine[9]).toBe(15)
    expect(Math.round(alb.gapMs[9]! / 100) / 10).toBe(74.2)
    const story = carStory(table, [...s.events.raceControl].sort((a, b) => a.t - b.t), '23')
    expect(story.lastLap).toBe(14)
    expect(story.pitInOnLastLap).toBe(true)
    expect(story.rc.map((e) => [e.lap, e.parsed.kind])).toEqual([
      [14, 'incident'],
      [9, 'incident'],
    ])
    expect(story.rc[0]!.text).toContain('23 (ALB) AND 5 (BOR)')
    expect(story.rcMore).toBe(1)
  })
})
