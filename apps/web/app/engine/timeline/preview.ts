/**
 * Vista previa del timeline (ítem 16): qué pasaba en un instante cualquiera de la sesión, para la tarjeta que sale al
 * pasar el puntero, el dedo o el foco por el timeline. TS puro (sin Vue ni three) y solo con datos reales:
 *
 * - Vuelta: la del líder (`leaderLapAt`, la misma que el dock) en carrera y sprint, con las totales del manifest si
 *   las trae. Fuera de carrera no hay vuelta de sesión: la tarjeta enseña el reloj visible (`clockMs`).
 * - El primero, rotulado «Líder» en carrera y sprint y «Mejor vuelta» fuera de carrera (nunca «Líder»), por orden de
 *   preferencia:
 *   (a) la torre oficial (`timing.stream`): el coche que la torre da como P1 en t. La torre manda en cuanto algún
 *       coche tiene posición en ella en t (como en la clasificación). Si dos coches la reclaman a la vez (filas
 *       desacompasadas), manda el mensaje más reciente; a igual hora, sin dato.
 *   (b) sin torre en t, en carrera y sprint: el orden en la línea de meta, con las reglas de la clasificación
 *       (`compareAtLine`): más vueltas completadas y, a igualdad, quien cruzó antes. Los registros residuales de un
 *       retirado no son pasos por meta (`buildLapTable`). El primero solo cambia cuando alguien cruza la línea.
 *   (c) sin torre en t, fuera de carrera: la mejor vuelta válida (con tiempo oficial y no anulada a esa hora) de la
 *       tanda en curso, con las reglas de la clasificación (`compareByBestLap`). En clasificación, antes de que nadie
 *       marque tiempo en la tanda en curso, sin dato.
 *   Nunca se deduce de la posición en pista: antes del primer paso por meta o de la primera vuelta válida, o con un
 *   empate exacto que esas reglas no deshacen, el coche es null (la tarjeta dice «sin dato»). Como en la
 *   clasificación, solo cuentan los coches de la lista de pilotos del manifest.
 * - Estado de pista en t: una instancia propia de `TrackState` (la del reloj no se toca). Si el manifest lo declara
 *   deducido (`quality.estimated` con `trackStatus`, fuentes dev), `trackInferred`: la tarjeta lo marca «Estimado».
 * - Marcadores cerca del cursor: banderas de dirección de carrera, entradas al pit lane e inicios de SC, VSC y roja a
 *   menos de `toleranceMs` (dentro de la reproducción), del más cercano al más lejano.
 *
 * El primero se precalcula una vez como listas de cambios (barridos sobre la torre, los pasos por meta y las vueltas
 * válidas); cada consulta es una búsqueda binaria más el estado de pista: microsegundos, al ritmo del puntero.
 */
import type { DecodedTrzb, Manifest, SessionEvents, SessionType, WindowKind } from '@trazada/schema'
import { buildLapTable, type LapTable, segmentAt } from '../analysis/lapTable'
import {
  type BestLapKey,
  bestLapKeyAt,
  compareAtLine,
  compareByBestLap,
  type LineKey,
  lineKeyAt,
} from '../leaderboard/leaderboard'
import { TrackState, type TrackStateSnapshot } from '../trackstate/TrackState'
import { clockOrigin, type FlagKind, leaderLapAt, type TimelineMarkers } from './markers'

/** Clave de `rt.ext` de la vista previa (una por runtime, perezosa). */
export const PREVIEW_EXT = 'timelinePreview'

/** De dónde sale el primero: la torre oficial, el orden en la línea de meta o la mejor vuelta. */
export type LeaderBasis = 'tower' | 'line' | 'bestLap'
/** Cómo se rotula: «Líder» en carrera y sprint; «Mejor vuelta» en el resto. */
export type LeaderRole = 'leader' | 'bestLap'

export interface PreviewLeader {
  basis: LeaderBasis
  /** Dorsal (texto); null = sin dato. */
  car: string | null
  /** Fuera de carrera: su mejor vuelta válida (ms) en la tanda en curso; null sin dato (y siempre en carrera). */
  lapMs: number | null
}

export type PreviewMarker =
  | { kind: 'flag'; t: number; flag: FlagKind; sector: number | null }
  | { kind: 'pit'; t: number; car: string }
  | { kind: 'window'; t: number; window: WindowKind }

export interface PreviewAt {
  /** Instante consultado (ms de sesión). */
  t: number
  /** Reloj visible del dock en t (t menos su origen). */
  clockMs: number
  /** Vuelta del líder (carrera y sprint); null fuera de carrera o antes de la salida. */
  lap: number | null
  /** Vueltas de la carrera según el manifest; null fuera de carrera o sin dato. */
  totalLaps: number | null
  role: LeaderRole
  leader: PreviewLeader
  track: TrackStateSnapshot
  /** El estado de pista es deducido (no oficial): va con «Estimado». */
  trackInferred: boolean
  /** Marcadores a menos de la tolerancia, del más cercano al más lejano. */
  markers: PreviewMarker[]
}

/** Cambio del primero según la torre. `active: false`: en t ningún coche tiene posición en la torre. */
export interface TowerChange {
  t: number
  active: boolean
  car: string | null
}

/** Cambio del primero según la línea de meta o la mejor vuelta. */
export interface LeaderChange {
  t: number
  car: string | null
  /** Mejor vuelta (ms) del primero; solo fuera de carrera. */
  lapMs: number | null
}

/** Última entrada con `t ≤ x` de una lista ordenada por t, o null. */
function entryAt<T extends { t: number }>(list: readonly T[], x: number): T | null {
  let lo = 0
  let hi = list.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (list[mid]!.t <= x) lo = mid + 1
    else hi = mid
  }
  return lo === 0 ? null : list[lo - 1]!
}

/** El primero de `keys` según `cmp`, o null si no hay ninguno o si el primero empata con otro. */
function top<K>(keys: ReadonlyMap<string, K>, cmp: (a: K, b: K) => number): { car: string; key: K } | null {
  let best: { car: string; key: K } | null = null
  let tie = false
  for (const [car, key] of keys) {
    if (!best) {
      best = { car, key }
      continue
    }
    const c = cmp(key, best.key)
    if (c < 0) {
      best = { car, key }
      tie = false
    } else if (c === 0) tie = true
  }
  return best && !tie ? best : null
}

/** ¿Cuenta este coche? Los de la lista de pilotos (como en la clasificación); sin lista, todos. */
type CarFilter = (car: string) => boolean

/** Torre oficial: el P1 en cada instante (barrido por las filas de la torre en orden de llegada). */
function towerChanges(timing: DecodedTrzb, counts: CarFilter): TowerChange[] {
  const st = timing.tables.stream
  if (!st || st.rows === 0) return []
  const time = st.columns.t!
  const carCol = st.columns.car!
  const posCol = st.columns.position!
  // A igual hora, en el orden de la tabla: de un mismo coche manda su última fila (como en la clasificación).
  const order = Array.from({ length: st.rows }, (_, i) => i).sort((a, b) => time[a]! - time[b]! || a - b)
  const position = new Map<string, number>()
  /** Desde cuándo reclama el P1 cada coche que lo reclama. */
  const p1 = new Map<string, number>()
  let known = 0
  const out: TowerChange[] = []
  let i = 0
  while (i < order.length) {
    const t = time[order[i]!]!
    for (; i < order.length && time[order[i]!] === t; i++) {
      const row = order[i]!
      const car = String(carCol[row])
      if (!counts(car)) continue
      const pos = posCol[row]!
      const prev = position.get(car) ?? 0
      if (prev > 0 && !(pos > 0)) known--
      else if (!(prev > 0) && pos > 0) known++
      position.set(car, pos)
      if (pos === 1) p1.set(car, t)
      else p1.delete(car)
    }
    let car: string | null = null
    let since = -Infinity
    let tie = false
    for (const [c, from] of p1) {
      if (from > since) {
        car = c
        since = from
        tie = false
      } else if (from === since) tie = true
    }
    const change: TowerChange = { t, active: known > 0, car: known > 0 && !tie ? car : null }
    const last = out[out.length - 1]
    if (!last || last.active !== change.active || last.car !== change.car) out.push(change)
  }
  return out
}

/** Carrera sin torre: el primero en la línea de meta en cada paso por meta. */
function lineChanges(lapTable: LapTable, counts: CarFilter): LeaderChange[] {
  const events: { t: number; car: string }[] = []
  for (const [car, laps] of lapTable.cars) {
    if (!counts(car)) continue
    for (let k = 0; k < laps.lap.length; k++) if (laps.crossMs[k]! > 0) events.push({ t: laps.crossMs[k]!, car })
  }
  events.sort((a, b) => a.t - b.t)
  const keys = new Map<string, LineKey>()
  const out: LeaderChange[] = []
  let i = 0
  while (i < events.length) {
    const t = events[i]!.t
    for (; i < events.length && events[i]!.t === t; i++) {
      const car = events[i]!.car
      keys.set(car, lineKeyAt(lapTable.cars.get(car), t))
    }
    const first = top(keys, compareAtLine)
    const car = first?.car ?? null
    const last = out[out.length - 1]
    if (!last || last.car !== car) out.push({ t, car, lapMs: null })
  }
  return out
}

/** Libres y clasificación sin torre: la mejor vuelta válida de la tanda en curso en cada cambio. */
function bestLapChanges(lapTable: LapTable, counts: CarFilter): LeaderChange[] {
  const events: { t: number; car: string | null }[] = []
  for (const [car, laps] of lapTable.cars) {
    if (!counts(car)) continue
    for (let k = 0; k < laps.lap.length; k++) {
      if (laps.crossMs[k]! > 0) events.push({ t: laps.crossMs[k]!, car })
      // Una anulación quita la vuelta desde su mensaje (o desde que acaba, sin mensaje).
      const deleted = laps.deletedFrom[k]!
      if (Number.isFinite(deleted)) events.push({ t: deleted, car })
    }
  }
  // Inicio de cada tanda de clasificación: la anterior deja de contar.
  for (const start of lapTable.segments.starts) if (Number.isFinite(start)) events.push({ t: start, car: null })
  events.sort((a, b) => a.t - b.t)
  const keys = new Map<string, BestLapKey>()
  const out: LeaderChange[] = []
  let i = 0
  while (i < events.length) {
    const t = events[i]!.t
    for (; i < events.length && events[i]!.t === t; i++) {
      const car = events[i]!.car
      if (car !== null) keys.set(car, bestLapKeyAt(lapTable.cars.get(car), t))
    }
    const first = top(keys, compareByBestLap)
    const current = segmentAt(lapTable.segments, t)
    const valid = first !== null && first.key.seg >= 0 && first.key.seg === current
    const car = valid ? first.car : null
    const lapMs = valid ? first.key.best : null
    const last = out[out.length - 1]
    if (!last || last.car !== car || last.lapMs !== lapMs) out.push({ t, car, lapMs })
  }
  return out
}

/** El primero en cada instante: torre, línea de meta o mejor vuelta (ver la cabecera). */
export class LeaderTimeline {
  readonly race: boolean
  /** Cambios según la torre (vacía sin torre). */
  readonly tower: readonly TowerChange[]
  /** Cambios según la línea de meta (carrera) o la mejor vuelta (resto), para cuando la torre no dice nada. */
  readonly fallback: readonly LeaderChange[]

  /** `cars`: los dorsales que cuentan (los de la lista de pilotos, como en la clasificación); sin ella, todos. */
  constructor(
    private readonly lapTable: LapTable,
    timing: DecodedTrzb,
    cars?: readonly string[],
  ) {
    const only = cars ? new Set(cars) : null
    const counts: CarFilter = (car) => !only || only.has(car)
    this.race = lapTable.race
    this.tower = towerChanges(timing, counts)
    this.fallback = this.race ? lineChanges(lapTable, counts) : bestLapChanges(lapTable, counts)
  }

  at(t: number): PreviewLeader {
    const tower = entryAt(this.tower, t)
    if (tower?.active) {
      return { basis: 'tower', car: tower.car, lapMs: !this.race && tower.car ? this.bestLapOf(tower.car, t) : null }
    }
    const change = entryAt(this.fallback, t)
    return { basis: this.race ? 'line' : 'bestLap', car: change?.car ?? null, lapMs: change?.lapMs ?? null }
  }

  /** Mejor vuelta válida de un coche en la tanda en curso en t; null sin ella. */
  private bestLapOf(car: string, t: number): number | null {
    const key = bestLapKeyAt(this.lapTable.cars.get(car), t)
    return key.seg >= 0 && key.seg === segmentAt(this.lapTable.segments, t) ? key.best : null
  }
}

export interface PreviewInput {
  type: SessionType
  timing: DecodedTrzb
  events: SessionEvents
  playback: { startMs: number; endMs: number; lightsOutMs?: number | null }
  /** Vueltas de la carrera según el manifest (`session.totalLaps`). */
  totalLaps?: number | null
  /** `quality.estimated` del manifest. */
  estimated: readonly string[]
  /** Dorsales de la lista de pilotos (solo cuentan esos, como en la clasificación); sin ella, todos. */
  cars?: readonly string[]
  markers: TimelineMarkers
  /** Índice de vueltas ya hecho (el de la clasificación), para no rehacerlo. */
  lapTable?: LapTable
}

export class TimelinePreview {
  readonly race: boolean
  readonly role: LeaderRole
  readonly totalLaps: number | null
  readonly trackInferred: boolean
  readonly leaders: LeaderTimeline
  private readonly origin: number
  private readonly trackState: TrackState
  private readonly marks: PreviewMarker[]

  constructor(private readonly input: PreviewInput) {
    const { type, timing, events, playback, markers } = input
    this.race = type === 'race' || type === 'sprint'
    this.role = this.race ? 'leader' : 'bestLap'
    const total = input.totalLaps
    this.totalLaps = this.race && Number.isInteger(total) && total! >= 1 ? total! : null
    this.trackInferred = input.estimated.includes('trackStatus')
    this.leaders = new LeaderTimeline(input.lapTable ?? buildLapTable(type, timing, events.raceControl), timing, input.cars)
    this.origin = clockOrigin(type, timing, playback)
    // Propia: consultar otro instante no cambia la del reloj.
    this.trackState = new TrackState(events, playback.endMs)
    const inRange = (t: number) => t >= playback.startMs && t <= playback.endMs
    const marks: PreviewMarker[] = []
    for (const f of markers.flags) if (inRange(f.t)) marks.push({ kind: 'flag', t: f.t, flag: f.kind, sector: f.sector })
    for (const p of markers.pits) if (inRange(p.inMs)) marks.push({ kind: 'pit', t: p.inMs, car: p.car })
    for (const w of markers.windows) if (inRange(w.fromMs)) marks.push({ kind: 'window', t: w.fromMs, window: w.kind })
    this.marks = marks.sort((a, b) => a.t - b.t)
  }

  /** Lo que pasaba en t; con `toleranceMs` > 0, también los marcadores a menos de esa distancia. */
  at(t: number, toleranceMs = 0): PreviewAt {
    this.trackState.update(t)
    const lap = this.race ? leaderLapAt(this.input.markers, t) : 0
    return {
      t,
      clockMs: t - this.origin,
      lap: lap >= 1 ? lap : null,
      totalLaps: this.totalLaps,
      role: this.role,
      leader: this.leaders.at(t),
      track: this.trackState.snapshot,
      trackInferred: this.trackInferred,
      markers: toleranceMs > 0 ? this.markersNear(t, toleranceMs) : [],
    }
  }

  /** Marcadores a menos de `toleranceMs` de t, del más cercano al más lejano (a igual distancia, por hora). */
  markersNear(t: number, toleranceMs: number): PreviewMarker[] {
    let lo = 0
    let hi = this.marks.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.marks[mid]!.t < t - toleranceMs) lo = mid + 1
      else hi = mid
    }
    const out: PreviewMarker[] = []
    for (let i = lo; i < this.marks.length && this.marks[i]!.t <= t + toleranceMs; i++) out.push(this.marks[i]!)
    return out.sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t) || a.t - b.t)
  }
}

/** Lo que la vista previa necesita del runtime del replay (estructural: el motor no depende de `replay/`). */
export interface PreviewSource {
  readonly session: { readonly manifest: Manifest; readonly timing: DecodedTrzb; readonly events: SessionEvents }
  readonly markers: TimelineMarkers
  readonly leaderboard: { readonly lapTable: LapTable }
}

/** La vista previa de una sesión cargada (para `rt.ext(PREVIEW_EXT, createTimelinePreview)`). */
export function createTimelinePreview(src: PreviewSource): TimelinePreview {
  const { session, quality, drivers } = src.session.manifest
  return new TimelinePreview({
    type: session.type,
    timing: src.session.timing,
    events: src.session.events,
    playback: session.playback,
    totalLaps: session.totalLaps,
    estimated: quality.estimated,
    cars: drivers.map((d) => d.number),
    markers: src.markers,
    lapTable: src.leaderboard.lapTable,
  })
}
