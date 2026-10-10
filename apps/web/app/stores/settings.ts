import { defineStore } from 'pinia'

export const ELEVATION_SCALES = [1, 2, 3] as const
export type ElevationScale = (typeof ELEVATION_SCALES)[number]

const KEY = 'trazada.settings'

export type GapMode = 'leader' | 'interval'

interface Persisted {
  elevationScale: ElevationScale
  showBlueFlags: boolean
  gapMode: GapMode
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
  const showBlueFlags = ref(true)
  const gapMode = ref<GapMode>('leader')
  let hydrated = false

  function hydrate(): void {
    if (hydrated) return
    hydrated = true
    const saved = read()
    if (saved.elevationScale && ELEVATION_SCALES.includes(saved.elevationScale)) elevationScale.value = saved.elevationScale
    if (typeof saved.showBlueFlags === 'boolean') showBlueFlags.value = saved.showBlueFlags
    if (saved.gapMode === 'leader' || saved.gapMode === 'interval') gapMode.value = saved.gapMode
  }

  function persist(patch: Partial<Persisted>): void {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...read(), ...patch }))
    } catch {
      // almacenamiento no disponible (modo privado): la preferencia vive solo en memoria
    }
  }

  function setElevationScale(scale: ElevationScale): void {
    elevationScale.value = scale
    persist({ elevationScale: scale })
  }

  function setShowBlueFlags(value: boolean): void {
    showBlueFlags.value = value
    persist({ showBlueFlags: value })
  }

  function setGapMode(mode: GapMode): void {
    gapMode.value = mode
    persist({ gapMode: mode })
  }

  return {
    elevationScale,
    showBlueFlags,
    gapMode,
    hydrate,
    setElevationScale,
    setShowBlueFlags,
    setGapMode,
  }
})
