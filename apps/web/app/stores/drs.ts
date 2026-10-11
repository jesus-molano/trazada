import { defineStore } from 'pinia'
import { persisted } from './persisted'

const KEY = 'trazada.drs'

interface SavedDrs {
  show: boolean
}

/** Por navegador (D41); lo guardado con otra versión del formato se ignora. */
const saved = persisted<SavedDrs>(KEY, { version: 1 })

/**
 * Zonas de DRS deducidas (ítem 11, D38): se ven o no sobre la pista. Visibles por defecto: solo existen en sesiones de
 * 2018 a 2025 y siempre van con su etiqueta «Estimado» a la vista.
 */
export const useDrsStore = defineStore('drs', () => {
  const show = ref(true)
  let hydrated = false

  function hydrate(): void {
    if (hydrated) return
    hydrated = true
    const s = saved.read()
    if (typeof s.show === 'boolean') show.value = s.show
  }

  function setShow(value: boolean): void {
    hydrated = true
    show.value = value
    saved.patch({ show: value })
  }

  return { show, hydrate, setShow }
})
