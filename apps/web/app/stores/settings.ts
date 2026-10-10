import { defineStore } from 'pinia'

export const ELEVATION_SCALES = [1, 2, 3] as const
export type ElevationScale = (typeof ELEVATION_SCALES)[number]

const KEY = 'trazada.settings'

interface Persisted {
  elevationScale: ElevationScale
}

function read(): Partial<Persisted> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Persisted>
  } catch {
    return {}
  }
}

/** Preferencias del usuario (por navegador). */
export const useSettingsStore = defineStore('settings', () => {
  const elevationScale = ref<ElevationScale>(1)

  function hydrate(): void {
    const saved = read()
    if (saved.elevationScale && ELEVATION_SCALES.includes(saved.elevationScale)) elevationScale.value = saved.elevationScale
  }

  function setElevationScale(scale: ElevationScale): void {
    elevationScale.value = scale
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...read(), elevationScale: scale }))
    } catch {
      // almacenamiento no disponible (modo privado): la preferencia vive solo en memoria
    }
  }

  return { elevationScale, hydrate, setElevationScale }
})
