import { defineStore } from 'pinia'
import type { CompareRef } from '~/engine/compare/reference'
import { isCompareRef } from '~/engine/compare/reference'
import { getRuntime, usePlaybackStore } from './playback'
import { persisted } from './persisted'

const KEY = 'trazada.compare'

interface SavedCompare {
  showGhost: boolean
}

/** Por navegador (D41); lo guardado con otra versión del formato se ignora. */
const saved = persisted<SavedCompare>(KEY, { version: 1 })

/** Vista del panel del coche seleccionado: la telemetría en vivo o la comparación con otro piloto. */
export type CompareTab = 'live' | 'compare'

/**
 * Comparar dos pilotos (ítem 1, D31): el coche seleccionado (A) frente a `compareCar` (B), con su vuelta de referencia
 * (`compareRef`; null, la de por defecto para el tipo de sesión) y el fantasma de B sobre el mapa (`showGhost`, por
 * navegador). Estado grueso: lo que cambia por frame (diferencia, fantasma, trazas) va fuera de Vue
 * (engine/compare/session.ts, con `rt.ext`).
 *
 * Al deseleccionar el coche, al elegir como A el que era B o al cambiar de sesión, la comparación se cierra sola.
 */
export const useCompareStore = defineStore('compare', () => {
  const playback = usePlaybackStore()
  const tab = ref<CompareTab>('live')
  const compareCar = ref<string | null>(null)
  const compareRef = ref<CompareRef | null>(null)
  const showGhost = ref(true)
  let hydrated = false

  function hydrate(): void {
    if (hydrated) return
    hydrated = true
    const s = saved.read()
    if (typeof s.showGhost === 'boolean') showGhost.value = s.showGhost
  }

  /** Hay comparación a la vista: el panel en «Comparar», con A y B elegidos. */
  const comparing = computed(() => tab.value === 'compare' && compareCar.value !== null && playback.selectedCar !== null)

  /** Un frame para repintar en pausa (los runtimes falsos de algunos tests no lo tienen). */
  const requestFrame = () => getRuntime()?.requestFrame?.()

  function setTab(value: CompareTab): void {
    tab.value = value
    requestFrame()
  }

  /** Elige B (o nadie, con null). Nunca el propio A. Elegir a alguien abre la vista «Comparar». */
  function setCompareCar(car: string | null): void {
    compareCar.value = car !== null && car !== playback.selectedCar ? car : null
    if (compareCar.value !== null) tab.value = 'compare'
    requestFrame()
  }

  /**
   * Mayús+clic en la clasificación: elige ese coche como B (o lo quita si ya lo era). Sin coche seleccionado, o sobre
   * el propio A, no hace nada y devuelve false (el clic sigue siendo una selección normal).
   */
  function pick(car: string): boolean {
    if (playback.selectedCar === null || car === playback.selectedCar) return false
    setCompareCar(comparing.value && compareCar.value === car ? null : car)
    return true
  }

  function setRef(value: CompareRef | null): void {
    compareRef.value = value === null || isCompareRef(value) ? value : null
    requestFrame()
  }

  function setShowGhost(value: boolean): void {
    hydrated = true
    showGhost.value = value
    saved.patch({ showGhost: value })
    requestFrame()
  }

  /** Cierra la comparación (Esc): vuelve a la telemetría en vivo y olvida a B. Cerrada ya, no hace nada. */
  function close(): void {
    if (compareCar.value === null && tab.value === 'live') return
    compareCar.value = null
    tab.value = 'live'
    requestFrame()
  }

  watch(
    () => playback.selectedCar,
    (car) => {
      if (car === null) close()
      else if (car === compareCar.value) compareCar.value = null
    },
    { flush: 'sync' },
  )
  watch(
    () => playback.attached,
    (attached) => {
      if (attached) return
      close()
      compareRef.value = null
    },
    { flush: 'sync' },
  )

  return { tab, compareCar, compareRef, showGhost, comparing, hydrate, setTab, setCompareCar, pick, setRef, setShowGhost, close }
})
