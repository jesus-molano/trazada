/**
 * Guía de primer uso del replay (ítem 18): unas burbujas no modales que enseñan la clasificación, seguir un coche, la
 * línea de tiempo y su vista previa, qué es «Estimado», el análisis y los comandos. Se ven solas una vez por navegador
 * (1 s después de «listo», `replay-overlays/TzTips.vue`) y se reabren con el botón «?» de la cabecera, la tecla «?» o
 * la paleta de comandos («guía»).
 *
 * Lo visto se guarda en `trazada.tips` (D41, con el helper `persisted`): `{ "seen": [ids] }`, o `{ "all": true }`,
 * que las da todas por vistas, también las que añadan versiones futuras (lo que dejan los e2e que no prueban la guía,
 * `tests/e2e/helpers.ts`). La versión va por pasos: cada paso tiene un id estable y una versión nueva de la guía que
 * añade pasos enseña solo esos (para volver a enseñar uno que cambia mucho, se le cambia el id). Lo guardado se valida
 * campo a campo: con el JSON roto o sin almacenamiento, la guía sale como la primera vez y lo visto vive en memoria.
 *
 * No enseña ningún dato de la sesión: el ejemplo de «Estimado» se rotula como ejemplo, nunca como dato.
 */
import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { persisted } from './persisted'

export const TIPS_KEY = 'trazada.tips'

/** Pasos de la guía, en orden. El id es también su versión: lo visto se guarda por id. */
export const TIP_IDS = ['leaderboard', 'follow', 'timeline', 'estimated', 'analysis', 'palette'] as const
export type TipId = (typeof TIP_IDS)[number]

/** Lo que se guarda en `trazada.tips`. */
export interface SavedTips {
  /** Todas vistas, también las de versiones futuras. */
  all: boolean
  /** Ids de los pasos vistos o saltados (también de otras versiones de la guía: no se pierden). */
  seen: string[]
}

/** Lo visto, ya validado. */
export interface TipsSeen {
  readonly all: boolean
  readonly seen: ReadonlySet<string>
}

/** De lo guardado (parcial, sin validar: puede venir de otra versión o de otra mano) a lo visto. */
export function readTips(raw: Partial<SavedTips>): TipsSeen {
  const all = raw.all === true
  const seen = new Set(Array.isArray(raw.seen) ? raw.seen.filter((x): x is string => typeof x === 'string' && x !== '') : [])
  return { all, seen }
}

/** Pasos que aún no se han visto, en el orden de la guía. */
export function pendingTips(state: TipsSeen, ids: readonly TipId[] = TIP_IDS): TipId[] {
  return state.all ? [] : ids.filter((id) => !state.seen.has(id))
}

/** Lo visto, con estos pasos además. */
export function markSeen(state: TipsSeen, ids: readonly string[]): TipsSeen {
  if (state.all) return state
  return { all: false, seen: new Set([...state.seen, ...ids]) }
}

/** Lo que se escribe (solo lo necesario: `{ all: true }` o `{ seen }`). */
export function toSaved(state: TipsSeen): Partial<SavedTips> {
  return state.all ? { all: true } : { seen: [...state.seen] }
}

/** Cómo se abrió la guía: sola (la primera vez, solo con lo no visto) o a petición (entera). */
export type TipsMode = 'auto' | 'manual'

/** Sin versión de formato: `{ all: true }` (sin `_v`) es lo que guardan los e2e y tiene que seguir valiendo. */
const saved = persisted<SavedTips>(TIPS_KEY)

/** Estado de la guía: si está abierta, sus pasos y el actual (estado grueso: cambia al pulsar, nunca por frame). */
export const useTipsStore = defineStore('tips', () => {
  /** Pasos de la guía abierta (vacío: cerrada). */
  const steps = shallowRef<readonly TipId[]>([])
  const index = ref(0)
  const mode = ref<TipsMode>('manual')

  const open = computed(() => steps.value.length > 0)
  const current = computed<TipId | null>(() => steps.value[index.value] ?? null)
  const total = computed(() => steps.value.length)
  const last = computed(() => open.value && index.value === steps.value.length - 1)

  /** Pasos sin ver, leídos de nuevo cada vez (otra pestaña puede haber visto la guía). */
  function pending(): TipId[] {
    return pendingTips(readTips(saved.read()))
  }

  /** Apunta pasos como vistos, fusionando con lo que haya guardado ahora. */
  function remember(ids: readonly string[]): void {
    if (!ids.length) return
    saved.write(toSaved(markSeen(readTips(saved.read()), ids)))
  }

  /**
   * Abre la guía. `auto`: solo con pasos sin ver, y solo esos (una versión nueva enseña solo lo nuevo); `manual`: entera,
   * desde el principio. Ya abierta, no hace nada. ¿Está abierta después?
   */
  function start(how: TipsMode): boolean {
    if (open.value) return true
    const list = how === 'auto' ? pending() : [...TIP_IDS]
    if (!list.length) return false
    mode.value = how
    index.value = 0
    steps.value = list
    return true
  }

  /** «Siguiente»: el paso actual queda visto; en el último, termina. */
  function next(): void {
    const id = current.value
    if (id === null) return
    remember([id])
    if (index.value + 1 < steps.value.length) index.value++
    else close()
  }

  /** «Anterior». */
  function prev(): void {
    if (index.value > 0) index.value--
  }

  /** «Saltar» (o Esc, o terminar): todos los pasos de esta guía quedan vistos y se cierra. */
  function skip(): void {
    remember(steps.value)
    close()
  }

  /** Cierra sin apuntar nada más (al salir del replay a mitad: lo no visto vuelve la próxima vez). */
  function close(): void {
    steps.value = []
    index.value = 0
  }

  /** El botón «?» y la tecla «?»: la abre entera o, abierta, la salta. */
  function toggle(): void {
    if (open.value) skip()
    else start('manual')
  }

  return { steps, index, mode, open, current, total, last, pending, start, next, prev, skip, close, toggle }
})
