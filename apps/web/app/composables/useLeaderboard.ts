import type { LeaderboardRow } from '~/engine/leaderboard/leaderboard'
import { leaderboardStats } from '~/replay/debug'
import { getRuntime, usePlaybackStore } from '~/stores/playback'

/** Intervalo de actualización con reproducción: ~6,7 Hz, con margen sobre los 4 Hz del criterio. */
export const LEADERBOARD_INTERVAL_MS = 150
const STATS_WINDOW = 200

/**
 * Filas del leaderboard: se recalculan a ~6,7 Hz con reproducción y al momento tras un seek o en pausa.
 * Cada cálculo se mide con `performance.measure('tz:leaderboard')`.
 */
export function useLeaderboard() {
  const rt = getRuntime()!
  const playback = usePlaybackStore()
  const rows = shallowRef<LeaderboardRow[]>([])
  let lastWall = -Infinity
  let lastT = Number.NaN

  function recompute(t: number) {
    const start = performance.now()
    const next = rt.leaderboard.compute(t, rt.model.states)
    const end = performance.now()
    performance.measure('tz:leaderboard', { start, end })
    leaderboardStats.updates++
    leaderboardStats.durations.push(end - start)
    if (leaderboardStats.durations.length > STATS_WINDOW) leaderboardStats.durations.shift()
    rows.value = next
    const order = next.map((r) => r.car)
    if (order.join() !== playback.order.join()) playback.order = order
  }

  const off = rt.onFrame((t) => {
    const now = performance.now()
    // Con reproducción, a ~6,7 Hz; un salto del reloj (seek) o un frame en pausa, al momento.
    const jumped = Number.isNaN(lastT) || Math.abs(t - lastT) > 2_000 * rt.clock.rate || !rt.clock.playing
    if (jumped || now - lastWall >= LEADERBOARD_INTERVAL_MS) {
      lastWall = now
      recompute(t)
    }
    lastT = t
  })
  recompute(rt.clock.timeMs)
  onBeforeUnmount(off)
  return rows
}
