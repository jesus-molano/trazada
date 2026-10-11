import { defineStore } from 'pinia'
import { clampFollowDistance, FOLLOW_DISTANCE_M } from '~/engine/camera/FollowCamera'
import { persisted } from './persisted'

export const ELEVATION_SCALES = [1, 2, 3] as const
export type ElevationScale = (typeof ELEVATION_SCALES)[number]

const KEY = 'trazada.settings'

export type GapMode = 'leader' | 'interval'

interface SavedSettings {
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

/** Sin versión: el formato de siempre (un objeto plano), que ya está guardado en los navegadores. */
const saved = persisted<SavedSettings>(KEY)

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
    const s = saved.read()
    if (s.elevationScale && ELEVATION_SCALES.includes(s.elevationScale)) elevationScale.value = s.elevationScale
    if (typeof s.showBlueFlags === 'boolean') showBlueFlags.value = s.showBlueFlags
    if (s.gapMode === 'leader' || s.gapMode === 'interval') gapMode.value = s.gapMode
    if (typeof s.separation === 'boolean') separation.value = s.separation
    if (typeof s.estimateLap1 === 'boolean') estimateLap1.value = s.estimateLap1
    if (typeof s.followDistance === 'number') followDistance.value = clampFollowDistance(s.followDistance)
  }

  /** Guarda un cambio sin pisar lo demás (si el almacenamiento no está, la preferencia vive solo en memoria). */
  const persist = (patch: Partial<SavedSettings>) => saved.patch(patch)

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
