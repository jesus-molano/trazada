import { defineStore } from 'pinia'
import { persisted } from './persisted'

const KEY = 'trazada.ambience'

interface SavedAmbience {
  on: boolean
}

/** Por navegador (D41); lo guardado con otra versión del formato se ignora. */
const saved = persisted<SavedAmbience>(KEY, { version: 1 })

/**
 * Ambiente de la escena (ítem 10, D37): cielo según la posición del sol, niebla de profundidad en la pista y tono
 * nocturno. Activo por defecto (es decorativo y no tapa nada); quien prefiera la escena neutra lo apaga y se recuerda.
 */
export const useAmbienceStore = defineStore('ambience', () => {
  const on = ref(true)
  let hydrated = false

  function hydrate(): void {
    if (hydrated) return
    hydrated = true
    const s = saved.read()
    if (typeof s.on === 'boolean') on.value = s.on
  }

  function setOn(value: boolean): void {
    hydrated = true
    on.value = value
    saved.patch({ on: value })
  }

  return { on, hydrate, setOn }
})
