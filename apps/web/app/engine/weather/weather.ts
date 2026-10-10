/**
 * Meteorología (ítem 6, D36). TS puro, sin Vue ni three.
 *
 * `events.weather` trae una muestra por minuto de la estación del circuito (live timing), con `null` donde el feed no
 * dio el dato. Aquí no se inventa nada:
 * - El valor de un instante es el de la última muestra con t ≤ reloj, **sin interpolar** entre minutos.
 * - Una muestra caduca a los 150 s (`WEATHER_STALE_MS`): si la última es más vieja, o el reloj está antes de la primera,
 *   no hay valor («sin dato»), nunca el último conocido arrastrado.
 * - La lluvia es sí/no (Rainfall), nunca intensidad.
 * - La dirección del viento es respecto al norte, tal cual: el mapa 3D no está orientado al norte, así que nunca se
 *   dibuja sobre él (solo junto a una referencia orientada al norte, como la miniatura del trazado de D27).
 */
import type { Manifest, SessionWeather } from '@trazada/schema'

/** Una muestra de más de esto (ms) ya no vale: la estación da una por minuto, así que faltan al menos dos. */
export const WEATHER_STALE_MS = 150_000

/** Clave de `rt.ext` (D29): la serie se prepara una vez por runtime y la comparten el chip y el carril. */
export const WEATHER_EXT = 'weather'

export interface WeatherReading {
  /** Instante de la muestra (ms de sesión). */
  readonly t: number
  /** Temperatura del aire (°C). */
  readonly airC: number | null
  /** Temperatura de la pista (°C). */
  readonly trackC: number | null
  /** Humedad relativa (%). */
  readonly humidity: number | null
  /** Presión (hPa). */
  readonly pressureHpa: number | null
  /** Lluvia sí/no. */
  readonly rain: boolean | null
  /** Velocidad del viento (m/s). */
  readonly windMs: number | null
  /** Dirección del viento (grados desde el norte, 0–359). */
  readonly windDeg: number | null
}

export interface WeatherSeries {
  /** Muestras por t creciente, sin instantes repetidos. */
  readonly rows: readonly WeatherReading[]
}

/**
 * Qué se sabe de la meteorología de la sesión:
 * - `present`: hay muestras;
 * - `absent`: la fuente no la trae (`channels.weather: absent`);
 * - `outdated`: la sesión se generó antes de 1.1.0 (sin `channels.weather`): no se sabe; hay que volver a descargarla.
 */
export type WeatherAvailability = 'present' | 'absent' | 'outdated'

const num = (v: unknown, ok: (x: number) => boolean = () => true): number | null =>
  typeof v === 'number' && Number.isFinite(v) && ok(v) ? v : null

/**
 * Serie lista para consultar, o null si no hay ninguna muestra utilizable. Tolera datos mal formados sin inventar:
 * columnas de distinto largo o sin `t` → null; un valor de tipo o rango imposible → «sin dato» en esa celda.
 */
export function weatherSeries(weather: SessionWeather | undefined | null): WeatherSeries | null {
  if (!weather || typeof weather !== 'object' || !Array.isArray(weather.t)) return null
  const n = weather.t.length
  const cols = [weather.airC, weather.trackC, weather.humidity, weather.pressureHpa, weather.rain, weather.windMs, weather.windDeg]
  if (n === 0 || !cols.every((c) => Array.isArray(c) && c.length === n)) return null
  const rows: WeatherReading[] = []
  for (let i = 0; i < n; i++) {
    const t = num(weather.t[i])
    if (t === null) continue
    const rain = weather.rain[i]
    rows.push({
      t,
      airC: num(weather.airC[i]),
      trackC: num(weather.trackC[i]),
      humidity: num(weather.humidity[i], (x) => x >= 0 && x <= 100),
      pressureHpa: num(weather.pressureHpa[i], (x) => x > 0),
      rain: typeof rain === 'boolean' ? rain : null,
      windMs: num(weather.windMs[i], (x) => x >= 0),
      windDeg: num(weather.windDeg[i], (x) => x >= 0 && x < 360),
    })
  }
  // Por t; con el mismo t, la última (como el pipeline).
  const sorted = rows.map((r, i) => ({ r, i })).sort((a, b) => a.r.t - b.r.t || a.i - b.i)
  const out: WeatherReading[] = []
  for (const { r } of sorted) {
    if (out.length && out[out.length - 1]!.t === r.t) out[out.length - 1] = r
    else out.push(r)
  }
  return out.length ? { rows: out } : null
}

export function weatherAvailability(manifest: Pick<Manifest, 'channels'>, series: WeatherSeries | null): WeatherAvailability {
  if (series) return 'present'
  return manifest.channels.weather === undefined ? 'outdated' : 'absent'
}

/** Índice de la última muestra con t ≤ `timeMs`, o −1 (antes de la primera). */
function lastAtOrBefore(rows: readonly WeatherReading[], timeMs: number): number {
  let lo = 0
  let hi = rows.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (rows[mid]!.t <= timeMs) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

/**
 * Índice de la muestra vigente en `timeMs`: la última con t ≤ reloj, si no tiene más de `staleMs`. −1 = sin dato
 * (antes de la primera muestra o la última ya caducó). Es un número: quien lo observe solo cambia al cambiar de muestra.
 */
export function weatherIndexAt(series: WeatherSeries, timeMs: number, staleMs = WEATHER_STALE_MS): number {
  const i = lastAtOrBefore(series.rows, timeMs)
  if (i < 0 || timeMs - series.rows[i]!.t > staleMs) return -1
  return i
}

/** La muestra vigente en `timeMs` (escalonada, sin interpolar) o null («sin dato»). */
export function weatherAt(series: WeatherSeries, timeMs: number, staleMs = WEATHER_STALE_MS): WeatherReading | null {
  const i = weatherIndexAt(series, timeMs, staleMs)
  return i < 0 ? null : series.rows[i]!
}

export interface WeatherSpan {
  readonly fromMs: number
  readonly toMs: number
}

export interface TrackTempStep extends WeatherSpan {
  /** Temperatura de la pista (°C) de la muestra. */
  readonly value: number
}

/** Lo que pinta el carril del timeline, recortado al intervalo de reproducción. */
export interface WeatherLane {
  /** Un escalón por muestra con temperatura de pista: desde su instante hasta la siguiente o hasta que caduca. */
  readonly trackTemp: readonly TrackTempStep[]
  /** Tramos con lluvia (muestras seguidas con `rain: true`, unidas). */
  readonly rain: readonly WeatherSpan[]
  /** Mínimo y máximo de la temperatura de pista en esos escalones, o null si no hay ninguno. */
  readonly trackRange: { readonly min: number; readonly max: number } | null
}

/**
 * Escalones y tramos de lluvia del intervalo [fromMs, toMs]. Cada muestra vale desde su instante hasta la siguiente o,
 * como mucho, `staleMs` (lo mismo que el chip): un hueco del feed queda como hueco, sin rellenar.
 */
export function weatherLane(series: WeatherSeries, fromMs: number, toMs: number, staleMs = WEATHER_STALE_MS): WeatherLane {
  const trackTemp: TrackTempStep[] = []
  const rain: WeatherSpan[] = []
  let min = Infinity
  let max = -Infinity
  const rows = series.rows
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!
    const next = rows[i + 1]?.t ?? Infinity
    const from = Math.max(r.t, fromMs)
    const to = Math.min(next, r.t + staleMs, toMs)
    if (!(to > from)) continue
    if (r.trackC !== null) {
      trackTemp.push({ fromMs: from, toMs: to, value: r.trackC })
      min = Math.min(min, r.trackC)
      max = Math.max(max, r.trackC)
    }
    if (r.rain === true) {
      const last = rain[rain.length - 1]
      if (last && last.toMs === from) rain[rain.length - 1] = { fromMs: last.fromMs, toMs: to }
      else rain.push({ fromMs: from, toMs: to })
    }
  }
  return { trackTemp, rain, trackRange: trackTemp.length ? { min, max } : null }
}

/** Lo que necesita `createWeatherModel` del runtime del replay. */
export interface WeatherSource {
  readonly session: { readonly manifest: Pick<Manifest, 'channels'>; readonly events: { readonly weather?: SessionWeather } }
  readonly clock: { readonly startMs: number; readonly endMs: number }
}

/** Meteorología de una sesión cargada, preparada una vez: la comparten el chip de la cabecera y el carril del timeline. */
export interface WeatherModel {
  readonly availability: WeatherAvailability
  readonly series: WeatherSeries | null
  /** Carril del intervalo de reproducción (null sin muestras). */
  readonly lane: WeatherLane | null
}

/** Para `rt.ext(WEATHER_EXT, createWeatherModel)`. */
export function createWeatherModel(src: WeatherSource): WeatherModel {
  const series = weatherSeries(src.session.events.weather)
  return {
    availability: weatherAvailability(src.session.manifest, series),
    series,
    lane: series ? weatherLane(series, src.clock.startMs, src.clock.endMs) : null,
  }
}

/** Rumbo de 8 puntos (N, NE, E…) de una dirección en grados: solo para leerla mejor, junto a los grados. */
export const COMPASS_POINTS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const
export type CompassPoint = (typeof COMPASS_POINTS)[number]

export function compassPoint(deg: number): CompassPoint {
  const normalized = ((deg % 360) + 360) % 360
  return COMPASS_POINTS[Math.round(normalized / 45) % 8]!
}
