/**
 * Mapa de calor de la pista (ítem 2, D32; TS puro, sin Vue ni three): colorea la cinta de la pista, punto a punto de
 * la línea central, con una vuelta completa de uno o dos coches.
 *
 * - **Velocidad** (dato real): las muestras crudas de velocidad del coche (~4 Hz, una cada 10–25 m a fondo), cada una
 *   en la distancia del replay en su instante (posición GPS proyectada, ±8 m). Entre dos muestras seguidas el color se
 *   interpola en línea recta; entre dos muestras separadas más de 2 s, o con un hueco de posición en medio, no hay
 *   color («sin dato»): nunca se rellena. La escala va de la velocidad mínima a la máxima de las muestras de la vuelta.
 * - **Minisectores** («Estimado», campo `minisectors`): la vuelta se divide en 25 tramos iguales desde la línea de meta
 *   (s = 0) y en cada uno gana el coche que tarda menos en recorrerlo, con el tiempo a cada distancia que sale del GPS
 *   (`timeAtS`). Ese tiempo tiene un error de unos 15–30 ms por tramo, del orden de las diferencias reales: con menos
 *   de 50 ms de diferencia no se elige ganador («igual»). Un tramo con un hueco de posición de alguno de los dos, o sin
 *   tiempo en alguno de sus extremos, queda sin color («sin dato»).
 *
 * Qué vuelta: solo vueltas representativas (sin entrada ni salida de boxes, sin SC, VSC ni roja, sin la vuelta 1, con
 * tiempo oficial y sin anular en el instante actual), completas y vistas: su paso por meta fue hace al menos 2 s (así
 * ninguna muestra usada es del futuro). La última o la más rápida de cada coche (`HeatLapPick`); sin coche
 * seleccionado, la más rápida de la sesión hasta ese momento.
 *
 * El cálculo se hace solo cuando cambia lo que se pinta (modo, coches o vuelta): `HeatModel.view` es barato mientras
 * la clave no cambia y devuelve el mismo objeto.
 */
import type { DecodedTrzb, SessionType } from '@trazada/schema'
import { type CarLaps, LAP_NOT_REPRESENTATIVE, lapFlagsAt, type LapTable } from '../analysis/lapTable'
import { timeAtS } from '../compare/distance'
import { lapStartTime } from '../compare/laps'
import { SEGMENT_GAP_MS } from '../interp/hermite'
import { type CarTrack, findInterval, newCarSample, PATH_NODATA, sampleCar } from '../replay/motion'
import { type CarSeries, MAX_SAMPLE_AGE_MS, Telemetry } from '../telemetry/telemetry'

/** Clave de `rt.ext` del mapa de calor (uno por runtime, perezoso). */
export const HEAT_EXT = 'heat'
/** Minisectores por vuelta (tramos iguales desde la línea de meta). */
export const HEAT_MINISECTORS = 25
/** Banda de empate de un minisector (ms): por debajo, «igual», sin ganador. */
export const HEAT_TIE_MS = 50
/** Separación máxima entre dos muestras para colorear entre ellas (ms): más, «sin dato». */
export const HEAT_GAP_MS = MAX_SAMPLE_AGE_MS
/** Una vuelta entra cuando su paso por meta fue hace al menos esto (ms): ninguna muestra que use es del futuro. */
export const HEAT_SETTLE_MS = MAX_SAMPLE_AGE_MS

export type HeatDrawMode = 'speed' | 'minisectors'
export const HEAT_LAP_PICKS = ['last', 'best'] as const
export type HeatLapPick = (typeof HEAT_LAP_PICKS)[number]
export const isHeatLapPick = (x: unknown): x is HeatLapPick => (HEAT_LAP_PICKS as readonly unknown[]).includes(x)

/** En carrera y sprint, la última vuelta (cómo va ahora); en libres y clasificación, la más rápida. */
export function defaultHeatPick(type: SessionType): HeatLapPick {
  return type === 'race' || type === 'sprint' ? 'last' : 'best'
}

/** Ganador de un minisector. */
export const MS_NONE = -1
export const MS_TIE = 0
export const MS_A = 1
export const MS_B = 2

/** La línea central, en lo que el mapa de calor necesita de ella (TrackPath). */
export interface HeatPath {
  readonly count: number
  readonly length: number
  readonly closed: boolean
  vertexS(i: number): number
}

// ——— Qué vuelta ———

/** ¿Cuenta la vuelta k en t? Representativa, con paso por meta real hace al menos `HEAT_SETTLE_MS` y con inicio. */
function eligible(laps: CarLaps, k: number, t: number): boolean {
  const cross = laps.crossMs[k]!
  if (!(cross > 0 && cross + HEAT_SETTLE_MS <= t)) return false
  if (lapFlagsAt(laps, k, t) & LAP_NOT_REPRESENTATIVE) return false
  return lapStartTime(laps, k) !== null
}

/** Vuelta del coche que se pinta en t (índice en `laps`), la última o la más rápida, o −1 si no hay ninguna. */
export function heatLapIndex(laps: CarLaps, pick: HeatLapPick, t: number): number {
  let best = -1
  for (let k = 0; k < laps.lap.length; k++) {
    if (!eligible(laps, k, t)) continue
    if (best < 0) best = k
    else if (pick === 'last' ? laps.crossMs[k]! > laps.crossMs[best]! : laps.lapMs[k]! < laps.lapMs[best]!) best = k
  }
  return best
}

/** Vuelta más rápida de la sesión hasta t (de cualquier coche), o null. A igual tiempo, la primera en cerrarse. */
export function sessionBestLap(table: LapTable, t: number): { car: string; k: number } | null {
  let out: { car: string; k: number } | null = null
  let bestMs = Infinity
  let bestCross = Infinity
  for (const [car, laps] of table.cars) {
    const k = heatLapIndex(laps, 'best', t)
    if (k < 0) continue
    const ms = laps.lapMs[k]!
    const cross = laps.crossMs[k]!
    if (ms < bestMs || (ms === bestMs && cross < bestCross)) {
      out = { car, k }
      bestMs = ms
      bestCross = cross
    }
  }
  return out
}

// ——— Dónde empieza la vuelta ———

/**
 * s acumulada del paso por la línea de meta (s = 0 de la línea central) más cercano a `s0`: la vuelta que empezó en
 * `s0` (±8 m de GPS) recorre la línea central de ahí a ahí + L.
 */
export function lineCrossingS(s0: number, length: number): number {
  const p = ((s0 % length) + length) % length
  return p > length / 2 ? s0 + (length - p) : s0 - p
}

/** ¿Hay algún instante en [t0, t1] sin posición del coche (hueco de más de 2 s, «sin dato» o fuera de sus datos)? */
export function hasPositionGap(track: CarTrack, t0: number, t1: number): boolean {
  const { t, path, seg } = track
  const n = t.length
  const i0 = findInterval(t, t0, -1)
  const i1 = findInterval(t, t1, i0)
  if (i0 < 0 || (i1 === n - 1 && t1 > t[n - 1]!)) return true
  if (path[i0] === PATH_NODATA) return true
  for (let j = i0; j < i1; j++) {
    if (path[j + 1] === PATH_NODATA) return true
    // Entre segmentos, solo una transición corta pista↔pit tiene posición (como en `sampleCar`).
    if (seg[j] !== seg[j + 1] && t[j + 1]! - t[j]! > SEGMENT_GAP_MS) return true
  }
  return false
}

// ——— Velocidad ———

/** Muestras de velocidad de una vuelta colocadas en la distancia (relativa al inicio de la vuelta). */
export interface SpeedSamples {
  /** Distancia desde el inicio de la vuelta (m): no decrece. */
  d: Float64Array
  /** km/h, tal cual (sin interpolar ni suavizar). */
  kmh: Float32Array
  /** 1 si entre la muestra anterior y esta no se puede colorear (más de 2 s, o un hueco de posición en medio). */
  cut: Uint8Array
}

export interface HeatLapSpan {
  /** Inicio y paso por meta de la vuelta (ms de sesión). */
  t0: number
  t1: number
  /** s acumulada del coche al empezar la vuelta. */
  s0: number
}

/** Primer índice con t[i] ≥ x. */
function lowerBound(t: ArrayLike<number>, x: number): number {
  let lo = 0
  let hi = t.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (t[mid]! < x) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Muestras de velocidad de la vuelta [t0, t1) más la anterior y la siguiente (también son del coche en ese tramo, a
 * menos de 2 s: así la línea de meta no queda sin color), cada una en su distancia. Ninguna posterior a `now`. Sin
 * posición en el instante de una muestra, no entra y la línea se corta ahí.
 */
export function lapSpeedSamples(series: CarSeries, track: CarTrack, lap: HeatLapSpan, now: number): SpeedSamples {
  const from = Math.max(0, lowerBound(series.t, lap.t0) - 1)
  const to = Math.min(series.t.length, lowerBound(series.t, lap.t1) + 1)
  const n = Math.max(0, to - from)
  const d = new Float64Array(n)
  const kmh = new Float32Array(n)
  const cut = new Uint8Array(n)
  const smp = newCarSample()
  let k = 0
  let pending = false
  let lastT = Number.NaN
  let lastD = -Infinity
  for (let i = from; i < to; i++) {
    const ti = series.t[i]!
    if (ti > now) break
    const smpS = sampleCar(track, ti, smp)
    const di = smpS.state === 'hidden' ? Number.NaN : smpS.s - lap.s0
    if (!Number.isFinite(di) || di < lastD) {
      pending = true
      continue
    }
    d[k] = di
    kmh[k] = series.speed[i]!
    cut[k] = k > 0 && (pending || ti - lastT > HEAT_GAP_MS || hasPositionGap(track, lastT, ti)) ? 1 : 0
    pending = false
    lastT = ti
    lastD = di
    k++
  }
  return { d: d.subarray(0, k), kmh: kmh.subarray(0, k), cut: cut.subarray(0, k) }
}

/**
 * Velocidad en cada punto de la línea central (km/h; NaN sin dato): el punto i está a `dLine + vertexS(i)` del inicio
 * de la vuelta. Entre dos muestras seguidas sin corte, interpolación lineal en la distancia; fuera de las muestras o
 * en un corte, NaN. Devuelve el mínimo y el máximo de las muestras que colorean algo (NaN si ninguna).
 */
export function speedAlong(samples: SpeedSamples, path: HeatPath, dLine: number, out: Float32Array): { min: number; max: number } {
  const { d, kmh, cut } = samples
  const n = d.length
  let min = Infinity
  let max = -Infinity
  const used = new Uint8Array(n)
  for (let i = 0; i < path.count; i++) {
    const x = dLine + path.vertexS(i)
    // Última muestra con d ≤ x.
    const j = lowerBound(d, x + 1e-9) - 1
    if (j < 0 || j >= n) {
      out[i] = Number.NaN
      continue
    }
    if (j === n - 1) {
      // Justo en la última muestra; más allá, sin dato.
      const at = x - d[j]! <= 1e-9
      out[i] = at ? kmh[j]! : Number.NaN
      if (at) used[j] = 1
      continue
    }
    if (cut[j + 1]) {
      out[i] = Number.NaN
      continue
    }
    const span = d[j + 1]! - d[j]!
    const u = span > 0 ? (x - d[j]!) / span : 0
    out[i] = kmh[j]! + u * (kmh[j + 1]! - kmh[j]!)
    used[j] = 1
    used[j + 1] = 1
  }
  for (let j = 0; j < n; j++) {
    if (!used[j]) continue
    min = Math.min(min, kmh[j]!)
    max = Math.max(max, kmh[j]!)
  }
  return min <= max ? { min, max } : { min: Number.NaN, max: Number.NaN }
}

// ——— Minisectores ———

/**
 * Tiempo (ms) de cada uno de los `count` minisectores de la vuelta que pasa por la línea en `sLine` (s acumulada):
 * del instante en que el coche alcanza el inicio del tramo al instante en que alcanza su final (`timeAtS`). NaN si
 * falta alguno de los dos, si hay un hueco de posición dentro del tramo o si cae fuera de la vuelta [t0, t1] (±2 s).
 */
export function minisectorTimes(track: CarTrack, sLine: number, length: number, lap: HeatLapSpan, count = HEAT_MINISECTORS): Float64Array {
  const step = length / count
  const at = new Float64Array(count + 1)
  for (let k = 0; k <= count; k++) {
    const x = timeAtS(track, sLine + k * step)
    at[k] = x !== null && x >= lap.t0 - HEAT_GAP_MS && x <= lap.t1 + HEAT_GAP_MS ? x : Number.NaN
  }
  const out = new Float64Array(count)
  for (let k = 0; k < count; k++) {
    const a = at[k]!
    const b = at[k + 1]!
    out[k] = Number.isFinite(a) && Number.isFinite(b) && b > a && !hasPositionGap(track, a, b) ? b - a : Number.NaN
  }
  return out
}

/** Ganador de cada minisector: `MS_A`, `MS_B`, `MS_TIE` (|Δ| < `tieMs`) o `MS_NONE` (sin tiempo de alguno). */
export function minisectorWinners(a: Float64Array, b: Float64Array, tieMs = HEAT_TIE_MS): Int8Array {
  const out = new Int8Array(Math.min(a.length, b.length))
  for (let k = 0; k < out.length; k++) {
    const x = a[k]!
    const y = b[k]!
    if (!Number.isFinite(x) || !Number.isFinite(y)) out[k] = MS_NONE
    else if (Math.abs(x - y) < tieMs) out[k] = MS_TIE
    else out[k] = x < y ? MS_A : MS_B
  }
  return out
}

/** Minisector del punto de la línea central en s ∈ [0, L). */
export function minisectorOf(s: number, length: number, count = HEAT_MINISECTORS): number {
  return Math.min(count - 1, Math.max(0, Math.floor((s / length) * count)))
}

// ——— Colores ———

export type Rgb = readonly [number, number, number]

export interface HeatPalette {
  /** Rampa de velocidad, de lenta a rápida (paradas equiespaciadas). */
  ramp: readonly Rgb[]
  a: Rgb
  b: Rgb
  tie: Rgb
}

/** Color de la rampa en f ∈ [0, 1] (interpolación lineal entre paradas), escrito en out[o…o+2]. */
export function rampAt(stops: readonly Rgb[], f: number, out: Float32Array, o: number): void {
  const x = Math.min(1, Math.max(0, Number.isFinite(f) ? f : 0)) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(x))
  const u = x - i
  const a = stops[i]!
  const b = stops[i + 1] ?? a
  for (let c = 0; c < 3; c++) out[o + c] = a[c]! + (b[c]! - a[c]!) * u
}

// ——— Vista ———

export interface HeatLapInfo {
  car: string
  /** Índice en la tabla de vueltas del coche y número de vuelta. */
  k: number
  lap: number
  /** Tiempo oficial (ms). */
  lapMs: number
  startMs: number
  endMs: number
}

/**
 * - `ok`: hay algo que pintar.
 * - `noPair`: minisectores sin comparación (hacen falta dos coches).
 * - `noLap`: el coche (o alguno de los dos, `missing`) aún no tiene una vuelta representativa completa.
 * - `noData`: hay vuelta, pero sin posiciones ni muestras con las que colorear nada.
 */
export type HeatStatus = 'ok' | 'noPair' | 'noLap' | 'noData'

export interface HeatCounts {
  a: number
  b: number
  tie: number
  none: number
}

export interface HeatView {
  /** Cambia cada vez que cambia lo que se pinta. */
  readonly version: number
  readonly mode: HeatDrawMode
  readonly status: HeatStatus
  readonly pick: HeatLapPick
  /** Coche pintado (velocidad) o A (minisectores); null sin coche. */
  readonly carA: string | null
  readonly carB: string | null
  readonly a: HeatLapInfo | null
  readonly b: HeatLapInfo | null
  /** Velocidad sin coche seleccionado: la vuelta más rápida de la sesión hasta ahora. */
  readonly sessionBest: boolean
  /** Con `noLap`, de quién falta la vuelta. */
  readonly missing: 'a' | 'b' | null
  /** Velocidad por punto de la línea central (km/h; NaN sin dato). */
  readonly speed: Float32Array | null
  readonly minKmh: number
  readonly maxKmh: number
  /** Minisectores: tiempos de A y B (ms; NaN sin dato) y ganador de cada uno. */
  readonly msA: Float64Array | null
  readonly msB: Float64Array | null
  readonly winners: Int8Array | null
  readonly counts: HeatCounts | null
  /** Puntos de la línea central con color (de `path.count`). */
  readonly colored: number
}

export interface HeatInput {
  mode: HeatDrawMode
  /** Coche seleccionado (A) y el comparado (B), o null. */
  a: string | null
  b: string | null
  pick: HeatLapPick
  t: number
}

/** Lo que el mapa de calor necesita del runtime del replay (estructural: el motor no depende de `replay/`). */
export interface HeatSource {
  readonly session: { readonly manifest: { readonly session: { readonly type: SessionType } }; readonly car: DecodedTrzb }
  readonly model: { readonly tracks: readonly CarTrack[] }
  readonly leaderboard: { readonly lapTable: LapTable }
  readonly circuit: { readonly centerline: HeatPath }
}

interface Selection {
  key: string
  status: HeatStatus
  carA: string | null
  carB: string | null
  kA: number
  kB: number
  sessionBest: boolean
  missing: 'a' | 'b' | null
}

export class HeatModel {
  readonly defaultPick: HeatLapPick
  readonly path: HeatPath
  private readonly table: LapTable
  private readonly tracks = new Map<string, CarTrack>()
  private readonly car: DecodedTrzb
  private telemetry: Telemetry | null = null
  private last: HeatView | null = null
  private lastKey = ''
  private version = 0

  constructor(src: HeatSource) {
    this.defaultPick = defaultHeatPick(src.session.manifest.session.type)
    this.path = src.circuit.centerline
    this.table = src.leaderboard.lapTable
    this.car = src.session.car
    for (const tr of src.model.tracks) this.tracks.set(tr.car, tr)
  }

  private lapOf(car: string | null, pick: HeatLapPick, t: number): number {
    const laps = car === null ? undefined : this.table.cars.get(car)
    return laps ? heatLapIndex(laps, pick, t) : -1
  }

  private select(input: HeatInput): Selection {
    const { mode, a, pick, t } = input
    const base = { carA: a, carB: null, kA: -1, kB: -1, sessionBest: false, missing: null }
    if (mode === 'speed') {
      if (a === null) {
        const best = sessionBestLap(this.table, t)
        if (!best) return { ...base, key: 'speed|best|-', status: 'noLap', sessionBest: true }
        return { ...base, key: `speed|best|${best.car}:${best.k}`, status: 'ok', carA: best.car, kA: best.k, sessionBest: true }
      }
      const kA = this.lapOf(a, pick, t)
      if (kA < 0) return { ...base, key: `speed|${a}:-`, status: 'noLap', missing: 'a' }
      return { ...base, key: `speed|${a}:${kA}`, status: 'ok', kA }
    }
    const b = input.b
    if (a === null || b === null || a === b) return { ...base, key: 'ms|pair', status: 'noPair', carB: b }
    const kA = this.lapOf(a, pick, t)
    const kB = this.lapOf(b, pick, t)
    const key = `ms|${a}:${kA}|${b}:${kB}`
    const sel = { ...base, key, carB: b, kA, kB }
    if (kA < 0) return { ...sel, status: 'noLap', missing: 'a' }
    if (kB < 0) return { ...sel, status: 'noLap', missing: 'b' }
    return { ...sel, status: 'ok' }
  }

  private info(car: string, k: number): HeatLapInfo {
    const laps = this.table.cars.get(car)!
    return {
      car,
      k,
      lap: laps.lap[k]!,
      lapMs: laps.lapMs[k]!,
      startMs: lapStartTime(laps, k)!,
      endMs: laps.crossMs[k]!,
    }
  }

  /** Inicio de la vuelta en tiempo y distancia, y la s acumulada de su paso por meta; null sin posición al empezar. */
  private span(info: HeatLapInfo, track: CarTrack | undefined): { lap: HeatLapSpan; sLine: number } | null {
    if (!track) return null
    const smp = sampleCar(track, info.startMs, newCarSample())
    if (smp.state === 'hidden') return null
    const lap = { t0: info.startMs, t1: info.endMs, s0: smp.s }
    return { lap, sLine: lineCrossingS(lap.s0, this.path.length) }
  }

  /** Lo que se pinta con estos datos. Mientras no cambie el modo, los coches ni la vuelta, el mismo objeto. */
  view(input: HeatInput): HeatView {
    const sel = this.select(input)
    const key = `${sel.key}|${input.pick}`
    if (this.last && key === this.lastKey) return this.last
    this.lastKey = key
    this.version++
    const a = sel.kA >= 0 && sel.carA !== null ? this.info(sel.carA, sel.kA) : null
    const b = sel.kB >= 0 && sel.carB !== null ? this.info(sel.carB, sel.kB) : null
    let view: HeatView = {
      version: this.version,
      mode: input.mode,
      status: sel.status,
      pick: input.pick,
      carA: sel.carA,
      carB: sel.carB,
      a,
      b,
      sessionBest: sel.sessionBest,
      missing: sel.missing,
      speed: null,
      minKmh: Number.NaN,
      maxKmh: Number.NaN,
      msA: null,
      msB: null,
      winners: null,
      counts: null,
      colored: 0,
    }
    if (sel.status === 'ok' && input.mode === 'speed') view = this.speedView(view, a!, input.t)
    else if (sel.status === 'ok') view = this.minisectorView(view, a!, b!)
    this.last = Object.freeze(view)
    return this.last
  }

  private speedView(view: HeatView, a: HeatLapInfo, now: number): HeatView {
    this.telemetry ??= new Telemetry(this.car)
    const series = this.telemetry.seriesOf(a.car)
    const track = this.tracks.get(a.car)
    const sp = this.span(a, track)
    if (!series || !sp) return { ...view, status: 'noData' }
    const samples = lapSpeedSamples(series, track!, sp.lap, now)
    const speed = new Float32Array(this.path.count)
    const { min, max } = speedAlong(samples, this.path, sp.sLine - sp.lap.s0, speed)
    let colored = 0
    for (let i = 0; i < speed.length; i++) if (!Number.isNaN(speed[i]!)) colored++
    return { ...view, status: colored > 0 ? 'ok' : 'noData', speed, minKmh: min, maxKmh: max, colored }
  }

  private minisectorView(view: HeatView, a: HeatLapInfo, b: HeatLapInfo): HeatView {
    const L = this.path.length
    const times = (info: HeatLapInfo) => {
      const track = this.tracks.get(info.car)
      const sp = this.span(info, track)
      return sp ? minisectorTimes(track!, sp.sLine, L, sp.lap) : new Float64Array(HEAT_MINISECTORS).fill(Number.NaN)
    }
    const msA = times(a)
    const msB = times(b)
    const winners = minisectorWinners(msA, msB)
    const counts: HeatCounts = { a: 0, b: 0, tie: 0, none: 0 }
    for (const w of winners) {
      if (w === MS_A) counts.a++
      else if (w === MS_B) counts.b++
      else if (w === MS_TIE) counts.tie++
      else counts.none++
    }
    let colored = 0
    for (let i = 0; i < this.path.count; i++) if (winners[minisectorOf(this.path.vertexS(i), L)] !== MS_NONE) colored++
    return { ...view, status: counts.none < winners.length ? 'ok' : 'noData', msA, msB, winners, counts, colored }
  }
}

/** El mapa de calor de una sesión cargada (para `rt.ext(HEAT_EXT, createHeat)`). */
export function createHeat(src: HeatSource): HeatModel {
  return new HeatModel(src)
}

/**
 * Color de cada punto de la línea central (rgb, 3 por punto) y si lo tiene (`valid`): velocidad con la rampa entre
 * el mínimo y el máximo de la vuelta; minisectores con el color de A, de B o de empate. Devuelve los puntos con color.
 */
export function heatPointColors(view: HeatView, path: HeatPath, palette: HeatPalette, rgb: Float32Array, valid: Uint8Array): number {
  valid.fill(0)
  if (view.status !== 'ok') return 0
  let n = 0
  if (view.speed) {
    const span = view.maxKmh - view.minKmh
    for (let i = 0; i < path.count; i++) {
      const v = view.speed[i]!
      if (Number.isNaN(v)) continue
      rampAt(palette.ramp, span > 0 ? (v - view.minKmh) / span : 0.5, rgb, i * 3)
      valid[i] = 1
      n++
    }
    return n
  }
  if (view.winners) {
    for (let i = 0; i < path.count; i++) {
      const w = view.winners[minisectorOf(path.vertexS(i), path.length, view.winners.length)]!
      if (w === MS_NONE) continue
      const c = w === MS_A ? palette.a : w === MS_B ? palette.b : palette.tie
      rgb[i * 3] = c[0]
      rgb[i * 3 + 1] = c[1]
      rgb[i * 3 + 2] = c[2]
      valid[i] = 1
      n++
    }
  }
  return n
}

/**
 * Colores de los vértices de la cinta (`buildRibbon`: dos por punto, izquierdo y derecho, con el color del punto) e
 * índices de los cuadriláteros cuyos dos puntos tienen color (los demás no se dibujan: se ve la pista de debajo).
 * Devuelve cuántos índices escribió.
 */
export function heatRibbon(rgb: Float32Array, valid: Uint8Array, closed: boolean, colors: Float32Array, index: Uint32Array): number {
  const n = valid.length
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      const v = valid[i] ? rgb[i * 3 + c]! : 0
      colors[i * 6 + c] = v
      colors[i * 6 + 3 + c] = v
    }
  }
  const quads = closed ? n : n - 1
  let o = 0
  for (let i = 0; i < quads; i++) {
    const j = (i + 1) % n
    if (!valid[i] || !valid[j]) continue
    const l0 = i * 2
    const r0 = l0 + 1
    const l1 = j * 2
    const r1 = l1 + 1
    index[o++] = l0
    index[o++] = r0
    index[o++] = l1
    index[o++] = r0
    index[o++] = r1
    index[o++] = l1
  }
  return o
}
