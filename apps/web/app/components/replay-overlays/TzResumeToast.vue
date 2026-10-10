<script setup lang="ts">
/**
 * Aviso «Retomado en …» (ítem 13): al abrir una sesión con una posición guardada, el replay arranca en pausa en ese
 * instante y este aviso, no modal, se queda 8 s sobre el dock con «Empezar desde el principio». El tiempo se para
 * mientras el puntero o el foco están en él. Sin nada retomado (`rt.ext(RESUME_EXT)` vacío), no pinta nada.
 */
import { RESUME_EXT, RESUME_TOAST_MS, type ResumeApplied, resumeAt, resumeStore } from '~/replay/resume'
import { getRuntime, usePlaybackStore } from '~/stores/playback'

const { t } = useI18n()
const playback = usePlaybackStore()
const applied = getRuntime()!.ext<ResumeApplied | null>(RESUME_EXT, () => null)
const label = useResumeLabel()
const at = applied ? label(resumeAt(applied.info, applied.plan.t)) : ''

const visible = ref(applied !== null)
const root = ref<HTMLElement | null>(null)

let timer: ReturnType<typeof setTimeout> | null = null
let hovered = false
let focused = false
function disarm() {
  if (timer !== null) clearTimeout(timer)
  timer = null
}
function arm() {
  disarm()
  if (visible.value && !hovered && !focused) timer = setTimeout(hide, RESUME_TOAST_MS)
}

function hide() {
  // Si el foco estaba en el aviso, pasa al botón de reproducir (no cae al <body>).
  const hadFocus = !!root.value?.contains(document.activeElement)
  disarm()
  visible.value = false
  if (hadFocus) void nextTick(() => document.querySelector<HTMLElement>('[data-testid="play-toggle"]')?.focus())
}

/** Como si no hubiera nada guardado: instante por defecto, sin coche ni seguimiento, a ×1. Se olvida lo guardado. */
function restart() {
  if (!applied) return
  resumeStore.forget(applied.info.id)
  playback.selectCar(null)
  playback.setRate(1)
  playback.seek(applied.info.defaultMs)
  hide()
}

function onPointerEnter() {
  hovered = true
  disarm()
}
function onPointerLeave() {
  hovered = false
  arm()
}
function onFocusIn() {
  focused = true
  disarm()
}
function onFocusOut(event: FocusEvent) {
  if (root.value?.contains(event.relatedTarget as Node | null)) return
  focused = false
  arm()
}

onMounted(arm)
onBeforeUnmount(disarm)
</script>

<script lang="ts">
/** Hueco components/replay-overlays/ (D29): los avisos, después de hojas y tarjetas. */
export const order = 90
</script>

<template>
  <!-- Dentro del dock (posición relativa): el aviso va justo encima, mida lo que mida el dock. -->
  <Teleport v-if="applied" defer to="[data-testid='replay-dock']">
    <Transition name="tz-resume">
      <div
        v-if="visible"
        ref="root"
        class="tz-resume"
        data-testid="resume-toast"
        @pointerenter="onPointerEnter"
        @pointerleave="onPointerLeave"
        @focusin="onFocusIn"
        @focusout="onFocusOut"
      >
        <TzIcon name="resume" />
        <p class="tz-resume__text tz-tabular" role="status" data-testid="resume-at">
          {{ t('resume.toast.resumed', { at }) }}
        </p>
        <button type="button" class="tz-button tz-button--quiet tz-resume__restart" data-testid="resume-restart" @click="restart">
          {{ t('resume.toast.restart') }}
        </button>
        <button
          type="button"
          class="tz-iconbtn"
          :aria-label="t('resume.toast.close')"
          :title="t('resume.toast.close')"
          data-testid="resume-close"
          @click="hide"
        >
          <TzIcon name="close" />
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* Centrado sobre el dock. `translate` (no `transform`): la entrada tz-enter anima `transform` y no lo pisa. */
.tz-resume {
  position: absolute;
  bottom: calc(100% + var(--tz-space-2));
  left: 50%;
  z-index: var(--tz-z-toast);
  display: flex;
  align-items: center;
  gap: var(--tz-space-3);
  width: max-content;
  max-width: calc(100% - 2 * var(--tz-space-4));
  padding: var(--tz-space-2) var(--tz-space-2) var(--tz-space-2) var(--tz-space-4);
  border: 1px solid var(--tz-border-strong);
  border-radius: var(--tz-radius-lg);
  background: var(--tz-surface-2);
  box-shadow: var(--tz-shadow-panel);
  color: var(--tz-text);
  translate: -50% 0;
  animation: tz-enter var(--tz-dur-slow) var(--tz-ease-enter);
}

.tz-resume > .tz-icon {
  color: var(--tz-accent);
}

.tz-resume__text {
  margin: 0;
  font-weight: var(--tz-weight-semibold);
}

.tz-resume__restart {
  padding: var(--tz-space-1) var(--tz-space-3);
  font-size: var(--tz-text-sm);
  white-space: nowrap;
}

/* Salida: solo opacidad (0 ms con prefers-reduced-motion, por los tokens). */
.tz-resume-leave-active {
  transition: opacity var(--tz-dur-base) var(--tz-ease-exit);
}

.tz-resume-leave-to {
  opacity: 0;
}

/* Estrecho (tablet en vertical, móvil): el botón baja a otra línea en vez de cortar el texto. */
@media (width < 640px) {
  .tz-resume {
    flex-wrap: wrap;
  }
}
</style>
