/**
 * Asa de inspección para e2e y depuración (`window.__trazada`). Solo lectura: no expone datos que no
 * estén ya en la página.
 */
import type { ReplayRuntime } from './runtime'

/** Duración (ms) de las últimas actualizaciones del leaderboard. */
export const leaderboardStats = { updates: 0, durations: [] as number[] }

export const sceneStats = {
  renders: 0,
  instances: 0,
  ready: false,
  pitLaneLengthM: 0,
  /** Longitud de arco de las muestras de pit con las que se construyó el pit lane (pipeline). */
  pitSamplesLengthM: 0,
  corners: 0,
  elevationScale: 1,
  /** Color (#RRGGBB) y coche de cada instancia del InstancedMesh, tal y como se subieron a la GPU. */
  instanceColors: [] as string[],
  instanceCars: [] as string[],
}

export interface TrazadaHandle {
  readonly timeMs: number
  readonly playing: boolean
  readonly rate: number
  readonly selectedCar: string | null
  readonly frames: number
  readonly renders: number
  readonly scene: typeof sceneStats
  readonly leaderboard: typeof leaderboardStats
  readonly startMs: number
  readonly endMs: number
  readonly markers: ReplayRuntime['markers']
  readonly drivers: ReplayRuntime['drivers']
  /** Estado de los coches en el último frame (copia). */
  cars(): { car: string; visible: boolean; inPit: boolean; s: number; x: number; y: number }[]
}

declare global {
  interface Window {
    __trazada?: TrazadaHandle
  }
}

export function installDebugHandle(rt: ReplayRuntime, selected: () => string | null): () => void {
  window.__trazada = {
    get timeMs() {
      return rt.clock.timeMs
    },
    get playing() {
      return rt.clock.playing
    },
    get rate() {
      return rt.clock.rate
    },
    get selectedCar() {
      return selected()
    },
    get frames() {
      return rt.frames
    },
    get renders() {
      return sceneStats.renders
    },
    scene: sceneStats,
    leaderboard: leaderboardStats,
    startMs: rt.clock.startMs,
    endMs: rt.clock.endMs,
    markers: rt.markers,
    drivers: rt.drivers,
    cars: () => rt.model.states.map(({ car, visible, inPit, s, x, y }) => ({ car, visible, inPit, s, x, y })),
  }
  return () => {
    delete window.__trazada
  }
}
