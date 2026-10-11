/**
 * Zonas de DRS deducidas de la telemetría (D38, ítem 11). TS puro, sin Vue ni three: corre en el Web Worker de carga.
 *
 * Ninguna fuente da la geometría de las zonas (ni FastF1, ni la API de circuitos, ni dirección de carrera, que solo
 * dice «DRS DISABLED IN ZONE 2», sin dónde). Lo que sí hay, de 2018 a 2025, es el canal DRS de cada coche: dónde lo
 * llevaron abierto. Las zonas son los tramos de la línea central donde muchas pasadas lo llevaron abierto. Es una
 * estimación («Estimado», campo `drsZones`): empiezan algo después de la línea de activación (reacción del piloto) y
 * acaban donde frenan, no en una línea oficial.
 *
 * Cómo se cuenta:
 * - Abierto es lo mismo que en el panel de telemetría (`drsState`: códigos 10, 12 y 14); 255 es «canal ausente».
 * - Solo pasadas limpias: muestras con posición en pista (sin pit lane, sin transición pista↔pit, sin huecos) y fuera
 *   de neutralizaciones (SC, VSC y roja: el DRS está desactivado y un «abierto» ahí sería ruido).
 * - Cada muestra abierta se sitúa en la `s` del replay en su instante (la misma interpolación que mueve al coche). Entre
 *   dos muestras abiertas seguidas del mismo tramo (≤ 1 s y ≤ 150 m) el flap iba abierto: se marca el recorrido entero.
 * - La pista se divide en celdas de 5 m. Una pasada es un coche en una vuelta (la `s` acumulada dividida por la
 *   longitud): cuenta una sola vez por celda, por muchas muestras que tenga dentro.
 * - Una celda es de zona si la abrieron al menos 3 pasadas y el 10 % de las de la celda más usada, de al menos 2
 *   coches distintos (o del único que la abriera). Un coche con el canal inverosímil (abierto en más de la mitad de
 *   sus muestras: canal atascado) no cuenta.
 * - Las celdas de zona seguidas forman un tramo (también a través de s = 0); dos tramos separados por menos de 30 m
 *   se unen y los de menos de 100 m se descartan (aperturas sueltas).
 * - Si lo que queda cubre más del 60 % de la vuelta, no es creíble (ningún circuito tiene tanta recta): sin zonas.
 *
 * Solo se calcula de 2018 a 2025: desde 2026 no hay DRS (ni canal por coche), y antes de 2018 no hay datos.
 */
import type { DecodedTrzb, Manifest, SessionEvents, WindowKind } from '@trazada/schema'
import { column } from '../data/columns'
import { type CarTrack, carTracks, newCarSample, PATH_TRACK, sampleCar } from '../replay/motion'
import { drsState } from '../telemetry/telemetry'
import { circuitModel } from '../track/circuit'

/** Temporadas con canal DRS por coche. */
export const DRS_FIRST_SEASON = 2018
export const DRS_LAST_SEASON = 2025

/** Celda de la pista (m). */
export const DRS_BIN_M = 5
/** Pasadas mínimas en una celda de zona. */
export const DRS_MIN_PASSES = 3
/** Fracción de las pasadas de la celda más usada que necesita una celda de zona. */
export const DRS_PEAK_FRACTION = 0.1
/** Coches distintos que necesita una celda de zona (o todos los que abrieran, si son menos). */
export const DRS_MIN_CARS = 2
/** Dos tramos separados por menos de esto (m) son la misma zona. */
export const DRS_MERGE_GAP_M = 30
/** Un tramo más corto (m) no es una zona: aperturas sueltas. */
export const DRS_MIN_SPAN_M = 100
/** Entre dos muestras abiertas seguidas, se marca el recorrido si no las separa más que esto. */
export const DRS_FILL_MAX_GAP_MS = 1000
export const DRS_FILL_MAX_STEP_M = 150
/** Un coche con el flap abierto en más de esta fracción de sus muestras tiene el canal atascado: no cuenta. */
export const DRS_MAX_CAR_OPEN_FRACTION = 0.5
/** Más de esta fracción de la vuelta en zona no es creíble: sin zonas. */
export const DRS_MAX_LAP_FRACTION = 0.6

/** Neutralizaciones: el DRS está desactivado. */
const NEUTRAL: ReadonlySet<WindowKind> = new Set<WindowKind>(['sc', 'vsc', 'vsc-ending', 'red'])

/**
 * - `deduced`: hay zonas deducidas (`spans`).
 * - `insufficient`: hay canal, pero no bastan las aperturas para deducir nada creíble (sesión en mojado, extracto
 *   corto, canal raro): «sin dato».
 * - `season`: temporada sin DRS (2026 en adelante): ni zonas ni canal por coche.
 * - `no-channel`: la sesión no trae el canal DRS de cada coche (o la temporada es anterior a 2018).
 */
export type DrsZonesStatus = 'deduced' | 'insufficient' | 'season' | 'no-channel'

export interface DrsZones {
  status: DrsZonesStatus
  /**
   * Pares [inicio, fin) de cada zona, en m sobre la línea central y ordenados por inicio; inicio > fin si cruza
   * s = 0 (la misma convención que los sectores de comisarios y `rangeIndices`). Vacío salvo con `deduced`.
   */
  spans: Float64Array
  /** Por zona: pasadas (coche y vuelta) con el DRS abierto en su celda más usada. */
  passes: Int32Array
  /** Coches cuyas aperturas se han contado. */
  cars: number
  /** Coches descartados por tener el canal atascado (abierto en más de la mitad de sus muestras). */
  discardedCars: number
}

/** Telemetría y movimiento de un coche. */
export interface DrsCarInput {
  /** Instante (ms de sesión) y código crudo del canal DRS de cada muestra de telemetría, en orden de tiempo. */
  t: ArrayLike<number>
  drs: ArrayLike<number>
  /** Pista de movimiento del coche (null: sin posiciones; sus aperturas no se pueden situar). */
  track: CarTrack | null
}

export interface DrsDeduceOptions {
  /** Longitud de la línea central (m): las `s` acumuladas se llevan a [0, longitud). */
  lengthM: number
  /** Intervalos [desde, hasta) en ms de sesión cuyas muestras no cuentan (neutralizaciones). */
  exclude?: readonly { fromMs: number; toMs: number }[]
}

export function noDrsZones(status: DrsZonesStatus, cars = 0, discardedCars = 0): DrsZones {
  return { status, spans: new Float64Array(0), passes: new Int32Array(0), cars, discardedCars }
}

/** Por qué una sesión no admite zonas deducidas (temporada o canal), o null si se pueden deducir. */
export function drsZonesUnavailable(manifest: {
  session: { season: number }
  channels: { drs: 'present' | 'absent' }
}): 'season' | 'no-channel' | null {
  const { season } = manifest.session
  if (season > DRS_LAST_SEASON) return 'season'
  if (season < DRS_FIRST_SEASON || manifest.channels.drs !== 'present') return 'no-channel'
  return null
}

/** Intervalos ordenados y sin solapes (para recorrerlos con un cursor). */
function disjoint(windows: readonly { fromMs: number; toMs: number }[]): { from: number[]; to: number[] } {
  const sorted = windows.filter((w) => w.toMs > w.fromMs).sort((a, b) => a.fromMs - b.fromMs)
  const from: number[] = []
  const to: number[] = []
  for (const w of sorted) {
    const last = to.length - 1
    if (last >= 0 && w.fromMs <= to[last]!) to[last] = Math.max(to[last]!, w.toMs)
    else {
      from.push(w.fromMs)
      to.push(w.toMs)
    }
  }
  return { from, to }
}

/** Tramos de celdas marcadas (circulares): [primera celda, celdas]. Todas marcadas: un tramo de la vuelta entera. */
function runsOf(marked: Uint8Array): [number, number][] {
  const n = marked.length
  const z = marked.indexOf(0)
  if (z < 0) return n > 0 ? [[0, n]] : []
  const runs: [number, number][] = []
  let start = -1
  // Desde la celda siguiente a una sin marcar hasta ella misma: ningún tramo queda partido por s = 0.
  for (let k = 1; k <= n; k++) {
    const b = (z + k) % n
    if (marked[b]) {
      if (start < 0) start = k
    } else if (start >= 0) {
      runs.push([(z + start) % n, k - start])
      start = -1
    }
  }
  return runs
}

/** Une los tramos separados por menos de `gap` celdas (también el último con el primero, a través de s = 0). */
function mergeRuns(runs: [number, number][], n: number, gap: number): [number, number][] {
  if (runs.length < 2) return runs
  const out: [number, number][] = [[...runs[0]!]]
  for (let k = 1; k < runs.length; k++) {
    const prev = out[out.length - 1]!
    const [start, len] = runs[k]!
    const between = (((start - (prev[0] + prev[1])) % n) + n) % n
    if (between < gap) prev[1] += between + len
    else out.push([start, len])
  }
  if (out.length > 1) {
    const first = out[0]!
    const last = out[out.length - 1]!
    const between = (((first[0] - (last[0] + last[1])) % n) + n) % n
    if (between < gap) {
      first[1] += last[1] + between
      first[0] = last[0]
      out.pop()
    }
  }
  return out
}

/**
 * Deduce las zonas de DRS de las aperturas de todos los coches (ver arriba). Sin ningún código DRS conocido en ningún
 * coche, `no-channel`; con canal pero sin nada creíble, `insufficient`.
 */
export function deduceDrsZones(cars: readonly DrsCarInput[], opts: DrsDeduceOptions): DrsZones {
  const L = opts.lengthM
  if (!(L > 0)) return noDrsZones('insufficient')
  const nBins = Math.ceil(L / DRS_BIN_M)
  const passes = new Int32Array(nBins)
  const carsPerBin = new Int32Array(nBins)
  /** Vuelta de la última pasada del coche en curso que marcó cada celda (NONE: ninguna aún). */
  const NONE = -0x80000000
  const lastLap = new Int32Array(nBins)
  const { from: exFrom, to: exTo } = disjoint(opts.exclude ?? [])
  const sample = newCarSample()

  let coded = 0
  let counted = 0
  let discarded = 0

  for (const car of cars) {
    const n = Math.min(car.t.length, car.drs.length)
    let known = 0
    let open = 0
    for (let i = 0; i < n; i++) {
      const code = car.drs[i]!
      if (code === 255) continue
      known++
      if (drsState(code) === 'open') open++
    }
    if (known > 0) coded++
    if (open === 0 || !car.track || car.track.t.length === 0) continue
    if (open / known > DRS_MAX_CAR_OPEN_FRACTION) {
      discarded++
      continue
    }

    const track = car.track
    lastLap.fill(NONE)
    let marks = 0
    const mark = (x: number) => {
      const lap = Math.floor(x / L)
      const bin = Math.min(nBins - 1, Math.floor((x - lap * L) / DRS_BIN_M))
      const prev = lastLap[bin]!
      if (prev === lap) return
      if (prev === NONE) carsPerBin[bin]!++
      lastLap[bin] = lap
      passes[bin]!++
      marks++
    }

    sample.i = -1
    let ex = 0
    // Última muestra abierta y limpia (para marcar el recorrido hasta la siguiente): instante, s y segmento.
    let prevT = Number.NaN
    let prevS = Number.NaN
    let prevSeg = -1
    for (let i = 0; i < n; i++) {
      const t = car.t[i]!
      if (drsState(car.drs[i]!) !== 'open') {
        prevSeg = -1
        continue
      }
      while (ex < exTo.length && exTo[ex]! <= t) ex++
      if (ex < exFrom.length && exFrom[ex]! <= t) {
        prevSeg = -1
        continue
      }
      const smp = sampleCar(track, t, sample)
      if (smp.state !== 'visible' || smp.path !== PATH_TRACK || smp.i < 0) {
        prevSeg = -1
        continue
      }
      const s = smp.s
      const seg = track.seg[smp.i]!
      if (seg === prevSeg && t - prevT <= DRS_FILL_MAX_GAP_MS && s >= prevS && s - prevS <= DRS_FILL_MAX_STEP_M) {
        // El flap iba abierto en las dos muestras: también entre ellas (una celda cada 5 m, sin saltarse ninguna).
        for (let x = prevS + DRS_BIN_M; x < s; x += DRS_BIN_M) mark(x)
      }
      mark(s)
      prevT = t
      prevS = s
      prevSeg = seg
    }
    if (marks > 0) counted++
  }

  if (coded === 0) return noDrsZones('no-channel')
  let peak = 0
  for (let b = 0; b < nBins; b++) peak = Math.max(peak, passes[b]!)
  if (peak === 0) return noDrsZones('insufficient', counted, discarded)

  const minPasses = Math.max(DRS_MIN_PASSES, Math.ceil(DRS_PEAK_FRACTION * peak))
  const minCars = Math.min(DRS_MIN_CARS, counted)
  const zone = new Uint8Array(nBins)
  for (let b = 0; b < nBins; b++) zone[b] = passes[b]! >= minPasses && carsPerBin[b]! >= minCars ? 1 : 0

  const runs = mergeRuns(runsOf(zone), nBins, Math.ceil(DRS_MERGE_GAP_M / DRS_BIN_M)).filter(
    ([, len]) => len * DRS_BIN_M >= DRS_MIN_SPAN_M,
  )
  const covered = runs.reduce((acc, [, len]) => acc + len, 0)
  if (runs.length === 0 || covered >= nBins || covered * DRS_BIN_M > DRS_MAX_LAP_FRACTION * L) {
    return noDrsZones('insufficient', counted, discarded)
  }

  runs.sort((a, b) => a[0] - b[0])
  const spans = new Float64Array(runs.length * 2)
  const zonePasses = new Int32Array(runs.length)
  runs.forEach(([start, len], k) => {
    const end = start + len
    spans[k * 2] = start * DRS_BIN_M
    spans[k * 2 + 1] = end <= nBins ? Math.min(L, end * DRS_BIN_M) : (end - nBins) * DRS_BIN_M
    let best = 0
    for (let j = 0; j < len; j++) best = Math.max(best, passes[(start + j) % nBins]!)
    zonePasses[k] = best
  })
  return { status: 'deduced', spans, passes: zonePasses, cars: counted, discardedCars: discarded }
}

/**
 * Zonas de una sesión cargada (lo que hace el Web Worker justo después de las tangentes): telemetría y movimiento de
 * cada coche, la longitud de la línea central y las neutralizaciones de `events.json`.
 */
export function sessionDrsZones(
  manifest: Pick<Manifest, 'session' | 'channels'>,
  data: { motion: DecodedTrzb; car: DecodedTrzb; circuit: DecodedTrzb; events: Pick<SessionEvents, 'windows'> },
  tangents: Float64Array,
): DrsZones {
  const unavailable = drsZonesUnavailable(manifest)
  if (unavailable) return noDrsZones(unavailable)
  const tracks = new Map(carTracks(data.motion, tangents).map((tr) => [tr.car, tr]))
  const table = data.car.tables.cars!
  const t = column(data.car, 'tel', 't')
  const drs = column(data.car, 'tel', 'drs')
  const cars: DrsCarInput[] = []
  for (let k = 0; k < table.rows; k++) {
    const start = table.columns.start![k]!
    const count = table.columns.count![k]!
    cars.push({
      t: t.subarray(start, start + count),
      drs: drs.subarray(start, start + count),
      track: tracks.get(String(table.columns.car![k])) ?? null,
    })
  }
  const exclude = data.events.windows
    .filter((w) => NEUTRAL.has(w.kind))
    .map((w) => ({ fromMs: w.fromMs, toMs: w.toMs ?? Number.POSITIVE_INFINITY }))
  return deduceDrsZones(cars, { lengthM: circuitModel(data.circuit).centerline.length, exclude })
}

/** Longitud (m) de una zona [inicio, fin), con envoltura en s = 0. */
export function spanLength(sStart: number, sEnd: number, lengthM: number): number {
  return sEnd >= sStart ? sEnd - sStart : lengthM - sStart + sEnd
}
