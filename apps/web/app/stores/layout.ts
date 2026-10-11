import { defineStore } from 'pinia'
import { type LayoutPanel, sanitizeWidth } from '~/engine/layout/clamp'
import { isLayoutPreset, type LayoutPreset } from '~/engine/layout/presets'
import { defaultLayoutState, isCustomized, LAYOUT_VERSION, type LayoutState, sanitizeLayout } from '~/engine/layout/state'
import { persisted } from './persisted'

const KEY = 'trazada.layout'

/** Por navegador (D41), con versión: lo guardado con otra versión del formato se ignora; lo demás se valida campo a campo. */
const saved = persisted<LayoutState>(KEY, { version: LAYOUT_VERSION })

/**
 * Atributo que pone el asa de un panel en la raíz del replay mientras se arrastra: la escena no reencuadra hasta
 * soltarla (TzScene). Al soltar (o al cambiar el ancho con el teclado), el asa avisa con `LAYOUT_SETTLED_EVENT`.
 */
export const RESIZING_ATTR = 'data-resizing'
export const LAYOUT_SETTLED_EVENT = 'tz:layout-settled'

/**
 * Diseño del replay (ítem 15, D44): «Espectador» o «Análisis», y de cada uno los anchos elegidos con las asas y si la
 * dirección de carrera está abierta. Solo estado grueso (cambia al soltar un asa o al pulsar un botón, nunca por
 * frame ni por cada movimiento del puntero).
 */
export const useLayoutStore = defineStore('layout', () => {
  const state = reactive<LayoutState>(defaultLayoutState())
  let hydrated = false

  /** Lee lo guardado una vez (en el cliente, ya montada la página: el HTML prerenderizado es el de por defecto). */
  function hydrate(): void {
    if (hydrated) return
    hydrated = true
    Object.assign(state, sanitizeLayout(saved.read()))
  }

  /** Guarda todo (si el almacenamiento no está, el diseño vive solo en memoria). */
  function persist(): void {
    hydrated = true
    saved.write({ preset: state.preset, presets: JSON.parse(JSON.stringify(state.presets)) as LayoutState['presets'] })
  }

  const preset = computed(() => state.preset)
  /** Lo del diseño elegido. */
  const current = computed(() => state.presets[state.preset])
  /** ¿Algún ancho del diseño elegido lo ha puesto el usuario? */
  const customized = computed(() => isCustomized(current.value))

  function setPreset(value: LayoutPreset): void {
    if (!isLayoutPreset(value) || value === state.preset) return
    state.preset = value
    persist()
  }

  function togglePreset(): void {
    setPreset(state.preset === 'spectator' ? 'analysis' : 'spectator')
  }

  /** Ancho elegido de un panel del diseño actual (px) o null (el de por defecto). Lo que no vale, también null. */
  function setWidth(panel: LayoutPanel, px: number | null): void {
    const value = px === null ? null : sanitizeWidth(px)
    if (state.presets[state.preset][panel] === value) return
    state.presets[state.preset][panel] = value
    persist()
  }

  /** Vuelve a los anchos por defecto del diseño actual. */
  function resetWidths(): void {
    if (!customized.value) return
    state.presets[state.preset].lb = null
    state.presets[state.preset].side = null
    persist()
  }

  function setRcOpen(open: boolean): void {
    if (state.presets[state.preset].rcOpen === open) return
    state.presets[state.preset].rcOpen = open
    persist()
  }

  return { preset, current, customized, hydrate, setPreset, togglePreset, setWidth, resetWidths, setRcOpen }
})
