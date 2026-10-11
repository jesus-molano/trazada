/**
 * Tirones del mapa con datos reales (local, D52): se dibuja cada coche a 60 fps con y sin el reajuste de la hora de las
 * posiciones y se compara la velocidad dibujada (lo que avanza entre frames) con la medida (CarData). Spa FP1 era la
 * referencia (29 % de «roughness» sin reajuste); se mide con las sesiones que haya en data/.
 */
import { existsSync, readdirSync } from 'node:fs'
import type { LoadedSession } from '~/data/types'
import { describe, expect, it } from 'vitest'
import { LOCAL_DATA_ROOT, loadLocal } from '../../testing/fixture'
import { column } from '../data/columns'
import { carTracks, newCarSample, PATH_TRACK, sampleCar } from './motion'

function localSessions(): string[] {
  const root = `${LOCAL_DATA_ROOT}v1/sessions/`
  const out = new Set(['2026/10-spa-francorchamps/fp1'])
  if (existsSync(root)) {
    for (const season of readdirSync(root)) {
      for (const event of readdirSync(`${root}${season}`)) {
        for (const type of readdirSync(`${root}${season}/${event}`)) out.add(`${season}/${event}/${type}`)
      }
    }
  }
  return [...out].filter((id) => existsSync(`${root}${id}/manifest.json`))
}
const SESSIONS = localSessions()

function percentile(xs: Float64Array, p: number): number {
  const a = Float64Array.from(xs).sort()
  return a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))]!
}

const FRAME_MS = 1000 / 60

/** p95 de |dibujada/medida − 1| («roughness») y de la aceleración dibujada entre frames (m/s²), por encima de 80 km/h. */
function roughness(s: LoadedSession): { ratio: number; accel: number } {
  const tracks = carTracks(s.motion, s.tangents)
  const telCars = s.car.tables.cars!
  const ratios: number[] = []
  const accels: number[] = []
  for (const track of tracks) {
    const k = Array.from(telCars.columns.car!).indexOf(Number(track.car))
    if (k < 0) continue
    const start = telCars.columns.start![k]!
    const count = telCars.columns.count![k]!
    const ct = column(s.car, 'tel', 't').subarray(start, start + count)
    const cv = column(s.car, 'tel', 'speed').subarray(start, start + count)
    const a = newCarSample()
    const b = newCarSample()
    let j = 0
    let prev = Number.NaN
    for (let x = track.t[0]!; x + FRAME_MS < track.t[track.t.length - 1]!; x += FRAME_MS) {
      sampleCar(track, x, a)
      sampleCar(track, x + FRAME_MS, b)
      if (a.state !== 'visible' || b.state !== 'visible' || a.path !== PATH_TRACK || b.path !== PATH_TRACK) {
        prev = Number.NaN
        continue
      }
      const drawn = ((b.s - a.s) / FRAME_MS) * 3600 // km/h
      const mid = x + FRAME_MS / 2
      while (j < count - 2 && ct[j + 1]! < mid) j++
      const f = Math.min(1, Math.max(0, (mid - ct[j]!) / (ct[j + 1]! - ct[j]! || 1)))
      const measured = cv[j]! + f * (cv[j + 1]! - cv[j]!)
      if (measured < 80) {
        prev = Number.NaN
        continue
      }
      ratios.push(Math.abs(drawn / measured - 1))
      if (!Number.isNaN(prev)) accels.push(Math.abs((drawn - prev) / 3.6 / (FRAME_MS / 1000)))
      prev = drawn
    }
  }
  return { ratio: percentile(Float64Array.from(ratios), 95), accel: percentile(Float64Array.from(accels), 95) }
}

describe.skipIf(SESSIONS.length === 0)('tirones del mapa: hora de las posiciones por consenso (local, D52)', () => {
  it.each(SESSIONS)('%s', { timeout: 120_000 }, async (id) => {
    const before = await loadLocal(id, { realign: false })
    const after = await loadLocal(id)
    const raw = roughness(before)
    const fixed = roughness(after)
    console.log(
      `${id}: p95 |dibujada/medida − 1| ${(raw.ratio * 100).toFixed(1)} % → ${(fixed.ratio * 100).toFixed(1)} %; ` +
        `p95 aceleración entre frames ${raw.accel.toFixed(0)} → ${fixed.accel.toFixed(0)} m/s²; ` +
        `reajuste + tangentes ${after.timings.tangentsMs.toFixed(0)} ms (sin reajuste ${before.timings.tangentsMs.toFixed(0)} ms)`,
    )
    // Madrid y Marina Bay 2026 (carrera): 62–65 % → 10–11 %; aceleración 400 → 60 m/s².
    expect(fixed.ratio).toBeLessThan(raw.ratio / 2)
    expect(fixed.ratio).toBeLessThanOrEqual(0.15)
    expect(fixed.accel).toBeLessThan(raw.accel / 2)
  })
})
