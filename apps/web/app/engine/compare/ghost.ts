/**
 * Coche fantasma de la comparación (ítem 1, D31; TS puro, sin Vue ni three): la posición REAL del coche B en su vuelta
 * de referencia, desplazada en el tiempo a la vuelta de A. Se dibuja donde estaba B cuando llevaba en su vuelta el
 * mismo tiempo que lleva A ahora (t − inicio de la vuelta de A). No es una estimación: es la misma posición que
 * dibujaría el replay para B en ese instante (`sampleCar`), con la misma regla de huecos.
 *
 * - `visible`: B tiene posición en ese instante.
 * - `notYet`: ese instante aún no había llegado (misma vuelta con B por detrás): sería el futuro y no se dibuja.
 * - `finished`: A lleva más tiempo de vuelta que lo que tardó B en la suya: B ya la había cerrado.
 * - `noData`: B no tiene posición en ese instante (hueco de más de 2 s, «sin dato» o garaje): no se inventa.
 */
import { type CarSample, type CarTrack, newCarSample, sampleCar } from '../replay/motion'
import type { LapAnchor, RefAnchor } from './delta'

export type GhostState = 'visible' | 'notYet' | 'finished' | 'noData'

export interface Ghost {
  state: GhostState
  /** Instante (ms de sesión) de B que se dibuja; NaN sin vuelta de referencia. */
  t: number
  /** Muestra de B en ese instante (la que coloca la escena con `placeSample`). */
  sample: CarSample
}

export function newGhost(): Ghost {
  return { state: 'noData', t: Number.NaN, sample: newCarSample() }
}

/** El fantasma en t: B en su vuelta `b` al mismo tiempo de vuelta que lleva A en la vuelta que empezó en `a`. */
export function ghostAt(trackB: CarTrack, a: Pick<LapAnchor, 't'>, b: RefAnchor, t: number, out: Ghost = newGhost()): Ghost {
  const tg = b.t + (t - a.t)
  out.t = tg
  if (tg > t) {
    out.state = 'notYet'
    return out
  }
  if (!Number.isNaN(b.end) && tg > b.end) {
    out.state = 'finished'
    return out
  }
  out.state = sampleCar(trackB, tg, out.sample).state === 'hidden' ? 'noData' : 'visible'
  return out
}
