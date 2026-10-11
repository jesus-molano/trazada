import { describe, expect, it } from 'vitest'
import { ringCircuit, syntheticTrack } from '../../testing/motion'
import { newSample } from '../track/TrackPath'
import { newCarSample, PATH_NODATA, PATH_PIT, PATH_TRACK, sampleCar } from './motion'
import { newPlaceScratch, pitSpan, placeOnCircuit, placeSample, type PlacedPoint } from './place'
import { ReplayModel } from './ReplayModel'

const pit = { entryS: 2900, exitS: 200, lengthM: 600 }
const ring = ringCircuit({ radius: 500, pit })
const L = ring.centerline.length

const point = (): PlacedPoint => ({ x: NaN, y: NaN, z: NaN, heading: NaN })

describe('placeOnCircuit', () => {
  it('en pista, la línea central en s (con envoltura en s = 0 y s acumulada)', () => {
    const a = placeOnCircuit(ring, PATH_TRACK, 0, newSample())
    expect(a.x).toBeCloseTo(500, 6)
    expect(a.y).toBeCloseTo(0, 6)
    const b = placeOnCircuit(ring, PATH_TRACK, 3 * L + 100, newSample())
    const c = ring.centerline.sample(100, newSample())
    expect([b.x, b.y]).toEqual([c.x, c.y])
  })

  it('tramo de pit con envoltura en s = 0: de la entrada a la salida', () => {
    // La entrada está antes de la línea (2900) y la salida después (200): el tramo cruza s = 0.
    expect(pitSpan(ring)).toBeCloseTo(L - 2900 + 200, 6)
    expect(pitSpan(ringCircuit())).toBe(0)
  })

  it('en el pit lane, la fracción del tramo entrada→salida sobre la longitud del pit lane', () => {
    const span = pitSpan(ring)
    const start = placeOnCircuit(ring, PATH_PIT, pit.entryS, newSample())
    expect(start.x).toBeCloseTo(-300, 6)
    const mid = placeOnCircuit(ring, PATH_PIT, pit.entryS + span / 2 - L, newSample()) // s acumulada de otra vuelta
    expect(mid.x).toBeCloseTo(0, 6)
    expect(mid.y).toBeCloseTo(-400, 6)
    // Fuera del tramo (dato raro) se satura en los extremos del pit lane.
    const end = placeOnCircuit(ring, PATH_PIT, pit.exitS + 50, newSample())
    expect(end.x).toBeCloseTo(300, 6)
  })

  it('sin pit lane (o sin tramo de pit), el pit se dibuja sobre la línea central', () => {
    const bare = ringCircuit()
    const p = placeOnCircuit(bare, PATH_PIT, 250, newSample())
    const q = bare.centerline.sample(250, newSample())
    expect([p.x, p.y]).toEqual([q.x, q.y])
  })
})

describe('placeSample', () => {
  // Coche que va por pista hasta 1000 ms y entra en el pit lane (cambio de camino sin hueco: transición).
  const track = syntheticTrack({
    car: 7,
    t: [0, 250, 500, 750, 1000, 1250, 1500, 1750, 2000, 6000, 6250],
    s: [2700, 2740, 2780, 2820, 2860, 2900, 2930, 2960, 2990, 0, 0],
    path: [0, 0, 0, 0, 0, 1, 1, 1, 1, PATH_NODATA, PATH_NODATA],
  })

  it('visible: el punto de su camino y el rumbo de la tangente', () => {
    const smp = sampleCar(track, 500, newCarSample())
    const out = point()
    expect(placeSample(ring, track, smp, out, newPlaceScratch())).toBe(true)
    const q = ring.centerline.sample(2780, newSample())
    expect(out.x).toBeCloseTo(q.x, 9)
    expect(out.y).toBeCloseTo(q.y, 9)
    expect(out.heading).toBeCloseTo(Math.atan2(q.ty, q.tx), 9)
  })

  it('transición pista↔pit: recta entre la última muestra de un camino y la primera del otro', () => {
    const smp = sampleCar(track, 1125, newCarSample())
    expect(smp.state).toBe('transition')
    const out = point()
    placeSample(ring, track, smp, out, newPlaceScratch())
    const a = placeOnCircuit(ring, PATH_TRACK, 2860, newSample())
    const b = placeOnCircuit(ring, PATH_PIT, 2900, newSample())
    expect(out.x).toBeCloseTo((a.x + b.x) / 2, 9)
    expect(out.y).toBeCloseTo((a.y + b.y) / 2, 9)
    expect(out.heading).toBeCloseTo(Math.atan2(b.y - a.y, b.x - a.x), 9)
  })

  it('oculta (hueco o sin dato): devuelve false y no toca el punto', () => {
    const out = point()
    for (const t of [-10, 4000, 6100]) {
      const smp = sampleCar(track, t, newCarSample())
      expect(placeSample(ring, track, smp, out, newPlaceScratch())).toBe(false)
    }
    expect(out.x).toBeNaN()
  })

  it('ReplayModel coloca los coches con la misma lógica', () => {
    const model = new ReplayModel([track], ring, [])
    const smp = newCarSample()
    const scratch = newPlaceScratch()
    for (let t = 0; t <= 2000; t += 37) {
      model.update(t)
      const st = model.states[0]!
      const out = point()
      const visible = placeSample(ring, track, sampleCar(track, t, smp), out, scratch)
      expect(st.visible).toBe(visible)
      if (!visible) continue
      expect([st.x, st.y, st.z, st.heading]).toEqual([out.x, out.y, out.z, out.heading])
      expect(st.inPit).toBe(smp.path === PATH_PIT)
    }
  })
})
