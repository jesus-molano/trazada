/**
 * Motor compartido con sesiones completas (local): contrato de s monótona, ida y vuelta distancia↔tiempo,
 * inicio de vuelta sobre la línea de meta y presupuestos de precálculo (< 10 ms en el hilo
 * principal para el índice de vueltas; < 50 ms para un barrido de minisectores de toda la sesión).
 */
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LOCAL_DATA_ROOT, loadLocal } from '../../testing/fixture'
import { buildLapTable, LAP_NOT_REPRESENTATIVE, lapIs } from '../analysis/lapTable'
import { carTracks, newCarSample, PATH_NODATA, sampleCar } from '../replay/motion'
import { circuitModel } from '../track/circuit'
import { timeAtS } from './distance'
import { lapStartsByCar } from './laps'

const SESSIONS = ['2026/10-spa-francorchamps/fp1', '2026/03-suzuka/race'].filter((id) =>
  existsSync(`${LOCAL_DATA_ROOT}v1/sessions/${id}/manifest.json`),
)

describe.skipIf(SESSIONS.length === 0)('motor compartido con datos completos (local)', () => {
  // Carga la sesión entera (gunzip y TRZB) y la recorre coche a coche cada 5 s: 2–3 s en solitario, y más del límite
  // de 5 s con la CPU compartida de la suite completa (falló así dos veces en el cierre de las 21 funciones, con los
  // cálculos ya hechos y dentro de sus presupuestos). Lo que se mide son los presupuestos de abajo, no esta espera.
  it.each(SESSIONS)('%s', { timeout: 30_000 }, async (id) => {
    const s = await loadLocal(id)
    const L = circuitModel(s.circuit).centerline.length
    const tracks = carTracks(s.motion, s.tangents)

    // s no decrece en las muestras con dato (contrato del pipeline en el que se apoya timeAtS).
    for (const tr of tracks) {
      let last = -Infinity
      for (let i = 0; i < tr.t.length; i++) {
        if (tr.path[i] === PATH_NODATA) continue
        expect(tr.s[i]!, `${tr.car} @ ${tr.t[i]}`).toBeGreaterThanOrEqual(last)
        last = tr.s[i]!
      }
    }

    let t0 = performance.now()
    const table = buildLapTable(s.manifest.session.type, s.timing, s.events.raceControl)
    const tableMs = performance.now() - t0
    t0 = performance.now()
    const starts = lapStartsByCar(table, tracks)
    const startsMs = performance.now() - t0

    // Inicio de vuelta del cronometraje frente a la línea de meta del GPS.
    const errs: number[] = []
    for (const st of starts.values()) {
      for (const x of st.s) if (!Number.isNaN(x)) errs.push(Math.abs(x - Math.round(x / L) * L))
    }
    errs.sort((a, b) => a - b)
    const median = errs[errs.length >> 1]!

    // Barrido de 25 minisectores en cada vuelta representativa de cada coche.
    const byCar = new Map(tracks.map((tr) => [tr.car, tr]))
    let calls = 0
    let nulls = 0
    t0 = performance.now()
    for (const [car, laps] of table.cars) {
      const tr = byCar.get(car)
      const st = starts.get(car)!
      if (!tr) continue
      for (let k = 0; k < st.lap.length; k++) {
        const s0 = st.s[k]!
        if (Number.isNaN(s0)) continue
        const idx = laps.lap.indexOf(st.lap[k]!)
        if (idx < 0 || lapIs(laps, idx, LAP_NOT_REPRESENTATIVE, Infinity)) continue
        for (let m = 0; m <= 25; m++) {
          calls++
          if (timeAtS(tr, s0 + (m * L) / 25) === null) nulls++
        }
      }
    }
    const sweepMs = performance.now() - t0

    // Ida y vuelta en instantes con el coche en marcha.
    const smp = newCarSample()
    let worst = 0
    for (const tr of tracks) {
      for (let x = tr.t[0]!; x < tr.t[tr.t.length - 1]!; x += 4999) {
        const q = sampleCar(tr, x, smp)
        if (q.state === 'hidden' || q.speed < 1) continue
        worst = Math.max(worst, Math.abs(timeAtS(tr, q.s)! - x))
      }
    }

    console.log(
      `${id}: índice ${tableMs.toFixed(1)} ms · inicios ${startsMs.toFixed(1)} ms · línea mediana ${median.toFixed(1)} m · ` +
        `minisectores ${calls} en ${sweepMs.toFixed(1)} ms (${nulls} sin dato) · ida y vuelta peor ${worst.toFixed(3)} ms`,
    )
    expect(tableMs).toBeLessThan(10)
    expect(sweepMs).toBeLessThan(50)
    expect(median).toBeLessThan(10)
    expect(worst).toBeLessThan(1)
  })
})
