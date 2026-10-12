/**
 * Compila los textos del idioma en ratos libres. En la build estática, los mensajes llegan como cadenas
 * (/_i18n/…/messages.json) y vue-i18n los compila la primera vez que se usa cada uno: al abrir el replay eran cientos de
 * golpe, dentro de las tareas de montaje (perf.spec, CPU ×4). Aquí se recorren todas las claves con `t()` en trozos de
 * ≤ 4 ms con requestIdleCallback (la caché de vue-i18n es global), y otra vez al cambiar de idioma. En desarrollo no
 * hace falta (los mensajes ya van compilados).
 */
type Messages = { [key: string]: unknown }

/** Claves (con puntos) de los textos de un árbol de mensajes. */
function messageKeys(tree: Messages, prefix = ''): string[] {
  const out: string[] = []
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out.push(key)
    else if (v && typeof v === 'object') out.push(...messageKeys(v as Messages, key))
  }
  return out
}

/** Lo máximo que dura cada trozo (ms): un clic o una tecla esperan como mucho esto. */
const SLICE_MS = 4

export default defineNuxtPlugin((nuxtApp) => {
  // En los tests de nuxt tampoco: los avisos de vue-i18n saldrían con el entorno ya cerrado.
  if (import.meta.dev || import.meta.test || typeof requestIdleCallback !== 'function') return
  const i18n = nuxtApp.$i18n
  let run = 0

  function warm(locale: string) {
    const id = ++run
    const keys = messageKeys(i18n.getLocaleMessage(locale) as Messages)
    if (!keys.length) return
    let i = 0
    const step = (deadline: IdleDeadline) => {
      if (id !== run || i18n.locale.value !== locale) return
      const end = performance.now() + SLICE_MS
      // Al menos una clave por vuelta (un reloj falso puede dar siempre 0 ms libres) y sin cortar la cadena si un
      // mensaje no compila: ya fallará donde se use.
      do {
        try {
          i18n.t(keys[i]!)
        } catch {
          // mensaje con sintaxis inválida
        }
        i++
      } while (i < keys.length && deadline.timeRemaining() > 1 && performance.now() < end)
      if (i < keys.length) requestIdleCallback(step)
    }
    requestIdleCallback(step)
  }

  nuxtApp.hook('app:mounted', () => warm(i18n.locale.value))
  nuxtApp.hook('i18n:localeSwitched', ({ newLocale }) => warm(newLocale))
})
