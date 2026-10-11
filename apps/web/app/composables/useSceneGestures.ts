/**
 * Gestos táctiles de la escena (ítem 17, D43), sobre la raíz `.tz-scene` (lienzo y siglas):
 *
 * - **Dos dedos en paralelo y en horizontal** mueven el reloj: todo el ancho de la escena son 2 minutos de sesión
 *   (`engine/gestures/twoFinger.ts`), con un seek por frame de pantalla como mucho y sin tocar la reproducción (sigue en
 *   pausa o reproduciendo). Mientras, la escena enseña cuánto se ha movido y la tarjeta de la vista previa del timeline
 *   (ítem 16) con lo que pasaba en ese instante (`hud`).
 * - **Pellizco**: el zoom de siempre. Con la vista general lo hacen los controles del mapa; siguiendo a un coche, la
 *   distancia de la cámara (`follow`).
 * - **Lo demás con dos dedos** (inclinar, girar) sigue siendo de los controles del mapa.
 * - **Doble toque** (o doble clic) sobre un coche o su sigla: lo elige y la cámara lo sigue (`engine/gestures/doubleTap.ts`).
 *   El lienzo y las siglas avisan del coche tocado con `useCarTap`; aquí se ve cada toque sobre la escena.
 *
 * Arbitraje con los controles del mapa (MapControls, que escuchan `pointermove` en el documento): los punteros que
 * empiezan en la escena se siguen en fase de captura (ver los oyentes). Con dos dedos, sus movimientos se retienen (no
 * les llegan a los controles) hasta saber qué gesto es, algo que se decide una vez por frame con los dos dedos al día; si
 * es el reloj, siguen retenidos hasta que se levantan todos los dedos (la cámara no se mueve); si no, pasan. Los
 * `pointerdown`/`pointerup` siempre pasan, para que los controles lleven bien la cuenta de los dedos. Un dedo solo (girar
 * o desplazar el mapa, elegir un coche), el ratón y el teclado no cambian.
 *
 * Nada por frame en la reactividad de Vue: `hud` solo cambia mientras dura el gesto del reloj (al ritmo del dedo).
 */
import type { Ref, ShallowRef } from 'vue'
import { DoubleTap } from '~/engine/gestures/doubleTap'
import { classifyTwoFinger, type FingerPair, fingerMidX, fingerSpan, scrubOffsetMs, type TwoFingerKind } from '~/engine/gestures/twoFinger'
import { createTimelinePreview, PREVIEW_EXT, type PreviewAt } from '~/engine/timeline/preview'
import { registerSceneStat } from '~/replay/debug'
import type { ReplayRuntime } from '~/replay/runtime'
import { getRuntime, usePlaybackStore } from '~/stores/playback'

/** Extensión del runtime (`rt.ext`) con el detector de doble toque, compartido por la escena, el lienzo y las siglas. */
export const DOUBLE_TAP_EXT = 'gestures:doubleTap'

/** Un toque: dónde (px CSS de la página) y cuándo (`timeStamp` del evento, ms). */
export interface TapPoint {
  readonly x: number
  readonly y: number
  readonly t: number
}

/** Lo que enseña la escena mientras dos dedos mueven el reloj. */
export interface ScrubHud {
  /** Lo que pasaba en el instante actual (la tarjeta de la vista previa del timeline). */
  readonly at: PreviewAt
  /** Cuánto se ha movido el reloj con este gesto (ms; negativo hacia atrás). */
  readonly offsetMs: number
  /** Ancho de la escena (px): la tarjeta se centra en él. */
  readonly width: number
}

export interface SceneGestureOptions {
  /** Raíz de la escena (`.tz-scene`): lienzo y siglas. */
  readonly root: Readonly<Ref<HTMLElement | null>>
  /** Cámara de seguimiento: el pellizco cambia su distancia mientras sigue a un coche. */
  readonly follow: {
    readonly active: () => boolean
    readonly distance: () => number
    readonly zoom: (distance: number) => void
  }
}

/** Un toque: el dedo o el botón se levanta cerca de donde bajó y pronto. */
const TAP_SLOP_PX = 10
const TAP_MAX_MS = 500
/** Marcadores de la tarjeta: los que el timeline enseñaría a esta distancia (px) del instante, como su vista previa. */
const PREVIEW_MARKER_PX = 8

type Phase = 'idle' | 'pending' | TwoFingerKind

const doubleTap = (rt: ReplayRuntime) => rt.ext(DOUBLE_TAP_EXT, () => new DoubleTap())

/** Doble toque: elige el coche y la cámara lo sigue (las mismas acciones que la clasificación y «Seguir»). */
function followCar(playback: ReturnType<typeof usePlaybackStore>, car: string) {
  playback.selectCar(car)
  playback.setFollowing(true)
}

/**
 * Toque o clic sobre un coche (el proxy del lienzo o la sigla): lo elige o lo deja como siempre, salvo que ese toque
 * complete un doble toque (lo sigue) o ya lo haya completado la escena (nada: no se deselecciona).
 */
export function useCarTap(): (car: string, at: TapPoint) => void {
  const rt = getRuntime()!
  const playback = usePlaybackStore()
  const taps = doubleTap(rt)
  return (car, at) => {
    const r = taps.car(car, at.x, at.y, at.t)
    if (r.kind === 'double') followCar(playback, r.car)
    else if (r.kind === 'single') playback.selectCar(playback.selectedCar === car ? null : car)
  }
}

export function useSceneGestures(opts: SceneGestureOptions): { hud: ShallowRef<ScrubHud | null> } {
  const rt = getRuntime()!
  const clock = rt.clock
  const playback = usePlaybackStore()
  const taps = doubleTap(rt)
  const hud = shallowRef<ScrubHud | null>(null)

  // --- Toques (doble toque) ---
  const downs = new Map<number, { x: number; y: number; t: number }>()
  /** Hubo más de un puntero a la vez en esta secuencia: ninguno de sus levantamientos es un toque. */
  let multi = false

  // --- Dos dedos ---
  const touches = new Map<number, { x: number; y: number }>()
  let phase: Phase = 'idle'
  let pair: [number, number] | null = null
  const start: FingerPair = { ax: 0, ay: 0, bx: 0, by: 0 }
  const now: FingerPair = { ax: 0, ay: 0, bx: 0, by: 0 }
  /** Último gesto de dos dedos decidido (para los e2e). */
  let last: TwoFingerKind | null = null

  function pairDown(): boolean {
    return !!pair && touches.has(pair[0]) && touches.has(pair[1])
  }

  function read(out: FingerPair): FingerPair {
    const a = touches.get(pair![0])!
    const b = touches.get(pair![1])!
    out.ax = a.x
    out.ay = a.y
    out.bx = b.x
    out.by = b.y
    return out
  }

  function begin() {
    const ids = [...touches.keys()]
    pair = [ids[0]!, ids[1]!]
    read(start)
    phase = 'pending'
    pinchBase = null
    taps.reset()
  }

  // Reloj: un seek por frame de pantalla, con lo que pidan los dedos desde que empezó el gesto.
  let width = 0
  let baseMidX = 0
  /** Lo que los dedos han pedido hasta ahora y lo que el reloj se ha movido de verdad (con los extremos de la sesión). */
  let requested = 0
  let applied = 0
  let toleranceMs = 0
  let raf = 0
  let preview: ReturnType<typeof createTimelinePreview> | null = null

  function startScrub() {
    width = opts.root.value?.clientWidth ?? 0
    baseMidX = fingerMidX(start)
    requested = 0
    applied = 0
    const timeline = document.querySelector('[data-testid="timeline"]')?.getBoundingClientRect().width ?? 0
    const basis = timeline > 0 ? timeline : width
    toleranceMs = basis > 0 ? (PREVIEW_MARKER_PX / basis) * clock.duration : 0
  }

  function applyScrub() {
    if (phase !== 'scrub' || !pairDown()) return
    const goal = scrubOffsetMs(fingerMidX(read(now)) - baseMidX, width)
    const delta = goal - requested
    requested = goal
    if (delta !== 0) {
      const before = clock.timeMs
      clock.seekBy(delta)
      applied += clock.timeMs - before
    }
    preview ??= rt.ext(PREVIEW_EXT, createTimelinePreview)
    hud.value = { at: preview.at(clock.timeMs, toleranceMs), offsetMs: applied, width }
  }

  function flush() {
    raf = 0
    applyScrub()
  }

  function schedule() {
    if (!raf) raf = requestAnimationFrame(flush)
  }

  function endScrub() {
    cancelAnimationFrame(raf)
    raf = 0
    hud.value = null
  }

  // Pellizco siguiendo a un coche: la distancia de la cámara cambia en proporción a la separación de los dedos.
  let pinchBase: { distance: number; span: number } | null = null

  function pinchMove() {
    if (!pinchBase || !pairDown() || !opts.follow.active()) return
    opts.follow.zoom((pinchBase.distance * pinchBase.span) / Math.max(1, fingerSpan(read(now))))
  }

  // --- Oyentes ---
  // `pointerdown`, en captura sobre la raíz: solo cuentan los punteros que empiezan en la escena. El resto, en captura
  // sobre `window` (antes que nadie, también antes que los controles del mapa, que escuchan en el documento) y solo para
  // esos punteros, pasen por donde pasen después (el ratón, al soltar fuera de la escena).
  function onPointerDown(e: PointerEvent) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (e.pointerType === 'touch' && e.isPrimary) {
      // Primer dedo de una secuencia nueva: lo de antes ya terminó (aunque se perdiera algún evento).
      if (phase === 'scrub') endScrub()
      touches.clear()
      downs.clear()
      multi = false
      phase = 'idle'
      pair = null
    }
    downs.set(e.pointerId, { x: e.clientX, y: e.clientY, t: e.timeStamp })
    if (downs.size > 1) multi = true
    if (e.pointerType !== 'touch') return
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (touches.size === 2 && phase !== 'scrub') begin()
    else if (touches.size > 2 && phase === 'pending') phase = 'map' // tres dedos: de los controles del mapa
  }

  function onPointerMove(e: PointerEvent) {
    if (e.pointerType !== 'touch') return
    const p = touches.get(e.pointerId)
    if (!p) return
    p.x = e.clientX
    p.y = e.clientY
    if (phase === 'scrub') {
      e.stopPropagation()
      schedule()
      return
    }
    if (phase === 'pending' && pairDown()) {
      // Retenido hasta decidir. Se decide en el frame, con los dos dedos al día: el navegador entrega el movimiento de
      // cada dedo en su propio `pointermove`, uno detrás de otro, y decidir con el primero (el otro aún en su sitio
      // anterior) haría pellizco de un deslizamiento rápido de dos dedos en paralelo.
      e.stopPropagation()
      if (!decideRaf) decideRaf = requestAnimationFrame(decide)
      return
    }
    if (phase === 'pinch') pinchMove()
  }

  let decideRaf = 0
  /** Qué gesto es, con lo último de los dos dedos (una vez por frame, mientras no se sabe). */
  function decide() {
    decideRaf = 0
    if (phase !== 'pending' || !pairDown()) return
    const kind = classifyTwoFinger(start, read(now))
    if (kind === null) return // aún no se han movido lo bastante: el siguiente movimiento lo vuelve a intentar
    phase = kind
    last = kind
    if (kind === 'scrub') {
      startScrub()
      applyScrub()
      return
    }
    if (kind === 'pinch' && opts.follow.active()) {
      pinchBase = { distance: opts.follow.distance(), span: fingerSpan(start) }
      pinchMove()
    }
  }

  function onPointerUp(e: PointerEvent) {
    const d = downs.get(e.pointerId)
    if (!d) return // un puntero que no empezó en la escena
    downs.delete(e.pointerId)
    const tap =
      e.type === 'pointerup' &&
      !multi &&
      e.timeStamp - d.t <= TAP_MAX_MS &&
      Math.hypot(e.clientX - d.x, e.clientY - d.y) <= TAP_SLOP_PX
    if (downs.size === 0) multi = false
    if (tap) {
      const car = taps.tap(e.clientX, e.clientY, e.timeStamp)
      if (car) followCar(playback, car)
    }

    const p = touches.get(e.pointerId)
    if (!p) return
    if (phase === 'scrub' && pair?.includes(e.pointerId)) {
      // El último tramo del dedo que se levanta cuenta; después, el gesto termina (aunque quede el otro dedo).
      p.x = e.clientX
      p.y = e.clientY
      cancelAnimationFrame(raf)
      raf = 0
      applyScrub()
      endScrub()
    }
    touches.delete(e.pointerId)
    if (touches.size === 0) {
      phase = 'idle'
      pair = null
    } else if (phase !== 'scrub' && touches.size < 2) {
      // Queda un dedo: es de los controles del mapa (con otro más, se vuelve a decidir).
      phase = 'idle'
      pair = null
    }
  }

  /**
   * Safari: aunque `touch-action: none` ya evita que la página haga zoom o se desplace, con dos dedos se cancela también
   * el gesto nativo (como hacía el zoom de seguimiento). No afecta a los Pointer Events.
   */
  function onTouchMove(e: TouchEvent) {
    if (e.touches.length >= 2 && e.cancelable) e.preventDefault()
  }

  const WINDOW_LISTENERS = [
    ['pointermove', onPointerMove],
    ['pointerup', onPointerUp],
    ['pointercancel', onPointerUp],
  ] as const

  let el: HTMLElement | null = null
  let offStat: (() => void) | null = null
  onMounted(() => {
    el = opts.root.value
    el?.addEventListener('pointerdown', onPointerDown, { capture: true })
    el?.addEventListener('touchmove', onTouchMove, { passive: false })
    for (const [type, fn] of WINDOW_LISTENERS) window.addEventListener(type, fn, { capture: true })
    // Para los e2e (`window.__trazada.scene.gestures`): el gesto en curso y el último decidido.
    offStat = registerSceneStat('gestures', () => ({ phase, last, offsetMs: hud.value?.offsetMs ?? null }))
  })
  onBeforeUnmount(() => {
    cancelAnimationFrame(decideRaf)
    decideRaf = 0
    el?.removeEventListener('pointerdown', onPointerDown, { capture: true })
    el?.removeEventListener('touchmove', onTouchMove)
    for (const [type, fn] of WINDOW_LISTENERS) window.removeEventListener(type, fn, { capture: true })
    el = null
    endScrub()
    offStat?.()
  })

  return { hud }
}
