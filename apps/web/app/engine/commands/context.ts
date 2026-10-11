/**
 * Paleta de comandos (ítem 14): la información fija de la sesión para los comandos y ayudas que comparten (pilotos,
 * reloj visible, vueltas por coche). TS puro, sin depender de `replay/` (la fuente es estructural, como la de la
 * vista previa del timeline).
 */
import type { DecodedTrzb, DriverInfo, Manifest } from '@trazada/schema'
import { type LapTable, lapIndex } from '../analysis/lapTable'
import { formatClock } from '../format/time'
import { clockOrigin, type TimelineMarkers } from '../timeline/markers'
import type { CommandContext, CommandSessionInfo } from './types'

/** Lo que la paleta necesita del runtime del replay. */
export interface CommandSource {
  readonly session: { readonly manifest: Manifest; readonly timing: DecodedTrzb }
  readonly drivers: readonly DriverInfo[]
  readonly markers: TimelineMarkers
  readonly leaderboard: { readonly lapTable: LapTable }
}

/** La información fija de la sesión. `defaultMs`: el instante por defecto al abrir (`defaultInitialMs`). */
export function commandSessionInfo(src: CommandSource, defaultMs: number): CommandSessionInfo {
  const { type, playback, totalLaps } = src.session.manifest.session
  const race = type === 'race' || type === 'sprint'
  return {
    type,
    race,
    drivers: src.drivers,
    startMs: playback.startMs,
    endMs: playback.endMs,
    originMs: clockOrigin(type, src.session.timing, playback),
    defaultMs,
    totalLaps: race && Number.isInteger(totalLaps) && totalLaps! >= 1 ? totalLaps! : null,
    markers: src.markers,
    laps: src.leaderboard.lapTable,
  }
}

/** El reloj visible (como el del dock) en t: «1:02:03», «−0:30». */
export const clockAt = (ctx: CommandContext, t: number): string => formatClock(t - ctx.session.originMs)

export function driverOf(ctx: CommandContext, car: string): DriverInfo | undefined {
  return ctx.session.drivers.find((d) => d.number === car)
}

/** Sigla (o «#dorsal» sin piloto en la lista). */
export function tlaOf(ctx: CommandContext, car: string): string {
  return driverOf(ctx, car)?.tla ?? `#${car}`
}

/** Nombre y apellido (o la sigla, si no hay nombre). */
export function nameOf(ctx: CommandContext, car: string): string {
  const d = driverOf(ctx, car)
  if (!d) return `#${car}`
  return `${d.first} ${d.last}`.trim() || d.tla
}

/** Parámetros de texto de un piloto: `{driver}` (sigla) y `{name}` (nombre). */
export const driverParams = (ctx: CommandContext, car: string) => ({ driver: tlaOf(ctx, car), name: nameOf(ctx, car) })

/** Coches en el orden de la clasificación (los que no estén en ella, detrás, en el orden del manifest). */
export function carsInOrder(ctx: CommandContext): string[] {
  const known = new Set(ctx.session.drivers.map((d) => d.number))
  const out = ctx.state.order.filter((c) => known.has(c))
  for (const d of ctx.session.drivers) if (!out.includes(d.number)) out.push(d.number)
  return out
}

/** Vuelta de un coche: su inicio (ms de sesión; null sin dato) o, si no la tiene, su última vuelta con datos. */
export type CarLapLookup = { kind: 'start'; t: number } | { kind: 'no-start' } | { kind: 'no-lap'; last: number | null }

export function carLapStart(ctx: CommandContext, car: string, lap: number): CarLapLookup {
  const laps = ctx.session.laps.cars.get(car)
  if (!laps || laps.lap.length === 0) return { kind: 'no-lap', last: null }
  const k = lapIndex(laps, lap)
  if (k < 0) return { kind: 'no-lap', last: laps.lap[laps.lap.length - 1]! }
  const t = laps.startMs[k]!
  return t >= 0 ? { kind: 'start', t } : { kind: 'no-start' }
}

/** Inicios de vuelta conocidos de un coche, en orden: [vuelta, t]. */
export function carLapStarts(ctx: CommandContext, car: string): { lap: number; t: number }[] {
  const laps = ctx.session.laps.cars.get(car)
  if (!laps) return []
  const out: { lap: number; t: number }[] = []
  for (let k = 0; k < laps.lap.length; k++) if (laps.startMs[k]! >= 0) out.push({ lap: laps.lap[k]!, t: laps.startMs[k]! })
  return out.sort((a, b) => a.t - b.t)
}

/** ¿Cae t dentro del intervalo de reproducción? */
export const inSession = (ctx: CommandContext, t: number): boolean => t >= ctx.session.startMs && t <= ctx.session.endMs

/** Margen para «siguiente» y «anterior»: lo que está justo en el instante actual no cuenta (pulsar dos veces avanza). */
export const NEAR_MS = 500
