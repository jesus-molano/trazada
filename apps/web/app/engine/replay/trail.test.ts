import { describe, expect, it } from 'vitest'
import { constantSpeed, ringCircuit, syntheticTrack } from '../../testing/motion'
import { newSample } from '../track/TrackPath'
import { newCarSample, PATH_NODATA, PATH_PIT, PATH_TRACK, sampleCar } from './motion'
import { newPlaceScratch, placeOnCircuit, type PlacedPoint, placeSample } from './place'
import { ReplayModel } from './ReplayModel'
import {
  intervalDrawn,
  latestSample,
  newTrailScratch,
  sampleTrail,
  speedFraction,
  TRAIL_POINTS,
  TRAIL_SPAN_MS,
  TRAIL_SPEED_KMH,
  TRAIL_STRIDE,
  trailAlpha,
} from './trail'

const pit = { entryS: 2900, exitS: 200, lengthM: 600 }
const ring = ringCircuit({ radius: 500, pit })
const L = ring.centerline.length

const buffer = (points = TRAIL_POINTS) => new Float64Array(points * TRAIL_STRIDE)
const point = (out: Float64Array, k: number) => {
  const o = k * TRAIL_STRIDE
  return { x: out[o]!, y: out[o + 1]!, z: out[o + 2]!, heading: out[o + 3]!, t: out[o + 4]! }
}

/** Coche a 50 m/s por pista desde s = 1000, con una muestra cada 250 ms durante 20 s. */
const cruising = syntheticTrack(constantSpeed(1, { fromMs: 0, toMs: 20_000, stepMs: 250, speedMps: 50, s0: 1000 }))

describe('sampleTrail', () => {
  it('los últimos 3 s a intervalos iguales, de la cola al coche, y la punta es el coche (como en ReplayModel)', () => {
    const out = buffer()
    const t = 10_000
    const n = sampleTrail(ring, cruising, t, out, newTrailScratch())
    expect(n).toBe(TRAIL_POINTS)
    const step = TRAIL_SPAN_MS / (TRAIL_POINTS - 1)
    for (let k = 0; k < n; k++) expect(point(out, k).t).toBeCloseTo(t - TRAIL_SPAN_MS + k * step, 9)
    expect(point(out, n - 1).t).toBe(t)

    const model = new ReplayModel([cruising], ring, [])
    model.update(t)
    const st = model.states[0]!
    const head = point(out, n - 1)
    expect([head.x, head.y, head.z, head.heading]).toEqual([st.x, st.y, st.z, st.heading])

    // La cola, donde estaba el coche 3 s antes: 150 m más atrás por la línea central.
    const tail = point(out, 0)
    const q = ring.centerline.sample(1000 + 50 * 7, newSample())
    expect(tail.x).toBeCloseTo(q.x, 6)
    expect(tail.y).toBeCloseTo(q.y, 6)
  })

  it('los puntos avanzan por la pista y cubren s(t) − s(t − 3 s)', () => {
    const out = buffer()
    const n = sampleTrail(ring, cruising, 12_000, out, newTrailScratch())
    let length = 0
    for (let k = 1; k < n; k++) {
      const a = point(out, k - 1)
      const b = point(out, k)
      const d = Math.hypot(b.x - a.x, b.y - a.y)
      expect(d).toBeGreaterThan(0)
      length += d
      // Hacia delante: el desplazamiento va en el sentido del rumbo.
      expect((b.x - a.x) * Math.cos(a.heading) + (b.y - a.y) * Math.sin(a.heading)).toBeGreaterThan(0)
    }
    expect(length).toBeCloseTo(50 * 3, 0)
  })

  it('cruza s = 0 sin saltos (la estela sigue la pista de una vuelta a la siguiente)', () => {
    const lap = syntheticTrack(constantSpeed(2, { fromMs: 0, toMs: 10_000, stepMs: 250, speedMps: 60, s0: L - 200 }))
    const out = buffer()
    // A los 4 s, el coche lleva 40 m de la vuelta nueva; la cola, 140 m antes de la línea.
    const n = sampleTrail(ring, lap, 4000, out, newTrailScratch())
    expect(n).toBe(TRAIL_POINTS)
    const maxStep = (60 * TRAIL_SPAN_MS) / (TRAIL_POINTS - 1) / 1000
    for (let k = 1; k < n; k++) {
      const a = point(out, k - 1)
      const b = point(out, k)
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThan(maxStep * 1.01)
    }
    expect(point(out, 0).y).toBeLessThan(0) // antes de la línea (s = 0 en (500, 0), sentido antihorario)
    expect(point(out, n - 1).y).toBeGreaterThan(0)
  })

  it('se corta en un hueco de más de 2 s: solo el tramo que acaba en el coche, sin puentear', () => {
    // Muestras hasta 5000 ms y de nuevo desde 7500 ms (hueco de 2,5 s: el coche no se dibuja en él).
    const t = [0, 250, 500, 750, 1000, 2000, 3000, 4000, 5000, 7500, 7750, 8000, 8250, 8500]
    const track = syntheticTrack({ car: 3, t, s: t.map((x) => 1000 + 0.05 * x) })
    const out = buffer()
    const now = 8500
    const n = sampleTrail(ring, track, now, out, newTrailScratch())
    expect(n).toBeGreaterThan(1)
    expect(point(out, 0).t).toBeGreaterThanOrEqual(7500)
    for (let k = 0; k < n; k++) expect(sampleCar(track, point(out, k).t, newCarSample()).state).not.toBe('hidden')
    // Dentro del hueco, ni un punto; justo después, 1 s de estela (de 7500 a 8500).
    expect(point(out, n - 1).t - point(out, 0).t).toBeLessThanOrEqual(1000)
  })

  it('se corta donde no hay dato (path 2), aunque el intervalo sea más corto que el paso entre puntos', () => {
    // Un intervalo sin dato de 250 ms (de 1000 a 1250) entre dos puntos de una estela de 4 puntos (1 s de paso).
    const t = [0, 250, 500, 750, 1000, 1250, 1500, 1750, 2000, 2250, 2500, 2750, 3000]
    const path = t.map((x) => (x === 1000 ? PATH_NODATA : PATH_TRACK))
    const track = syntheticTrack({ car: 4, t, s: t.map((x) => (x === 1000 ? 0 : 1000 + 0.05 * x)), path })
    expect(intervalDrawn(track, t.indexOf(1000))).toBe(false)
    const out = buffer(4)
    const n = sampleTrail(ring, track, 3000, out, newTrailScratch(), { spanMs: 3000, points: 4 })
    // Puntos en 0, 1000, 2000 y 3000: el de 1000 cae en el intervalo sin dato; del de 0 al de 2000 hay un hueco.
    expect(n).toBe(2)
    expect([point(out, 0).t, point(out, 1).t]).toEqual([2000, 3000])
  })

  it('sin coche en el instante, o con menos de dos puntos seguidos, no hay estela', () => {
    const out = buffer()
    expect(sampleTrail(ring, cruising, 25_000, out, newTrailScratch())).toBe(0) // después de la última muestra
    expect(sampleTrail(ring, cruising, -10, out, newTrailScratch())).toBe(0)
    // El coche aparece a los 0 ms: a los 50 ms solo hay un punto con coche (el de la punta).
    expect(sampleTrail(ring, cruising, 50, out, newTrailScratch())).toBe(0)
    // A los 1000 ms, la estela empieza donde empieza el dato (no antes).
    const n = sampleTrail(ring, cruising, 1000, out, newTrailScratch())
    expect(n).toBeGreaterThan(1)
    expect(point(out, 0).t).toBeGreaterThanOrEqual(0)
  })

  it('en el pit lane, los puntos van sobre el pit lane; la transición pista↔pit no corta la estela', () => {
    // Por pista hasta 1000 ms, transición y pit lane desde 1250 ms (como en place.test.ts).
    const t = [0, 250, 500, 750, 1000, 1250, 1500, 1750, 2000, 2250, 2500, 2750, 3000, 3250]
    const s = [2700, 2740, 2780, 2820, 2860, 2900, 2920, 2940, 2960, 2980, 3000, 3020, 3040, 3060]
    const path = t.map((x) => (x >= 1250 ? PATH_PIT : PATH_TRACK))
    const track = syntheticTrack({ car: 5, t, s, path })
    const out = buffer()
    const n = sampleTrail(ring, track, 3250, out, newTrailScratch())
    expect(n).toBe(TRAIL_POINTS) // 3 s continuos: pista, transición y pit
    const smp = newCarSample()
    const scratch = newPlaceScratch()
    const placed: PlacedPoint = { x: 0, y: 0, z: 0, heading: 0 }
    let inPit = 0
    for (let k = 0; k < n; k++) {
      const p = point(out, k)
      sampleCar(track, p.t, smp)
      placeSample(ring, track, smp, placed, scratch)
      expect([p.x, p.y]).toEqual([placed.x, placed.y])
      if (smp.state === 'visible' && smp.path === PATH_PIT) {
        const q = placeOnCircuit(ring, PATH_PIT, smp.s, newSample())
        expect(p.y).toBeCloseTo(q.y, 9) // el pit lane del anillo es la recta y = −400
        inPit++
      }
    }
    expect(inPit).toBeGreaterThan(10)
  })

  it('no necesita historial: el mismo resultado con el cursor frío que tras otros instantes (seek atrás)', () => {
    const warm = newTrailScratch()
    const a = buffer()
    for (const x of [18_000, 2000, 15_000]) sampleTrail(ring, cruising, x, a, warm)
    const nWarm = sampleTrail(ring, cruising, 9_137, a, warm)
    const b = buffer()
    const nCold = sampleTrail(ring, cruising, 9_137, b, newTrailScratch())
    expect(nWarm).toBe(nCold)
    expect(Array.from(a.subarray(0, nWarm * TRAIL_STRIDE))).toEqual(Array.from(b.subarray(0, nCold * TRAIL_STRIDE)))
  })

  it('un búfer sin sitio para todos los puntos es un error', () => {
    expect(() => sampleTrail(ring, cruising, 10_000, new Float64Array(10), newTrailScratch())).toThrow(RangeError)
  })
})

describe('latestSample (velocidad de la estela)', () => {
  const times = new Float64Array([1000, 1270, 1500, 6000])

  it('la última muestra con t ≤ x, sin interpolar; en su instante exacto, esa', () => {
    const cursor = { i: 0 }
    expect(latestSample(times, 1000, cursor)).toBe(0)
    expect(latestSample(times, 1269, cursor)).toBe(0)
    expect(latestSample(times, 1270, cursor)).toBe(1)
    expect(latestSample(times, 3400, cursor)).toBe(2) // 1900 ms de antigüedad
  })

  it('sin muestra de hace 2 s o menos (o antes de la primera): −1, «sin dato»', () => {
    const cursor = { i: 0 }
    expect(latestSample(times, 999, cursor)).toBe(-1)
    expect(latestSample(times, 3501, cursor)).toBe(-1)
    expect(latestSample(times, 8001, cursor)).toBe(-1)
    expect(latestSample(new Float64Array(0), 1000, cursor)).toBe(-1)
  })

  it('el cursor solo acelera: hacia atrás da lo mismo que en frío', () => {
    const cursor = { i: 0 }
    latestSample(times, 6500, cursor)
    expect(latestSample(times, 1300, cursor)).toBe(latestSample(times, 1300, { i: 0 }))
  })
})

describe('color y opacidad', () => {
  it('escala fija de velocidad, saturada en los extremos', () => {
    expect(speedFraction(TRAIL_SPEED_KMH.min)).toBe(0)
    expect(speedFraction(TRAIL_SPEED_KMH.max)).toBe(1)
    expect(speedFraction(0)).toBe(0)
    expect(speedFraction(400)).toBe(1)
    expect(speedFraction((TRAIL_SPEED_KMH.min + TRAIL_SPEED_KMH.max) / 2)).toBeCloseTo(0.5, 9)
    expect(speedFraction(Number.NaN)).toBe(0)
  })

  it('se desvanece del coche a la cola', () => {
    expect(trailAlpha(0, 0.8)).toBeCloseTo(0.8, 9)
    expect(trailAlpha(1, 0.8)).toBe(0)
    expect(trailAlpha(0.5, 0.8)).toBeCloseTo(0.4, 9)
    expect(trailAlpha(-1, 0.8)).toBeCloseTo(0.8, 9)
    expect(trailAlpha(2, 0.8)).toBe(0)
  })
})
