/**
 * Web Worker de carga: descarga, verifica, descomprime y decodifica la sesión fuera del hilo principal
 * y transfiere los typed arrays (sin copias).
 */
import { loadSession, transferablesOf } from '../data/load-session'
import { LoadError, type LoadStage, type WorkerRequest, type WorkerResponse } from '../data/types'

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void
}

const scope = self as unknown as WorkerScope
const PROGRESS_INTERVAL_MS = 50

scope.onmessage = async (event) => {
  const req = event.data
  if (req.type !== 'load') return
  let lastPost = 0
  let lastStage: LoadStage | null = null
  try {
    const session = await loadSession(req.manifestUrl, req.id, req.readerVersion, {
      onManifest: (manifest) => scope.postMessage({ type: 'manifest', manifest }),
      onProgress: (stage, loaded, total) => {
        const t = performance.now()
        // Se limita la frecuencia: el hilo principal solo necesita ~20 actualizaciones por segundo.
        if (stage === lastStage && loaded < total && t - lastPost < PROGRESS_INTERVAL_MS) return
        lastPost = t
        lastStage = stage
        scope.postMessage({ type: 'progress', stage, loaded, total })
      },
    })
    scope.postMessage({ type: 'ready', session }, transferablesOf(session))
  } catch (err) {
    const code = err instanceof LoadError ? err.code : 'decode'
    scope.postMessage({ type: 'error', code, message: err instanceof Error ? err.message : String(err) })
  }
}
