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
 * - Al quitar la selección o elegir a otro con la hoja abierta (su selector en la cabecera o las gráficas, D49) sin que
 *   el usuario haya elegido en la leyenda de «Ritmo», se congelan sus visibles: el coche que estaba elegido sigue
 *   dibujado, sin destacar, en vez de desaparecer (y el nuevo se ve). Vale también desde otra pestaña (la hoja solo
 *   monta la activa). Si en una pestaña el usuario eligió qué se ve y el nuevo elegido estaba oculto, pasa a verse: se
 *   elige para destacarlo. Con la hoja cerrada, nada: «Ritmo» sigue mostrando por defecto el coche elegido de cada
 *   momento.
 */
import { computed, type ComputedRef, effectScope, readonly, type Ref, ref, shallowRef, watch } from 'vue'
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
  /**
   * Los cinco primeros de la clasificación con los que «Ritmo» se abrió (su selección por defecto, junto al coche
   * elegido): con ellos se congelan sus visibles al quitar la selección.
   */
  setPaceTop(cars: readonly string[]): void
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
  const table = rt.leaderboard.lapTable
  let paceTop: readonly string[] | null = null
  const setShown = (key: string, cars: readonly string[]) => {
    shown.value = { ...shown.value, [key]: [...cars] }
  }
  /** Coches de las gráficas en su orden (el del manifest; los que solo están en la tabla de vueltas, después). */
  const chartCars = () => {
    const known = new Set(rt.drivers.map((d) => d.number))
    return [...rt.drivers.map((d) => d.number).filter((c) => table.cars.has(c)), ...[...table.cars.keys()].filter((c) => !known.has(c))]
  }
  scope.run(() =>
    watch(
      () => playback.selectedCar,
      (now, before) => {
        if (!open.value || now === before) return
        // «Ritmo» sin elección del usuario en su leyenda: el que estaba elegido sigue dibujado (ya sin destacar).
        if (before && !shown.value.pace) {
          const top = paceTop ?? playback.order.filter((c) => table.cars.has(c)).slice(0, 5)
          setShown('pace', chartCars().filter((c) => c === before || c === now || top.includes(c)))
        }
        // El elegido nuevo, a la vista en las pestañas donde el usuario eligió qué se ve (si no, se destacaría oculto).
        if (!now || !table.cars.has(now)) return
        for (const [key, cars] of Object.entries(shown.value)) {
          if (cars.includes(now)) continue
          const next = new Set([...cars, now])
          setShown(key, chartCars().filter((c) => next.has(c)))
        }
      },
      { flush: 'sync' },
    ),
  )

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
    table,
    open: readonly(open),
    tab,
    noSpoilers,
    cutoffMs,
    shown: readonly(shown) as Readonly<Ref<Readonly<Record<string, readonly string[]>>>>,
    setShown,
    setPaceTop(cars) {
      paceTop = [...cars]
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
