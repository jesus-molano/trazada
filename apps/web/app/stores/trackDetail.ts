import { defineStore } from 'pinia'
import { persisted } from './persisted'

/**
 * Detalle del trazado (D50, lámina 5): «Relieve» (faldones de cada borde hasta el suelo: la altura es dato) y «Retícula»
 * (suelo con líneas cada 100 m que se desvanecen: decorativa, lo dice «Cómo se dibuja»). Encendidos por defecto y
 * recordados por navegador (D41) en el menú «Capas».
 */
const KEY = 'trazada.trackDetail'

interface SavedTrackDetail {
  relief: boolean
  grid: boolean
}

/** Lo guardado con otra versión del formato se ignora. */
const saved = persisted<SavedTrackDetail>(KEY, { version: 1 })

export const useTrackDetailStore = defineStore('trackDetail', () => {
  const relief = ref(true)
  const grid = ref(true)
  let hydrated = false

  function hydrate(): void {
    if (hydrated) return
    hydrated = true
    const s = saved.read()
    if (typeof s.relief === 'boolean') relief.value = s.relief
    if (typeof s.grid === 'boolean') grid.value = s.grid
  }

  function setRelief(on: boolean): void {
    hydrated = true
    relief.value = on
    saved.patch({ relief: on })
  }

  function setGrid(on: boolean): void {
    hydrated = true
    grid.value = on
    saved.patch({ grid: on })
  }

  return { relief, grid, hydrate, setRelief, setGrid }
})
