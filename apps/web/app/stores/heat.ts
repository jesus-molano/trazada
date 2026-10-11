import { defineStore } from 'pinia'
import { createHeat, defaultHeatPick, HEAT_EXT, type HeatLapPick, type HeatView, isHeatLapPick } from '~/engine/track/heat'
import { useCompareStore } from './compare'
import { persisted } from './persisted'
import { getRuntime, usePlaybackStore } from './playback'

/** Mapa de calor (ítem 2, D32): apagado, por velocidad o por minisectores. */
export const HEAT_MODES = ['off', 'speed', 'minisectors'] as const
export type HeatMode = (typeof HEAT_MODES)[number]

export const isHeatMode = (x: unknown): x is HeatMode => (HEAT_MODES as readonly unknown[]).includes(x)

const KEY = 'trazada.heat'

interface SavedHeat {
  mode: HeatMode
}

/** Por navegador (D41); lo guardado con otra versión del formato se ignora. */
const saved = persisted<SavedHeat>(KEY, { version: 1 })

/**
 * Mapa de calor de la pista. Apagado por defecto (no cambia la escena de siempre ni sus capturas); el modo se recuerda
 * por navegador. La vuelta (`pick`: la última o la más rápida; null, la de por defecto para el tipo de sesión) vale
 * para la sesión abierta y vuelve a la de por defecto al cambiar de sesión.
 *
 * `view` es estado grueso: se recalcula con el reloj grueso (≤ 10 Hz) y solo cambia (otro objeto, con otra `version`)
 * cuando cambia lo que se pinta: el modo, los coches o su vuelta. El cálculo pesado (colores por punto de la pista) se
 * hace entonces, una vez, en engine/track/heat.ts (`rt.ext`); la capa de la escena lo sube a la GPU sin reactividad.
 */
export const useHeatStore = defineStore('heat', () => {
  const playback = usePlaybackStore()
  const compare = useCompareStore()
  const mode = ref<HeatMode>('off')
  const pick = ref<HeatLapPick | null>(null)
  let hydrated = false

  function hydrate(): void {
    if (hydrated) return
    hydrated = true
    const s = saved.read()
    if (isHeatMode(s.mode)) mode.value = s.mode
  }

  /** Un frame para repintar en pausa (los runtimes falsos de algunos tests no lo tienen). */
  const requestFrame = () => getRuntime()?.requestFrame?.()

  function setMode(value: HeatMode): void {
    if (!isHeatMode(value)) return
    hydrated = true
    mode.value = value
    saved.patch({ mode: value })
    requestFrame()
  }

  function setPick(value: HeatLapPick | null): void {
    pick.value = value === null || isHeatLapPick(value) ? value : null
    requestFrame()
  }

  /** La vuelta que se usa: la elegida o la de por defecto para el tipo de sesión. */
  const effectivePick = computed<HeatLapPick>(() => {
    if (pick.value) return pick.value
    const type = playback.attached ? getRuntime()?.session.manifest.session.type : undefined
    return type ? defaultHeatPick(type) : 'best'
  })

  /** Lo que se pinta ahora (null apagado o sin sesión). */
  const view = computed<HeatView | null>(() => {
    const m = mode.value
    if (m === 'off' || !playback.attached) return null
    const rt = getRuntime()
    if (!rt) return null
    return rt.ext(HEAT_EXT, createHeat).view({
      mode: m,
      a: playback.selectedCar,
      b: compare.comparing ? compare.compareCar : null,
      pick: effectivePick.value,
      t: playback.timeMs,
    })
  })

  watch(
    () => playback.attached,
    (attached) => {
      if (!attached) pick.value = null
    },
    { flush: 'sync' },
  )

  return { mode, pick, effectivePick, view, hydrate, setMode, setPick }
})
