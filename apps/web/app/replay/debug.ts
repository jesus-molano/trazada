/**
 * Asa de inspección para e2e y depuración (`window.__trazada`). No expone datos que no estén ya en la
 * página. Lo único que cambia es `seek`, lo mismo que hace el timeline pero con precisión de ms.
 */
import type { TrackStateSnapshot } from '~/engine/trackstate/TrackState'
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
  /** Modo de cámara y posición (three) tras el último render. */
  cameraMode: 'overview' as 'overview' | 'to-follow' | 'follow' | 'to-overview',
  camera: [0, 0, 0] as [number, number, number],
  /** Lo que la escena pinta del estado de pista en el último render: tinte y sectores con bandera. */
  trackTint: null as string | null,
  sectorOverlays: [] as number[],
  marshalSectors: 0,
  /** Resolución de render (DPR) actual y cambios del gobernador de calidad. */
  dpr: 1,
  dprChanges: 0,
  /** Draw calls y triángulos del último render; GPU según el driver (si lo expone). */
  drawCalls: 0,
  triangles: 0,
  gpu: '',
  /** Último encuadre de la vista general: caja del trazado y hueco libre (coordenadas de pantalla −1…1). */
  framing: null as null | {
    box: { x0: number; x1: number; y0: number; y1: number }
    free: { x0: number; x1: number; y0: number; y1: number }
  },
  /** Semianchura con la que se dibuja la pista ahora (m): la real de cerca, mayor al alejarse. */
  trackHalfWidthM: 0,
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
  /** Estado de pista en el último frame. */
  readonly trackState: TrackStateSnapshot
  /** Instantes (ms) de los mensajes de race control, en orden. */
  readonly raceControlTimes: number[]
  /** Coches desplazados por la separación visual (opción Estimado) en el último frame. */
  readonly separatedCars: number
  seek(ms: number): void
  /** Resultado del bench (`?bench=1`) cuando termina. */
  readonly bench: unknown
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
    get trackState() {
      return rt.trackState.snapshot
    },
    raceControlTimes: rt.raceControl.map((e) => e.t),
    get separatedCars() {
      return rt.separatedCars
    },
    seek: (ms: number) => rt.clock.seek(ms),
    get bench() {
      return (window as Window & { __trazadaBench?: unknown }).__trazadaBench ?? null
    },
    cars: () => rt.model.states.map(({ car, visible, inPit, s, x, y }) => ({ car, visible, inPit, s, x, y })),
  }
  return () => {
    delete window.__trazada
  }
}
