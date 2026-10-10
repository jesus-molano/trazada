/**
 * Comparación con sesiones completas (local): coste por frame (diferencia, fantasma y oficial) y de las trazas por
 * vuelta, y coherencia con el cronometraje: al cerrar la vuelta, la diferencia en vivo (GPS, décimas) cae cerca de la
 * oficial (tiempos de vuelta) cuando la referencia es la misma vuelta.
 */
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LOCAL_DATA_ROOT, loadLocal } from '../../testing/fixture'
import { buildLapTable, lapIndex } from '../analysis/lapTable'
import { carTracks } from '../replay/motion'
import { circuitModel } from '../track/circuit'
import { CompareSession } from './session'

const SESSIONS = ['2026/10-spa-francorchamps/fp1', '2026/03-suzuka/race'].filter((id) =>
  existsSync(`${LOCAL_DATA_ROOT}v1/sessions/${id}/manifest.json`),
)

describe.skipIf(SESSIONS.length === 0)('comparación con datos completos (local)', () => {
  it.each(SESSIONS)('%s', async (id) => {
    const s = await loadLocal(id)
    const table = buildLapTable(s.manifest.session.type, s.timing, s.events.raceControl)
    const cmp = new CompareSession({
      session: s,
      model: { tracks: carTracks(s.motion, s.tangents) },
      leaderboard: { lapTable: table },
      circuit: circuitModel(s.circuit),
    })
    const [a, b] = [...table.cars.keys()]
    const { startMs, endMs } = s.manifest.session.playback
    let frames = 0
    let ok = 0
    let t0 = performance.now()
    for (let t = startMs; t < endMs; t += 250) {
      for (const mode of ['same', 'best', 'last'] as const) {
        const f = cmp.frame(a!, b!, mode, t)
        cmp.official(a!, b!, mode, t)
        frames++
        if (f.delta.state === 'ok') ok++
      }
    }
    const perFrameMs = (performance.now() - t0) / frames

    // Trazas de todas las vueltas de A (una por vuelta: se calculan al cambiar de vuelta).
    const starts = cmp.starts(a!)!
    t0 = performance.now()
    let traced = 0
    for (let k = 0; k < starts.t.length; k++) {
      const f = cmp.frame(a!, b!, 'same', starts.t[k]! + 1000)
      if (cmp.traceA(f)) traced++
    }
    const perTraceMs = (performance.now() - t0) / Math.max(1, traced)

    // Al cerrar una vuelta (misma vuelta), la diferencia en vivo del último en cerrarla está cerca de la oficial (±8 m
    // de GPS en la línea): justo antes de cruzar, el otro ya la había cerrado y se compara en su distancia.
    const errs: number[] = []
    const lapsA = table.cars.get(a!)!
    const lapsB = table.cars.get(b!)!
    for (let k = 0; k < lapsA.lap.length; k++) {
      const lap = lapsA.lap[k]!
      const j = lapIndex(lapsB, lap)
      const crossA = lapsA.crossMs[k]!
      const crossB = j < 0 ? -1 : lapsB.crossMs[j]!
      if (!(crossA > 0 && crossB > 0) || lap === 1) continue
      const [first, last] = crossA <= crossB ? [a!, b!] : [b!, a!]
      const end = Math.max(crossA, crossB)
      const live = cmp.frame(last, first, 'same', end - 1)
      if (live.delta.state !== 'ok' || live.lapA !== lap) continue
      const ms = live.delta.ms
      const off = cmp.official(last, first, 'same', end + 1)
      if (!off || off.lapA !== lap || off.diffMs === null) continue
      errs.push(Math.abs(ms - off.diffMs))
    }
    errs.sort((x, y) => x - y)
    const median = errs.length ? errs[errs.length >> 1]! : 0

    console.log(
      `${id}: ${a} frente a ${b} · ${frames} frames en ${perFrameMs.toFixed(4)} ms/frame (${ok} con cifra) · ` +
        `${traced} trazas a ${perTraceMs.toFixed(2)} ms · cierre de vuelta: mediana ${median.toFixed(0)} ms (${errs.length})`,
    )
    expect(perFrameMs).toBeLessThan(0.2)
    expect(perTraceMs).toBeLessThan(10)
    // Medido: mediana de 75–83 ms en Spa (libres 1) y Suzuka (carrera).
    if (errs.length >= 5) expect(median).toBeLessThan(250)
  })
})
