<script setup lang="ts">
/**
 * Burbuja de la guía de primer uso (ítem 18): una tarjeta no modal, junto a su ancla (un elemento que ya existe, por
 * su selector `data-testid`), con una flecha hacia él y un anillo que lo marca. Sin ancla visible (un panel plegado,
 * otra disposición en tablet) sale centrada, sin flecha. Lleva «Guía de primer uso · n de N», el título, el texto (hueco
 * por defecto) y «Saltar», «Anterior» y «Siguiente» (o «Terminar» en el último paso).
 *
 * - Accesible: `role="dialog"` no modal (no atrapa el foco ni tapa la escena), con nombre (guía y título) y descripción
 *   (el texto). Quien la abre decide si lleva el foco a ella (`focusPrimary`, a petición) o no (al abrirse sola, para no
 *   robarle el teclado a nadie). Esc la cierra a través de quien la usa (`registerEscape` con `ESC_PRIORITY.tips`).
 * - Se coloca con `engine/tips/place.ts` al montarse, al cambiar de paso, al redimensionar o girar la tablet y cuando
 *   cambia de tamaño ella o su ancla (ResizeObserver); nunca por frame ni anclada a nada que se mueva con el reloj.
 * - Movimiento solo con los tokens (`tz-enter`, 0 ms con movimiento reducido). Colores y medidas, de los tokens.
 */
import { boxOnScreen, type TipBox, type TipPlacement, placeTip, type TipSize } from '~/engine/tips/place'

const props = defineProps<{
  /** Selectores de las anclas, en orden de preferencia: la primera visible manda. */
  anchors: readonly string[]
  title: string
  /** Paso actual (desde 1) y cuántos hay. */
  step: number
  total: number
  /** Cambia con cada paso: se recoloca. */
  stepKey: string
}>()

const emit = defineEmits<{ next: []; prev: []; skip: [] }>()

const { t } = useI18n()
const id = useId()
const nameId = `${id}-name`
const titleId = `${id}-title`
const bodyId = `${id}-body`

const root = ref<HTMLElement | null>(null)
const primary = ref<HTMLButtonElement | null>(null)
const placement = shallowRef<TipPlacement | null>(null)
/** Rectángulo del ancla (para el anillo), o null sin ancla. */
const ring = shallowRef<TipBox | null>(null)

const last = computed(() => props.step >= props.total)

/** Margen del anillo alrededor del ancla (px). */
const RING_PAD_PX = 4

const tipStyle = computed(() => {
  const p = placement.value
  if (!p) return undefined
  return { left: `${p.left}px`, top: `${p.top}px`, '--tip-arrow': p.arrow === null ? undefined : `${p.arrow}px` }
})
const ringStyle = computed(() => {
  const r = ring.value
  if (!r) return undefined
  return {
    left: `${r.left - RING_PAD_PX}px`,
    top: `${r.top - RING_PAD_PX}px`,
    width: `${r.width + 2 * RING_PAD_PX}px`,
    height: `${r.height + 2 * RING_PAD_PX}px`,
  }
})

function viewport(): TipSize {
  const d = document.documentElement
  return { width: d.clientWidth, height: d.clientHeight }
}

const toBox = (r: DOMRect): TipBox => ({ left: r.left, top: r.top, width: r.width, height: r.height })

/**
 * ¿Se ve? Con tamaño, dentro de la ventana y sin `display: none` ni `visibility: hidden` en su camino. La opacidad no
 * cuenta: un panel que acaba de montarse entra desde opacidad 0 (`tz-enter`) y ya es su sitio.
 */
function shown(el: Element, view: TipSize): boolean {
  if (!boxOnScreen(toBox(el.getBoundingClientRect()), view)) return false
  return typeof el.checkVisibility !== 'function' || el.checkVisibility({ visibilityProperty: true })
}

/** La primera ancla visible (nunca algo de la propia burbuja). */
function findAnchor(view: TipSize): Element | null {
  for (const selector of props.anchors) {
    for (const el of document.querySelectorAll(selector)) {
      if (root.value?.contains(el)) continue
      if (shown(el, view)) return el
    }
  }
  return null
}

let observer: ResizeObserver | null = null
let observed: Element | null = null

/** Sigue el tamaño de la burbuja y del ancla (su contenido cambia con el idioma; un panel se pliega). */
function observe(anchor: Element | null) {
  if (typeof ResizeObserver === 'undefined' || !root.value) return
  if (!observer) {
    observer = new ResizeObserver(() => schedule())
    observer.observe(root.value)
  }
  if (observed === anchor) return
  if (observed) observer.unobserve(observed)
  observed = anchor
  if (anchor) observer.observe(anchor)
}

/** Coloca la burbuja (y el anillo) ahora. */
function place() {
  const el = root.value
  if (!el) return
  const view = viewport()
  const anchor = findAnchor(view)
  observe(anchor)
  const box = anchor ? toBox(anchor.getBoundingClientRect()) : null
  ring.value = box
  placement.value = placeTip(box, { width: el.offsetWidth, height: el.offsetHeight }, view)
}

/** Como mucho una colocación por frame (los avisos de tamaño llegan en ráfagas). */
let frame = 0
function schedule() {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    place()
  })
}

watch(
  () => [props.stepKey, props.anchors] as const,
  async () => {
    await nextTick()
    place()
  },
)

onMounted(() => {
  place()
  window.addEventListener('resize', schedule)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', schedule)
  if (frame) cancelAnimationFrame(frame)
  observer?.disconnect()
  observer = null
})

defineExpose({
  place,
  /** Lleva el foco a la acción principal («Siguiente» o «Terminar»): el lector de pantalla anuncia la guía. */
  focusPrimary: () => primary.value?.focus({ preventScroll: true }),
  /** ¿Tiene el foco algo de la burbuja? */
  hasFocus: () => !!root.value && root.value.contains(document.activeElement),
  /** ¿Es de la burbuja? */
  contains: (node: Node | null) => !!root.value && !!node && root.value.contains(node),
})
</script>

<template>
  <div v-if="ring" class="tz-tip__ring" :style="ringStyle" aria-hidden="true" data-testid="tip-ring" />
  <section
    ref="root"
    class="tz-tip"
    :class="{ 'is-placed': placement }"
    :style="tipStyle"
    role="dialog"
    aria-modal="false"
    :aria-labelledby="`${nameId} ${titleId}`"
    :aria-describedby="bodyId"
    :data-side="placement?.side ?? 'center'"
    :data-anchored="ring ? 'true' : 'false'"
    :data-step="stepKey"
    data-testid="tip"
  >
    <span v-if="placement && placement.arrow !== null" class="tz-tip__arrow" aria-hidden="true" />
    <p class="tz-tip__eyebrow">
      <TzIcon name="help" size="sm" />
      <span :id="nameId">{{ t('tips.name') }}</span>
      <span aria-hidden="true">·</span>
      <span class="tz-tabular" data-testid="tip-count">{{ t('tips.counter', { n: step, total }) }}</span>
    </p>
    <h2 :id="titleId" class="tz-tip__title" data-testid="tip-title">{{ title }}</h2>
    <div :id="bodyId" class="tz-tip__body">
      <slot />
    </div>
    <div class="tz-tip__actions">
      <button type="button" class="tz-button tz-button--quiet tz-tip__skip" data-testid="tip-skip" @click="emit('skip')">
        {{ t('tips.skip') }}
      </button>
      <span class="tz-tip__nav">
        <button
          v-if="step > 1"
          type="button"
          class="tz-button tz-button--quiet"
          data-testid="tip-prev"
          @click="emit('prev')"
        >
          {{ t('tips.prev') }}
        </button>
        <button ref="primary" type="button" class="tz-button" data-testid="tip-next" @click="emit('next')">
          {{ last ? t('tips.done') : t('tips.next') }}
        </button>
      </span>
    </div>
  </section>
</template>

<style scoped>
/*
 * Por encima de la cabecera, los paneles, la hoja de análisis y el dock; por debajo de los diálogos modales (paleta,
 * tarjeta de fin de sesión) y de los avisos. No tapa nada más que su propio rectángulo: la escena sigue a mano.
 */
.tz-tip {
  position: fixed;
  z-index: calc(var(--tz-z-header) + 1);
  display: flex;
  flex-direction: column;
  gap: var(--tz-space-2);
  width: min(calc(var(--tz-panel-w) + var(--tz-space-10)), calc(100vw - 2 * var(--tz-space-3)));
  max-height: calc(100vh - 2 * var(--tz-space-3));
  padding: var(--tz-space-3) var(--tz-space-4) var(--tz-space-4);
  overflow: auto;
  border: 1px solid var(--tz-border-strong);
  border-radius: var(--tz-radius-lg);
  background: var(--tz-surface-2);
  box-shadow: var(--tz-shadow-panel);
  color: var(--tz-text);
  font-size: var(--tz-text-sm);
  line-height: var(--tz-leading-normal);
  animation: tz-enter var(--tz-dur-slow) var(--tz-ease-enter);
}

/* Hasta colocarla (en el mismo frame en que se monta), invisible: nunca aparece fuera de sitio. */
.tz-tip:not(.is-placed) {
  visibility: hidden;
}

/* Con flecha, la tarjeta no recorta (la flecha sobresale); su alto ya cabe por la colocación. */
.tz-tip:has(.tz-tip__arrow) {
  overflow: visible;
}

.tz-tip__arrow {
  position: absolute;
  width: 10px;
  height: 10px;
  border: 1px solid var(--tz-border-strong);
  background: var(--tz-surface-2);
  transform: rotate(45deg);
}

.tz-tip[data-side='bottom'] .tz-tip__arrow {
  top: -6px;
  left: calc(var(--tip-arrow) - 5px);
  border-right: 0;
  border-bottom: 0;
}

.tz-tip[data-side='top'] .tz-tip__arrow {
  bottom: -6px;
  left: calc(var(--tip-arrow) - 5px);
  border-top: 0;
  border-left: 0;
}

.tz-tip[data-side='right'] .tz-tip__arrow {
  top: calc(var(--tip-arrow) - 5px);
  left: -6px;
  border-top: 0;
  border-right: 0;
}

.tz-tip[data-side='left'] .tz-tip__arrow {
  top: calc(var(--tip-arrow) - 5px);
  right: -6px;
  border-bottom: 0;
  border-left: 0;
}

/* Marca el ancla sin tapar ni bloquear nada (los clics pasan). */
.tz-tip__ring {
  position: fixed;
  z-index: calc(var(--tz-z-header) + 1);
  border: 2px solid var(--tz-accent);
  border-radius: var(--tz-radius-lg);
  pointer-events: none;
  animation: tz-enter var(--tz-dur-slow) var(--tz-ease-enter);
}

.tz-tip__eyebrow {
  display: flex;
  align-items: center;
  gap: var(--tz-space-1);
  margin: 0;
  color: var(--tz-text-muted);
  font-size: var(--tz-text-xs);
}

.tz-tip__eyebrow > .tz-icon {
  color: var(--tz-accent);
}

.tz-tip__title {
  margin: 0;
  font-size: var(--tz-text-lg);
  font-weight: var(--tz-weight-semibold);
  line-height: var(--tz-leading-tight);
}

.tz-tip__body {
  display: flex;
  flex-direction: column;
  gap: var(--tz-space-2);
}

.tz-tip__body :deep(p) {
  margin: 0;
}

.tz-tip__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--tz-space-2);
  margin-top: var(--tz-space-1);
}

.tz-tip__nav {
  display: inline-flex;
  gap: var(--tz-space-2);
  margin-left: auto;
}

.tz-tip__actions .tz-button {
  padding: var(--tz-space-1) var(--tz-space-3);
  font-size: var(--tz-text-sm);
}

/* Con puntero grueso, los botones con la zona táctil mínima. */
@media (pointer: coarse) {
  .tz-tip__actions .tz-button {
    min-height: var(--tz-hit-min);
  }
}
</style>
