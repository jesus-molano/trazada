import { describe, expect, it } from 'vitest'
import { loadFixture } from '../../testing/fixture'
import { carTracks } from '../replay/motion'
import { ReplayModel } from '../replay/ReplayModel'
import { circuitModel } from '../track/circuit'
import {
  clampFollowDistance,
  FOLLOW_DISTANCE_M,
  FOLLOW_MAX_DISTANCE_M,
  FOLLOW_MIN_DISTANCE_M,
  FOLLOW_PITCH_DEG,
  FollowCamera,
  YAW_MAX_ACCEL,
} from './FollowCamera'

/**
 * 60 s de sesión guionizados siguiendo a un coche real del fixture, a ×1 y ×16 (60 fps de reloj real).
 * Umbral de suavidad (calibrado en H8): |d²yaw/dt²| ≤ 6 rad/s² y |d²pitch/dt²| = 0 (pitch constante).
 */
async function scripted(rate: number) {
  const s = await loadFixture()
  const model = new ReplayModel(carTracks(s.motion, s.tangents), circuitModel(s.circuit), s.manifest.drivers)
  const start = s.manifest.session.playback.startMs + 30_000
  // Un coche en pista durante todo el tramo
  const candidates = model.states.map((st) => st.car)
  let car = candidates[0]!
  for (const c of candidates) {
    let ok = true
    for (let t = start; t <= start + 60_000 && ok; t += 1000) {
      model.update(t)
      const st = model.states.find((x) => x.car === c)!
      ok = st.visible && !st.inPit && st.speedMps > 20
    }
    if (ok) {
      car = c
      break
    }
  }
  const cam = new FollowCamera()
  const dtWall = 1 / 60
  const yaw: number[] = []
  const pitch: number[] = []
  const errors: number[] = []
  for (let t = start; t <= start + 60_000; t += dtWall * 1000 * rate) {
    model.update(t)
    const st = model.states.find((x) => x.car === car)!
    cam.update({ x: st.x, y: st.z, z: -st.y }, st.heading, dtWall)
    yaw.push(cam.yaw)
    pitch.push(cam.pitch)
    const e = Math.atan2(Math.sin(-st.heading - cam.yaw), Math.cos(-st.heading - cam.yaw))
    errors.push(Math.abs(e))
  }
  const d2 = (a: number[]) => {
    let max = 0
    for (let i = 1; i < a.length - 1; i++) max = Math.max(max, Math.abs(a[i + 1]! - 2 * a[i]! + a[i - 1]!) / dtWall ** 2)
    return max
  }
  return { yawAcc: d2(yaw), pitchAcc: d2(pitch), frames: yaw.length, errors }
}

describe('cámara de seguimiento: suavidad', () => {
  it.each([1, 16])('×%i: segunda derivada de yaw y pitch bajo el umbral', async (rate) => {
    const r = await scripted(rate)
    console.log(`×${rate}: ${r.frames} frames, máx |d²yaw/dt²| = ${r.yawAcc.toFixed(3)} rad/s²`)
    expect(r.frames).toBeGreaterThan(rate === 1 ? 3500 : 220)
    expect(r.yawAcc).toBeLessThanOrEqual(YAW_MAX_ACCEL + 1e-6)
    expect(r.pitchAcc).toBe(0)
    if (rate === 1) {
      // A ×1 la cámara va detrás del coche: error medio pequeño
      const mean = r.errors.reduce((a, b) => a + b, 0) / r.errors.length
      expect((mean * 180) / Math.PI).toBeLessThan(10)
    }
  })

  it('posición detrás y por encima del coche', () => {
    const cam = new FollowCamera(100)
    cam.update({ x: 0, y: 0, z: 0 }, 0, 1 / 60) // rumbo +x canónico → yaw 0
    const p = cam.position({ x: 0, y: 0, z: 0 })
    expect(p.x).toBeCloseTo(-100 * Math.cos((FOLLOW_PITCH_DEG * Math.PI) / 180), 6)
    expect(p.y).toBeCloseTo(100 * Math.sin((FOLLOW_PITCH_DEG * Math.PI) / 180), 6)
    expect(p.z).toBeCloseTo(0, 6)
  })

  it('zoom: la distancia se puede cambiar, dentro de sus límites', () => {
    expect(clampFollowDistance(5)).toBe(FOLLOW_MIN_DISTANCE_M)
    expect(clampFollowDistance(500)).toBe(FOLLOW_MAX_DISTANCE_M)
    expect(clampFollowDistance(Number.NaN)).toBe(FOLLOW_DISTANCE_M)
    expect(new FollowCamera(1).distance).toBe(FOLLOW_MIN_DISTANCE_M)
    const cam = new FollowCamera()
    cam.update({ x: 0, y: 0, z: 0 }, 0, 1 / 60)
    cam.distance = 20
    expect(cam.position({ x: 0, y: 0, z: 0 }).y).toBeCloseTo(20 * Math.sin((FOLLOW_PITCH_DEG * Math.PI) / 180), 6)
  })
})
