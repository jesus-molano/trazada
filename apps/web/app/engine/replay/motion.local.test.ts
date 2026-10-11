/** Hold-out con datos reales (local): se quita una de cada dos muestras y se interpola en ellas. */
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LOCAL_DATA_ROOT, loadLocal } from '../../testing/fixture'
import { hermiteAt, segmentStarts, segmentTangents } from '../interp/hermite'
import { PATH_TRACK, type TangentMode } from './motion'

const SESSIONS = ['2026/10-spa-francorchamps/fp1', '2026/03-suzuka/race'].filter((id) =>
  existsSync(`${LOCAL_DATA_ROOT}v1/sessions/${id}/manifest.json`),
)

function percentile(xs: number[], p: number): number {
  const a = [...xs].sort((x, y) => x - y)
  return a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))]!
}

describe.skipIf(SESSIONS.length === 0)('hold-out de la interpolación (local)', () => {
  it.each(SESSIONS)('%s', async (id) => {
    const s = await loadLocal(id)
    const cars = s.motion.tables.cars!
    const T = s.motion.tables.pos!.columns.t! as Float64Array
    const S = s.motion.tables.pos!.columns.s! as Float64Array
    const P = s.motion.tables.pos!.columns.path!
    const results: Record<TangentMode, number[]> = { pchip: [], speed: [] }
    for (const mode of ['pchip', 'speed'] as TangentMode[]) {
      for (let c = 0; c < cars.rows; c++) {
        const start = cars.columns.start![c]!
        const count = cars.columns.count![c]!
        const t = T.subarray(start, start + count)
        const sv = S.subarray(start, start + count)
        const path = P.subarray(start, start + count)
        // Muestras pares como datos; impares, a predecir. Solo en pista y dentro de un segmento.
        const keep: number[] = []
        for (let i = 0; i < count; i += 2) keep.push(i)
        const kt = Float64Array.from(keep, (i) => t[i]!)
        const ks = Float64Array.from(keep, (i) => sv[i]!)
        const kp = Uint8Array.from(keep, (i) => path[i]!)
        const m = new Float64Array(keep.length)
        let speed: Float64Array | undefined
        if (mode === 'speed') {
          // Velocidad real del coche en los instantes conservados (de la telemetría)
          const { column } = await import('../data/columns')
          const carIdx = Array.from(s.car.tables.cars!.columns.car!).indexOf(cars.columns.car![c]!)
          const cs = s.car.tables.cars!.columns.start![carIdx]!
          const cc = s.car.tables.cars!.columns.count![carIdx]!
          const ct = column(s.car, 'tel', 't').subarray(cs, cs + cc)
          const cv = column(s.car, 'tel', 'speed').subarray(cs, cs + cc)
          speed = new Float64Array(keep.length)
          let j = 0
          for (let k = 0; k < keep.length; k++) {
            while (j < cc - 2 && ct[j + 1]! < kt[k]!) j++
            const f = Math.min(1, Math.max(0, (kt[k]! - ct[j]!) / (ct[j + 1]! - ct[j]! || 1)))
            speed[k] = ((cv[j]! + f * (cv[j + 1]! - cv[j]!)) / 3.6) * 1e-3
          }
        }
        const starts = segmentStarts(kt, kp, 4000)
        for (let k = 0; k < starts.length; k++) {
          const from = starts[k]!
          const to = k + 1 < starts.length ? starts[k + 1]! : keep.length
          segmentTangents(kt, ks, from, to, m, speed)
        }
        const out = { s: 0, v: 0 }
        for (let k = 0; k < keep.length - 1; k++) {
          const i = keep[k]! + 1
          if (i >= count || path[i] !== PATH_TRACK || kp[k] !== PATH_TRACK || kp[k + 1] !== PATH_TRACK) continue
          if (kt[k + 1]! - kt[k]! > 1500) continue
          hermiteAt(kt, ks, m, k, t[i]!, out)
          results[mode].push(Math.abs(out.s - sv[i]!))
        }
      }
    }
    const summary = Object.fromEntries(
      Object.entries(results).map(([k, v]) => [k, { n: v.length, p50: percentile(v, 50), p95: percentile(v, 95) }]),
    )
    console.log(id, JSON.stringify(summary))
    for (const mode of ['pchip', 'speed'] as const) {
      expect(summary[mode]!.p50).toBeLessThanOrEqual(1.5)
      expect(summary[mode]!.p95).toBeLessThanOrEqual(10)
    }
    // La velocidad medida como tangente (la que usa la app) no es peor que PCHIP.
    expect(summary.speed!.p95).toBeLessThanOrEqual(summary.pchip!.p95)
  })
})
