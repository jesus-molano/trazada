/** Lado del hilo principal: lanza el Web Worker de carga y traduce sus mensajes. */
import type { Manifest } from '@trazada/schema'
import { LoadError, type LoadedSession, type LoadStage, type WorkerRequest, type WorkerResponse } from './types'

export interface ClientLoadOptions {
  onProgress?: (stage: LoadStage, loaded: number, total: number) => void
  onManifest?: (manifest: Manifest) => void
  signal?: AbortSignal
}

export function loadSessionInWorker(
  manifestUrl: string,
  id: string,
  readerVersion: string,
  opts: ClientLoadOptions = {},
): Promise<LoadedSession> {
  return new Promise((resolve, reject) => {
    // Con la señal ya cancelada, su evento 'abort' no volvería a saltar y el worker cargaría la sesión entera.
    if (opts.signal?.aborted) {
      reject(new DOMException('carga cancelada', 'AbortError'))
      return
    }
    const worker = new Worker(new URL('../workers/session.worker.ts', import.meta.url), {
      type: 'module',
      name: 'trazada-session',
    })
    const finish = () => {
      worker.terminate()
      opts.signal?.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      finish()
      reject(new DOMException('carga cancelada', 'AbortError'))
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data
      if (msg.type === 'progress') opts.onProgress?.(msg.stage, msg.loaded, msg.total)
      else if (msg.type === 'manifest') opts.onManifest?.(msg.manifest)
      else if (msg.type === 'ready') {
        finish()
        resolve(msg.session)
      } else if (msg.type === 'error') {
        finish()
        reject(new LoadError(msg.code, msg.message))
      }
    }
    worker.onerror = (event) => {
      finish()
      reject(new LoadError('decode', event.message || 'error en el Web Worker de carga'))
    }
    const req: WorkerRequest = { type: 'load', manifestUrl, id, readerVersion }
    worker.postMessage(req)
  })
}
