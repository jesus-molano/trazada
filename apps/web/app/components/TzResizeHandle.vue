<script setup lang="ts">
/**
 * Asa para cambiar el ancho de un panel del replay (ítem 15): un separador (`role="separator"`, enfocable, con
 * `aria-valuenow/min/max` = el ancho del panel en px) en el borde que da al mapa.
 *
 * - Puntero: durante el arrastre escribe el ancho directamente en la variable CSS del panel (`cssVar` en `target`), sin
 *   reactividad de Vue por movimiento, y lo confirma al soltar (`commit`). Mientras dura, `target` lleva
 *   `RESIZING_ATTR`: la escena no reencuadra hasta soltar (`LAYOUT_SETTLED_EVENT`), así no gasta un encuadre por frame.
 * - Teclado: ← y → mueven el borde (Mayús: más), Inicio y Fin van al mínimo y al máximo, Intro restablece. Las flechas
 *   no llegan a los atajos del replay (aquí no mueven el reloj).
 * - Doble clic: restablece el ancho por defecto (`reset`).
 *
 * Los límites (`min`/`max`) los da la página con engine/layout/clamp.ts: el mapa conserva su mínimo. El asa es la
 * mitad sobre el panel y la otra mitad sobre el mapa (`--tz-resize-hit`); quien la monta la posiciona.
 */
import { LAYOUT_SETTLED_EVENT, RESIZING_ATTR } from '~/stores/layout'

const props = defineProps<{
  /** Para el `data-testid` (`resize-<panel>`). */
  panel: string
  /** `end`: el asa está en el borde derecho del panel (crece hacia la derecha); `start`, en el izquierdo. */
  edge: 'start' | 'end'
  /** Ancho actual del panel (px) y sus límites. */
  value: number
  min: number
  max: number
  /** Nombre accesible («Ancho de la clasificación») y explicación (título). */
  label: string
  hint: string
  /** id del panel que controla. */
  controls?: string
  /** Dónde vive la variable CSS del ancho durante el arrastre, y su nombre. */
  target: HTMLElement | null
  cssVar: string
}>()
const emit = defineEmits<{ commit: [width: number]; reset: [] }>()
const { t } = useI18n()

/** Paso del teclado (px); con Mayús, más largo. */
const STEP_PX = 16
const STEP_LARGE_PX = 64

const el = ref<HTMLElement | null>(null)
const dragging = ref(false)
const valueText = computed(() => t('layout.resize.value', { px: props.value }))

const clamp = (x: number) => Math.round(Math.min(props.max, Math.max(props.min, x)))

let drag: { pointer: number; x: number; from: number; live: number } | null = null

function settle() {
  window.dispatchEvent(new Event(LAYOUT_SETTLED_EVENT))
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0 || drag) return
  event.preventDefault()
  try {
    el.value?.setPointerCapture?.(event.pointerId)
  } catch {
    // un puntero que ya no está activo: el arrastre sigue con los eventos que lleguen al asa
  }
  drag = { pointer: event.pointerId, x: event.clientX, from: props.value, live: props.value }
  dragging.value = true
  props.target?.setAttribute(RESIZING_ATTR, '')
}

function onPointerMove(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointer) return
  const dx = event.clientX - drag.x
  const next = clamp(drag.from + (props.edge === 'end' ? dx : -dx))
  if (next === drag.live) return
  drag.live = next
  // Directo al DOM: ni Vue ni el almacenamiento se enteran hasta soltar.
  props.target?.style.setProperty(props.cssVar, `${next}px`)
  el.value?.setAttribute('aria-valuenow', String(next))
}

function onPointerUp(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointer) return
  const { live, from } = drag
  drag = null
  dragging.value = false
  try {
    if (el.value?.hasPointerCapture?.(event.pointerId)) el.value.releasePointerCapture(event.pointerId)
  } catch {
    // ya liberado
  }
  props.target?.removeAttribute(RESIZING_ATTR)
  if (live !== from) emit('commit', live)
  settle()
}

function onKeydown(event: KeyboardEvent) {
  const step = event.shiftKey ? STEP_LARGE_PX : STEP_PX
  const grow = props.edge === 'end' ? 'ArrowRight' : 'ArrowLeft'
  const shrink = props.edge === 'end' ? 'ArrowLeft' : 'ArrowRight'
  let next: number
  if (event.key === grow) next = props.value + step
  else if (event.key === shrink) next = props.value - step
  else if (event.key === 'Home') next = props.min
  else if (event.key === 'End') next = props.max
  else if (event.key === 'Enter') {
    event.preventDefault()
    emit('reset')
    settle()
    return
  } else return
  // Atendido aquí: los atajos del replay ignoran un evento con defaultPrevented (las flechas no mueven el reloj).
  event.preventDefault()
  const value = clamp(next)
  if (value === props.value) return
  emit('commit', value)
  settle()
}

function onDoubleClick() {
  emit('reset')
  settle()
}

onBeforeUnmount(() => {
  if (drag) props.target?.removeAttribute(RESIZING_ATTR)
  drag = null
})
</script>

<template>
  <div
    ref="el"
    class="tz-resize"
    :class="{ 'is-dragging': dragging }"
    role="separator"
    tabindex="0"
    aria-orientation="vertical"
    :aria-label="label"
    :aria-controls="controls"
    :aria-valuenow="value"
    :aria-valuemin="min"
    :aria-valuemax="max"
    :aria-valuetext="valueText"
    :title="hint"
    :data-testid="`resize-${panel}`"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @lostpointercapture="onPointerUp"
    @dblclick="onDoubleClick"
    @keydown="onKeydown"
  >
    <span class="tz-resize__line" aria-hidden="true" />
    <TzIcon name="grip" size="sm" class="tz-resize__grip" />
  </div>
</template>

<style scoped>
/* Zona de agarre de --tz-resize-hit a lo alto del panel; quien la monta la sitúa sobre el borde. */
.tz-resize {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 1;
  display: grid;
  place-items: center;
  width: var(--tz-resize-hit);
  cursor: col-resize;
  touch-action: none;
  user-select: none;
}

.tz-resize:focus-visible {
  outline-offset: -2px;
}

/* El borde: una línea de pintura que se ve al pasar, al enfocar y al arrastrar (en táctil, siempre, más tenue). */
.tz-resize__line {
  position: absolute;
  top: var(--tz-space-2);
  bottom: var(--tz-space-2);
  left: 50%;
  width: 2px;
  margin-left: -1px;
  border-radius: var(--tz-radius-sm);
  background: var(--tz-accent);
  opacity: 0;
  transition: opacity var(--tz-dur-fast) var(--tz-ease-standard);
}

.tz-resize__grip {
  position: relative;
  padding: var(--tz-space-0-5) 0;
  border-radius: var(--tz-radius-sm);
  background: var(--tz-surface-3);
  color: var(--tz-text);
  opacity: 0;
  transition: opacity var(--tz-dur-fast) var(--tz-ease-standard);
}

.tz-resize:focus-visible .tz-resize__line,
.tz-resize:focus-visible .tz-resize__grip,
.tz-resize.is-dragging .tz-resize__line,
.tz-resize.is-dragging .tz-resize__grip {
  opacity: 1;
}

@media (hover: hover) {
  .tz-resize:hover .tz-resize__line,
  .tz-resize:hover .tz-resize__grip {
    opacity: 0.7;
  }
}

@media (pointer: coarse) {
  .tz-resize__line {
    opacity: 0.35;
  }
}
</style>
