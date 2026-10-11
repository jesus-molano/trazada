<script setup lang="ts">
/**
 * Guía de primer uso del replay (ítem 18): seis burbujas no modales (`TzTip`) ancladas a lo que ya existe, por su
 * `data-testid`: la clasificación, «Seguir» (en el panel del coche elegido), la línea de tiempo y su vista previa, una
 * etiqueta «Estimado» visible, el botón de análisis y la paleta de comandos (su botón en el dock, en táctil; si no, el
 * botón «?» de la cabecera). Sin ancla visible, la burbuja sale centrada.
 *
 * - Sale sola una vez por navegador, 1 s después de «listo» (no tapa la carga), solo con los pasos que no se han visto
 *   (`stores/tips.ts`); nunca en el bench ni encima de un diálogo modal o de la paleta. Al salir sola no se lleva el
 *   foco (se anuncia por una región `status`); abierta a petición (botón «?», tecla «?» o la paleta: «guía»), sí, y al
 *   cerrarla vuelve a donde estaba.
 * - Esc la salta (`ESC_PRIORITY.tips`), igual que «Saltar»: se recuerda.
 * - Los textos cambian con el puntero grueso o sin hover (tablet): tocar en vez de hacer clic, el doble toque, dos dedos
 *   para mover el reloj y la lupa del dock en vez de Ctrl+K.
 * - Honestidad: no enseña ningún dato de la sesión. «Estimado» se explica con un ejemplo rotulado como ejemplo (el
 *   campo y su explicación de `estimated.*`), que no es un chip `TzEstimated` ni lleva su `data-testid`.
 */
import TzTip from '~/components/TzTip.vue'
import { SEEK_STEP_MS } from '~/composables/useReplayShortcuts'
import { registerCommandService } from '~/replay/commands'
import { ESC_PRIORITY, registerEscape, registerShortcut } from '~/replay/keys'
import { usePlaybackStore } from '~/stores/playback'
import { type TipId, useTipsStore } from '~/stores/tips'

const { t } = useI18n()
const tips = useTipsStore()
const playback = usePlaybackStore()
const palette = usePalette()
const route = useRoute()
const bench = route.query.bench === '1'

/** Tablet (puntero grueso o sin hover): los textos dicen tocar, doble toque y dos dedos. Se sabe al montar. */
const touch = ref(false)

const ANCHORS: Readonly<Record<TipId, readonly string[]>> = {
  leaderboard: ['[data-testid="leaderboard"]'],
  follow: ['[data-testid="follow-toggle"]'],
  timeline: ['[data-testid="timeline"]'],
  estimated: ['[data-testid="estimated"]'],
  analysis: ['[data-testid="analysis-button"]'],
  palette: ['[data-testid="palette-button"]', '[data-testid="help-button"]'],
}

const TITLES: Readonly<Record<TipId, () => string>> = {
  leaderboard: () => t('tips.steps.leaderboard.title'),
  follow: () => t('tips.steps.follow.title'),
  timeline: () => t('tips.steps.timeline.title'),
  estimated: () => t('tips.steps.estimated.title'),
  analysis: () => t('tips.steps.analysis.title'),
  palette: () => t('tips.steps.palette.title'),
}

const BODIES: Readonly<Record<TipId, () => string>> = {
  leaderboard: () => (touch.value ? t('tips.steps.leaderboard.bodyTouch') : t('tips.steps.leaderboard.body')),
  follow: () => (touch.value ? t('tips.steps.follow.bodyTouch') : t('tips.steps.follow.body')),
  timeline: () =>
    touch.value ? t('tips.steps.timeline.bodyTouch') : t('tips.steps.timeline.body', { seconds: SEEK_STEP_MS / 1000 }),
  estimated: () => t('tips.steps.estimated.body'),
  analysis: () => t('tips.steps.analysis.body'),
  palette: () => (touch.value ? t('tips.steps.palette.bodyTouch') : t('tips.steps.palette.body')),
}

const current = computed(() => tips.current)
const title = computed(() => (current.value ? TITLES[current.value]() : ''))
const body = computed(() => (current.value ? BODIES[current.value]() : ''))

/**
 * Lo que dice la región `status`: al abrirse sola y al cambiar de paso (el foco se queda en «Siguiente» y el lector no
 * volvería a leer la burbuja). Al abrirla a petición no hace falta: el foco entra en ella y se lee entera.
 */
const announcing = ref(false)
const announce = computed(() =>
  announcing.value && current.value ? t('tips.announce', { n: tips.index + 1, total: tips.total, title: title.value }) : '',
)

const tip = ref<InstanceType<typeof TzTip> | null>(null)
/** Dónde estaba el foco al abrirla a petición (vuelve ahí al cerrarla). */
let returnTo: HTMLElement | null = null

/** ¿Fue con el puntero lo último que se hizo en la burbuja? (con el teclado, el foco vuelve a quien la abrió). */
let pointerInTip = false
function onPointerDown(event: PointerEvent) {
  pointerInTip = !!tip.value?.contains(event.target as Node | null)
}
function onKeydown() {
  pointerInTip = false
}

/** Algo visible y que admite el foco (con `display: none`, `focus()` no hace nada). */
const focusable = (el: HTMLElement | null): el is HTMLElement => !!el && el.isConnected && el.getClientRects().length > 0
const byTestid = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)

/**
 * El foco, al cerrar la guía con el foco dentro: con el teclado, a quien la abrió (o al botón «?», que la reabre); con
 * el puntero, al botón de reproducir, como el aviso de «Retomado» (así el espacio sigue siendo reproducir o pausar y no
 * vuelve a abrir la guía). Nunca cae al `<body>` si hay adónde ir.
 */
function restoreFocus(back: HTMLElement | null, pointer: boolean) {
  const order = pointer ? [byTestid('play-toggle')] : [back, byTestid('help-button'), byTestid('play-toggle')]
  order.find(focusable)?.focus({ preventScroll: true })
}

watch(
  () => tips.open,
  async (open) => {
    if (open) {
      const manual = tips.mode === 'manual'
      announcing.value = !manual
      await nextTick()
      if (!manual || !tips.open) return
      // Después de pintar: si venía de la paleta, esta ya ha devuelto el foco a donde estaba.
      const active = document.activeElement
      returnTo = active instanceof HTMLElement && active !== document.body && !tip.value?.hasFocus() ? active : null
      tip.value?.focusPrimary()
      return
    }
    // Cerrándose (la burbuja aún está montada): si el foco estaba en ella, vuelve a donde estaba antes.
    const hadFocus = tip.value?.hasFocus() ?? false
    const back = returnTo
    const pointer = pointerInTip
    returnTo = null
    pointerInTip = false
    announcing.value = false
    if (!hadFocus) return
    await nextTick()
    restoreFocus(back, pointer)
  },
)

watch(
  () => tips.index,
  async (index, before) => {
    if (!tips.open || index === before) return
    announcing.value = true
    // El botón «Anterior» desaparece en el primer paso: el foco no se pierde, pasa a «Siguiente».
    const hadFocus = tip.value?.hasFocus() ?? false
    await nextTick()
    if (hadFocus && !tip.value?.hasFocus()) tip.value?.focusPrimary()
  },
)

// El paso «Seguir» se ancla al botón del panel del coche: aparece y desaparece al elegir uno.
watch(
  () => playback.selectedCar,
  async () => {
    if (!tips.open) return
    await nextTick()
    tip.value?.place()
  },
)

/** Otro diálogo modal abierto (la tarjeta de fin de sesión): la guía no se abre sola encima. */
const otherModal = () => document.querySelector('[aria-modal="true"]') !== null

let timer: ReturnType<typeof setTimeout> | null = null
function autoStart() {
  timer = null
  if (palette.open.value || otherModal()) return
  tips.start('auto')
}

const offs: (() => void)[] = []
onMounted(() => {
  touch.value = typeof matchMedia === 'function' && matchMedia('(pointer: coarse), (hover: none)').matches
  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('keydown', onKeydown, true)
  offs.push(
    registerEscape(ESC_PRIORITY.tips, { active: () => tips.open, run: () => tips.skip() }),
    // «?» (con Mayús en casi todos los teclados): la abre entera o, abierta, la salta.
    registerShortcut({ key: '?' }, () => tips.toggle(), { when: () => tips.open || !otherModal() }),
    registerCommandService('tips', {
      get open() {
        return tips.open
      },
      start: () => void tips.start('manual'),
    }),
  )
  if (!bench) timer = setTimeout(autoStart, TIPS_AUTO_DELAY_MS)
})
onBeforeUnmount(() => {
  if (timer !== null) clearTimeout(timer)
  document.removeEventListener('pointerdown', onPointerDown, true)
  document.removeEventListener('keydown', onKeydown, true)
  for (const off of offs.splice(0)) off()
  // Al salir del replay a mitad: se cierra sin apuntar lo no visto (vuelve la próxima vez).
  tips.close()
})
</script>

<script lang="ts">
/** Hueco `replay-overlays` (D29): la guía, después de los avisos. */
export const order = 95

/** Espera tras «listo» antes de abrirse sola (no tapa la carga). */
export const TIPS_AUTO_DELAY_MS = 1000
</script>

<template>
  <p class="tz-visually-hidden" role="status" data-testid="tips-announce">{{ announce }}</p>
  <TzTip
    v-if="current"
    ref="tip"
    :anchors="ANCHORS[current]"
    :title="title"
    :step="tips.index + 1"
    :total="tips.total"
    :step-key="current"
    @next="tips.next()"
    @prev="tips.prev()"
    @skip="tips.skip()"
  >
    <p>{{ body }}</p>
    <!-- Un ejemplo, rotulado como tal: no es un dato de esta sesión ni el chip de verdad (no se pulsa ni se cuenta). -->
    <figure v-if="current === 'estimated'" class="tz-tips__example" data-testid="tip-example">
      <figcaption class="tz-tips__caption">{{ t('tips.example.caption') }}</figcaption>
      <span class="tz-tips__chip">
        <TzIcon name="estimated" size="sm" />
        <span class="tz-tips__tag">{{ t('estimated.tag') }}</span>
        <span>{{ t('estimated.fields.lap1') }}</span>
      </span>
      <p class="tz-tips__why">{{ t('tips.example.why', { why: t('estimated.hints.lap1') }) }}</p>
    </figure>
  </TzTip>
</template>

<style scoped>
/* El ejemplo, en un recuadro discontinuo neutro con su rótulo «Ejemplo» encima: se lee como ilustración, no como dato. */
.tz-tips__example {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--tz-space-1);
  margin: 0;
  padding: var(--tz-space-2) var(--tz-space-3);
  border: 1px dashed var(--tz-border-strong);
  border-radius: var(--tz-radius-md);
  background: var(--tz-surface-1);
}

.tz-tips__caption {
  color: var(--tz-text-muted);
  font-family: var(--tz-font-display);
  font-size: var(--tz-text-xs);
  font-weight: var(--tz-weight-semibold);
  letter-spacing: var(--tz-tracking-caps);
  text-transform: uppercase;
}

/* Con el aspecto de la etiqueta común (TzEstimated) para que se reconozca, pero sin botón. */
.tz-tips__chip {
  display: inline-flex;
  align-items: center;
  gap: var(--tz-space-1);
  padding: var(--tz-space-0-5) var(--tz-space-2);
  border: 1px dashed var(--tz-estimated);
  border-radius: var(--tz-radius-pill);
  color: var(--tz-estimated);
  font-size: var(--tz-text-xs);
  line-height: var(--tz-leading-tight);
  white-space: nowrap;
}

.tz-tips__tag {
  font-weight: var(--tz-weight-semibold);
}

.tz-tips__why {
  color: var(--tz-text-muted);
  font-size: var(--tz-text-xs);
}
</style>
