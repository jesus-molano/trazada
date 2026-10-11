/**
 * Estado de la paleta de comandos (ítem 14, D43), compartido por la paleta (hueco `replay-overlays`) y su botón (hueco
 * `replay-dock`): uno por runtime, con `rt.ext`, así que vive y muere con la sesión. Solo si está abierta: lo demás
 * (lo escrito, la sugerencia activa) es de la paleta.
 */
import { readonly, type Ref, ref } from 'vue'
import { registerSceneStat } from '~/replay/debug'
import type { ReplayRuntime } from '~/replay/runtime'
import { getRuntime } from '~/stores/playback'

export interface PaletteState {
  readonly open: Readonly<Ref<boolean>>
  show(): void
  close(): void
  toggle(): void
  dispose(): void
}

export function createPaletteState(_rt: ReplayRuntime): PaletteState {
  const open = ref(false)
  // Para los e2e (`window.__trazada.scene.palette`).
  const offStat = registerSceneStat('palette', () => ({ open: open.value }))
  return {
    open: readonly(open),
    show: () => void (open.value = true),
    close: () => void (open.value = false),
    toggle: () => void (open.value = !open.value),
    dispose() {
      open.value = false
      offStat()
    },
  }
}

/** La paleta del runtime activo (el replay solo monta sus huecos con el runtime enganchado). */
export function usePalette(): PaletteState {
  return getRuntime()!.ext('palette:ui', createPaletteState)
}
