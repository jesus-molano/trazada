import { RATES } from '~/engine/clock/SessionClock'
import { ESC_PRIORITY, handleEscape, registerEscape, runShortcut } from '~/replay/keys'
import { usePlaybackStore } from '~/stores/playback'

export const SEEK_STEP_MS = 5_000
export const SEEK_STEP_LARGE_MS = 30_000

/**
 * Roles de los controles en los que se escribe o se elige tecleando: las teclas sueltas son suyas. No está `slider`:
 * el timeline atiende sus teclas (flechas, Re Pág/Av Pág, Inicio, Fin) y las cancela; las demás siguen siendo atajos.
 */
const EDITABLE_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton', 'listbox'])
/** Tipos de `<input>` en los que no se escribe: con el foco en ellos, los atajos siguen. */
const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color', 'file', 'image'])
/** Controles que se activan con el espacio (nativo). */
const SPACE_CONTROLS = 'button, a, input:not([type="range"])'
/** Controles cuyas flechas son suyas (nativas, sin cancelarlas): el replay no las toma. */
const ARROW_CONTROLS = 'input[type="range"], input[type="radio"]'

/**
 * ¿El foco está en un control en el que se escribe o se elige tecleando (campo de texto, desplegable, combobox)?
 * Entonces no hay atajos de una tecla, solo los que lo piden (Ctrl/⌘+K) y Esc. El timeline, las casillas y los botones
 * no lo son: sus propias teclas las atienden ellos (o el navegador) y las demás llegan al replay.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target.closest('textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]')) return true
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(target.type)
  const role = target.closest('[role]')?.getAttribute('role')
  return !!role && EDITABLE_ROLES.has(role)
}

/** El control (botón, enlace, casilla) sobre el que cae el puntero; con una etiqueta, el suyo. */
function pointerControl(target: EventTarget | null): Element | null {
  const el = target instanceof Element ? target.closest('button, a, input, label') : null
  return el instanceof HTMLLabelElement ? el.control : el
}

/**
 * Atajos del replay: espacio, 1–5, ←/→ (Shift: ×6), ↑/↓ y Esc, más los que registran las funciones en
 * `replay/keys.ts` (D29). Esc cierra lo más prioritario que esté abierto (`ESC_PRIORITY`): de lo que registran las
 * funciones y, al final, el seguimiento y después la selección. Esc vale con el foco en cualquier sitio (también en el
 * timeline o en un desplegable); las demás teclas, salvo los atajos que lo piden, no con el foco en un campo de texto.
 * Mantener pulsada una tecla (repetición automática) no alterna sin parar: el espacio y Esc cuentan una vez.
 */
export function useReplayShortcuts(): void {
  const playback = usePlaybackStore()

  /** Último control enfocado con el puntero (`:focus-visible` no sirve: se activa al teclear). */
  let pointerFocused: Element | null = null
  function onPointerDown(event: PointerEvent) {
    pointerFocused = pointerControl(event.target)
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Tab') pointerFocused = null
    // Ya atendido (la paleta, la tarjeta del timeline o una pista ⓘ cierran con su propio Esc) o a mitad de una
    // composición (IME): no es del replay.
    if (event.defaultPrevented || event.isComposing || !playback.attached) return
    // Esc, antes que el corte por el foco: cierra lo de encima también desde el timeline o un desplegable.
    if (event.key === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (!event.repeat && handleEscape()) event.preventDefault()
      return
    }
    const editable = isEditableTarget(event.target)
    // Los atajos registrados van antes del corte por Ctrl/⌘/Alt: alguno lo lleva (Ctrl+K).
    if (runShortcut(event, editable)) return
    if (event.ctrlKey || event.metaKey || event.altKey || editable) return
    const target = event.target instanceof Element ? event.target : null
    switch (event.key) {
      case ' ': {
        // En un botón, enlace o casilla al que se llegó con el teclado, el espacio lo activa (nativo). Si el foco vino
        // de un clic, el espacio es reproducir/pausa (y se cancela la activación del control).
        const control = target?.closest(SPACE_CONTROLS)
        if (control && control !== pointerFocused) return
        event.preventDefault()
        if (!event.repeat) playback.toggle()
        return
      }
      case 'ArrowLeft':
      case 'ArrowRight': {
        if (target?.closest(ARROW_CONTROLS)) return
        event.preventDefault()
        const step = event.shiftKey ? SEEK_STEP_LARGE_MS : SEEK_STEP_MS
        playback.seekBy(event.key === 'ArrowLeft' ? -step : step)
        return
      }
      case 'ArrowUp':
      case 'ArrowDown':
        if (target?.closest(ARROW_CONTROLS)) return
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
