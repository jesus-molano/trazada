<script setup lang="ts">
/**
 * Cabecera de la hoja de paneles del modo compacto (móvil y ventanas pequeñas; pages/replay.vue): un asa y las pestañas
 * «Clasificación · <sigla del coche elegido> · Dirección de carrera». La hoja tiene tres alturas: asomada (solo esta
 * cabecera: el mapa entero a la vista), media y entera.
 *
 * - Pestañas (`role="tablist"`): elegir una con la hoja asomada la abre a media altura; ← y → pasan de una a otra.
 * - Asa: un toque alterna asomada ↔ media (desde entera, a asomada); arrastrar mueve la hoja con el dedo y al soltar se
 *   queda en la altura más cercana. Durante el arrastre la altura va directa a la variable CSS del escenario
 *   (`--sheet-body` en `target`), sin Vue por movimiento, y `root` lleva `RESIZING_ATTR`: la escena reencuadra una vez,
 *   al soltar (`LAYOUT_SETTLED_EVENT`), como con las asas de los paneles.
 */
import type { SheetState, SheetTab } from '~/composables/useReplayLayout'
import { LAYOUT_SETTLED_EVENT, RESIZING_ATTR } from '~/stores/layout'

const props = defineProps<{
  state: SheetState
  tab: SheetTab
  /** Sigla del coche elegido, si lo hay (su pestaña solo sale entonces). */
  car: string | null
  /** El escenario: donde vive `--sheet-body` durante el arrastre. */
  target: HTMLElement | null
  /** La página: lleva `RESIZING_ATTR` mientras se arrastra. */
  root: HTMLElement | null
}>()
const emit = defineEmits<{ 'update:state': [SheetState]; 'update:tab': [SheetTab] }>()
const { t } = useI18n()

const head = ref<HTMLElement | null>(null)
/** Alto del cuerpo (px) de cada estado, con el escenario y la cabecera de ahora. */
function heights(): Record<SheetState, number> {
  const stage = props.target?.clientHeight ?? 0
  const h = head.value?.offsetHeight ?? 0
  return { peek: 0, half: Math.max(0, stage * 0.5 - h), full: Math.max(0, stage - h - 8) }
}

const tabs = computed(() => {
  const out: { id: SheetTab; label: string; controls: string }[] = [
    { id: 'lb', label: t('sheet.lb'), controls: 'tz-leaderboard' },
  ]
  if (props.car) out.push({ id: 'car', label: props.car, controls: 'tz-replay-side' })
  out.push({ id: 'rc', label: t('sheet.rc'), controls: 'tz-replay-side' })
  return out
})

function choose(id: SheetTab) {
  emit('update:tab', id)
  if (props.state === 'peek') emit('update:state', 'half')
}

function onTabKey(event: KeyboardEvent) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  const list = tabs.value
  const i = list.findIndex((x) => x.id === props.tab)
  const next = list[(i + (event.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length]!
  choose(next.id)
  nextTick(() => head.value?.querySelector<HTMLElement>(`[data-tab="${next.id}"]`)?.focus())
}

function toggle() {
  emit('update:state', props.state === 'peek' ? 'half' : 'peek')
}

/** Movimiento mínimo (px) para que el asa cuente como arrastre y no como toque. */
const DRAG_MIN_PX = 6
let drag: { pointer: number; y: number; from: number; live: number; moved: boolean } | null = null

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0 || drag) return
  try {
    ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
  } catch {
    // un puntero que ya no está activo
  }
  const from = heights()[props.state]
  drag = { pointer: event.pointerId, y: event.clientY, from, live: from, moved: false }
}

function onPointerMove(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointer) return
  const dy = event.clientY - drag.y
  if (!drag.moved && Math.abs(dy) < DRAG_MIN_PX) return
  if (!drag.moved) {
    drag.moved = true
    props.root?.setAttribute(RESIZING_ATTR, '')
  }
  drag.live = Math.min(heights().full, Math.max(0, drag.from - dy))
  props.target?.style.setProperty('--sheet-body', `${drag.live}px`)
}

function onPointerUp(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointer) return
  const { moved, live } = drag
  drag = null
  if (!moved) {
    toggle()
    return
  }
  const h = heights()
  const nearest = (Object.keys(h) as SheetState[]).reduce((a, b) => (Math.abs(h[b] - live) < Math.abs(h[a] - live) ? b : a))
  props.target?.style.removeProperty('--sheet-body')
  props.root?.removeAttribute(RESIZING_ATTR)
  emit('update:state', nearest)
  nextTick(() => window.dispatchEvent(new Event(LAYOUT_SETTLED_EVENT)))
}

onBeforeUnmount(() => {
  if (drag?.moved) props.root?.removeAttribute(RESIZING_ATTR)
  props.target?.style.removeProperty('--sheet-body')
  drag = null
})
</script>

<template>
  <div ref="head" class="tz-sheet" data-testid="sheet" :data-state="state">
    <button
      type="button"
      class="tz-sheet__handle"
      :aria-label="t('sheet.handle')"
      :aria-expanded="state !== 'peek'"
      :title="t('sheet.handleHint')"
      data-testid="sheet-handle"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @keydown.enter.prevent="toggle"
      @keydown.space.prevent="toggle"
    >
      <span class="tz-sheet__grip" aria-hidden="true" />
    </button>
    <div class="tz-sheet__tabs" role="tablist" :aria-label="t('sheet.label')" @keydown="onTabKey">
      <button
        v-for="x in tabs"
        :key="x.id"
        type="button"
        role="tab"
        class="tz-sheet__tab"
        :aria-selected="tab === x.id"
        :aria-controls="x.controls"
        :tabindex="tab === x.id ? 0 : -1"
        :data-tab="x.id"
        :data-testid="`sheet-tab-${x.id}`"
        @click="choose(x.id)"
      >
        {{ x.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
/* La hoja (D50): surface-1 con radio de hoja arriba; esta cabecera es lo que asoma con la hoja recogida. */
.tz-sheet {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  padding: 0 var(--tz-space-3) var(--tz-space-1);
  border-radius: var(--tz-radius-sheet) var(--tz-radius-sheet) 0 0;
  background: var(--tz-surface-1);
  touch-action: none;
}

.tz-sheet__handle {
  position: relative;
  display: grid;
  place-items: center;
  height: 18px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: grab;
  touch-action: none;
}

/* Zona táctil de --tz-hit-min sin mover el layout. */
.tz-sheet__handle::after {
  content: '';
  position: absolute;
  inset: min(0px, calc((100% - var(--tz-hit-min)) / 2)) 0;
}

.tz-sheet__grip {
  width: 36px;
  height: 4px;
  border-radius: var(--tz-radius-pill);
  background: var(--tz-border-strong);
}

.tz-sheet__tabs {
  display: flex;
  gap: var(--tz-space-1);
  overflow-x: auto;
  scrollbar-width: none;
}

.tz-sheet__tab {
  flex: none;
  min-height: 32px;
  padding: 0 var(--tz-space-3);
  border: 0;
  border-radius: var(--tz-radius-md);
  background: transparent;
  color: var(--tz-text-muted);
  font-size: var(--tz-text-sm);
  font-weight: var(--tz-weight-medium);
  white-space: nowrap;
  cursor: pointer;
}

.tz-sheet__tab[aria-selected='true'] {
  background: var(--tz-surface-3);
  color: var(--tz-text);
}
</style>
