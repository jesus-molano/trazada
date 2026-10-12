/**
 * Preparación de la escena antes de cada render: un único gancho en el bucle de TresJS para toda la escena, que
 * llama a lo que registran pista, banderas, coches, capas y la anchura de mapa SOLO cuando hay un render pendiente.
 *
 * Por qué no `useLoop().onBeforeRender` en cada componente: en TresJS 5 ese gancho cuelga del bucle de
 * requestAnimationFrame y salta en cada tick, también en pausa y con la escena tapada (`rt.setSceneHidden`), aunque el
 * modo on-demand no dibuje nada; y cada `useLoop()` cuesta, en cada tick, dos copias de objeto y dos `Promise.all`. Con
 * esto, en pausa y sin nada que pintar la escena no calcula ni sube nada a la GPU, y hay un solo gancho por tick.
 *
 * - `useSceneFrame(cb)` (dentro de TresCanvas): `cb` corre justo antes de cada render, en el orden en que se
 *   registraron (el de montaje). Lo que cambie la escena debe pedir el frame por su lado (`rt.requestFrame()`,
 *   `invalidate`): la preparación va detrás, nunca lo pide.
 * - `useSceneFrame(cb, { everyTick: true })`: en cada tick, antes que los demás, con `frame.pending` (¿ya hay render
 *   pendiente?). Solo para quien se anima a sí mismo y pide frames desde aquí (la cámara al seguir a un coche o en la
 *   realización); si pide uno, los demás se preparan para él en el mismo tick.
 *
 * TzScene crea el registro (`provideSceneFrames`) y lo engancha al bucle de cada lienzo en `@ready` (`attach`).
 */
import type { Camera } from 'three'
import { inject, type InjectionKey, onScopeDispose, provide } from 'vue'

export interface SceneFrame {
  /** Cámara activa del lienzo. */
  camera: Camera | undefined
  /** Segundos desde el tick anterior (reloj de TresJS). */
  delta: number
  /** Hay un render pendiente en este tick (con `everyTick`, antes de que corran los ganchos de cada tick). */
  pending: boolean
}

export type SceneFrameCallback = (frame: SceneFrame) => void

export interface SceneFrameOptions {
  /** En cada tick, haya render o no (ver arriba). Por defecto, solo antes de cada render. */
  everyTick?: boolean
}

/** Lo que el registro necesita del contexto de TresJS (`TresContext`; así se prueba sin lienzo). */
export type SceneFrameHost = {
  camera: { activeCamera: { readonly value: Camera | undefined } }
  renderer: {
    canBeInvalidated: { readonly value: boolean }
    loop: { onBeforeLoop: (fn: (c: { delta: number }) => void) => { off: () => void } }
  }
}

export interface SceneFrames {
  /** Registra `cb`; devuelve la baja. */
  add(cb: SceneFrameCallback, options?: SceneFrameOptions): () => void
  /** Engancha el registro al bucle de un lienzo (un solo gancho); devuelve la baja. */
  attach(host: SceneFrameHost): () => void
  /** Ticks del bucle y cuántos acabaron en preparación (render pendiente): `sceneStats.frameHooks`. */
  readonly stats: { readonly ticks: number; readonly prepared: number }
}

export function createSceneFrames(): SceneFrames {
  const everyTick = new Set<SceneFrameCallback>()
  const beforeRender = new Set<SceneFrameCallback>()
  const frame: SceneFrame = { camera: undefined, delta: 0, pending: false }
  const stats = { ticks: 0, prepared: 0 }

  function tick(host: SceneFrameHost, delta: number) {
    stats.ticks++
    frame.camera = host.camera.activeCamera.value
    frame.delta = delta
    // Modo on-demand: `canBeInvalidated` es false justo cuando hay un frame pendiente (frames > 0).
    frame.pending = !host.renderer.canBeInvalidated.value
    for (const cb of everyTick) cb(frame)
    if (host.renderer.canBeInvalidated.value) return
    frame.pending = true
    stats.prepared++
    for (const cb of beforeRender) cb(frame)
  }

  return {
    add(cb, options) {
      const set = options?.everyTick ? everyTick : beforeRender
      set.add(cb)
      return () => void set.delete(cb)
    },
    attach(host) {
      const { off } = host.renderer.loop.onBeforeLoop(({ delta }) => tick(host, delta))
      return off
    },
    stats,
  }
}

const KEY: InjectionKey<SceneFrames> = Symbol('tz-scene-frames')

/** Crea el registro de la escena y lo ofrece a lo que va dentro de TresCanvas (TzScene). */
export function provideSceneFrames(): SceneFrames {
  const frames = createSceneFrames()
  provide(KEY, frames)
  return frames
}

/** Registra `cb` en la escena (ver arriba) mientras viva el componente. Va dentro de TresCanvas, bajo TzScene. */
export function useSceneFrame(cb: SceneFrameCallback, options?: SceneFrameOptions): void {
  const frames = inject(KEY, null)
  if (!frames) throw new Error('useSceneFrame: va dentro de TzScene (provideSceneFrames)')
  onScopeDispose(frames.add(cb, options))
}
