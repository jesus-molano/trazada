<script setup lang="ts">
/**
 * Paleta de comandos (ítem 14, D43): seguir o elegir pilotos, ir a una vuelta o a una hora, velocidad, saltos a los
 * marcadores (coche de seguridad, banderas, paradas), comparar pilotos y reanudar, escribiendo («seguir VER»,
 * «vuelta 30», «1:02:30», «x4», «siguiente sc», «parada de NOR»). Reglas fijas, sin IA (`engine/commands/`).
 *
 * - Se abre con Ctrl+K (⌘K) o «/» (registro de teclas) y con el botón de la cabecera (iPad); no se abre encima de
 *   otro diálogo modal. Se cierra con Esc (`ESC_PRIORITY.palette`), con ×, con Ctrl+K o con un clic fuera.
 * - Diálogo modal con un combobox y su lista (patrón de WAI-ARIA con `aria-activedescendant`): el foco se queda en el
 *   campo; ↑/↓ eligen, Enter ejecuta, Tab completa. Mientras está abierta, las teclas no llegan a los atajos del replay.
 * - Cada sugerencia dice qué hará antes de pulsar Enter; lo que no se puede, deshabilitado con su motivo («sin dato»).
 *   Si lleva a un instante, abajo se ve qué pasaba entonces (la vista previa del timeline, ítem 16).
 * - Nada irreversible: mover el reloj, elegir, seguir o comparar, la velocidad.
 * - Entrada con los tokens de movimiento (nada con movimiento reducido). DOM fuera del bucle de frames: la lista se
 *   recalcula al escribir y con el estado grueso (≤ 10 Hz), nunca por frame.
 */
import { commandSessionInfo } from '~/engine/commands/context'
import { BUILTIN_COMMANDS, flatten, groupSuggestions, suggest } from '~/engine/commands/registry'
import { type CommandContext, GROUP_LABELS, type Suggestion, type Text } from '~/engine/commands/types'
import { formatClock, formatLapTime } from '~/engine/format/time'
import { createTimelinePreview, PREVIEW_EXT, type PreviewAt, type TimelinePreview } from '~/engine/timeline/preview'
import { commandServices, registerCommandService } from '~/replay/commands'
import { ESC_PRIORITY, registerEscape, registerShortcut } from '~/replay/keys'
import { RESUME_EXT, type ResumeApplied } from '~/replay/resume'
import { defaultInitialMs } from '~/replay/runtime'
import { useCompareStore } from '~/stores/compare'
import { getRuntime, usePlaybackStore } from '~/stores/playback'

const { t, locale } = useI18n()
const rt = getRuntime()!
const playback = usePlaybackStore()
const compare = useCompareStore()
const palette = usePalette()
const { open } = palette

const session = commandSessionInfo(rt, defaultInitialMs(rt.session.manifest.session.playback))
const drivers = new Map(rt.drivers.map((d) => [d.number, d]))

const id = useId()
const titleId = `${id}-title`
const listId = `${id}-list`
const hintId = `${id}-hint`
const groupId = (g: string) => `${id}-group-${g}`
const optionId = (s: Suggestion) => `${id}-opt-${s.key.replace(/[^\w-]/g, '_')}`

const query = ref('')
const activeKey = ref<string | null>(null)

/** Un texto del motor, traducido. */
const tx = (x: Text) => (x.plural === undefined ? t(x.key, { ...x.params }) : t(x.key, { ...x.params }, x.plural))

/**
 * Foto del estado para los comandos. Depende del estado grueso de Pinia (el reloj a ≤ 10 Hz reproduciendo), así que
 * «siguiente…» sigue siendo verdad mientras la paleta está abierta; el instante exacto, del reloj maestro.
 */
function context(): CommandContext {
  void playback.timeMs
  return {
    session,
    state: {
      timeMs: rt.clock.timeMs,
      playing: playback.playing,
      rate: playback.rate,
      selectedCar: playback.selectedCar,
      following: playback.following,
      order: playback.order,
    },
    services: commandServices(),
  }
}

const suggestions = computed<Suggestion[]>(() => (open.value ? suggest(BUILTIN_COMMANDS, query.value, context()) : []))
const groups = computed(() => groupSuggestions(suggestions.value))
/** El orden de ↑/↓ (el de la lista pintada). */
const flat = computed(() => flatten(groups.value))
const active = computed(() => flat.value.find((s) => s.key === activeKey.value) ?? null)
const expanded = computed(() => flat.value.length > 0)

// Al escribir, la primera sugerencia; si la lista cambia sola (el reloj avanza), la activa se queda si sigue ahí.
let lastQuery: string | null = null
watch(
  [flat, query],
  ([list, q]) => {
    const typed = q !== lastQuery
    lastQuery = q
    if (!typed && activeKey.value !== null && list.some((s) => s.key === activeKey.value)) return
    activeKey.value = list[0]?.key ?? null
  },
  { immediate: true },
)

function move(step: 1 | -1) {
  const list = flat.value
  if (!list.length) return
  const i = list.findIndex((s) => s.key === activeKey.value)
  const next = i < 0 ? (step > 0 ? 0 : list.length - 1) : (i + step + list.length) % list.length
  activeKey.value = list[next]!.key
}

/** Ejecuta una sugerencia habilitada y cierra la paleta (el foco vuelve a donde estaba). */
function runSuggestion(s: Suggestion | null) {
  if (!s?.run) return
  const run = s.run
  palette.close()
  run()
}

function onInputKeydown(event: KeyboardEvent) {
  if (event.isComposing) return
  switch (event.key) {
    case 'ArrowDown':
    case 'ArrowUp':
      event.preventDefault()
      move(event.key === 'ArrowDown' ? 1 : -1)
      return
    case 'Enter':
      event.preventDefault()
      runSuggestion(active.value)
      return
    case 'Tab': {
      // Tab completa con la sugerencia activa (si cambia algo); si no, el foco sigue dentro del diálogo.
      const complete = active.value?.complete
      if (event.shiftKey || !complete || complete === query.value) return
      event.preventDefault()
      query.value = complete
    }
  }
}

// Foco: al abrir, al campo; no sale del diálogo (Tab y Mayús+Tab dan la vuelta); al cerrar, vuelve a donde estaba.
const root = ref<HTMLElement | null>(null)
const input = ref<HTMLInputElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)
let returnTo: HTMLElement | null = null

function trapTab(event: KeyboardEvent) {
  const items = [input.value, closeButton.value].filter((e): e is HTMLInputElement | HTMLButtonElement => !!e)
  const i = items.indexOf(document.activeElement as HTMLInputElement | HTMLButtonElement)
  event.preventDefault()
  const next = i < 0 ? 0 : (i + (event.shiftKey ? -1 : 1) + items.length) % items.length
  items[next]?.focus()
}

/** Teclas dentro de la paleta: Esc y Ctrl+K la cierran; ninguna llega a los atajos del replay. */
function onKeydown(event: KeyboardEvent) {
  event.stopPropagation()
  if (event.isComposing) return
  if (event.key === 'Escape') {
    event.preventDefault()
    palette.close()
    return
  }
  const modK = event.key.toLowerCase() === 'k' && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey
  if (modK) {
    event.preventDefault()
    palette.close()
    return
  }
  if (event.key === 'Tab' && !event.defaultPrevented) trapTab(event)
}

/** El foco no sale de la paleta mientras está abierta. */
function onFocusIn(event: FocusEvent) {
  if (root.value && !root.value.contains(event.target as Node | null)) input.value?.focus()
}

watch(open, async (isOpen) => {
  if (isOpen) {
    returnTo = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
    query.value = ''
    lastQuery = null
    await nextTick()
    input.value?.focus()
    document.addEventListener('focusin', onFocusIn, true)
  } else {
    document.removeEventListener('focusin', onFocusIn, true)
    const back = returnTo
    returnTo = null
    const focused = document.activeElement
    const lost = !focused || focused === document.body || !!root.value?.contains(focused)
    if (lost && back?.isConnected) back.focus()
  }
})

// La sugerencia activa, siempre a la vista.
watch(
  activeKey,
  () => {
    const s = active.value
    if (s) document.getElementById(optionId(s))?.scrollIntoView?.({ block: 'nearest' })
  },
  { flush: 'post' },
)

// Vista previa del instante al que lleva la sugerencia activa (la del timeline, ítem 16; perezosa).
let previewModel: TimelinePreview | null = null
const preview = computed<PreviewAt | null>(() => {
  const at = active.value?.seekTo
  if (at === undefined) return null
  previewModel ??= rt.ext(PREVIEW_EXT, createTimelinePreview)
  return previewModel.at(at)
})
const placeable = rt.circuit.marshalSectors.length > 0
const previewWhen = computed(() => {
  const p = preview.value
  if (!p) return ''
  const time = formatClock(p.clockMs)
  if (p.lap === null) return time
  return p.totalLaps ? t('preview.lap', { lap: p.lap, total: p.totalLaps, time }) : t('preview.lapNoTotal', { lap: p.lap, time })
})
const previewLeader = computed(() => {
  const car = preview.value?.leader.car ?? null
  if (car === null) return null
  const d = drivers.get(car)
  return { name: d?.tla ?? `#${car}`, color: d?.color ?? 'var(--tz-team-unknown)' }
})
const previewLapTime = computed(() => {
  const ms = preview.value?.leader.lapMs ?? null
  return ms === null ? '' : formatLapTime(ms, locale.value)
})

const teamColor = (car: string | undefined) => ({ background: (car && drivers.get(car)?.color) || 'var(--tz-team-unknown)' })
const countText = computed(() => t('palette.count', { n: flat.value.length }, flat.value.length))

/** Otro diálogo modal abierto (la tarjeta de fin de sesión): la paleta no se abre encima. */
const otherModal = () => document.querySelector('[aria-modal="true"]:not([data-testid="command-palette"])') !== null

const offs: (() => void)[] = []
onMounted(() => {
  const resumed = rt.ext<ResumeApplied | null>(RESUME_EXT, () => null)
  offs.push(
    registerShortcut({ key: 'k', mods: ['mod'] }, () => palette.toggle(), { inEditable: true, when: () => open.value || !otherModal() }),
    registerShortcut({ key: '/' }, () => palette.show(), { when: () => !open.value && !otherModal() }),
    registerEscape(ESC_PRIORITY.palette, { active: () => open.value, run: () => palette.close() }),
    // Servicios de serie para los comandos (las funciones nuevas registran los suyos).
    registerCommandService('playback', {
      play: () => playback.play(),
      pause: () => playback.pause(),
      setRate: (r) => playback.setRate(r),
      seek: (ms) => playback.seek(ms),
      select: (car) => playback.selectCar(car),
      follow: (on) => playback.setFollowing(on),
    }),
    registerCommandService('compare', {
      get comparing() {
        return compare.comparing ? compare.compareCar : null
      },
      compare(a, b) {
        playback.selectCar(a)
        compare.setCompareCar(b)
      },
      close: () => compare.close(),
    }),
    registerCommandService('resume', { resumedMs: resumed?.plan.t ?? null }),
  )
})
onBeforeUnmount(() => {
  for (const off of offs.splice(0)) off()
  document.removeEventListener('focusin', onFocusIn, true)
})
</script>

<script lang="ts">
/** Hueco `replay-overlays` (D29): la paleta, entre la tarjeta de fin de sesión y la hoja de análisis. */
export const order = 15
</script>

<template>
  <div v-if="open" class="tz-palette" data-testid="palette-scrim" @click.self="palette.close()">
    <section
      ref="root"
      class="tz-palette__card"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      :aria-describedby="hintId"
      data-testid="command-palette"
      @keydown="onKeydown"
    >
      <h2 :id="titleId" class="tz-visually-hidden">{{ t('palette.title') }}</h2>
      <div class="tz-palette__search">
        <TzIcon name="search" class="tz-palette__lens" />
        <input
          ref="input"
          v-model="query"
          class="tz-palette__input"
          type="text"
          role="combobox"
          aria-autocomplete="list"
          :aria-expanded="expanded"
          :aria-controls="listId"
          :aria-activedescendant="active ? optionId(active) : undefined"
          :aria-label="t('palette.inputLabel')"
          :placeholder="t('palette.placeholder')"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          enterkeyhint="go"
          data-testid="palette-input"
          @keydown="onInputKeydown"
        >
        <button
          ref="closeButton"
          type="button"
          class="tz-iconbtn"
          :aria-label="t('palette.close')"
          :title="t('palette.close')"
          data-testid="palette-close"
          @click="palette.close()"
        >
          <TzIcon name="close" />
        </button>
      </div>

      <div :id="listId" class="tz-palette__list" role="listbox" :aria-label="t('palette.listLabel')" data-testid="palette-list">
        <ul v-for="g in groups" :key="g.group" class="tz-palette__group" role="group" :aria-labelledby="groupId(g.group)">
          <li :id="groupId(g.group)" class="tz-palette__group-label" role="presentation">{{ tx(GROUP_LABELS[g.group]) }}</li>
          <li
            v-for="s in g.items"
            :id="optionId(s)"
            :key="s.key"
            class="tz-palette__option"
            :class="{ 'is-active': s.key === activeKey, 'is-disabled': !s.run }"
            role="option"
            :aria-selected="s.key === activeKey"
            :aria-disabled="s.run ? undefined : 'true'"
            data-testid="palette-option"
            :data-key="s.key"
            :data-active="s.key === activeKey"
            :data-disabled="!s.run"
            :data-t="s.seekTo === undefined ? undefined : Math.round(s.seekTo)"
            @mousedown.prevent
            @pointermove="activeKey = s.key"
            @click="runSuggestion(s)"
          >
            <span v-if="s.car" class="tz-palette__team" :style="teamColor(s.car)" aria-hidden="true" />
            <span class="tz-palette__text">
              <span class="tz-palette__title">{{ tx(s.title) }}</span>
              <span v-if="s.disabled" class="tz-palette__reason" data-testid="palette-reason">{{ tx(s.disabled) }}</span>
              <span v-else-if="s.detail" class="tz-palette__detail">{{ tx(s.detail) }}</span>
            </span>
          </li>
        </ul>
      </div>

      <div v-if="!expanded" class="tz-palette__empty" data-testid="palette-empty">
        <p v-if="query.trim()">{{ t('palette.empty', { q: query.trim() }) }}</p>
        <p>{{ t('palette.examples') }}</p>
      </div>

      <!-- Qué pasaba en el instante al que lleva la sugerencia activa (vista previa del timeline, ítem 16). -->
      <div v-if="preview" class="tz-palette__preview" data-testid="palette-preview" :data-t="Math.round(preview.t)">
        <span class="tz-palette__preview-label">{{ t('palette.previewLabel') }}</span>
        <span class="tz-palette__when tz-tabular" data-testid="palette-preview-when">{{ previewWhen }}</span>
        <span class="tz-palette__leader">
          <span class="tz-palette__muted">{{ preview.role === 'leader' ? t('preview.leader') : t('preview.bestLap') }}</span>
          <template v-if="previewLeader">
            <span class="tz-palette__team" :style="{ background: previewLeader.color }" aria-hidden="true" />
            <span class="tz-palette__name">{{ previewLeader.name }}</span>
            <span v-if="previewLapTime" class="tz-tabular">{{ previewLapTime }}</span>
          </template>
          <span v-else class="tz-palette__muted">{{ t('preview.noData') }}</span>
        </span>
        <TzTrackStatusChips
          class="tz-palette__chips"
          :state="preview.track"
          :inferred="preview.trackInferred"
          :placeable="placeable"
          testid="palette-track"
          :empty-label="t('preview.clear')"
        />
      </div>

      <footer :id="hintId" class="tz-palette__foot">
        <span class="tz-palette__keys">
          <span>{{ t('palette.keys.move') }}</span>
          <span>{{ t('palette.keys.run') }}</span>
          <span>{{ t('palette.keys.complete') }}</span>
          <span>{{ t('palette.keys.close') }}</span>
        </span>
        <span class="tz-palette__rules">{{ t('palette.rules') }}</span>
      </footer>
      <p class="tz-visually-hidden" role="status" aria-live="polite">{{ countText }}</p>
    </section>
  </div>
</template>

<style scoped>
/* Capa superior: oscurece el replay y deja la paleta arriba y centrada. */
.tz-palette {
  position: fixed;
  inset: 0;
  z-index: var(--tz-z-overlay);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: max(var(--tz-space-6), 12vh) var(--tz-space-4) var(--tz-space-6);
  background: transparent;
  background: color-mix(in srgb, var(--tz-bg) 45%, transparent);
  animation: palette-fade var(--tz-dur-fast) var(--tz-ease-standard) both;
}

.tz-palette__card {
  display: flex;
  flex-direction: column;
  width: min(640px, 100%);
  max-height: min(560px, 100%);
  overflow: hidden;
  border: 1px solid var(--tz-border-strong);
  border-radius: var(--tz-radius-lg);
  background: var(--tz-surface-2);
  box-shadow: var(--tz-shadow-panel);
  color: var(--tz-text);
  animation: tz-enter var(--tz-dur-fast) var(--tz-ease-enter) both;
}

.tz-palette__search {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--tz-space-2);
  padding: var(--tz-space-2) var(--tz-space-2) var(--tz-space-2) var(--tz-space-4);
  border-bottom: 1px solid var(--tz-border);
}

.tz-palette__lens {
  flex: none;
  color: var(--tz-text-muted);
}

.tz-palette__input {
  flex: 1 1 auto;
  min-width: 0;
  min-height: var(--tz-hit-min);
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--tz-text);
  font: inherit;
  font-size: var(--tz-text-lg);
  outline: none;
}

.tz-palette__input::placeholder {
  color: var(--tz-text-faint);
}

/* El anillo de foco, en el buscador entero (el campo no tiene borde propio). */
.tz-palette__search:focus-within {
  box-shadow: inset 0 -2px 0 var(--tz-focus);
}

.tz-palette__list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--tz-space-1) 0;
}

.tz-palette__group {
  margin: 0;
  padding: 0;
  list-style: none;
}

.tz-palette__group-label {
  padding: var(--tz-space-2) var(--tz-space-4) var(--tz-space-1);
  color: var(--tz-text-muted);
  font-size: var(--tz-text-xs);
  font-weight: var(--tz-weight-semibold);
  letter-spacing: var(--tz-tracking-caps);
  text-transform: uppercase;
}

.tz-palette__option {
  display: flex;
  align-items: center;
  gap: var(--tz-space-3);
  min-height: var(--tz-hit-min);
  margin: 0 var(--tz-space-2);
  padding: var(--tz-space-1) var(--tz-space-3);
  border-radius: var(--tz-radius-md);
  cursor: pointer;
}

.tz-palette__option.is-active {
  background: var(--tz-accent-soft);
  box-shadow: inset 2px 0 0 var(--tz-accent);
}

.tz-palette__option.is-disabled {
  cursor: default;
}

.tz-palette__option.is-disabled .tz-palette__title {
  color: var(--tz-text-muted);
}

.tz-palette__team {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.tz-palette__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.tz-palette__title {
  font-weight: var(--tz-weight-semibold);
}

.tz-palette__detail,
.tz-palette__reason {
  color: var(--tz-text-muted);
  font-size: var(--tz-text-sm);
}

/* «Sin dato» y los motivos: en cursiva, como el resto de huecos sin dato. */
.tz-palette__reason {
  font-style: italic;
}

.tz-palette__empty {
  padding: var(--tz-space-3) var(--tz-space-4);
  color: var(--tz-text-muted);
  font-size: var(--tz-text-sm);
}

.tz-palette__empty p {
  margin: 0 0 var(--tz-space-1);
}

.tz-palette__preview {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--tz-space-1) var(--tz-space-3);
  padding: var(--tz-space-2) var(--tz-space-4);
  border-top: 1px solid var(--tz-border);
  font-size: var(--tz-text-xs);
}

.tz-palette__preview-label,
.tz-palette__muted {
  color: var(--tz-text-muted);
}

.tz-palette__when {
  font-family: var(--tz-font-mono);
  font-weight: var(--tz-weight-semibold);
}

.tz-palette__leader {
  display: inline-flex;
  align-items: center;
  gap: var(--tz-space-2);
}

.tz-palette__name {
  font-weight: var(--tz-weight-semibold);
}

.tz-palette__foot {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: var(--tz-space-1) var(--tz-space-4);
  padding: var(--tz-space-2) var(--tz-space-4);
  border-top: 1px solid var(--tz-border);
  color: var(--tz-text-faint);
  font-size: var(--tz-text-xs);
}

.tz-palette__keys {
  display: flex;
  flex-wrap: wrap;
  gap: var(--tz-space-3);
}

/* Sin teclado físico (iPad), las teclas sobran. */
@media (hover: none) and (pointer: coarse) {
  .tz-palette__keys {
    display: none;
  }
}

@keyframes palette-fade {
  from {
    opacity: 0;
  }
}
</style>
