/**
 * Estado por navegador en localStorage (D41), con el patrón de las preferencias (`settings.ts`): leer nunca falla
 * (sin almacenamiento, en SSR, con el JSON roto o con otra versión del formato, devuelve `{}`) y escribir nunca
 * lanza (en modo privado o con el almacenamiento lleno, el valor vive solo en memoria de quien lo usa). Lo leído
 * puede venir de otra versión de la app o de otra mano: quien lo usa valida campo a campo antes de aplicarlo.
 *
 * Claves `trazada.<algo>`. Cada dispositivo guarda lo suyo: nada se sincroniza (D26).
 */

export interface PersistedOptions {
  /**
   * Versión del formato. Lo guardado con otra versión (o sin ella) se ignora, como si no hubiera nada. Sin versión,
   * el objeto se guarda tal cual (así está `trazada.settings`).
   */
  version?: number
  /** Almacenamiento; por defecto, `localStorage`. Los tests inyectan uno propio. */
  storage?: () => Storage | null | undefined
}

export interface Persisted<T extends object> {
  readonly key: string
  /** Lo guardado (parcial y sin validar). */
  read(): Partial<T>
  /** Fusiona `patch` con lo guardado (nivel superior) y lo escribe. */
  patch(patch: Partial<T>): void
  /** Sustituye todo lo guardado. */
  write(value: Partial<T>): void
  clear(): void
}

/** Campo reservado con la versión del formato, cuando la hay. */
export const VERSION_FIELD = '_v'

function defaultStorage(): Storage | undefined {
  // En SSR no hay `localStorage`; con el almacenamiento bloqueado, leer la propiedad ya lanza.
  return typeof localStorage === 'undefined' ? undefined : localStorage
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

export function persisted<T extends object>(key: string, options: PersistedOptions = {}): Persisted<T> {
  const { version } = options
  const storage = (): Storage | null | undefined => {
    try {
      return (options.storage ?? defaultStorage)()
    } catch {
      return null
    }
  }

  function read(): Partial<T> {
    try {
      const raw = storage()?.getItem(key)
      if (raw == null) return {}
      const value: unknown = JSON.parse(raw)
      if (!isRecord(value)) return {}
      if (version === undefined) return value as Partial<T>
      if (value[VERSION_FIELD] !== version) return {}
      const { [VERSION_FIELD]: _version, ...rest } = value
      return rest as Partial<T>
    } catch {
      return {}
    }
  }

  function write(value: Partial<T>): void {
    try {
      storage()?.setItem(key, JSON.stringify(version === undefined ? value : { ...value, [VERSION_FIELD]: version }))
    } catch {
      // almacenamiento no disponible (modo privado) o lleno: el valor vive solo en memoria
    }
  }

  return {
    key,
    read,
    write,
    patch: (patch) => write({ ...read(), ...patch }),
    clear() {
      try {
        storage()?.removeItem(key)
      } catch {
        // nada que borrar si no hay almacenamiento
      }
    },
  }
}
