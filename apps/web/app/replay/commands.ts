/**
 * Servicios de la paleta de comandos (ítem 14, D29/D43): los comandos (`engine/commands/builtin/*.ts`) son TS puro y
 * no importan stores; actúan a través de los servicios que se registran aquí, como el registro de teclas
 * (`replay/keys.ts`). La paleta registra los de serie (reproducción, comparación, reanudar) y cada función nueva
 * registra el suyo donde tenga su estado (`registerCommandService('moments', …)`); un comando cuyo servicio no está
 * registrado no se ofrece. Sin Vue.
 */
import type { CommandServices, ServiceName } from '../engine/commands/types'

const registered = new Map<ServiceName, { impl: unknown }>()

/** Registra un servicio. Con el mismo nombre, manda el último. Devuelve la baja (que no quita uno posterior). */
export function registerCommandService<K extends ServiceName>(name: K, impl: CommandServices[K]): () => void {
  const entry = { impl }
  registered.set(name, entry)
  return () => {
    if (registered.get(name) === entry) registered.delete(name)
  }
}

/** Los servicios registrados ahora. */
export function commandServices(): Partial<CommandServices> {
  const out: Partial<Record<ServiceName, unknown>> = {}
  for (const [name, { impl }] of registered) out[name] = impl
  return out as Partial<CommandServices>
}
