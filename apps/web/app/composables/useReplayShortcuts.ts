import { RATES } from '~/engine/clock/SessionClock'
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

/** Atajos del replay: espacio, 1–5, ←/→ (Shift: ×6), ↑/↓. */
export function useReplayShortcuts(): void {
  const playback = usePlaybackStore()

  function onKeydown(event: KeyboardEvent) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
    if (!playback.attached || isEditableTarget(event.target)) return
    const target = event.target as Element | null
    switch (event.key) {
      case ' ':
        // En un botón, el espacio lo activa (comportamiento nativo): no se duplica.
        if (target?.closest('button, a')) return
        event.preventDefault()
        playback.toggle()
        return
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

  onMounted(() => window.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
}
