import { defineStore } from 'pinia'
import type { CameraKind, ShotBasis, ShotKind, ShotReason } from '~/engine/camera/Director'
import type { NeutralKind } from '~/engine/trackstate/TrackState'
import { getRuntime, usePlaybackStore } from './playback'

/** Por qué se sale de la realización automática. */
export type TvExit = 'toggle' | 'escape' | 'selection' | 'follow' | 'camera' | 'session' | 'scene'

/**
 * Lo que enseña el chip del plano (estado grueso: cambia con cada corte y cuando la torre da otra cifra, nunca por
 * frame). Lo publica el rig de cámara.
 */
export interface TvShotView {
  /** Sube con cada plano nuevo. */
  readonly id: number
  readonly kind: ShotKind
  /** Duelo de la torre: [delante, detrás] según la torre ahora; cercanía: los dos, sin orden; líder: [líder]. */
  readonly cars: readonly string[]
  readonly basis: ShotBasis | null
  readonly reason: ShotReason
  readonly neutral: NeutralKind | null
  /** Intervalo oficial de la torre entre los dos (ms); null sin dato o fuera de un duelo de la torre. */
  readonly intervalMs: number | null
  /** Posiciones oficiales [delante, detrás] (torre); null sin dato. */
  readonly positions: readonly [number, number] | null
  readonly camera: CameraKind
  /** Etiqueta de la curva de la cámara fija (MultiViewer), si la tiene. */
  readonly corner: string | null
}

function sameView(a: TvShotView | null, b: TvShotView | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.id === b.id &&
    a.kind === b.kind &&
    a.reason === b.reason &&
    a.neutral === b.neutral &&
    a.basis === b.basis &&
    a.intervalMs === b.intervalMs &&
    a.camera === b.camera &&
    a.corner === b.corner &&
    a.cars.join() === b.cars.join() &&
    (a.positions?.join() ?? '') === (b.positions?.join() ?? '')
  )
}

/**
 * Realización automática (ítem 9, D39): encendida o no y el plano que enseña. No se guarda: cada sesión empieza con
 * la cámara de siempre.
 *
 * Cualquier acción manual la apaga: elegir otro coche (o ninguno), seguir a un coche o dejar de seguirlo (lo vigila
 * este store, sin tocar el de reproducción), mover el mapa o tocar la escena (el rig de cámara), Esc, el botón o la
 * tecla T. Solo está disponible con la escena 3D montada (`available`: el rig de cámara se engancha con `attachRig`).
 */
export const useTvStore = defineStore('tv', () => {
  const playback = usePlaybackStore()
  const active = ref(false)
  const available = ref(false)
  const view = shallowRef<TvShotView | null>(null)
  const lastExit = ref<TvExit | null>(null)

  function start(): void {
    if (active.value || !available.value || !playback.attached) return
    // Fuera del seguimiento antes de encenderse: con `active` aún en false, el vigilante de abajo no lo cuenta como
    // una acción manual.
    if (playback.following) playback.setFollowing(false)
    lastExit.value = null
    active.value = true
    getRuntime()?.requestFrame()
  }

  function stop(reason: TvExit): void {
    if (!active.value) return
    active.value = false
    lastExit.value = reason
    view.value = null
    getRuntime()?.requestFrame()
  }

  function toggle(): void {
    if (active.value) stop('toggle')
    else start()
  }

  /**
   * El rig de cámara se engancha al montarse y se suelta al desmontarse (devuelve la baja). Cuenta enganches: al
   * recuperar el contexto WebGL, el rig nuevo puede montarse antes de que se desmonte el viejo. Sin ninguno, se apaga.
   */
  let rigs = 0
  function attachRig(): () => void {
    rigs++
    available.value = true
    let attached = true
    return () => {
      if (!attached) return
      attached = false
      rigs--
      if (rigs > 0) return
      available.value = false
      stop('scene')
    }
  }

  /** El rig publica el plano tras cada decisión; solo llega a Vue si ha cambiado algo de lo que se enseña. */
  function publish(next: TvShotView | null): void {
    if (!active.value) next = null
    if (!sameView(view.value, next)) view.value = next
  }

  // Síncronos: la salida tiene que verse antes que la reacción del rig a ese mismo cambio (seguir a un coche).
  watch(
    () => playback.selectedCar,
    () => stop('selection'),
    { flush: 'sync' },
  )
  watch(
    () => playback.following,
    () => stop('follow'),
    { flush: 'sync' },
  )
  watch(
    () => playback.attached,
    () => stop('session'),
    { flush: 'sync' },
  )

  return { active, available, view, lastExit, start, stop, toggle, attachRig, publish }
})
