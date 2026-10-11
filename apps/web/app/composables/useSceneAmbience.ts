/**
 * Ambiente de la escena (ítem 10, D37), compartido por el cielo y la niebla (`scene-layers/TzSky.vue`), el tono
 * nocturno de la pista (`TzTrack.vue`) y su herramienta (`scene-tools/TzAmbienceTool.vue`): uno por runtime
 * (`rt.ext`), así que vive y muere con la sesión.
 *
 * La posición del sol sale de la hora UTC de la sesión (`t0Utc` + reloj maestro) y del centro del circuito
 * (`venues/outlines.ts`, de bacinger/f1-circuits); nunca de `gmtOffset`. Sin posición del circuito o sin hora válida,
 * `look()` devuelve null y la escena se queda neutra. Lo que pinta cambia por pasos de sol (`SUN_STEP_DEG`): quien lo
 * usa en cada render solo toca la escena cuando cambia el objeto que recibe. Nada de esto es reactivo: la escena lo lee
 * en cada render; la preferencia «Ambiente» (Pinia) se copia en `enabled` y pide un frame.
 */
import { watch } from 'vue'
import { token } from '~/design/tokens'
import {
  type AmbienceLook,
  ambienceLook,
  ambiencePalette,
  type AmbienceStatus,
  ambienceSource,
  quantizeSun,
  sunAt,
} from '~/engine/ambience/ambience'
import type { ReplayRuntime } from '~/replay/runtime'
import { useAmbienceStore } from '~/stores/ambience'
import { getRuntime } from '~/stores/playback'
import { centerFor } from '~/venues/outlines'

export const AMBIENCE_EXT = 'ambience'

export interface SceneAmbience {
  /** `ok`, o por qué no hay ambiente: sin posición del circuito (`no-location`) o sin hora válida (`no-time`). */
  readonly status: AmbienceStatus
  /** Preferencia del usuario (la copia `useSceneAmbience` desde el store). */
  enabled: boolean
  /** Altura del sol (°) en el tiempo de sesión `timeMs`, sin redondear; null sin posición o sin hora. */
  sunAt(timeMs: number): number | null
  /** Lo que pinta la escena en `timeMs`; null si está apagado o no hay dato (escena neutra). Mismo objeto por paso. */
  look(timeMs: number): AmbienceLook | null
}

export function createSceneAmbience(rt: ReplayRuntime): SceneAmbience {
  // Un manifest sin estos campos (runtimes de prueba) se queda sin ubicación: escena neutra.
  const s = rt.session?.manifest?.session
  const center = s && typeof s.slug === 'string' ? centerFor(s.season, s.round, s.slug) : null
  const source = ambienceSource(typeof s?.t0Utc === 'string' ? s.t0Utc : '', center)
  // Los tokens son #rrggbb (lo comprueba engine/ambience/ambience.test.ts): sin ellos no se pinta nada a medias.
  const palette = ambiencePalette(token)
  let cached: AmbienceLook | null = null
  const amb: SceneAmbience = {
    status: source.status,
    enabled: true,
    sunAt: (timeMs) => sunAt(source, timeMs),
    look(timeMs) {
      if (!amb.enabled || !palette) return null
      const sun = sunAt(source, timeMs)
      if (sun === null) return null
      const q = quantizeSun(sun)
      if (cached?.sunDeg !== q) cached = ambienceLook(q, palette)
      return cached
    },
  }
  return amb
}

/**
 * Ambiente de la sesión activa, sincronizado con la preferencia «Ambiente»; null sin sesión cargada. Se llama en el
 * setup de un componente.
 */
export function useSceneAmbience(): SceneAmbience | null {
  const rt = getRuntime()
  if (!rt) return null
  const amb = rt.ext(AMBIENCE_EXT, createSceneAmbience)
  const store = useAmbienceStore()
  store.hydrate()
  watch(
    () => store.on,
    (on) => {
      if (amb.enabled === on) return
      amb.enabled = on
      rt.requestFrame()
    },
    { immediate: true },
  )
  return amb
}
