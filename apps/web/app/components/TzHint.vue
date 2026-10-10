<script setup lang="ts">
/**
 * Pista «ⓘ» que se abre al pulsar (también en iPad, donde un `title` no se ve nunca). Botón de solo icono con
 * nombre (`label`, ya traducido), `aria-expanded` y `aria-controls`; el texto llega por `text` o por el slot
 * (contenido en línea: el componente vive dentro de frases y celdas). Esc la cierra y devuelve el foco al
 * botón (sin que llegue al atajo global de Esc); un toque fuera también. Con la Popover API (iPadOS/Safari
 * 17+) el panel sube a la capa superior y ningún panel con scroll lo recorta; sin ella, es un panel fijo. En
 * ambos casos se coloca al abrir, dentro de la ventana, y sigue al botón si algo se desplaza.
 */
import type { IconName } from '~/design/icons'

const props = withDefaults(
  defineProps<{ label: string; text?: string; testid?: string; icon?: IconName; align?: 'start' | 'end' }>(),
  { text: undefined, testid: 'hint', icon: 'info', align: 'start' },
)

const open = ref(false)
const panelId = `${props.testid}-panel-${useId()}`
const root = ref<HTMLElement | null>(null)
const button = ref<HTMLButtonElement | null>(null)
const panel = ref<HTMLElement | null>(null)
/** Popover API disponible (se sabe al montar; en SSR, no). */
const native = ref(false)
const pos = ref<{ top: number; left: number } | null>(null)
const panelStyle = computed(() => (pos.value ? { top: `${pos.value.top}px`, left: `${pos.value.left}px` } : undefined))

const MARGIN_PX = 8
const GAP_PX = 4

/** Debajo del botón (o encima si no cabe), alineado por `align` y dentro de la ventana. */
function place() {
  const b = button.value?.getBoundingClientRect()
  const el = panel.value
  if (!open.value || !b || !el) return
  const vw = document.documentElement.clientWidth
  const vh = document.documentElement.clientHeight
  const w = el.offsetWidth
  const h = el.offsetHeight
  const left = props.align === 'end' ? b.right - w : b.left
  let top = b.bottom + GAP_PX
  if (top + h > vh - MARGIN_PX && b.top - GAP_PX - h >= MARGIN_PX) top = b.top - GAP_PX - h
  pos.value = { top, left: Math.max(MARGIN_PX, Math.min(left, vw - MARGIN_PX - w)) }
}

/** Capa superior (Popover API); si el navegador falla al usarla, se queda en panel fijo. */
function setTopLayer(show: boolean) {
  const el = panel.value
  if (!native.value || !el) return
  try {
    const shown = el.matches(':popover-open')
    if (show && !shown) el.showPopover()
    else if (!show && shown) el.hidePopover()
  } catch {
    native.value = false
  }
}

function onPointerDown(event: PointerEvent) {
  if (root.value && !root.value.contains(event.target as Node | null)) void setOpen(false)
}

/** Los listeners solo existen con la pista abierta. */
function listen(on: boolean) {
  if (on) {
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
  } else {
    document.removeEventListener('pointerdown', onPointerDown, true)
    window.removeEventListener('resize', place)
    window.removeEventListener('scroll', place, true)
  }
}

async function setOpen(value: boolean) {
  if (open.value === value) return
  open.value = value
  listen(value)
  await nextTick()
  setTopLayer(value)
  if (value) place()
  else pos.value = null
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !open.value) return
  // Los atajos del replay ignoran un evento ya atendido: este Esc no saca de la cámara de seguimiento.
  event.preventDefault()
  void setOpen(false)
  button.value?.focus()
}

onMounted(() => {
  native.value = 'showPopover' in HTMLElement.prototype
})
onBeforeUnmount(() => {
  if (open.value) listen(false)
})
</script>

<template>
  <span ref="root" class="tz-hint" @keydown="onKeydown">
    <button
      ref="button"
      type="button"
      class="tz-iconbtn tz-hint__btn"
      :aria-label="label"
      :aria-expanded="open"
      :aria-controls="panelId"
      :data-testid="testid"
      @click="setOpen(!open)"
    >
      <TzIcon :name="icon" size="sm" />
    </button>
    <span
      v-show="open"
      :id="panelId"
      ref="panel"
      class="tz-hint__panel"
      :class="{ 'is-placed': pos }"
      :popover="native ? 'manual' : undefined"
      :style="panelStyle"
      :data-testid="`${testid}-panel`"
    >
      <slot>{{ text }}</slot>
    </span>
  </span>
</template>

<style scoped>
.tz-hint {
  display: inline-flex;
  vertical-align: middle;
}

.tz-hint__btn {
  width: var(--tz-space-6);
  height: var(--tz-space-6);
}

/* Fijo a la ventana. Como popover, anula el centrado del agente de usuario (inset y margin). */
.tz-hint__panel {
  position: fixed;
  inset: auto;
  z-index: var(--tz-z-overlay);
  width: max-content;
  max-width: min(320px, calc(100vw - 2 * var(--tz-space-4)));
  margin: 0;
  padding: var(--tz-space-2) var(--tz-space-3);
  overflow: visible;
  border: 1px solid var(--tz-border-strong);
  border-radius: var(--tz-radius-md);
  background: var(--tz-surface-2);
  box-shadow: var(--tz-shadow-panel);
  color: var(--tz-text);
  font-size: var(--tz-text-sm);
  font-weight: var(--tz-weight-regular);
  line-height: var(--tz-leading-normal);
  letter-spacing: normal;
  text-align: start;
  text-transform: none;
  white-space: normal;
}

/* Hasta colocarlo (mismo frame en que se abre), invisible: nunca parpadea fuera de sitio. */
.tz-hint__panel:not(.is-placed) {
  visibility: hidden;
}
</style>
