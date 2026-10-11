/**
 * Estado de la tarjeta de fin de sesión (ítem 12, D40), compartido por la tarjeta (hueco `replay-overlays`) y su
 * botón del dock (hueco `replay-dock`): uno por runtime, con `rt.ext`, así que vive y muere con la sesión.
 *
 * - `available`: el reloj ya pasó el momento de la tarjeta (`showMs`); el botón del dock la puede abrir. Al volver
 *   atrás (antes de ese momento), la tarjeta se cierra y el botón desaparece.
 * - Se abre sola solo cuando la reproducción cruza ese momento, nunca con un salto del reloj (seek, timeline,
 *   flechas) ni al cargar la sesión ya pasado el fin. En el bench no se abre sola (`autoOpen`).
 *
 * Solo estado grueso: un frame escribe en las refs únicamente cuando cambian (nada por frame en la reactividad).
 */
import { readonly, type Ref, ref } from 'vue'
import { crossedSummary, type SessionSummary, sessionSummary } from '~/engine/summary/sessionSummary'
import { registerSceneStat } from '~/replay/debug'
import type { ReplayRuntime } from '~/replay/runtime'
import { getRuntime } from '~/stores/playback'

export interface SessionSummaryState {
  readonly summary: SessionSummary
  readonly available: Readonly<Ref<boolean>>
  readonly open: Readonly<Ref<boolean>>
  /** ¿Se abre sola al cruzar el momento reproduciendo? (no en el bench, que mide la escena). */
  autoOpen: boolean
  show(): void
  close(): void
  dispose(): void
}

/** El resumen de la sesión del runtime (memoizado: se calcula una vez por sesión). */
export function runtimeSummary(rt: ReplayRuntime): SessionSummary {
  return rt.ext('summary', (r) => {
    const { type, playback } = r.session.manifest.session
    return sessionSummary({
      type,
      timing: r.session.timing,
      events: r.session.events,
      drivers: r.drivers,
      playback,
      leaderboard: r.leaderboard,
    })
  })
}

export function createSessionSummaryState(rt: ReplayRuntime): SessionSummaryState {
  const summary = runtimeSummary(rt)
  const available = ref(rt.clock.timeMs >= summary.showMs)
  const open = ref(false)
  let prev = Number.NaN
  let jumped = true
  const offClock = rt.clock.on((event) => {
    if (event === 'seek') jumped = true
  })
  const state: SessionSummaryState = {
    summary,
    available: readonly(available),
    open: readonly(open),
    autoOpen: true,
    show() {
      if (available.value) open.value = true
    },
    close() {
      open.value = false
    },
    dispose() {
      offClock()
      offFrame()
      offStat()
    },
  }
  const offFrame = rt.onFrame((t) => {
    const now = t >= summary.showMs
    if (now !== available.value) available.value = now
    if (!now && open.value) open.value = false
    if (state.autoOpen && crossedSummary(prev, t, summary.showMs, jumped)) open.value = true
    prev = t
    jumped = false
  })
  // Para los e2e (`window.__trazada.scene.summary`): cuándo aparece y de dónde sale el fin.
  const offStat = registerSceneStat('summary', () => ({
    showMs: summary.showMs,
    endMs: summary.end.t,
    source: summary.end.source,
    available: available.value,
    open: open.value,
  }))
  return state
}

/** Estado de la tarjeta del runtime activo (el replay solo monta sus huecos con el runtime enganchado). */
export function useSessionSummary(): SessionSummaryState {
  return getRuntime()!.ext('summary:ui', createSessionSummaryState)
}
