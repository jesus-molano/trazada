/**
 * Lo que se recuerda del diseño del replay por navegador (ítem 15, D41): el diseño elegido y, de cada diseño, los
 * anchos que puso el usuario (null = el de por defecto) y si la dirección de carrera está abierta. Se guarda en
 * `trazada.layout` con versión (stores/layout.ts); aquí, el formato y su validación campo a campo. TS puro.
 */
import { LAYOUT_PANELS, type LayoutPanel, sanitizeWidth } from './clamp'
import { isLayoutPreset, LAYOUT_PRESETS, type LayoutPreset } from './presets'

/** Versión del formato de `trazada.layout`: lo guardado con otra se ignora. */
export const LAYOUT_VERSION = 1

export interface PresetLayout {
  /** Anchos elegidos con el asa (px) o null (por defecto). */
  lb: number | null
  side: number | null
  /** Lista de la dirección de carrera desplegada. */
  rcOpen: boolean
}

export interface LayoutState {
  preset: LayoutPreset
  presets: Record<LayoutPreset, PresetLayout>
}

export function defaultPresetLayout(): PresetLayout {
  return { lb: null, side: null, rcOpen: true }
}

export function defaultLayoutState(): LayoutState {
  return {
    preset: 'spectator',
    presets: Object.fromEntries(LAYOUT_PRESETS.map((p) => [p, defaultPresetLayout()])) as Record<LayoutPreset, PresetLayout>,
  }
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

function sanitizePreset(raw: unknown): PresetLayout {
  const out = defaultPresetLayout()
  if (!isRecord(raw)) return out
  for (const panel of LAYOUT_PANELS) out[panel as LayoutPanel] = sanitizeWidth(raw[panel])
  if (typeof raw.rcOpen === 'boolean') out.rcOpen = raw.rcOpen
  return out
}

/**
 * Lo leído de `localStorage` (puede venir de otra versión de la app o de otra mano): lo que no vale (un diseño que
 * no existe, un ancho que no es un número o se sale de los límites) se queda en el valor por defecto, sin tocar lo
 * demás.
 */
export function sanitizeLayout(raw: unknown): LayoutState {
  const out = defaultLayoutState()
  if (!isRecord(raw)) return out
  if (isLayoutPreset(raw.preset)) out.preset = raw.preset
  if (isRecord(raw.presets)) {
    for (const p of LAYOUT_PRESETS) out.presets[p] = sanitizePreset(raw.presets[p])
  }
  return out
}

/** ¿Tiene el diseño algún ancho elegido por el usuario? */
export function isCustomized(layout: PresetLayout): boolean {
  return layout.lb !== null || layout.side !== null
}
