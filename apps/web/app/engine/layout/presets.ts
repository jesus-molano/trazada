/**
 * Diseños del replay (ítem 15, D44): «Espectador» es el de siempre (el mapa primero, paneles compactos) y «Análisis»
 * ensancha la clasificación con columnas opcionales y agranda la telemetría. Solo reordenan y agrandan lo que ya hay:
 * ningún diseño añade datos. TS puro.
 */
export const LAYOUT_PRESETS = ['spectator', 'analysis'] as const
export type LayoutPreset = (typeof LAYOUT_PRESETS)[number]

export function isLayoutPreset(x: unknown): x is LayoutPreset {
  return (LAYOUT_PRESETS as readonly unknown[]).includes(x)
}
