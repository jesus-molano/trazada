/**
 * Estado de todos los coches en un instante (TS puro, sin Vue ni three). Se muta en sitio en cada frame.
 */
import type { DriverInfo } from '@trazada/schema'
import type { CircuitModel } from '../track/circuit'
import { newSample, type PathSample } from '../track/TrackPath'
import { type CarSample, type CarTrack, newCarSample, PATH_PIT, sampleCar } from './motion'

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
  private readonly tracks: CarTrack[]
  private readonly circuit: CircuitModel
  private readonly pitSpan: number
  private readonly a: PathSample = newSample()
  private readonly b: PathSample = newSample()

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
    const pit = circuit.meta.pit
    const L = circuit.centerline.length
    this.pitSpan = pit ? (((pit.exitS - pit.entryS) % L) + L) % L : 0
  }

  /** Punto (canónico) de un coche con `path` y `s` dados. */
  private place(path: number, s: number, out: PathSample): void {
    const { centerline, pitlane, meta } = this.circuit
    if (path === PATH_PIT && pitlane && meta.pit && this.pitSpan > 0) {
      const L = centerline.length
      const rel = (((s - meta.pit.entryS) % L) + L) % L
      const f = Math.min(1, Math.max(0, rel / this.pitSpan))
      pitlane.sample(f * pitlane.length, out)
      return
    }
    centerline.sample(s, out)
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
      if (smp.state === 'visible') {
        this.place(smp.path, smp.s, this.a)
        st.x = this.a.x
        st.y = this.a.y
        st.z = this.a.z
        st.heading = Math.atan2(this.a.ty, this.a.tx)
      } else {
        // Transición pista↔pit: recta entre el último punto de un camino y el primero del otro.
        const i = smp.i
        this.place(tr.path[i]!, tr.s[i]!, this.a)
        this.place(tr.path[i + 1]!, tr.s[i + 1]!, this.b)
        const f = smp.f
        st.x = this.a.x + f * (this.b.x - this.a.x)
        st.y = this.a.y + f * (this.b.y - this.a.y)
        st.z = this.a.z + f * (this.b.z - this.a.z)
        const dx = this.b.x - this.a.x
        const dy = this.b.y - this.a.y
        st.heading = Math.hypot(dx, dy) > 0.5 ? Math.atan2(dy, dx) : Math.atan2(this.a.ty, this.a.tx)
      }
    }
  }

  /** Coches visibles ordenados por distancia recorrida (de más a menos). */
  orderByDistance(): CarState[] {
    return this.states.filter((s) => s.visible).sort((a, b) => b.s - a.s)
  }
}
