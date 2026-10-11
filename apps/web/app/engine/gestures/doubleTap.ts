/**
 * Doble toque (o doble clic) sobre un coche para seguirlo (ítem 17, D43). Puro (sin DOM): lo usan la escena, que avisa
 * de cada toque sobre ella (`tap`), y el lienzo y las siglas, que avisan del coche tocado (`car`).
 *
 * El primer toque sobre un coche lo elige como hoy (o lo deja, si ya lo estaba). Un segundo toque a menos de `maxPx` y
 * `maxMs` del primero completa el doble toque, aunque no acierte al coche: a ×16 un coche recorre unos 400 m entre dos
 * toques. Lo completa el primer aviso que llegue de ese segundo toque: el de la escena (al levantar el dedo) o el del
 * coche (el lienzo lo da un frame después; la sigla, con su clic). El otro aviso de ese mismo toque ya no cuenta
 * (`consumed`): así el segundo toque no deselecciona el coche que eligió el primero.
 *
 * Doble toque en el vacío (D53, «Centrar»): dos toques de la escena igual de cerca y de pronto, sin que ningún coche
 * reclame ninguno de los dos. Como el aviso del coche llega después que el de la escena, el segundo toque solo deja el
 * doble toque pendiente (`tap`) y quien lo recibe lo confirma un poco después (`confirmEmpty`): si mientras tanto llega
 * el aviso de un coche de cualquiera de los dos toques, ya no vale.
 */

export interface DoubleTapOptions {
  /** Tiempo máximo entre los dos toques (ms). */
  readonly maxMs: number
  /** Distancia máxima entre los dos toques (px). */
  readonly maxPx: number
  /** Los dos avisos de un mismo toque llegan, como mucho, con esta diferencia (ms). */
  readonly sameTapMs: number
}

export const DOUBLE_TAP: DoubleTapOptions = { maxMs: 400, maxPx: 40, sameTapMs: 300 }

/**
 * Qué hacer con el coche tocado: `single`, elegirlo o dejarlo como siempre; `double`, seguir a `car` (el del primer
 * toque); `consumed`, nada (ese toque ya completó un doble toque).
 */
export interface CarTapResult {
  readonly kind: 'single' | 'double' | 'consumed'
  readonly car: string
}

export class DoubleTap {
  private first: { car: string; x: number; y: number; t: number } | null = null
  private consumedAt = -Infinity
  /** Último toque de la escena que, de momento, no cayó en ningún coche. */
  private empty: { x: number; y: number; t: number } | null = null
  /** Doble toque en el vacío pendiente de confirmar: los instantes de sus dos toques. */
  private emptyDouble: { first: number; second: number } | null = null

  constructor(private readonly opts: DoubleTapOptions = DOUBLE_TAP) {}

  /** ¿(x, y, t) completa un doble toque con el primero? Si es así, lo consume y devuelve su coche. */
  private complete(x: number, y: number, t: number): string | null {
    const f = this.first
    if (!f) return null
    const dt = t - f.t
    if (!(dt > 0 && dt <= this.opts.maxMs && Math.hypot(x - f.x, y - f.y) <= this.opts.maxPx)) return null
    this.first = null
    this.consumedAt = t
    return f.car
  }

  /**
   * Un toque sobre la escena (al levantar el dedo o el botón), en el instante `t` (ms) y en (x, y) (px). Si completa un
   * doble toque, devuelve el coche del primero (para seguirlo); si no, null.
   */
  tap(x: number, y: number, t: number): string | null {
    const car = this.complete(x, y, t)
    if (car !== null) {
      this.empty = null
      return car
    }
    const e = this.empty
    const dt = e ? t - e.t : -1
    if (e && dt > 0 && dt <= this.opts.maxMs && Math.hypot(x - e.x, y - e.y) <= this.opts.maxPx) {
      this.empty = null
      this.emptyDouble = { first: e.t, second: t }
    } else this.empty = { x, y, t }
    return null
  }

  /**
   * ¿El toque de la escena del instante `t` completó un doble toque en el vacío que ningún coche ha reclamado? Se llama
   * un poco después de `tap` (cuando ya habrían llegado los avisos de los coches) y lo consume.
   */
  confirmEmpty(t: number): boolean {
    if (this.emptyDouble?.second !== t) return false
    this.emptyDouble = null
    return true
  }

  /** El toque del instante `t`, en (x, y), cayó sobre `car`. */
  car(car: string, x: number, y: number, t: number): CarTapResult {
    // Ese toque cayó en un coche: ni él ni el doble toque del que forme parte son toques en el vacío.
    const near = (u: number) => Math.abs(t - u) <= this.opts.sameTapMs
    if (this.empty && near(this.empty.t)) this.empty = null
    if (this.emptyDouble && (near(this.emptyDouble.first) || near(this.emptyDouble.second))) this.emptyDouble = null
    const since = t - this.consumedAt
    if (since >= 0 && since <= this.opts.sameTapMs) return { kind: 'consumed', car }
    const followed = this.complete(x, y, t)
    if (followed !== null) return { kind: 'double', car: followed }
    this.first = { car, x, y, t }
    return { kind: 'single', car }
  }

  /** Olvida el primer toque (p. ej., al empezar un gesto de dos dedos). */
  reset(): void {
    this.first = null
    this.empty = null
    this.emptyDouble = null
  }
}
