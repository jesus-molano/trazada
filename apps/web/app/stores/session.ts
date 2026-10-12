import { type Manifest, SCHEMA_VERSION } from '@trazada/schema'
import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import { manifestPath, parseSessionId } from '~/data/session-id'
import { LoadError, type LoadedSession, type LoadErrorCode, type LoadStage } from '~/data/types'

export type SessionStatus = 'idle' | 'loading' | 'ready' | 'error'

/**
 * Estado *grueso* de la sesión cargada. Los datos (typed arrays) se guardan sin reactividad:
 * el motor los lee directamente y Vue nunca los recorre.
 */
export const useSessionStore = defineStore('session', () => {
  const id = ref<string | null>(null)
  const status = ref<SessionStatus>('idle')
  const stage = ref<LoadStage>('manifest')
  const progress = ref(0)
  const error = ref<{ code: LoadErrorCode; message: string } | null>(null)
  const manifest = shallowRef<Manifest | null>(null)
  const data = shallowRef<LoadedSession | null>(null)
  let controller: AbortController | null = null

  async function load(newId: string): Promise<void> {
    controller?.abort()
    controller = new AbortController()
    const signal = controller.signal
    id.value = newId
    status.value = 'loading'
    stage.value = 'manifest'
    progress.value = 0
    error.value = null
    manifest.value = null
    data.value = null
    if (!parseSessionId(newId)) {
      status.value = 'error'
      error.value = { code: 'not-found', message: `identificador de sesión inválido: ${newId}` }
      return
    }
    try {
      const { loadSessionInWorker } = await import('~/data/session-client')
      const session = await loadSessionInWorker(useDataUrl()(manifestPath(newId)), newId, SCHEMA_VERSION, {
        signal,
        onManifest: (m) => (manifest.value = markRaw(m)),
        onProgress: (s, loaded, total) => {
          stage.value = s
          // Descarga: 0–90 %; decodificación: 90–100 %.
          const f = total > 0 ? loaded / total : 0
          progress.value = s === 'manifest' ? 0 : s === 'download' ? 0.9 * f : 0.9 + 0.1 * f
        },
      })
      if (signal.aborted) return
      performance.mark('trazada:ready') // instante exacto de "listo": los datos están (medidas de rendimiento)
      // Se cede el hilo antes de montar el replay: pasar a «listo» arranca en microtareas el montaje de
      // todo (runtime, paneles, escena) y, en la misma tarea que trae los datos, era una tarea larga; así el navegador
      // puede atender un clic o una tecla entre medias.
      await new Promise((resolve) => setTimeout(resolve, 0))
      if (signal.aborted) return
      data.value = markRaw(session)
      progress.value = 1
      status.value = 'ready'
    } catch (err) {
      if (signal.aborted) return
      status.value = 'error'
      error.value =
        err instanceof LoadError
          ? { code: err.code, message: err.message }
          : { code: 'decode', message: err instanceof Error ? err.message : String(err) }
    }
  }

  function retry(): void {
    if (id.value) void load(id.value)
  }

  function unload(): void {
    controller?.abort()
    controller = null
    id.value = null
    status.value = 'idle'
    manifest.value = null
    data.value = null
    error.value = null
    progress.value = 0
  }

  return { id, status, stage, progress, error, manifest, data, load, retry, unload }
})
