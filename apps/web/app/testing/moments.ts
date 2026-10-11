/**
 * Solo para tests: carreras sintéticas para los momentos (ítem 5): vueltas del cronometraje y pistas GPS coherentes con
 * ellas (cada coche recorre cada vuelta a velocidad constante entre sus pasos por meta), y una sesión completa sobre
 * el fixture para montar el runtime real. Usa `timingBuilder` y `fakeMotion` sin modificarlos.
 */
import type { SessionEvents } from '@trazada/schema'
import type { LoadedSession } from '../data/types'
import { computeTangents } from '../engine/replay/motion'
import { type LapInput, timingBuilder } from './laps'
import { fakeMotion, type TrackSpec } from './motion'

/** Largo de la vuelta de las pistas sintéticas (m). */
export const MOMENTS_LAP_M = 1000

/** Pasos por meta de una tanda de vueltas seguidas que empieza en `startMs` (sin la salida). */
export function crossings(startMs: number, lapMs: readonly number[]): number[] {
  let t = startMs
  return lapMs.map((ms) => (t += ms))
}

export interface LapTrackOptions {
  /** Largo de la vuelta (m); por defecto, `MOMENTS_LAP_M`. */
  lengthM?: number
  /** Una muestra cada tanto (ms); por defecto, 1000. */
  stepMs?: number
  /** Tramos [desde, hasta) sin muestras (huecos del GPS). */
  gaps?: readonly (readonly [number, number])[]
}

/**
 * Pista GPS de un coche que da las vueltas `lapMs` desde `startMs`: la vuelta k va de (k − 1)·L a k·L a velocidad
 * constante, entre sus pasos por meta.
 */
export function lapTrackSpec(car: number, startMs: number, lapMs: readonly number[], opts: LapTrackOptions = {}): TrackSpec {
  const L = opts.lengthM ?? MOMENTS_LAP_M
  const step = opts.stepMs ?? 1000
  const ends = crossings(startMs, lapMs)
  const last = ends[ends.length - 1] ?? startMs
  const t: number[] = []
  const s: number[] = []
  let k = 0
  for (let x = startMs; x <= last; x += step) {
    if (opts.gaps?.some(([a, b]) => x >= a && x < b)) continue
    while (k < ends.length - 1 && x > ends[k]!) k++
    const from = k === 0 ? startMs : ends[k - 1]!
    s.push(k * L + (L * (x - from)) / lapMs[k]!)
    t.push(x)
  }
  return { car, t, s }
}

export interface RaceCar {
  car: number
  lapMs: readonly number[]
  /** Campos de cada vuelta (boxes, estado de pista…), como en `TimingBuilder.run`. */
  each?: (i: number) => LapInput
  /** Huecos del GPS de este coche. */
  gaps?: readonly (readonly [number, number])[]
}

/**
 * Carrera sintética sobre una sesión real (el fixture): tipo «race», salida en el inicio de la reproducción, las vueltas
 * y las pistas GPS de `cars` (vuelta 1 sin tiempo oficial, como en el live timing) y los eventos dados (por defecto,
 * ninguno). Lo demás (circuito, pilotos, telemetría), el de la sesión base.
 */
export function raceSession(base: LoadedSession, cars: readonly RaceCar[], events: Partial<SessionEvents> = {}): LoadedSession {
  const start = base.manifest.session.playback.startMs
  const b = timingBuilder()
  for (const c of cars) b.run(c.car, start, c.lapMs, { lap1NoTime: true, each: c.each })
  const motion = fakeMotion(cars.map((c) => lapTrackSpec(c.car, start, c.lapMs, { gaps: c.gaps })))
  const playback = { ...base.manifest.session.playback, lightsOutMs: start }
  return {
    ...base,
    manifest: { ...base.manifest, session: { ...base.manifest.session, type: 'race', totalLaps: null, playback } },
    timing: b.build(),
    motion,
    tangents: computeTangents(motion, null, 'pchip'),
    events: { ...base.events, raceControl: [], sectorFlags: [], windows: [], ...events },
  }
}
