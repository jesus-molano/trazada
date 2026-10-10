/**
 * Colores de sector (ítem 4, D34), calculados por Trazada con los tiempos de sector oficiales de la tabla de vueltas.
 * No son las banderas morado/verde del feed (FastF1 las descarta): es un cálculo determinista, no una estimación.
 *
 * Cada tiempo de sector recibe su color en el instante en que se completa, y lo conserva (como en una torre de
 * tiempos: si otro piloto lo mejora después, el que ya se pintó no cambia):
 *
 * - `best` (morado): estrictamente mejor que el mejor de ese sector en toda la sesión hasta ese instante (un empate
 *   no es morado). El primer tiempo de un sector en la sesión es morado.
 * - `personal` (verde): estrictamente mejor que el mejor personal del piloto en ese sector hasta ese instante.
 * - `normal` (amarillo): el resto.
 * - `none` (gris): sin tiempo de sector (−1 en la tabla), «sin dato».
 *
 * Solo cuentan los sectores de vueltas con paso por meta real (`crossMs`, ver `buildLapTable`) y completados antes
 * del instante: nada del futuro. Una vuelta anulada cuenta hasta el mensaje de dirección de carrera que la anula
 * (`deletedFrom`); desde entonces deja de contar para los mejores (los colores posteriores ya no la tienen en cuenta)
 * y se muestra como anulada, sin color de mejora. Nunca se da una «mejor vuelta posible» (sería una estimación).
 *
 * Instante en que se completa cada sector (sin cambiar el esquema): S3 al pasar por meta, S2 en meta − S3 y S1 en
 * meta − S3 − S2. Si falta un tiempo posterior, ese instante no se conoce y se usa el paso por meta (cota superior:
 * seguro que ya se había completado).
 *
 * TS puro (sin Vue ni three). El precálculo es una pasada O(n log n) por los ~3 sectores de cada vuelta; la consulta
 * no reserva memoria (objetos precalculados por vuelta).
 */
import { type CarLaps, lastCompletedIndex, type LapTable } from '../analysis/lapTable'

export type SectorStatus = 'best' | 'personal' | 'normal' | 'none'

/** Los estados, en el orden de su código interno (`STATUS_CODE`). */
export const SECTOR_STATUSES: readonly SectorStatus[] = ['best', 'personal', 'normal', 'none']

export interface SectorCell {
  /** Tiempo oficial del sector (ms); null sin dato. */
  readonly ms: number | null
  /** Color que recibió al completarse (`none` sin dato). */
  readonly status: SectorStatus
}

export interface LapSectors {
  /** Número de vuelta (la última completada en el instante de la consulta). */
  readonly lap: number
  readonly sectors: readonly [SectorCell, SectorCell, SectorCell]
  /** Dirección de carrera ya ha anulado la vuelta: no cuenta (se muestra tachada y sin color de mejora). */
  readonly deleted: boolean
}

const STATUS_CODE: Record<SectorStatus, number> = { best: 0, personal: 1, normal: 2, none: 3 }

interface Entry {
  readonly ms: number
  removed: boolean
}

/** Tiempos vigentes de un sector (de la sesión o de un piloto): mínimo con altas y bajas (las bajas son raras). */
class Bests {
  private readonly entries: Entry[] = []
  private min = Infinity

  get best(): number {
    return this.min
  }

  add(ms: number): Entry {
    const e = { ms, removed: false }
    this.entries.push(e)
    if (ms < this.min) this.min = ms
    return e
  }

  remove(e: Entry): void {
    if (e.removed) return
    e.removed = true
    if (e.ms > this.min) return
    this.min = Infinity
    for (const x of this.entries) if (!x.removed && x.ms < this.min) this.min = x.ms
  }
}

interface SectorEvent {
  /** Instante en que se completa (ms de sesión). */
  readonly t: number
  readonly car: string
  /** Índice de la vuelta en `CarLaps`. */
  readonly k: number
  /** 0, 1 o 2. */
  readonly s: number
  readonly ms: number
  /** Desde cuándo está anulada su vuelta (Infinity: no se anuló). */
  readonly deletedFrom: number
}

const sectorColumns = (laps: CarLaps) => [laps.s1Ms, laps.s2Ms, laps.s3Ms] as const

/** Instante en que se completa el sector `s` de la vuelta `k` (ver arriba), con su paso por meta `cross`. */
function sectorDoneAt(laps: CarLaps, k: number, s: number, cross: number): number {
  const s2 = laps.s2Ms[k]!
  const s3 = laps.s3Ms[k]!
  if (s === 2) return cross
  if (s === 1) return s3 > 0 ? cross - s3 : cross
  return s3 > 0 && s2 > 0 ? cross - s3 - s2 : cross
}

export class SectorTimes {
  private readonly laps: ReadonlyMap<string, CarLaps>
  /** Estado (código) de cada sector de cada vuelta, por coche: 3 por vuelta, en el orden de `CarLaps`. */
  private readonly codes = new Map<string, Uint8Array>()
  /** Resultado precalculado de cada vuelta: vigente y anulada. */
  private readonly views = new Map<string, { live: LapSectors; deleted: LapSectors }[]>()
  /** Sectores con tiempo de vueltas completadas (los que entran en el cálculo). */
  readonly timedSectors: number

  constructor(table: Pick<LapTable, 'cars'>) {
    this.laps = table.cars
    const events: SectorEvent[] = []
    for (const [car, laps] of table.cars) {
      const codes = new Uint8Array(laps.lap.length * 3)
      const cols = sectorColumns(laps)
      for (let k = 0; k < laps.lap.length; k++) {
        for (let s = 0; s < 3; s++) {
          const ms = cols[s]![k]!
          codes[k * 3 + s] = ms > 0 ? STATUS_CODE.normal : STATUS_CODE.none
          const cross = laps.crossMs[k]!
          if (!(ms > 0) || !(cross > 0)) continue
          events.push({ t: sectorDoneAt(laps, k, s, cross), car, k, s, ms, deletedFrom: laps.deletedFrom[k]! })
        }
      }
      this.codes.set(car, codes)
    }
    this.timedSectors = events.length
    this.colour(events)
    for (const [car, laps] of table.cars) {
      const codes = this.codes.get(car)!
      const cols = sectorColumns(laps)
      const list: { live: LapSectors; deleted: LapSectors }[] = []
      for (let k = 0; k < laps.lap.length; k++) {
        const cell = (s: number): SectorCell => {
          const ms = cols[s]![k]!
          return Object.freeze({ ms: ms > 0 ? ms : null, status: SECTOR_STATUSES[codes[k * 3 + s]!]! })
        }
        const sectors = Object.freeze([cell(0), cell(1), cell(2)] as const)
        list.push({
          live: Object.freeze({ lap: laps.lap[k]!, sectors, deleted: false }),
          deleted: Object.freeze({ lap: laps.lap[k]!, sectors, deleted: true }),
        })
      }
      this.views.set(car, list)
    }
  }

  /**
   * Recorre los sectores por el instante en que se completan y les da su color frente a los mejores vigentes en ese
   * instante. Las anulaciones son bajas en `deletedFrom`; a igualdad de instante, la baja va antes (en ese instante
   * la vuelta ya no cuenta).
   */
  private colour(events: SectorEvent[]): void {
    type Step = { t: number; add: SectorEvent | null; drop: SectorEvent | null }
    const steps: Step[] = events.map((e) => ({ t: e.t, add: e, drop: null }))
    for (const e of events) if (e.deletedFrom !== Infinity) steps.push({ t: e.deletedFrom, add: null, drop: e })
    const carOrder = new Map([...this.laps.keys()].map((c, i) => [c, i]))
    const rank = (x: Step) => (x.drop ? 0 : 1)
    steps.sort((a, b) => {
      if (a.t !== b.t) return a.t - b.t
      if (rank(a) !== rank(b)) return rank(a) - rank(b)
      const ea = (a.add ?? a.drop)!
      const eb = (b.add ?? b.drop)!
      return ea.s - eb.s || carOrder.get(ea.car)! - carOrder.get(eb.car)! || ea.k - eb.k
    })

    const session = [new Bests(), new Bests(), new Bests()]
    const personal = new Map<string, Bests[]>()
    const counted = new Map<SectorEvent, { session: Entry; personal: Entry }>()
    for (const step of steps) {
      if (step.drop) {
        const c = counted.get(step.drop)
        if (c) {
          session[step.drop.s]!.remove(c.session)
          personal.get(step.drop.car)![step.drop.s]!.remove(c.personal)
          counted.delete(step.drop)
        }
        continue
      }
      const e = step.add!
      const mine = personal.get(e.car) ?? personal.set(e.car, [new Bests(), new Bests(), new Bests()]).get(e.car)!
      const codes = this.codes.get(e.car)!
      // Ya anulada al completarse: no cuenta para nadie (y se mostrará anulada).
      if (e.deletedFrom <= e.t) {
        codes[e.k * 3 + e.s] = STATUS_CODE.normal
        continue
      }
      const status: SectorStatus = e.ms < session[e.s]!.best ? 'best' : e.ms < mine[e.s]!.best ? 'personal' : 'normal'
      codes[e.k * 3 + e.s] = STATUS_CODE[status]
      counted.set(e, { session: session[e.s]!.add(e.ms), personal: mine[e.s]!.add(e.ms) })
    }
  }

  /**
   * Sectores de la última vuelta completada (paso por meta real) del coche en t, con sus colores y si ya está
   * anulada en t. null si aún no ha completado ninguna. Siempre el mismo objeto para la misma vuelta y estado.
   */
  lastLap(car: string, t: number): LapSectors | null {
    const laps = this.laps.get(car)
    if (!laps) return null
    const k = lastCompletedIndex(laps, t)
    if (k < 0) return null
    const view = this.views.get(car)![k]!
    const from = laps.deletedFrom[k]!
    return from !== Infinity && from <= t ? view.deleted : view.live
  }
}
