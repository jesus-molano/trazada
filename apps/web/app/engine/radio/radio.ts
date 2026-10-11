/**
 * Radio de los equipos en el front (D51), TS puro: estado de la sesión, los clips hasta el instante del reloj (nunca
 * del futuro) y cuál suena al escuchar en directo. `t` es la hora de **publicación** del feed: el mensaje pudo decirse
 * unos segundos antes (lo dice la interfaz).
 */
import type { Manifest, RadioClip, SessionEvents } from '@trazada/schema'
import { visibleCount } from '../trackstate/TrackState'

/** `present`/`partial`/`absent` del manifest; `outdated`: la sesión es de antes de 1.2.0 (hay que volver a descargarla). */
export type RadioStatus = 'present' | 'partial' | 'absent' | 'outdated'

/** Escuchar en directo solo a ×1 o ×2: más deprisa, los clips se pisarían y no se entenderían. */
export const LIVE_MAX_RATE = 2

/** Lo que dice el manifest de la radio de esta sesión. */
export function radioStatus(manifest: Pick<Manifest, 'channels'>): RadioStatus {
  return manifest.channels?.radio ?? 'outdated'
}

const FILE = /^radio\/[0-9a-f]{16}\.mp3$/

/** Clips válidos en orden de t (el pipeline ya los da así; un `file` raro no se reproduce nunca). */
export function radioClips(events: Pick<SessionEvents, 'radio'>): readonly RadioClip[] {
  const clips = (events.radio ?? []).filter((c) => Number.isFinite(c.t) && FILE.test(c.file))
  return Object.freeze([...clips].sort((a, b) => a.t - b.t))
}

/** URL del clip junto al manifest (`…/manifest.json` → `…/radio/<sha>.mp3`). */
export function clipUrl(manifestUrl: string, clip: Pick<RadioClip, 'file'>): string | null {
  if (!FILE.test(clip.file)) return null
  return manifestUrl.slice(0, manifestUrl.lastIndexOf('/') + 1) + clip.file
}

/** Cuántos clips se han publicado hasta `timeMs` (incluido): los únicos que se enseñan. */
export function clipsUpTo(times: ArrayLike<number>, timeMs: number): number {
  return visibleCount(times, timeMs)
}

/**
 * Escuchar en directo: al pasar el reloj de `from` a `to` (hacia delante), el clip publicado en ese tramo que toca oír
 * (el más reciente: suena uno a la vez), del coche `car` o de todos si es null. -1 si ninguno.
 */
export function liveClip(
  clips: readonly Pick<RadioClip, 'car'>[],
  times: ArrayLike<number>,
  from: number,
  to: number,
  car: string | null,
): number {
  if (!(to > from)) return -1
  const a = visibleCount(times, from)
  for (let i = visibleCount(times, to) - 1; i >= a; i--) if (car === null || clips[i]!.car === car) return i
  return -1
}
