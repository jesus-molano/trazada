/**
 * Huecos por glob (D29): cada función nueva añade su componente en una carpeta (`components/<hueco>/*.vue`) y el
 * componente anfitrión lo monta sin que nadie toque el anfitrión. Cada hueco tiene su módulo en `app/slots/` con su
 * propio `import.meta.glob` (Vite solo acepta patrones literales), y así cada anfitrión solo arrastra a su chunk los
 * componentes de su hueco (los de la escena van con three.js, fuera de la página).
 *
 * Un fichero de hueco exporta su orden desde un `<script>` normal, junto a su `<script setup>`:
 *   <script lang="ts">
 *   export const order = 20
 *   </script>
 */
import type { Component } from 'vue'

/** Módulo de un `.vue` importado por glob: el componente y lo que exporte su `<script>` normal. */
export type SlotModule = { readonly default: Component } & Readonly<Record<string, unknown>>

export interface SlotEntry<M extends SlotModule = SlotModule> {
  /** Nombre del fichero sin `.vue`: clave estable para `v-for`. */
  readonly name: string
  readonly component: Component
  readonly order: number
  readonly module: M
}

/** Nombre del fichero sin carpeta ni `.vue`. */
export function slotName(path: string): string {
  return path.replace(/^.*[\\/]/, '').replace(/\.vue$/, '')
}

/**
 * Componentes de un hueco ordenados por el número que exporta cada uno en `orderKey` (`order` o, en la escena,
 * `renderOrder`) y, a igualdad, por nombre de fichero. Sin ficheros, una lista vacía. Un fichero sin su número es un
 * error al cargar (mejor que un orden al azar).
 */
export function collectSlot<M extends SlotModule>(modules: Record<string, M>, orderKey = 'order'): readonly SlotEntry<M>[] {
  const entries = Object.entries(modules).map(([path, module]): SlotEntry<M> => {
    const order = module[orderKey]
    if (typeof order !== 'number' || !Number.isFinite(order)) {
      throw new Error(`${path}: falta «export const ${orderKey} = <número>» en su <script lang="ts">`)
    }
    return { name: slotName(path), component: module.default, order, module }
  })
  entries.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
  return Object.freeze(entries)
}
