import type { DecodedTrzb, Manifest } from '@trazada/schema'
import { describe, expect, it } from 'vitest'
import { loadFixture } from '../../testing/fixture'
import { ringCircuit, syntheticTracks, type TrackSpec } from '../../testing/motion'
import { column } from '../data/columns'
import { carTracks, newCarSample, PATH_PIT, PATH_TRACK, sampleCar } from '../replay/motion'
import { circuitModel } from '../track/circuit'
import { rangeIndices } from '../track/ribbon'
import { drsZoneMesh } from './zoneMesh'
import {
  deduceDrsZones,
  type DrsCarInput,
  type DrsZones,
  drsZonesUnavailable,
  noDrsZones,
  sessionDrsZones,
  spanLength,
} from './zones'

/** Longitud de la vuelta sintética (m). */
const L = 3000
const SPEED = 60 // m/s
const MOTION_STEP = 250 // ms
const TEL_STEP = 270 // ms (otra cadencia que la posición, como en los datos reales)
const OPEN = 12
const CLOSED = 0
const AVAILABLE = 8

/** ¿Está s (m, acumulada) dentro de [a, b) en la vuelta (con envoltura en s = 0)? */
const inside = (s: number, a: number, b: number) => {
  const x = ((s % L) + L) % L
  return a <= b ? x >= a && x < b : x >= a || x < b
}

interface CarSpec {
  car: number
  laps: number
  /** Desfase (ms) de la telemetría y salida (m) de la posición: cada coche pasa por la zona a otra fase. */
  phase?: number
  s0?: number
  /** Código DRS de cada muestra a partir de su s acumulada y su instante. */
  code: (s: number, t: number) => number
  /** Camino de cada muestra de posición (pista por defecto). */
  path?: (s: number) => number
  /** Cadencia de la telemetría (ms). */
  telStep?: number
}

/** Coches a velocidad constante dando vueltas: su pista de movimiento y su telemetría con el código pedido. */
function session(specs: readonly CarSpec[]): DrsCarInput[] {
  const motion: TrackSpec[] = specs.map((c) => {
    const s0 = c.s0 ?? 0
    const duration = ((c.laps * L) / SPEED) * 1000
    const t: number[] = []
    const s: number[] = []
    const path: number[] = []
    for (let x = 0; x <= duration; x += MOTION_STEP) {
      t.push(x)
      s.push(s0 + (SPEED * x) / 1000)
      path.push(c.path?.(s0 + (SPEED * x) / 1000) ?? PATH_TRACK)
    }
    return { car: c.car, t, s, path }
  })
  const tracks = syntheticTracks(motion)
  return specs.map((c, k) => {
    const s0 = c.s0 ?? 0
    const duration = ((c.laps * L) / SPEED) * 1000
    const t: number[] = []
    const drs: number[] = []
    for (let x = c.phase ?? 0; x <= duration; x += c.telStep ?? TEL_STEP) {
      t.push(x)
      drs.push(c.code(s0 + (SPEED * x) / 1000, x))
    }
    return { t: Float64Array.from(t), drs: Uint8Array.from(drs), track: tracks[k]! }
  })
}

/** n coches que abren el DRS en [a, b) en cada vuelta, cada uno con su fase. */
function field(n: number, a: number, b: number, laps = 3, extra: Partial<CarSpec> = {}): CarSpec[] {
  return Array.from({ length: n }, (_, k) => ({
    car: k + 1,
    laps,
    phase: (k * 37) % TEL_STEP,
    s0: k * 7,
    code: (s: number) => (inside(s, a, b) ? OPEN : AVAILABLE),
    ...extra,
  }))
}

const spansOf = (z: DrsZones): [number, number][] =>
  Array.from({ length: z.spans.length / 2 }, (_, k) => [z.spans[k * 2]!, z.spans[k * 2 + 1]!])

describe('deduceDrsZones', () => {
  it('coches que abren en [800, 1400) en cada vuelta: una zona a ±10 m, con sus pasadas y coches', () => {
    const z = deduceDrsZones(session(field(10, 800, 1400)), { lengthM: L })
    expect(z.status).toBe('deduced')
    const spans = spansOf(z)
    expect(spans).toHaveLength(1)
    expect(spans[0]![0]).toBeGreaterThanOrEqual(790)
    expect(spans[0]![0]).toBeLessThanOrEqual(810)
    expect(spans[0]![1]).toBeGreaterThanOrEqual(1390)
    expect(spans[0]![1]).toBeLessThanOrEqual(1410)
    // 10 coches × 3 vueltas: cada pasada cuenta una vez por celda.
    expect(z.passes[0]).toBe(30)
    expect(z.cars).toBe(10)
    expect(z.discardedCars).toBe(0)
  })

  it('una zona que cruza s = 0 sale entera, con inicio > fin', () => {
    const z = deduceDrsZones(session(field(8, 2700, 300)), { lengthM: L })
    expect(z.status).toBe('deduced')
    const [[a, b]] = spansOf(z) as [[number, number]]
    expect(a).toBeGreaterThan(b)
    expect(Math.abs(a - 2700)).toBeLessThanOrEqual(10)
    expect(Math.abs(b - 300)).toBeLessThanOrEqual(10)
    expect(spanLength(a, b, L)).toBeGreaterThan(580)
    expect(spanLength(a, b, L)).toBeLessThan(620)
  })

  it('una pasada cuenta una vez por celda aunque la telemetría sea muy densa', () => {
    const z = deduceDrsZones(session(field(3, 800, 1400, 2, { telStep: 40 })), { lengthM: L })
    expect(z.status).toBe('deduced')
    expect(z.passes[0]).toBe(6)
  })

  it('dos zonas separadas son dos; separadas por menos de 30 m, una sola', () => {
    const two = session(
      field(6, 0, 0, 3, { code: (s) => (inside(s, 500, 900) || inside(s, 1500, 2100) ? OPEN : AVAILABLE) }),
    )
    expect(spansOf(deduceDrsZones(two, { lengthM: L })).map(([a, b]) => [Math.round(a / 100), Math.round(b / 100)])).toEqual([
      [5, 9],
      [15, 21],
    ])
    // Un hueco de 20 m: la telemetría (16 m entre muestras) apenas lo ve, y las celdas sueltas que queden se unen.
    const gap = session(field(6, 0, 0, 3, { code: (s) => (inside(s, 500, 900) || inside(s, 920, 1300) ? OPEN : AVAILABLE) }))
    const merged = spansOf(deduceDrsZones(gap, { lengthM: L }))
    expect(merged).toHaveLength(1)
    expect(merged[0]![0]).toBeLessThanOrEqual(510)
    expect(merged[0]![1]).toBeGreaterThanOrEqual(1290)
  })

  it('una apertura suelta en otro sitio no es una zona', () => {
    const cars = field(8, 800, 1400)
    // Un coche abre una vez 200 m en la vuelta 2, en otro sitio: una sola pasada.
    cars[0]!.code = (s) => (inside(s, 800, 1400) || (s >= L + 2000 && s < L + 2200) ? OPEN : AVAILABLE)
    // Otro, una sola muestra abierta en la recta de enfrente en cada vuelta: 1 celda.
    cars[1]!.code = (s, t) => (inside(s, 800, 1400) || Math.round(t / TEL_STEP) % 194 === 150 ? OPEN : AVAILABLE)
    const z = deduceDrsZones(session(cars), { lengthM: L })
    expect(spansOf(z)).toHaveLength(1)
    expect(spansOf(z)[0]![0]).toBeLessThan(900)
  })

  it('las aperturas de un solo coche (aunque sean muchas vueltas) no hacen una zona si otros coches abren', () => {
    const cars = field(6, 800, 1400)
    cars.push({ car: 99, laps: 5, code: (s) => (inside(s, 2000, 2400) || inside(s, 800, 1400) ? OPEN : AVAILABLE) })
    const z = deduceDrsZones(session(cars), { lengthM: L })
    expect(spansOf(z)).toHaveLength(1)
    expect(spansOf(z)[0]![1]).toBeLessThan(1500)
  })

  it('las muestras en el pit lane no cuentan', () => {
    const cars = field(6, 800, 1400)
    // Todos «abren» por el pit lane (s equivalente 2000–2400): un canal que dice abierto donde no puede.
    for (const c of cars) {
      c.code = (s) => (inside(s, 800, 1400) || inside(s, 2000, 2400) ? OPEN : AVAILABLE)
      c.path = (s) => (inside(s, 1900, 2500) ? PATH_PIT : PATH_TRACK)
    }
    const z = deduceDrsZones(session(cars), { lengthM: L })
    expect(spansOf(z)).toHaveLength(1)
    expect(spansOf(z)[0]![1]).toBeLessThan(1500)
  })

  it('las muestras durante una neutralización no cuentan', () => {
    const duration = ((3 * L) / SPEED) * 1000
    const cars = field(6, 800, 1400)
    for (const c of cars) c.code = (s, t) => (inside(s, 800, 1400) || (t > duration / 2 && inside(s, 2000, 2400)) ? OPEN : AVAILABLE)
    const z = deduceDrsZones(session(cars), { lengthM: L, exclude: [{ fromMs: duration / 2, toMs: duration + 1 }] })
    // Toda la segunda mitad queda fuera: solo cuenta la zona de la primera mitad.
    expect(spansOf(z)).toHaveLength(1)
    expect(spansOf(z)[0]![0]).toBeGreaterThan(700)
    expect(spansOf(z)[0]![1]).toBeLessThan(1500)
    const all = deduceDrsZones(session(cars), { lengthM: L })
    expect(spansOf(all)).toHaveLength(2)
  })

  it('un coche con el canal atascado en «abierto» no cuenta', () => {
    const cars = field(6, 800, 1400)
    cars.push({ car: 44, laps: 3, code: () => OPEN })
    cars.push({ car: 45, laps: 3, code: () => OPEN })
    const z = deduceDrsZones(session(cars), { lengthM: L })
    expect(z.status).toBe('deduced')
    expect(z.discardedCars).toBe(2)
    expect(z.cars).toBe(6)
    expect(spansOf(z)).toHaveLength(1)
  })

  it('sin aperturas, sin zonas («sin dato»); sin ningún código (255), sin canal', () => {
    const closed = deduceDrsZones(session(field(6, 0, 0, 3, { code: () => CLOSED })), { lengthM: L })
    expect(closed).toMatchObject({ status: 'insufficient', cars: 0 })
    expect(closed.spans.length).toBe(0)
    const absent = deduceDrsZones(session(field(6, 0, 0, 3, { code: () => 255 })), { lengthM: L })
    expect(absent.status).toBe('no-channel')
    expect(absent.spans.length).toBe(0)
    expect(deduceDrsZones([], { lengthM: L }).status).toBe('no-channel')
  })

  it('pocas pasadas (menos de 3) no bastan', () => {
    const z = deduceDrsZones(session(field(2, 800, 1400, 1)), { lengthM: L })
    expect(z.status).toBe('insufficient')
  })

  it('zonas que cubren más del 60 % de la vuelta no son creíbles', () => {
    // Medio tiempo en el box (cerrado) y, en pista, abierto en el 80 % de la vuelta: no es un canal atascado.
    const duration = ((3 * L) / SPEED) * 1000
    const cars = field(6, 0, 0, 3, {
      code: (s, t) => (t < duration / 2 ? CLOSED : inside(s, 0, 0.8 * L) ? OPEN : AVAILABLE),
      path: () => PATH_TRACK,
    })
    expect(deduceDrsZones(session(cars), { lengthM: L }).status).toBe('insufficient')
  })
})

describe('drsZonesUnavailable', () => {
  const m = (season: number, drs: 'present' | 'absent') => ({ session: { season }, channels: { drs } })
  it('de 2018 a 2025 con canal, se deducen; 2026, sin DRS; sin canal o antes de 2018, sin dato', () => {
    expect(drsZonesUnavailable(m(2018, 'present'))).toBeNull()
    expect(drsZonesUnavailable(m(2025, 'present'))).toBeNull()
    expect(drsZonesUnavailable(m(2026, 'absent'))).toBe('season')
    expect(drsZonesUnavailable(m(2026, 'present'))).toBe('season')
    expect(drsZonesUnavailable(m(2024, 'absent'))).toBe('no-channel')
    expect(drsZonesUnavailable(m(2017, 'present'))).toBe('no-channel')
  })
})

describe('sessionDrsZones', () => {
  it('una sesión de 2026 no se calcula (ni toca los datos)', () => {
    const untouchable = new Proxy({} as DecodedTrzb, {
      get() {
        throw new Error('no debería leer los datos')
      },
    })
    const z = sessionDrsZones(
      { session: { season: 2026 }, channels: { drs: 'absent' } } as Manifest,
      { motion: untouchable, car: untouchable, circuit: untouchable, events: { windows: [] } },
      new Float64Array(0),
    )
    expect(z).toEqual(noDrsZones('season'))
  })

  it('sobre el fixture (Spa, GPS real) con aperturas sintéticas en un tramo, lo recupera', async () => {
    const s = await loadFixture()
    const tracks = carTracks(s.motion, s.tangents)
    const length = circuitModel(s.circuit).centerline.length
    const a = 1200
    const b = 1900
    // Canal sintético: abierto donde el replay pone al coche dentro de [a, b) en pista.
    const cars = s.car.tables.cars!
    const tt = column(s.car, 'tel', 't')
    const drs = new Uint8Array(tt.length)
    const sample = newCarSample()
    for (let k = 0; k < cars.rows; k++) {
      const track = tracks.find((tr) => tr.car === String(cars.columns.car![k]))!
      const start = cars.columns.start![k]!
      sample.i = -1
      for (let i = start; i < start + cars.columns.count![k]!; i++) {
        const smp = sampleCar(track, tt[i]!, sample)
        const x = ((smp.s % length) + length) % length
        drs[i] = smp.state === 'visible' && smp.path === PATH_TRACK && x >= a && x < b ? OPEN : AVAILABLE
      }
    }
    const tel = s.car.tables.tel!
    const car: DecodedTrzb = { ...s.car, tables: { ...s.car.tables, tel: { ...tel, columns: { ...tel.columns, drs } } } }
    const manifest = {
      ...s.manifest,
      session: { ...s.manifest.session, season: 2025 },
      channels: { ...s.manifest.channels, drs: 'present' as const },
    }
    const z = sessionDrsZones(manifest, { motion: s.motion, car, circuit: s.circuit, events: s.events }, s.tangents)
    expect(z.status).toBe('deduced')
    const spans = spansOf(z)
    expect(spans).toHaveLength(1)
    // La telemetría real va a ~4 Hz (unos 20 m entre muestras a 300 km/h): el tramo sale con ese margen.
    expect(Math.abs(spans[0]![0] - a)).toBeLessThanOrEqual(25)
    expect(Math.abs(spans[0]![1] - b)).toBeLessThanOrEqual(25)
    expect(z.cars).toBeGreaterThan(5)

    // El fixture tal cual (2026, sin canal): sin zonas. Con un manifest de 2025 que declara el canal, sus códigos
    // siguen siendo 255 (canal ausente): sin canal, no «sin aperturas» (lo que comprueba también el e2e).
    expect(s.drsZones).toEqual(noDrsZones('season'))
    expect(sessionDrsZones(manifest, s, s.tangents).status).toBe('no-channel')
  })
})

describe('drsZoneMesh', () => {
  const ring = ringCircuit({ radius: 500 })
  const path = ring.centerline

  it('sin zonas, malla vacía', () => {
    const m = drsZoneMesh(path, [], false)
    expect(m.indices.length).toBe(0)
    expect(m.positions.length).toBe(0)
  })

  it('un solo índice con los cuadriláteros de todas las zonas y solo los vértices que usan', () => {
    const spans = [100, 400, path.length - 50, 60]
    const m = drsZoneMesh(path, spans, true)
    const quads = rangeIndices(path, 100, 400).length / 6 + rangeIndices(path, path.length - 50, 60).length / 6
    expect(m.indices.length).toBe(quads * 6)
    // Dos tramos de cuadriláteros seguidos: (cuadriláteros + 1) pares de vértices por tramo.
    const verts = m.positions.length / 3
    expect(verts).toBe((rangeIndices(path, 100, 400).length / 6 + 1) * 2 + (rangeIndices(path, path.length - 50, 60).length / 6 + 1) * 2)
    expect(m.mapCenter.length).toBe(m.positions.length)
    expect(m.mapNormal.length).toBe(m.positions.length)
    expect(Math.max(...m.indices)).toBe(verts - 1)
    // Cada vértice está a media anchura (7 m) de su punto del eje, en la dirección de su normal.
    for (let v = 0; v < verts; v++) {
      const d = [0, 1, 2].map((k) => m.positions[v * 3 + k]! - m.mapCenter[v * 3 + k]!)
      const nrm = [0, 1, 2].map((k) => m.mapNormal[v * 3 + k]!)
      expect(Math.hypot(...d)).toBeCloseTo(7, 4)
      expect(d[0]! * nrm[0]! + d[1]! * nrm[1]! + d[2]! * nrm[2]!).toBeCloseTo(7, 4)
    }
  })
})
