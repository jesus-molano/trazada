import { describe, expect, it } from 'vitest'
import { loadFixture } from '../../testing/fixture'
import { constantSpeed, ringCircuit, syntheticTrack } from '../../testing/motion'
import { carTracks, newCarSample, PATH_NODATA, PATH_PIT, PATH_TRACK, sampleCar } from '../replay/motion'
import { sAt, timeAtS } from './distance'

describe('timeAtS: tiempo en el que el coche alcanza una distancia', () => {
  it('velocidad constante: exacto, también al pasar por la línea (s acumulada, sin envoltura)', () => {
    const L = ringCircuit().centerline.length
    // 80 m/s desde 100 m antes de la línea hasta pasada una vuelta.
    const track = syntheticTrack(constantSpeed(1, { fromMs: 10_000, toMs: 60_000, stepMs: 250, speedMps: 80, s0: L - 100 }))
    for (const s of [L - 100, L - 1, L, L + 0.1, L + 1234.5, 2 * L - 0.01, L - 100 + 4000]) {
      expect(timeAtS(track, s)!).toBeCloseTo(10_000 + ((s - (L - 100)) / 80) * 1000, 6)
    }
  })

  it('es la inversa de lo que dibuja el replay (sAt), también acelerando', () => {
    const t: number[] = []
    const s: number[] = []
    for (let x = 0; x <= 20_000; x += 230) {
      t.push(x)
      s.push(5 + 0.5 * 4e-6 * x * x) // a = 4 m/s²
    }
    const track = syntheticTrack({ car: 1, t, s })
    for (let x = 50; x < 20_000; x += 333) {
      const d = sAt(track, x)!
      expect(timeAtS(track, d)!).toBeCloseTo(x, 4)
    }
  })

  it('fuera de los datos del coche, o con s no finita: null', () => {
    const track = syntheticTrack(constantSpeed(1, { fromMs: 0, toMs: 1000, stepMs: 250, speedMps: 10, s0: 100 }))
    expect(timeAtS(track, 99.9)).toBeNull()
    expect(timeAtS(track, 110.1)).toBeNull()
    expect(timeAtS(track, NaN)).toBeNull()
    expect(timeAtS(track, Infinity)).toBeNull()
    expect(timeAtS(track, 100)).toBe(0)
    expect(timeAtS(track, 110)!).toBeCloseTo(1000, 9)
  })

  it('hueco sin señal de más de 2 s: null dentro; los bordes, en su instante', () => {
    // 0–1 s a 20 m/s (0→20 m); sin señal hasta 5 s; 5–6 s de 100 a 120 m.
    const track = syntheticTrack({
      car: 1,
      t: [0, 250, 500, 750, 1000, 5000, 5250, 5500, 5750, 6000],
      s: [0, 5, 10, 15, 20, 100, 105, 110, 115, 120],
    })
    expect(timeAtS(track, 20)!).toBeCloseTo(1000, 9)
    expect(timeAtS(track, 20.01)).toBeNull()
    expect(timeAtS(track, 60)).toBeNull()
    expect(timeAtS(track, 99.99)).toBeNull()
    expect(timeAtS(track, 100)).toBe(5000)
    expect(timeAtS(track, 102.5)!).toBeCloseTo(5125, 6)
    // sAt coincide: oculto en el hueco.
    expect(sAt(track, 3000)).toBeNull()
  })

  it('muestras «sin dato» (s = 0 en el fichero) no rompen la búsqueda y su tramo es null', () => {
    const track = syntheticTrack({
      car: 1,
      t: [0, 250, 500, 750, 1000, 1250, 1500, 1750, 2000, 2250],
      s: [1000, 1010, 1020, 0, 0, 0, 1060, 1070, 1080, 1090],
      path: [0, 0, 0, 2, 2, 2, 0, 0, 0, 0].map((p) => (p === 2 ? PATH_NODATA : PATH_TRACK)),
    })
    expect(timeAtS(track, 1015)!).toBeCloseTo(375, 6)
    expect(timeAtS(track, 1040)).toBeNull()
    expect(timeAtS(track, 0)).toBeNull()
    expect(timeAtS(track, 1065)!).toBeCloseTo(1625, 6)
    expect(timeAtS(track, 1090)!).toBeCloseTo(2250, 6)
  })

  it('pit lane: s equivalente de pista, con la transición pista↔pit en recta como en el replay', () => {
    const t = [0, 250, 500, 750, 1000, 1250, 1500, 1750, 2000, 2250, 2500]
    const s = [0, 20, 40, 60, 80, 95, 110, 125, 140, 160, 180]
    const path = [0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0].map((p) => (p ? PATH_PIT : PATH_TRACK))
    const track = syntheticTrack({ car: 1, t, s, path })
    // Transición 1000 → 1250 ms (80 → 95 m): lineal.
    expect(sampleCar(track, 1100, newCarSample()).state).toBe('transition')
    expect(timeAtS(track, 86)!).toBeCloseTo(1100, 9)
    // Dentro del pit lane y en la salida.
    expect(timeAtS(track, 117.5)!).toBeCloseTo(1625, 6)
    expect(timeAtS(track, 150)!).toBeCloseTo(2125, 9)
    for (let x = 10; x < 2500; x += 97) expect(timeAtS(track, sAt(track, x)!)!).toBeCloseTo(x, 4)
  })

  it('coche parado: el primer instante en que llega a esa distancia', () => {
    // Llega a 50 m a los 1000 ms y se queda ahí hasta los 3000 ms (parada en el pit, con muestras).
    const track = syntheticTrack({
      car: 1,
      t: [0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000],
      s: [0, 25, 50, 50, 50, 50, 50, 75, 100],
    })
    expect(timeAtS(track, 50)!).toBeCloseTo(1000, 6)
    expect(timeAtS(track, 50.001)!).toBeGreaterThan(3000)
  })
})

describe('con el fixture real', () => {
  it('s no decrece en las muestras con dato (el contrato del pipeline) e ida y vuelta con sAt', async () => {
    const f = await loadFixture()
    const tracks = carTracks(f.motion, f.tangents)
    const smp = newCarSample()
    let checked = 0
    let gaps = 0
    const t0 = performance.now()
    for (const tr of tracks) {
      let last = -Infinity
      for (let i = 0; i < tr.t.length; i++) {
        if (tr.path[i] === PATH_NODATA) continue
        expect(tr.s[i]!).toBeGreaterThanOrEqual(last)
        last = tr.s[i]!
      }
      const from = tr.t[0]!
      const to = tr.t[tr.t.length - 1]!
      for (let x = from; x < to; x += 1777) {
        const st = sampleCar(tr, x, smp)
        if (st.state === 'hidden') {
          gaps++
          continue
        }
        if (st.speed < 1) continue // parado: el primer instante en esa distancia es anterior
        const back = timeAtS(tr, st.s)
        expect(back).not.toBeNull()
        expect(Math.abs(back! - x)).toBeLessThan(1)
        checked++
      }
    }
    const ms = performance.now() - t0
    expect(checked).toBeGreaterThan(500)
    expect(gaps).toBeGreaterThan(0)
    expect(ms).toBeLessThan(2000)
  })
})
