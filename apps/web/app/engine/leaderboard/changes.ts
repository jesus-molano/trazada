/**
 * Cambios de puesto en la clasificación (ítem 8): las flechas ↑↓ comparan dos órdenes calculados seguidos por
 * el leaderboard, nunca la parrilla (vendría de Jolpica, prohibida) ni un orden de antes de un salto del reloj.
 *
 * Reglas de honestidad:
 * - Solo cuenta un puesto conocido (`positionKnown`) de un coche con señal: un «—» nunca gana ni pierde puestos
 *   (ni conserva una flecha anterior), y un coche que pasa de «—» a un puesto (su primera vuelta, su primer paso por
 *   meta) no lleva flecha.
 * - En libres y clasificación el orden es por mejor vuelta: la primera vuelta cronometrada (de la tanda en
 *   curso, en clasificación) no es un adelantamiento, así que un coche sin mejor vuelta no cuenta.
 * - Un cambio tiene que mantenerse `hold` actualizaciones seguidas (~300 ms a 6,7 Hz): filtra los vaivenes de
 *   una sola actualización de la torre.
 * - Tras un seek, una carga o cualquier salto del reloj, `reset`: el orden nuevo es la referencia y no hay flechas.
 *
 * TS puro (sin Vue ni DOM): el tiempo de pared (`now`, ms) lo pone quien llama, y las flechas caducan con él.
 */

/** Lo que el seguimiento necesita de cada fila (`LeaderboardRow` lo cumple). */
export interface RankRow {
  readonly car: string
  /** Puesto en la lista (1…N). */
  readonly position: number
  readonly positionKnown: boolean
  readonly noSignal: boolean
  /** Mejor vuelta válida (de la tanda en curso en clasificación); null = aún sin vuelta cronometrada. */
  readonly bestLapMs: number | null
}

export interface RankChange {
  readonly car: string
  /** Puestos ganados (> 0) o perdidos (< 0) mientras dura la flecha (se acumulan en el mismo sentido). */
  readonly delta: number
  /** Puesto tras el último cambio. */
  readonly position: number
  /** Reloj de pared (ms) del último cambio confirmado: la flecha caduca `ttlMs` después. */
  readonly at: number
  /** Crece con cada cambio confirmado (de cualquier coche): sirve de clave para repetir el destello. */
  readonly seq: number
}

/** Actualizaciones seguidas que tiene que mantenerse un puesto nuevo para contar (2 ≈ 300 ms a 6,7 Hz). */
export const RANK_CHANGE_HOLD_UPDATES = 2
/** Vida de una flecha en tiempo de pared (ms). */
export const RANK_CHANGE_TTL_MS = 3000

export interface RankChangeOptions {
  /** Carrera: el orden es en pista. Si no (libres, clasificación), el orden es por mejor vuelta. */
  race: boolean
  hold?: number
  ttlMs?: number
}

/** ¿Puede el puesto de esta fila ganar o perder posiciones? (conocido, con señal y, fuera de carrera, cronometrado) */
export function rankEligible(row: RankRow, race: boolean): boolean {
  return row.positionKnown && row.position > 0 && !row.noSignal && (race || row.bestLapMs !== null)
}

/** Coches con puesto conocido, en el orden de la lista (lo que se compara para animar la reordenación). */
export function rankedOrder(rows: readonly RankRow[]): string[] {
  const out: string[] = []
  for (const r of rows) if (r.positionKnown && r.position > 0) out.push(r.car)
  return out
}

export class RankChangeTracker {
  readonly race: boolean
  private readonly hold: number
  private readonly ttlMs: number
  /** Último puesto confirmado de cada coche (null: no elegible, p. ej. «—» o sin vuelta cronometrada). */
  private readonly base = new Map<string, number | null>()
  /** Puesto candidato distinto del confirmado y cuántas actualizaciones seguidas lleva. */
  private readonly pending = new Map<string, { position: number | null; seen: number }>()
  private readonly current = new Map<string, RankChange>()
  private seq = 0
  private _version = 0

  constructor(options: RankChangeOptions) {
    this.race = options.race
    this.hold = Math.max(1, Math.floor(options.hold ?? RANK_CHANGE_HOLD_UPDATES))
    this.ttlMs = options.ttlMs ?? RANK_CHANGE_TTL_MS
  }

  /** Flechas vigentes por coche. */
  get active(): ReadonlyMap<string, RankChange> {
    return this.current
  }

  /** Crece cada vez que cambian las flechas vigentes (`active`): para publicarlas solo entonces. */
  get version(): number {
    return this._version
  }

  /**
   * Salto del reloj (seek, carga, paso en pausa): `rows` es la nueva referencia y se borran las flechas y los
   * cambios a medio confirmar. Devuelve si había flechas.
   */
  reset(rows: readonly RankRow[]): boolean {
    const had = this.current.size > 0
    this.base.clear()
    this.pending.clear()
    this.current.clear()
    if (had) this._version++
    for (const r of rows) this.base.set(r.car, this.positionOf(r))
    return had
  }

  /**
   * Siguiente orden calculado con reproducción continua. Devuelve los cambios confirmados en esta actualización
   * (ya acumulados con la flecha vigente del coche, si va en el mismo sentido).
   */
  update(rows: readonly RankRow[], now: number): RankChange[] {
    const confirmed: RankChange[] = []
    for (const r of rows) {
      const next = this.positionOf(r)
      // Una fila que ahora no es elegible («—», sin señal) no enseña flecha, ni la que ya tenía.
      if (next === null && this.current.delete(r.car)) this._version++
      if (!this.base.has(r.car)) {
        // Coche nuevo en la lista: sin referencia previa, no hay cambio.
        this.base.set(r.car, next)
        continue
      }
      const before = this.base.get(r.car)!
      if (next === before) {
        this.pending.delete(r.car)
        continue
      }
      const p = this.pending.get(r.car)
      const seen = p && p.position === next ? p.seen + 1 : 1
      if (seen < this.hold) {
        this.pending.set(r.car, { position: next, seen })
        continue
      }
      this.pending.delete(r.car)
      this.base.set(r.car, next)
      // De «—» a un puesto (o al revés): no es ganar ni perder posiciones.
      if (before === null || next === null) continue
      const delta = before - next
      const prev = this.current.get(r.car)
      const sameWay = prev !== undefined && Math.sign(prev.delta) === Math.sign(delta)
      const change: RankChange = {
        car: r.car,
        delta: sameWay ? prev.delta + delta : delta,
        position: next,
        at: now,
        seq: ++this.seq,
      }
      this.current.set(r.car, change)
      this._version++
      confirmed.push(change)
    }
    return confirmed
  }

  /** Quita las flechas caducadas en `now`. Devuelve si quitó alguna. */
  expire(now: number): boolean {
    let removed = false
    for (const [car, c] of this.current) {
      if (now - c.at >= this.ttlMs) {
        this.current.delete(car)
        removed = true
      }
    }
    if (removed) this._version++
    return removed
  }

  /** Instante de pared en que caduca la próxima flecha (null si no hay ninguna). */
  nextExpiry(): number | null {
    let next: number | null = null
    for (const c of this.current.values()) if (next === null || c.at + this.ttlMs < next) next = c.at + this.ttlMs
    return next
  }

  private positionOf(r: RankRow): number | null {
    return rankEligible(r, this.race) ? r.position : null
  }
}
