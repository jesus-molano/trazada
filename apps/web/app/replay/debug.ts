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
  /** Coches: triángulos del modelo detallado y cuántos se dibujan con él o con la cuña en el último render. */
  carTriangles: 0,
  carLod: { detail: 0, wedge: 0 },
  /** Último encuadre de la vista general: caja del trazado y hueco libre (coordenadas de pantalla −1…1). */
  framing: null as null | {
    box: { x0: number; x1: number; y0: number; y1: number }
    free: { x0: number; x1: number; y0: number; y1: number }
  },
  /**
   * Capas registradas (`registerSceneStat` con coste): su contribución al último render. El tope de draw calls de
   * los e2e es el de la escena base más la suma de las capas activas.
   */
  get layers(): SceneLayerStat[] {
    const out: SceneLayerStat[] = []
    for (const [name, getter] of registered) {
      const v = getter() as Partial<SceneLayerCost>
      if (typeof v.drawCalls === 'number' && typeof v.triangles === 'number' && typeof v.fogged === 'boolean') {
        out.push({ name, drawCalls: v.drawCalls, triangles: v.triangles, fogged: v.fogged })
      }
    }
    return out
  },
}

/** Lo que una capa de la escena añade al render (D29): 0 draw calls si está apagada. */
export interface SceneLayerCost {
  drawCalls: number
  triangles: number
  /** ¿Usa la niebla de la escena? Solo la pista debería (plan §3: materiales nuevos con `fog: false`). */
  fogged: boolean
}
export interface SceneLayerStat extends SceneLayerCost {
  name: string
}

/** Estadísticas de la escena: las fijas y las que registran capas y herramientas (`registerSceneStat`). */
export type SceneStats = typeof sceneStats & { readonly [name: string]: unknown }

const BUILTIN_STATS: ReadonlySet<string> = new Set(Object.keys(sceneStats))
const registered = new Map<string, () => object>()

/**
 * Publica una estadística con nombre en `sceneStats` (y así en `window.__trazada.scene.<nombre>` y en las copias
 * `{ ...scene }` de los e2e), leída en el momento con `getter`: cada capa o herramienta expone lo suyo (`trails`,
 * `heat`, `tv`…) sin tocar este fichero. Si lo que devuelve lleva `drawCalls`, `triangles` y `fogged`
 * (`SceneLayerCost`), cuenta como capa en `sceneStats.layers`. Con el mismo nombre, manda el último registro.
 * Devuelve la baja (que no borra un registro posterior con el mismo nombre).
 */
export function registerSceneStat(name: string, getter: () => object): () => void {
  if (BUILTIN_STATS.has(name)) throw new Error(`sceneStats.${name} ya existe: elige otro nombre`)
  registered.set(name, getter)
  Object.defineProperty(sceneStats, name, { get: getter, enumerable: true, configurable: true })
  return () => {
    if (registered.get(name) !== getter) return
    registered.delete(name)
    Reflect.deleteProperty(sceneStats, name)
  }
}

/** Punto del eje de la pista en pantalla (px CSS de la página), con lo que la escena debería dibujar ahí. */
export interface TrackScreenSample {
  s: number
  /** Posición canónica (m), para descartar puntos con coches cerca. */
  wx: number
  wy: number
  x: number
  y: number
  /** Dirección de la normal de la pista en pantalla (unitaria). */
  nx: number
  ny: number
  /** Anchura que debería tener la pista en pantalla (px), según `mapHalfWidth`. */
  expectedPx: number
  /** Anchura real (14 m) en pantalla (px), y la que tendría vista de frente (sin escorzo) a esa profundidad. */
  realPx: number
  frontalPx: number
  /** A menos de 40 m del pit lane (allí se juntan las dos cintas). */
  nearPit: boolean
}

/** Sondas que registra la escena para los e2e (fuera de `sceneStats`, que se copia entero). */
export const sceneProbe = {
  trackScreen: null as null | ((stepM: number) => TrackScreenSample[]),
}

export interface TrazadaHandle {
  readonly timeMs: number
  readonly playing: boolean
  readonly rate: number
  readonly selectedCar: string | null
  readonly frames: number
  readonly renders: number
  readonly scene: SceneStats
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
  /** La escena está tapada (`rt.setSceneHidden`) y no se le piden frames. */
  readonly sceneHidden: boolean
  seek(ms: number): void
  /** Resultado del bench (`?bench=1`) cuando termina. */
  readonly bench: unknown
  /** Estado de los coches en el último frame (copia). */
  cars(): { car: string; visible: boolean; inPit: boolean; s: number; x: number; y: number }[]
  /** Eje de la pista proyectado con la cámara actual, cada `stepM` metros (solo los puntos delante de ella). */
  trackScreen(stepM: number): TrackScreenSample[]
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
    get sceneHidden() {
      return rt.sceneHidden
    },
    seek: (ms: number) => rt.clock.seek(ms),
    get bench() {
      return (window as Window & { __trazadaBench?: unknown }).__trazadaBench ?? null
    },
    cars: () => rt.model.states.map(({ car, visible, inPit, s, x, y }) => ({ car, visible, inPit, s, x, y })),
    trackScreen: (stepM: number) => sceneProbe.trackScreen?.(stepM) ?? [],
  }
  return () => {
    delete window.__trazada
  }
}
