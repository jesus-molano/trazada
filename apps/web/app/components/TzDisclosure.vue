<script setup lang="ts">
/**
 * Botón que despliega un panel flotante de texto (patrón «disclosure»): `aria-expanded` y `aria-controls`;
 * se abre y se cierra con clic, Enter o espacio. Esc lo cierra y devuelve el foco al botón (sin que llegue al
 * atajo global de Esc). Un clic fuera también lo cierra. El panel no atrapa el foco: es texto para leer, pero
 * se puede enfocar (tabindex 0) para desplazarlo con el teclado cuando no cabe en su altura máxima.
 * Si no cabe en la ventana (tablet, cabecera partida), se desplaza en horizontal hasta que quepa.
 * `name`: nombre accesible (y título) más largo que el texto visible, si hace falta ahorrar sitio; debe
 * empezar por el texto visible (WCAG 2.5.3).
 * `icon`: icono del registro (por defecto, `info`: «ⓘ»; p. ej. `layers` para el menú «Capas» de las herramientas de
 * escena).
 * Hueco `label` (opcional): el texto visible con marcado propio (p. ej. piezas que se ocultan en pantallas estrechas,
 * como el chip de meteorología); `name` sigue siendo el nombre accesible y debe empezar por lo que se vea.
 * `tools`: el panel lleva controles, no texto. Su contenido pone su propio rol y nombre (un `role="group"`), así que
 * el panel no es una región ni se enfoca, y mide lo que sus controles.
 */
import type { IconName } from '~/design/icons'

const props = withDefaults(
  defineProps<{ label: string; name?: string; testid: string; align?: 'start' | 'end'; icon?: IconName; tools?: boolean }>(),
  { name: undefined, align: 'end', icon: undefined, tools: false },
)

const open = ref(false)
const panelId = `${props.testid}-panel-${useId()}`
const root = ref<HTMLElement | null>(null)
const button = ref<HTMLButtonElement | null>(null)
const panel = ref<HTMLElement | null>(null)
/** Desplazamiento horizontal (px) para que el panel quede dentro de la ventana. */
const shift = ref(0)
const panelStyle = computed(() => (shift.value ? { transform: `translateX(${shift.value}px)` } : undefined))
const MARGIN_PX = 16

function fit() {
  const el = panel.value
  if (!open.value || !el) return
  // Posición sin el desplazamiento que ya tenga aplicado.
  const r = el.getBoundingClientRect()
  const left = r.left - shift.value
  const right = r.right - shift.value
  const width = document.documentElement.clientWidth
  if (right > width - MARGIN_PX) shift.value = Math.max(MARGIN_PX - left, width - MARGIN_PX - right)
  else shift.value = left < MARGIN_PX ? MARGIN_PX - left : 0
}

async function toggle() {
  open.value = !open.value
  await nextTick()
  fit()
}

function onKeydown(event: KeyboardEvent) {
  // Un Esc ya atendido dentro (una pista ⓘ abierta en el panel) cierra solo eso.
  if (event.key !== 'Escape' || !open.value || event.defaultPrevented) return
  // Los atajos del replay ignoran un evento ya atendido: este Esc no saca de la cámara de seguimiento.
  event.preventDefault()
  open.value = false
  button.value?.focus()
}

function onPointerDown(event: PointerEvent) {
  if (open.value && root.value && !root.value.contains(event.target as Node | null)) open.value = false
}

onMounted(() => {
  document.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('resize', fit)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown, true)
  window.removeEventListener('resize', fit)
})
</script>

<template>
  <div ref="root" class="tz-disclosure" :class="`is-${align}`" @keydown="onKeydown">
    <button
      ref="button"
      type="button"
      class="tz-disclosure__btn"
      :aria-expanded="open"
      :aria-controls="panelId"
      :aria-label="name"
      :title="name"
      :data-testid="testid"
      @click="toggle"
    >
      <TzIcon :name="icon ?? 'info'" size="sm" class="tz-disclosure__icon" />
      <slot name="label"><span>{{ label }}</span></slot>
    </button>
    <div
      v-show="open"
      :id="panelId"
      ref="panel"
      class="tz-disclosure__panel"
      :class="{ 'is-tools': tools }"
      :style="panelStyle"
      :role="tools ? undefined : 'region'"
      :aria-label="tools ? undefined : (name ?? label)"
      :tabindex="tools ? undefined : 0"
      :data-testid="`${testid}-panel`"
    >
      <slot />
    </div>
  </div>
</template>

<style scoped>
.tz-disclosure {
  position: relative;
  display: inline-flex;
}

.tz-disclosure__btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: var(--tz-space-1);
  height: 28px;
  padding: 0 var(--tz-space-2);
  border: 1px solid var(--tz-border);
  border-radius: var(--tz-radius-sm);
  background: var(--tz-overlay);
  font-size: var(--tz-text-xs);
  font-weight: var(--tz-weight-semibold);
  white-space: nowrap;
  cursor: pointer;
  transition: background-color var(--tz-dur-fast) var(--tz-ease-standard);
}

/* Zona táctil de --tz-hit-min con puntero grueso, sin mover el layout. */
.tz-disclosure__btn::after {
  content: '';
  position: absolute;
  inset: min(0px, calc((100% - var(--tz-hit-min)) / 2)) 0;
}

@media (hover: hover) {
  .tz-disclosure__btn:hover:not([aria-expanded='true']) {
    border-color: var(--tz-border-strong);
  }
}

.tz-disclosure__btn[aria-expanded='true'] {
  border-color: var(--tz-accent);
  background: var(--tz-accent-soft);
  color: var(--tz-accent-strong);
}

.tz-disclosure__icon {
  flex: none;
}

.tz-disclosure__panel {
  position: absolute;
  top: calc(100% + var(--tz-space-1));
  z-index: var(--tz-z-overlay);
  width: min(460px, calc(100vw - 2 * var(--tz-space-4)));
  max-height: min(75vh, 600px);
  overflow-y: auto;
  padding: var(--tz-space-3) var(--tz-space-4);
  border: 1px solid var(--tz-border-strong);
  border-radius: var(--tz-radius-md);
  background: var(--tz-surface-2);
  box-shadow: var(--tz-shadow-panel);
  font-size: var(--tz-text-sm);
  font-weight: var(--tz-weight-regular);
  line-height: var(--tz-leading-normal);
  color: var(--tz-text);
  text-align: left;
  white-space: normal;
}

/*
 * Controles (menú de herramientas): lo que midan, sin recortar las pistas ⓘ que lleven dentro, y como mucho 560 px: lo
 * que no quepa (la leyenda del mapa de calor, sus vueltas) pasa a otra línea antes que tapar media pantalla.
 */
.tz-disclosure__panel.is-tools {
  width: max-content;
  max-width: min(560px, calc(100vw - 2 * var(--tz-space-4)));
  max-height: none;
  overflow: visible;
  padding: var(--tz-space-2) var(--tz-space-3);
}

.is-end .tz-disclosure__panel {
  right: 0;
}

.is-start .tz-disclosure__panel {
  left: 0;
}
</style>
