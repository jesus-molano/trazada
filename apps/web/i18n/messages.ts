/**
 * Textos por namespace (D29): cada idioma es una carpeta (`locales/es/`, `locales/en/`) con un fichero por
 * namespace. `base.json` lleva los textos comunes y cada función nueva añade el suyo (`<ns>.json`, con una sola
 * raíz `<ns>`), para que varias personas puedan trabajar a la vez sin tocar el mismo fichero.
 *
 * Solo para Node: lo usan `nuxt.config.ts` (lista de ficheros de cada idioma) y los tests (mensajes fusionados).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type Messages = { [key: string]: string | Messages }

export const LOCALES_DIR = fileURLToPath(new URL('./locales', import.meta.url))
/** Namespace común: el único fichero con varias raíces. */
export const BASE_NAMESPACE = 'base'

/** Namespaces de un idioma (nombres de fichero sin `.json`), con `base` el primero y el resto en orden alfabético. */
export function namespaces(locale: string, dir = LOCALES_DIR): string[] {
  const names = readdirSync(join(dir, locale))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
  return names.sort((a, b) => (a === BASE_NAMESPACE ? -1 : b === BASE_NAMESPACE ? 1 : a.localeCompare(b)))
}

/** Ficheros de un idioma relativos a `locales/` (lo que espera `locales[].files` de @nuxtjs/i18n). */
export function localeFiles(locale: string, dir = LOCALES_DIR): string[] {
  return namespaces(locale, dir).map((ns) => `${locale}/${ns}.json`)
}

export function loadNamespace(locale: string, ns: string, dir = LOCALES_DIR): Messages {
  return JSON.parse(readFileSync(join(dir, locale, `${ns}.json`), 'utf8')) as Messages
}

/**
 * Mensajes de un idioma, fusionados como los fusiona @nuxtjs/i18n. Una raíz repetida en dos ficheros
 * sería una fusión silenciosa (y el segundo pisaría al primero): aquí es un error.
 */
export function loadMessages(locale: string, dir = LOCALES_DIR): Messages {
  const out: Messages = {}
  const owner = new Map<string, string>()
  for (const ns of namespaces(locale, dir)) {
    for (const [root, value] of Object.entries(loadNamespace(locale, ns, dir))) {
      const prev = owner.get(root)
      if (prev) throw new Error(`i18n ${locale}: la raíz «${root}» está en ${prev}.json y en ${ns}.json`)
      owner.set(root, ns)
      out[root] = value
    }
  }
  return out
}
