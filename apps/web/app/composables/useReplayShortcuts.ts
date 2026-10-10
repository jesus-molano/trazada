import { RATES } from '~/engine/clock/SessionClock'
import { ESC_PRIORITY, handleEscape, registerEscape, runShortcut } from '~/replay/keys'
import { usePlaybackStore } from '~/stores/playback'

export const SEEK_STEP_MS = 5_000
export const SEEK_STEP_LARGE_MS = 30_000

const EDITABLE_ROLES = new Set(['slider', 'textbox', 'spinbutton', 'combobox', 'listbox', 'searchbox'])

/** ¿El foco está en un control que usa el teclado por sí mismo? Entonces no hay atajos globales. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return true
  const role = target.closest('[role]')?.getAttribute('role')
  return !!role && EDITABLE_ROLES.has(role)
}

/**
 * Atajos del replay: espacio, 1–5, ←/→ (Shift: ×6), ↑/↓ y Esc, más los que registran las funciones en
 * `replay/keys.ts` (D29). Esc cierra lo más prioritario que esté abierto (`ESC_PRIORITY`): de lo que registran las
 * funciones y, al final, el seguimiento y después la selección.
 */
export function useReplayShortcuts(): void {
  const playback = usePlaybackStore()

  /** Último botón o enlace enfocado con el puntero (`:focus-visible` no sirve: se activa al teclear). */
  let pointerFocused: Element | null = null
  function onPointerDown(event: PointerEvent) {
    pointerFocused = (event.target as Element | null)?.closest?.('button, a') ?? null
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Tab') pointerFocused = null
    if (event.defaultPrevented || !playback.attached) return
    const editable = isEditableTarget(event.target)
    // Los atajos registrados van antes del corte por Ctrl/⌘/Alt: alguno lo lleva (Ctrl+K).
    if (runShortcut(event, editable)) return
    if (event.ctrlKey || event.metaKey || event.altKey || editable) return
    const target = event.target as Element | null
    switch (event.key) {
      case 'Escape':
        handleEscape()
        return
      case ' ': {
        // En un botón al que se llegó con el teclado, el espacio lo activa (nativo). Si el foco vino de un
        // clic, el espacio es reproducir/pausa (y se cancela la activación del botón).
        const control = target?.closest('button, a')
        if (control && control !== pointerFocused) return
        event.preventDefault()
        playback.toggle()
        return
      }
      case 'ArrowLeft':
      case 'ArrowRight': {
        event.preventDefault()
        const step = event.shiftKey ? SEEK_STEP_LARGE_MS : SEEK_STEP_MS
        playback.seekBy(event.key === 'ArrowLeft' ? -step : step)
        return
      }
      case 'ArrowUp':
      case 'ArrowDown':
        event.preventDefault()
        playback.selectRelative(event.key === 'ArrowUp' ? -1 : 1)
        return
      default: {
        const n = Number(event.key)
        if (Number.isInteger(n) && n >= 1 && n <= RATES.length && event.key.length === 1) {
          event.preventDefault()
          playback.setRate(RATES[n - 1]!)
        }
      }
    }
  }

  let offEscapes: (() => void)[] = []
  onMounted(() => {
    // Esc del propio replay: primero sale del seguimiento (vista general); después, deselecciona.
    offEscapes = [
      registerEscape(ESC_PRIORITY.follow, {
        active: () => playback.following,
        run: () => playback.setFollowing(false),
      }),
      registerEscape(ESC_PRIORITY.selection, {
        active: () => playback.selectedCar !== null,
        run: () => playback.selectCar(null),
      }),
    ]
    window.addEventListener('keydown', onKeydown)
    window.addEventListener('pointerdown', onPointerDown, true)
  })
  onBeforeUnmount(() => {
    for (const off of offEscapes) off()
    offEscapes = []
    window.removeEventListener('keydown', onKeydown)
    window.removeEventListener('pointerdown', onPointerDown, true)
  })
}
