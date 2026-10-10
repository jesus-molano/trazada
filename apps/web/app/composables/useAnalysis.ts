/**
 * Estado de la hoja de análisis (ítem 3, D33), compartido por la hoja (hueco `replay-overlays`), su botón (hueco
 * `replay-header`) y sus pestañas (hueco `analysis-tabs`): uno por runtime, con `rt.ext`, así que vive y muere con
 * la sesión.
 *
 * - Abierta, la hoja tapa la escena: `rt.setSceneHidden(true)` (no se le piden frames y la GPU descansa; el reloj, la
 *   clasificación y el timeline siguen). Al cerrarla, o al desechar el runtime, la escena vuelve.
 * - «Sin spoilers» (activo por defecto): las gráficas solo usan los datos hasta el instante del reloj, con el estado
 *   grueso de Pinia (≤ 10 Hz). Cada pestaña recalcula solo cuando el reloj cruza un instante que cambia lo que
 *   muestra (`useEffectiveCutoff` sobre sus instantes de cambio), nunca en cada frame.
 * - Coches visibles de cada gráfica: lo que elija el usuario en la leyenda (por pestaña); si no ha elegido, los de
 *   cada pestaña por defecto.
 */
import { computed, type ComputedRef, effectScope, readonly, type Ref, ref, shallowRef } from 'vue'
import type { LapTable } from '~/engine/analysis/lapTable'
import { countUpTo } from '~/engine/analysis/raceTrace'
import { registerSceneStat } from '~/replay/debug'
import type { ReplayRuntime } from '~/replay/runtime'
import { ANALYSIS_TABS, defaultTab } from '~/slots/analysis-tabs'
import { getRuntime, usePlaybackStore } from '~/stores/playback'

export interface AnalysisState {
  /** Índice de vueltas de la sesión (el de la clasificación: no se vuelve a construir). */
  readonly table: LapTable
  readonly open: Readonly<Ref<boolean>>
  /** Pestaña activa (`tab` de su fichero en `components/analysis-tabs/`). */
  readonly tab: Ref<string>
  /** «Sin spoilers: hasta ahora»: solo los datos hasta el instante del reloj. */
  readonly noSpoilers: Ref<boolean>
  /** Corte de los datos (ms de sesión): el instante del reloj con «Sin spoilers»; si no, Infinity. */
  readonly cutoffMs: ComputedRef<number>
  /** Coches que el usuario dejó visibles en cada pestaña (sin entrada: los de por defecto de la pestaña). */
  readonly shown: Readonly<Ref<Readonly<Record<string, readonly string[]>>>>
  setShown(tab: string, cars: readonly string[]): void
  show(): void
  close(): void
  toggle(): void
  dispose(): void
}

export function createAnalysisState(rt: ReplayRuntime): AnalysisState {
  const scope = effectScope(true)
  const playback = usePlaybackStore()
  const open = ref(false)
  const tab = ref(defaultTab(ANALYSIS_TABS, rt.leaderboard.lapTable.race))
  const noSpoilers = ref(true)
  const shown = shallowRef<Readonly<Record<string, readonly string[]>>>({})
  const cutoffMs = scope.run(() => computed(() => (noSpoilers.value ? playback.timeMs : Infinity)))!

  const setOpen = (value: boolean) => {
    if (open.value === value) return
    open.value = value
    rt.setSceneHidden(value)
  }

  // Para los e2e (`window.__trazada.scene.analysis`).
  const offStat = registerSceneStat('analysis', () => ({
    open: open.value,
    tab: tab.value,
    noSpoilers: noSpoilers.value,
    cutoffMs: cutoffMs.value,
  }))

  return {
    table: rt.leaderboard.lapTable,
    open: readonly(open),
    tab,
    noSpoilers,
    cutoffMs,
    shown: readonly(shown) as Readonly<Ref<Readonly<Record<string, readonly string[]>>>>,
    setShown(key, cars) {
      shown.value = { ...shown.value, [key]: [...cars] }
    },
    show: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(!open.value),
    dispose() {
      setOpen(false)
      offStat()
      scope.stop()
    },
  }
}

/** Estado de la hoja del runtime activo (el replay solo monta sus huecos con el runtime enganchado). */
export function useAnalysis(): AnalysisState {
  return getRuntime()!.ext('analysis:ui', createAnalysisState)
}

/**
 * Corte efectivo de una pestaña: el último de sus instantes de cambio (ordenados) hasta el corte (−Infinity si
 * ninguno; Infinity sin corte). Da lo mismo que cortar en el instante del reloj, pero solo cambia cuando el reloj
 * cruza uno de esos instantes: lo que dependa de él se recalcula a ese ritmo, no con cada actualización del reloj.
 */
export function useEffectiveCutoff(times: Float64Array, cutoffMs: Readonly<Ref<number>>): ComputedRef<number> {
  return computed(() => {
    const t = cutoffMs.value
    if (t === Infinity) return Infinity
    const n = countUpTo(times, t)
    return n > 0 ? times[n - 1]! : -Infinity
  })
}
