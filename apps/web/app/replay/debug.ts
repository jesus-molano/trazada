/**
 * Asa de inspección para e2e y depuración (`window.__trazada`). Solo lectura: no expone datos que no
 * estén ya en la página.
 */
import type { ReplayRuntime } from './runtime'

export const sceneStats = { renders: 0, instances: 0 }

export interface TrazadaHandle {
  readonly timeMs: number
  readonly playing: boolean
  readonly rate: number
  readonly selectedCar: string | null
  readonly frames: number
  readonly renders: number
  readonly startMs: number
  readonly endMs: number
  readonly markers: ReplayRuntime['markers']
  readonly drivers: ReplayRuntime['drivers']
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
    startMs: rt.clock.startMs,
    endMs: rt.clock.endMs,
    markers: rt.markers,
    drivers: rt.drivers,
  }
  return () => {
    delete window.__trazada
  }
}
