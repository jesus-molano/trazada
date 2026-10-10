import { defineStore } from 'pinia'
import { clampFollowDistance, FOLLOW_DISTANCE_M } from '~/engine/camera/FollowCamera'

export const ELEVATION_SCALES = [1, 2, 3] as const
export type ElevationScale = (typeof ELEVATION_SCALES)[number]

const KEY = 'trazada.settings'

export type GapMode = 'leader' | 'interval'

interface Persisted {
  elevationScale: ElevationScale
  showBlueFlags: boolean
  gapMode: GapMode
  /** Separación lateral solo visual de coches solapados (Estimado). Apagada por defecto. */
  separation: boolean
  /** Estimar el tiempo de la vuelta 1 en carrera (Estimado). Apagado por defecto. */
  estimateLap1: boolean
  /** Distancia de la cámara de seguimiento (m), con el zoom de la rueda o el pellizco. */
  followDistance: number
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
  const separation = ref(false)
  const estimateLap1 = ref(false)
  const followDistance = ref(FOLLOW_DISTANCE_M)
  let hydrated = false

  function hydrate(): void {
    if (hydrated) return
    hydrated = true
    const saved = read()
    if (saved.elevationScale && ELEVATION_SCALES.includes(saved.elevationScale)) elevationScale.value = saved.elevationScale
    if (typeof saved.showBlueFlags === 'boolean') showBlueFlags.value = saved.showBlueFlags
    if (saved.gapMode === 'leader' || saved.gapMode === 'interval') gapMode.value = saved.gapMode
    if (typeof saved.separation === 'boolean') separation.value = saved.separation
    if (typeof saved.estimateLap1 === 'boolean') estimateLap1.value = saved.estimateLap1
    if (typeof saved.followDistance === 'number') followDistance.value = clampFollowDistance(saved.followDistance)
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

  function setSeparation(value: boolean): void {
    separation.value = value
    persist({ separation: value })
  }

  function setFollowDistance(value: number): void {
    followDistance.value = clampFollowDistance(value)
    persist({ followDistance: followDistance.value })
  }

  function setEstimateLap1(value: boolean): void {
    estimateLap1.value = value
    persist({ estimateLap1: value })
  }

  return {
    elevationScale,
    showBlueFlags,
    gapMode,
    separation,
    estimateLap1,
    followDistance,
    hydrate,
    setElevationScale,
    setShowBlueFlags,
    setGapMode,
    setSeparation,
    setEstimateLap1,
    setFollowDistance,
  }
})
