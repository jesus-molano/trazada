import { defineStore } from 'pinia'
import { persisted } from './persisted'

/**
 * Estelas (ítem 7): apagadas, con el color del equipo o con el de la última muestra de velocidad de la telemetría
 * (medida, o reconstruida si el manifest lo declara: entonces lleva «Estimado», ver TzTrailsTool).
 */
export const TRAIL_MODES = ['off', 'team', 'speed'] as const
export type TrailMode = (typeof TRAIL_MODES)[number]

export const isTrailMode = (x: unknown): x is TrailMode => (TRAIL_MODES as readonly unknown[]).includes(x)

const KEY = 'trazada.trails'

interface SavedTrails {
  mode: TrailMode
}

/** Por navegador (D41); lo guardado con otra versión del formato se ignora. */
const saved = persisted<SavedTrails>(KEY, { version: 1 })

/** Estelas detrás de los coches. Apagadas por defecto (no cambian la escena de siempre ni sus capturas). */
export const useTrailsStore = defineStore('trails', () => {
  const mode = ref<TrailMode>('off')
  let hydrated = false

  function hydrate(): void {
    if (hydrated) return
    hydrated = true
    const s = saved.read()
    if (isTrailMode(s.mode)) mode.value = s.mode
  }

  function setMode(value: TrailMode): void {
    if (!isTrailMode(value)) return
    hydrated = true
    mode.value = value
    saved.patch({ mode: value })
  }

  return { mode, hydrate, setMode }
})
