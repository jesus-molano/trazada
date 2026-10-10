import type { ShallowRef } from 'vue'
import { listMotionAllowed, LIST_MOTION_MAX_RATE, useReducedMotion } from '~/design/motion'
import { MAX_DELTA_MS } from '~/engine/clock/SessionClock'
import { RankChangeTracker, rankedOrder } from '~/engine/leaderboard/changes'
import type { LeaderboardRow } from '~/engine/leaderboard/leaderboard'
import { leaderboardStats } from '~/replay/debug'
import { getRuntime, usePlaybackStore } from '~/stores/playback'

/** Intervalo de actualización con reproducción: ~6,7 Hz, con margen sobre los 4 Hz del criterio. */
export const LEADERBOARD_INTERVAL_MS = 150
const STATS_WINDOW = 200
/** Como mucho un aviso de cambios de puesto (aria-live) cada este tiempo de pared: más sería ruido. */
export const RANK_ANNOUNCE_INTERVAL_MS = 5000
/** Pilotos que nombra un aviso; el resto, «y N más». */
export const RANK_ANNOUNCE_MAX = 3

/** Flecha de una fila: puestos ganados (> 0) o perdidos (< 0) en los últimos segundos. */
export interface RankBadge {
  readonly delta: number
  /** Puesto tras el cambio. */
  readonly position: number
  /** Destello al aparecer: solo si en ese momento se podía animar (≤ ×4 y movimiento permitido). */
  readonly flash: boolean
  /** Crece con cada cambio confirmado: clave para repetir el destello. */
  readonly seq: number
}

export interface RankAnnouncement {
  readonly seq: number
  /** Pilotos que cambiaron de puesto desde el aviso anterior, de arriba abajo (como mucho RANK_ANNOUNCE_MAX). */
  readonly items: readonly { car: string; tla: string; delta: number; position: number }[]
  /** Cuántos más cambiaron (sin nombrarlos). */
  readonly more: number
}

export interface LeaderboardView {
  rows: ShallowRef<LeaderboardRow[]>
  /** ¿Se anima (FLIP) el paso al orden actual? Solo con reproducción a ≤ ×4, sin salto del reloj ni reduced motion. */
  animate: ShallowRef<boolean>
  /** Flechas vigentes por coche. */
  changes: ShallowRef<ReadonlyMap<string, RankBadge>>
  /** Último resumen para lectores de pantalla (null tras un salto: nada que anunciar). */
  announcement: ShallowRef<RankAnnouncement | null>
  /** Carrera (orden en pista) o libres/clasificación (orden por mejor vuelta). */
  race: boolean
}

/** Cómo llega un frame: reproducción continua, en pausa en el mismo instante, o tras un salto del reloj. */
type FrameMode = 'play' | 'still' | 'jump'

const NO_CHANGES: ReadonlyMap<string, RankBadge> = new Map()

/**
 * Filas del leaderboard: se recalculan a ~6,7 Hz con reproducción y al momento tras un seek o en pausa.
 * Cada cálculo se mide con `performance.measure('tz:leaderboard')`.
 *
 * Además (ítem 8), los cambios de puesto entre dos órdenes calculados seguidos (`RankChangeTracker`): flechas que
 * duran unos segundos de pared, un aviso aria-live como mucho cada RANK_ANNOUNCE_INTERVAL_MS y si la reordenación
 * se anima. Tras un seek, una carga o un paso en pausa, el orden nuevo es la referencia: ni flechas ni animación.
 */
export function useLeaderboard(): LeaderboardView {
  const rt = getRuntime()!
  const playback = usePlaybackStore()
  const reduced = useReducedMotion()
  const race = !!rt.leaderboard.race
  const rows = shallowRef<LeaderboardRow[]>([])
  const animate = shallowRef(false)
  const changes = shallowRef<ReadonlyMap<string, RankBadge>>(NO_CHANGES)
  const announcement = shallowRef<RankAnnouncement | null>(null)
  const tracker = new RankChangeTracker({ race })
  /** `seq` de los cambios que destellan (decidido al confirmarse cada uno). */
  const flashing = new Set<number>()
  let published = tracker.version
  let lastWall = -Infinity
  let lastT = Number.NaN
  let expiryTimer: ReturnType<typeof setTimeout> | null = null
  /** Cambios por anunciar (el último de cada coche) y cuándo fue el último aviso. */
  const toAnnounce = new Map<string, { car: string; tla: string; delta: number; position: number }>()
  let lastAnnounce = -Infinity
  let announceTimer: ReturnType<typeof setTimeout> | null = null
  let announceSeq = 0

  function frameMode(t: number): FrameMode {
    if (Number.isNaN(lastT)) return 'jump'
    const dt = t - lastT
    if (!rt.clock.playing) return dt === 0 ? 'still' : 'jump'
    // Con reproducción, el reloj avanza como mucho MAX_DELTA_MS × velocidad por frame: más (o hacia atrás) es un seek.
    return dt < 0 || dt > MAX_DELTA_MS * rt.clock.rate + 1 ? 'jump' : 'play'
  }

  /** Copia las flechas vigentes a `changes` (solo si cambiaron: Vue no ve nada por frame). */
  function publishChanges() {
    if (tracker.version === published) return
    published = tracker.version
    const out = new Map<string, RankBadge>()
    const live = new Set<number>()
    for (const c of tracker.active.values()) {
      out.set(c.car, { delta: c.delta, position: c.position, seq: c.seq, flash: flashing.has(c.seq) })
      live.add(c.seq)
    }
    for (const seq of flashing) if (!live.has(seq)) flashing.delete(seq)
    changes.value = out.size ? out : NO_CHANGES
    scheduleExpiry()
  }

  /** Las flechas caducan también en pausa (sin frames): un temporizador para la próxima. */
  function scheduleExpiry() {
    if (expiryTimer) clearTimeout(expiryTimer)
    expiryTimer = null
    const next = tracker.nextExpiry()
    if (next === null) return
    expiryTimer = setTimeout(
      () => {
        expiryTimer = null
        if (tracker.expire(performance.now())) publishChanges()
        else scheduleExpiry()
      },
      Math.max(0, next - performance.now()) + 1,
    )
  }

  function flushAnnouncement() {
    if (announceTimer) clearTimeout(announceTimer)
    announceTimer = null
    if (toAnnounce.size === 0) return
    const all = [...toAnnounce.values()].sort((a, b) => a.position - b.position)
    toAnnounce.clear()
    lastAnnounce = performance.now()
    announcement.value = { seq: ++announceSeq, items: all.slice(0, RANK_ANNOUNCE_MAX), more: Math.max(0, all.length - RANK_ANNOUNCE_MAX) }
  }

  function queueAnnouncement(now: number) {
    const wait = lastAnnounce + RANK_ANNOUNCE_INTERVAL_MS - now
    if (wait <= 0) flushAnnouncement()
    else if (!announceTimer) announceTimer = setTimeout(flushAnnouncement, wait)
  }

  function clearAnnouncements() {
    if (announceTimer) clearTimeout(announceTimer)
    announceTimer = null
    toAnnounce.clear()
    announcement.value = null
  }

  function trackChanges(next: LeaderboardRow[], mode: FrameMode, now: number) {
    if (mode === 'jump') {
      tracker.reset(next)
      flashing.clear()
      clearAnnouncements()
    } else if (mode === 'play') {
      const confirmed = tracker.update(next, now)
      if (confirmed.length) {
        const flash = !reduced.value && rt.clock.rate <= LIST_MOTION_MAX_RATE
        const byCar = new Map(next.map((r) => [r.car, r]))
        for (const c of confirmed) {
          if (flash) flashing.add(c.seq)
          const tla = byCar.get(c.car)?.driver?.tla ?? c.car
          toAnnounce.set(c.car, { car: c.car, tla, delta: c.delta, position: c.position })
        }
        queueAnnouncement(now)
      }
    }
    tracker.expire(now)
    publishChanges()
  }

  function recompute(t: number, mode: FrameMode) {
    const start = performance.now()
    const next = rt.leaderboard.compute(t, rt.model.states)
    const end = performance.now()
    performance.measure('tz:leaderboard', { start, end })
    leaderboardStats.updates++
    leaderboardStats.durations.push(end - start)
    if (leaderboardStats.durations.length > STATS_WINDOW) leaderboardStats.durations.shift()
    trackChanges(next, mode, end)
    // FLIP solo entre puestos conocidos: que los «—» del final se recoloquen (por distancia) no es un suceso.
    animate.value = listMotionAllowed(rankedOrder(rows.value), rankedOrder(next), mode !== 'play', rt.clock.rate, reduced.value)
    rows.value = next
    const order = next.map((r) => r.car)
    if (order.join() !== playback.order.join()) playback.order = order
  }

  const off = rt.onFrame((t) => {
    const now = performance.now()
    // Con reproducción, a ~6,7 Hz; un salto del reloj (seek) o un frame en pausa, al momento.
    const mode = frameMode(t)
    if (mode !== 'play' || now - lastWall >= LEADERBOARD_INTERVAL_MS) {
      lastWall = now
      recompute(t, mode)
    }
    lastT = t
  })
  recompute(rt.clock.timeMs, 'jump')
  onBeforeUnmount(() => {
    off()
    if (expiryTimer) clearTimeout(expiryTimer)
    if (announceTimer) clearTimeout(announceTimer)
  })
  return { rows, animate, changes, announcement, race }
}
