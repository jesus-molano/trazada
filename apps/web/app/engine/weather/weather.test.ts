import type { SessionWeather } from '@trazada/schema'
import { describe, expect, it } from 'vitest'
import { loadFixture } from '../../testing/fixture'
import {
  compassPoint,
  createWeatherModel,
  WEATHER_STALE_MS,
  weatherAt,
  weatherAvailability,
  weatherIndexAt,
  weatherLane,
  weatherSeries,
} from './weather'

/** Columnas de `events.weather` (null = sin dato) a partir de filas. */
function columns(rows: Partial<Record<keyof SessionWeather, unknown>>[]): SessionWeather {
  const keys = ['t', 'airC', 'trackC', 'humidity', 'pressureHpa', 'rain', 'windMs', 'windDeg'] as const
  return Object.fromEntries(keys.map((k) => [k, rows.map((r) => (k in r ? r[k] : null))])) as unknown as SessionWeather
}

const row = (t: number, over: Partial<Record<keyof SessionWeather, unknown>> = {}) => ({
  t,
  airC: 23.6,
  trackC: 41.2,
  humidity: 45,
  pressureHpa: 966.7,
  rain: false,
  windMs: 1.5,
  windDeg: 330,
  ...over,
})

describe('weatherSeries', () => {
  it('ordena por t, se queda con la última de un instante repetido y conserva los null', () => {
    const s = weatherSeries(columns([row(60_000, { airC: 24 }), row(0, { trackC: null }), row(60_000, { airC: 25 })]))!
    expect(s.rows.map((r) => r.t)).toEqual([0, 60_000])
    expect(s.rows[0]!.trackC).toBeNull()
    expect(s.rows[1]!.airC).toBe(25)
  })

  it('un valor de tipo o rango imposible es «sin dato», nunca un valor recortado', () => {
    const s = weatherSeries(
      columns([row(0, { rain: 0.4, humidity: 120, pressureHpa: 0, windMs: -1, windDeg: 360, airC: 'x', trackC: Number.NaN })]),
    )!
    expect(s.rows[0]).toEqual({
      t: 0,
      airC: null,
      trackC: null,
      humidity: null,
      pressureHpa: null,
      rain: null,
      windMs: null,
      windDeg: null,
    })
  })

  it('sin meteorología o con columnas de distinto largo: null', () => {
    expect(weatherSeries(undefined)).toBeNull()
    expect(weatherSeries(columns([]))).toBeNull()
    const bad = columns([row(0), row(60_000)])
    bad.windDeg = [330]
    expect(weatherSeries(bad)).toBeNull()
  })
})

describe('valor en un instante (escalonado y con caducidad)', () => {
  const s = weatherSeries(columns([row(10_000, { airC: 20 }), row(70_000, { airC: 21 }), row(400_000, { airC: 22 })]))!

  it('antes de la primera muestra: sin dato', () => {
    expect(weatherAt(s, 9_999)).toBeNull()
    expect(weatherIndexAt(s, 0)).toBe(-1)
  })

  it('el valor es el de la última muestra con t ≤ reloj, sin interpolar', () => {
    expect(weatherAt(s, 10_000)!.airC).toBe(20)
    expect(weatherAt(s, 69_999)!.airC).toBe(20)
    expect(weatherAt(s, 70_000)!.airC).toBe(21)
    expect(weatherAt(s, 100_000)!.airC).toBe(21) // nunca 21,5 a medio camino
  })

  it('caduca a los 150 s: después, sin dato hasta la siguiente muestra', () => {
    expect(WEATHER_STALE_MS).toBe(150_000)
    expect(weatherAt(s, 70_000 + 150_000)!.airC).toBe(21)
    expect(weatherAt(s, 70_000 + 150_001)).toBeNull()
    expect(weatherIndexAt(s, 399_999)).toBe(-1)
    expect(weatherAt(s, 400_000)!.airC).toBe(22)
    expect(weatherAt(s, 1e9)).toBeNull() // pasado el final, tampoco se arrastra
  })

  it('el índice solo cambia al cambiar de muestra (el chip no se repinta en cada frame)', () => {
    const seen = new Set<number>()
    for (let t = 10_000; t < 70_000; t += 100) seen.add(weatherIndexAt(s, t))
    expect([...seen]).toEqual([0])
  })
})

describe('disponibilidad', () => {
  const s = weatherSeries(columns([row(0)]))
  it('con muestras, present; con el canal absent, absent; sin canal (antes de 1.1.0), outdated', () => {
    expect(weatherAvailability({ channels: { drs: 'absent', elevation: 'flat', weather: 'present' } }, s)).toBe('present')
    expect(weatherAvailability({ channels: { drs: 'absent', elevation: 'flat', weather: 'absent' } }, null)).toBe('absent')
    expect(weatherAvailability({ channels: { drs: 'absent', elevation: 'flat' } }, null)).toBe('outdated')
    // El canal dice present pero los datos no sirven: no se finge que haya.
    expect(weatherAvailability({ channels: { drs: 'absent', elevation: 'flat', weather: 'present' } }, null)).toBe('absent')
  })
})

describe('carril del timeline', () => {
  it('un escalón por muestra hasta la siguiente o hasta caducar; los huecos quedan huecos', () => {
    const s = weatherSeries(
      columns([row(0, { trackC: 40 }), row(60_000, { trackC: 42 }), row(120_000, { trackC: null }), row(600_000, { trackC: 38 })]),
    )!
    const lane = weatherLane(s, 30_000, 700_000)
    expect(lane.trackTemp).toEqual([
      { fromMs: 30_000, toMs: 60_000, value: 40 }, // recortado al inicio de la reproducción
      { fromMs: 60_000, toMs: 120_000, value: 42 },
      { fromMs: 600_000, toMs: 700_000, value: 38 }, // 120 000 no tiene dato y no se rellena
    ])
    expect(lane.trackRange).toEqual({ min: 38, max: 42 })
  })

  it('la lluvia: muestras seguidas con lluvia forman un tramo; un hueco de más de 150 s lo corta', () => {
    const s = weatherSeries(
      columns([
        row(0, { rain: true }),
        row(60_000, { rain: true }),
        row(120_000, { rain: false }),
        row(180_000, { rain: true }),
        row(500_000, { rain: true }),
        row(560_000, { rain: null }),
      ]),
    )!
    expect(weatherLane(s, 0, 600_000).rain).toEqual([
      { fromMs: 0, toMs: 120_000 },
      { fromMs: 180_000, toMs: 330_000 }, // caduca a los 150 s
      { fromMs: 500_000, toMs: 560_000 },
    ])
  })

  it('sin temperatura de pista: sin rango', () => {
    const s = weatherSeries(columns([row(0, { trackC: null })]))!
    expect(weatherLane(s, 0, 60_000)).toEqual({ trackTemp: [], rain: [], trackRange: null })
  })
})

describe('modelo del runtime (rt.ext)', () => {
  it('serie, disponibilidad y carril del intervalo de reproducción, de una vez', () => {
    const model = createWeatherModel({
      session: { manifest: { channels: { drs: 'absent', elevation: 'flat', weather: 'present' } }, events: { weather: columns([row(0), row(60_000)]) } },
      clock: { startMs: 30_000, endMs: 90_000 },
    })
    expect(model.availability).toBe('present')
    expect(model.series!.rows).toHaveLength(2)
    expect(model.lane!.trackTemp.map((s) => [s.fromMs, s.toMs])).toEqual([
      [30_000, 60_000],
      [60_000, 90_000],
    ])
    const none = createWeatherModel({ session: { manifest: { channels: { drs: 'absent', elevation: 'flat' } }, events: {} }, clock: { startMs: 0, endMs: 1 } })
    expect(none).toEqual({ availability: 'outdated', series: null, lane: null })
  })
})

describe('rumbo', () => {
  it('8 puntos desde el norte', () => {
    expect([0, 22, 23, 90, 180, 247, 248, 315, 330, 338, 359, 360, -45].map(compassPoint)).toEqual([
      'n',
      'n',
      'ne',
      'e',
      's',
      'sw',
      'w',
      'nw',
      'nw',
      'n',
      'n',
      'n',
      'nw',
    ])
  })
})

describe('fixture e2e (Bélgica FP1, caché de FastF1 con meteorología)', () => {
  it('trae la meteorología de la ventana y la vigente al empezar, sin datos inventados', async () => {
    const session = await loadFixture()
    expect(session.manifest.channels.weather).toBe('present')
    const s = weatherSeries(session.events.weather)!
    expect(weatherAvailability(session.manifest, s)).toBe('present')
    const { startMs, endMs } = session.manifest.session.playback
    expect(s.rows[0]!.t).toBeLessThan(startMs) // la vigente al empezar
    expect(s.rows.slice(1).every((r) => r.t >= startMs && r.t <= endMs)).toBe(true)
    const atStart = weatherAt(s, startMs)!
    expect(atStart).not.toBeNull()
    expect(atStart.rain).toBe(false)
    expect(atStart.airC).toBeGreaterThan(15)
    expect(atStart.trackC).toBeGreaterThan(atStart.airC!)
    // Una muestra por minuto: en toda la ventana siempre hay un valor vigente.
    for (let t = startMs; t <= endMs; t += 5_000) expect(weatherIndexAt(s, t)).toBeGreaterThanOrEqual(0)
  })
})
