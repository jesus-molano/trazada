/**
 * Estado de todos los coches en un instante (TS puro, sin Vue ni three). Se muta en sitio en cada frame.
 */
import type { DriverInfo } from '@trazada/schema'
import type { CircuitModel } from '../track/circuit'
import { type CarSample, type CarTrack, newCarSample, PATH_PIT, sampleCar } from './motion'
import { newPlaceScratch, pitSpan, placeSample } from './place'

export interface CarState {
  car: string
  driver: DriverInfo | null
  visible: boolean
  inPit: boolean
  /** Entre un segmento de pista y otro de pit (se dibuja en línea recta). */
  transition: boolean
  /** Distancia acumulada (m) equivalente en pista: ordena la carrera. */
  s: number
  speedMps: number
  /** Posición canónica (m) y rumbo en planta (rad, desde +x). */
  x: number
  y: number
  z: number
  heading: number
}

export class ReplayModel {
  readonly states: CarState[]
  private readonly samples: CarSample[]
  /** Pistas de movimiento de cada coche, en el orden de `states` (las estelas muestrean de ellas). */
  readonly tracks: readonly CarTrack[]
  private readonly circuit: CircuitModel
  private readonly pitSpan: number
  private readonly scratch = newPlaceScratch()

  constructor(tracks: CarTrack[], circuit: CircuitModel, drivers: DriverInfo[]) {
    this.tracks = tracks
    this.circuit = circuit
    const byNumber = new Map(drivers.map((d) => [d.number, d]))
    this.states = tracks.map((tr) => ({
      car: tr.car,
      driver: byNumber.get(tr.car) ?? null,
      visible: false,
      inPit: false,
      transition: false,
      s: 0,
      speedMps: 0,
      x: 0,
      y: 0,
      z: 0,
      heading: 0,
    }))
    this.samples = tracks.map(() => newCarSample())
    this.pitSpan = pitSpan(circuit)
  }

  update(t: number): void {
    for (let k = 0; k < this.tracks.length; k++) {
      const tr = this.tracks[k]!
      const smp = sampleCar(tr, t, this.samples[k]!)
      const st = this.states[k]!
      st.visible = smp.state !== 'hidden'
      if (!st.visible) continue
      st.s = smp.s
      st.speedMps = smp.speed
      st.inPit = smp.path === PATH_PIT
      st.transition = smp.state === 'transition'
      placeSample(this.circuit, tr, smp, st, this.scratch, this.pitSpan)
    }
  }

  /** Coches visibles ordenados por distancia recorrida (de más a menos). */
  orderByDistance(): CarState[] {
    return this.states.filter((s) => s.visible).sort((a, b) => b.s - a.s)
  }
}
