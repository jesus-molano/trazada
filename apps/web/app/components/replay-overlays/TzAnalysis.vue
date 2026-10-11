<script setup lang="ts">
/**
 * Hoja de análisis (ítem 3, D33): gráficas por vuelta con los tiempos oficiales, en pestañas (hueco
 * `components/analysis-tabs/`, que también usa el ítem 5). Tapa el escenario entre la cabecera y el dock (el
 * reproductor y el timeline siguen a mano) y, mientras está abierta, la escena no se redibuja
 * (`rt.setSceneHidden`, en `useAnalysis`).
 *
 * - «Sin spoilers: hasta ahora» (activo por defecto): solo los datos hasta el instante del reproductor.
 * - Diálogo no modal: al abrirla, el foco va a la pestaña activa; al cerrarla, vuelve a donde estaba. Pestañas con
 *   flechas, Inicio y Fin (patrón de pestañas de WAI-ARIA; las flechas no llegan al atajo de saltar en el tiempo).
 * - Se cierra con ×, con el botón de la cabecera o con Esc (registro de Esc, `ESC_PRIORITY.analysis`).
 * - Entrada con los tokens de movimiento (fundido y desplazamiento corto; nada con movimiento reducido).
 */
import { ESC_PRIORITY, registerEscape } from '~/replay/keys'
import { ANALYSIS_TABS } from '~/slots/analysis-tabs'

const { t } = useI18n()
const st = useAnalysis()
const { open, tab, noSpoilers } = st

const id = useId()
const titleId = `${id}-title`
const panelId = `${id}-panel`
const tabId = (key: string) => `${id}-tab-${key}`
const active = computed(() => ANALYSIS_TABS.find((x) => x.tab === tab.value) ?? ANALYSIS_TABS[0] ?? null)

function selectTab(key: string) {
  tab.value = key
}

function toggleSpoilers() {
  noSpoilers.value = !noSpoilers.value
}

const tabsEl = ref<HTMLElement | null>(null)
/** Pestañas: ←/→ (en círculo), Inicio y Fin; la pestaña elegida se activa y recibe el foco. */
function onTabsKeydown(event: KeyboardEvent) {
  const keys = ANALYSIS_TABS.map((x) => x.tab)
  const i = keys.indexOf(tab.value)
  let next = -1
  if (event.key === 'ArrowRight') next = (i + 1) % keys.length
  else if (event.key === 'ArrowLeft') next = (i - 1 + keys.length) % keys.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = keys.length - 1
  if (next < 0 || !keys.length) return
  event.preventDefault()
  selectTab(keys[next]!)
  void nextTick(() => document.getElementById(tabId(keys[next]!))?.focus())
}

// Hueco entre la cabecera y el dock del replay (los dos cambian de alto con el tamaño de la ventana).
const sheet = ref<HTMLElement | null>(null)
const box = ref<{ top: number; bottom: number } | null>(null)
const boxStyle = computed(() => (box.value ? { '--analysis-top': `${box.value.top}px`, '--analysis-bottom': `${box.value.bottom}px` } : undefined))
let ro: ResizeObserver | null = null

function measure() {
  const el = sheet.value
  const page = el?.parentElement
  if (!el || !page) return
  const pr = page.getBoundingClientRect()
  const bar = page.querySelector<HTMLElement>('.tz-replay__bar')
  const dock = page.querySelector<HTMLElement>('[data-testid="replay-dock"]')
  const top = bar ? Math.max(0, bar.getBoundingClientRect().bottom - pr.top) : 0
  const bottom = dock ? Math.max(0, pr.bottom - dock.getBoundingClientRect().top) : 0
  box.value = { top, bottom }
}

function watchLayout(on: boolean) {
  ro?.disconnect()
  ro = null
  window.removeEventListener('resize', measure)
  if (!on) return
  const page = sheet.value?.parentElement
  if (page && typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(measure)
    ro.observe(page)
    for (const sel of ['.tz-replay__bar', '[data-testid="replay-dock"]']) {
      const el = page.querySelector(sel)
      if (el) ro.observe(el)
    }
  }
  window.addEventListener('resize', measure)
}

// Foco: al abrir, a la pestaña activa; al cerrar, de vuelta a donde estaba (p. ej. el botón de la cabecera).
let returnTo: HTMLElement | null = null
watch(
  open,
  async (isOpen) => {
    if (isOpen) {
      returnTo = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
      await nextTick()
      measure()
      watchLayout(true)
      tabsEl.value?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus()
    } else {
      watchLayout(false)
      const back = returnTo
      returnTo = null
      // Solo si el foco estaba en la hoja (que desaparece) o en ningún sitio: no se le quita a otro control (el dock).
      const focused = document.activeElement
      const lost = !focused || focused === document.body || !!sheet.value?.contains(focused)
      if (lost && back?.isConnected) back.focus()
    }
  },
  { immediate: true },
)

let offEscape: (() => void) | null = null
onMounted(() => {
  offEscape = registerEscape(ESC_PRIORITY.analysis, { active: () => open.value, run: () => st.close() })
})
onBeforeUnmount(() => {
  offEscape?.()
  watchLayout(false)
})
</script>

<script lang="ts">
/** Hueco `replay-overlays` (D29): hoja de análisis (ítem 3), por debajo de la tarjeta de fin de sesión. */
export const order = 20
</script>

<template>
  <section
    v-if="open"
    ref="sheet"
    class="tz-analysis tz-panel"
    role="dialog"
    aria-modal="false"
    :aria-labelledby="titleId"
    :style="boxStyle"
    data-testid="analysis-sheet"
    :data-tab="tab"
  >
    <header class="tz-panel__head tz-analysis__head">
      <h2 :id="titleId" class="tz-analysis__title">
        <TzIcon name="analysis" size="sm" />
        {{ t('analysis.title') }}
      </h2>
      <div class="tz-analysis__actions">
        <button
          type="button"
          role="switch"
          class="tz-analysis__switch"
          :aria-checked="noSpoilers"
          data-testid="analysis-spoilers"
          @click="toggleSpoilers()"
        >
          <span class="tz-analysis__knob" aria-hidden="true" />
          {{ t('analysis.noSpoilers') }}
        </button>
        <TzHint :label="t('analysis.noSpoilers')" :text="t('analysis.noSpoilersHint')" testid="analysis-spoilers-hint" align="end" />
        <button type="button" class="tz-iconbtn" :aria-label="t('analysis.close')" data-testid="analysis-close" @click="st.close()">
          <TzIcon name="close" />
        </button>
      </div>
    </header>

    <div ref="tabsEl" class="tz-analysis__tabs" role="tablist" :aria-label="t('analysis.tabsLabel')" @keydown="onTabsKeydown">
      <button
        v-for="x in ANALYSIS_TABS"
        :id="tabId(x.tab)"
        :key="x.tab"
        type="button"
        role="tab"
        class="tz-analysis__tab"
        :aria-selected="x.tab === tab"
        :aria-controls="panelId"
        :tabindex="x.tab === tab ? 0 : -1"
        :data-testid="`analysis-tab-${x.tab}`"
        @click="selectTab(x.tab)"
      >
        {{ x.label(t) }}
      </button>
    </div>

    <div
      v-if="active"
      :id="panelId"
      class="tz-analysis__panel"
      role="tabpanel"
      :aria-labelledby="tabId(active.tab)"
      tabindex="0"
      :data-testid="`analysis-panel-${active.tab}`"
    >
      <component :is="active.entry.component" :key="active.tab" />
    </div>
  </section>
</template>

<style scoped>
/* Sobre el escenario, entre la cabecera y el dock; por encima de los paneles y por debajo de los menús de la cabecera. */
.tz-analysis {
  position: absolute;
  top: var(--analysis-top, 64px);
  right: var(--tz-space-6);
  bottom: calc(var(--analysis-bottom, 120px) + var(--tz-space-3));
  left: var(--tz-space-6);
  z-index: calc(var(--tz-z-panels) + 1);
  overflow: hidden;
  background: var(--tz-surface-1);
  animation: tz-enter var(--tz-dur-base) var(--tz-ease-enter) both;
}

.tz-analysis__head {
  flex-wrap: wrap;
}

.tz-analysis__title {
  display: flex;
  align-items: center;
  gap: var(--tz-space-2);
  margin: 0;
  font-size: var(--tz-text-lg);
  font-weight: var(--tz-weight-semibold);
  line-height: var(--tz-leading-tight);
}

.tz-analysis__actions {
  display: flex;
  align-items: center;
  gap: var(--tz-space-2);
}

/* Interruptor «Sin spoilers»: el texto siempre visible; la bolita solo lo acompaña. */
.tz-analysis__switch {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: var(--tz-space-2);
  min-height: 28px;
  padding: 0 var(--tz-space-3) 0 var(--tz-space-2);
  border: 1px solid var(--tz-border-strong);
  border-radius: var(--tz-radius-pill);
  background: transparent;
  font-size: var(--tz-text-sm);
  font-weight: var(--tz-weight-semibold);
  white-space: nowrap;
  cursor: pointer;
}

.tz-analysis__switch::after {
  content: '';
  position: absolute;
  inset: min(0px, calc((100% - var(--tz-hit-min)) / 2)) 0;
}

.tz-analysis__knob {
  position: relative;
  width: 26px;
  height: 14px;
  border: 1px solid var(--tz-border-strong);
  border-radius: var(--tz-radius-sm);
  background: var(--tz-surface-3);
  transition: background-color var(--tz-dur-fast) var(--tz-ease-standard);
}

/* La bolita es un cuadrado (cantos casi vivos, D47). */
.tz-analysis__knob::before {
  content: '';
  position: absolute;
  top: 1px;
  left: 1px;
  width: 10px;
  height: 10px;
  border-radius: var(--tz-radius-sm);
  background: var(--tz-text-muted);
  transition: transform var(--tz-dur-fast) var(--tz-ease-standard);
}

.tz-analysis__switch[aria-checked='true'] {
  border-color: var(--tz-accent);
  color: var(--tz-accent-strong);
}

/* Activado: el carril, placa maciza de pintura, y la bolita del color del texto sobre ella. */
.tz-analysis__switch[aria-checked='true'] .tz-analysis__knob {
  background: var(--tz-accent);
  border-color: var(--tz-accent);
}

.tz-analysis__switch[aria-checked='true'] .tz-analysis__knob::before {
  background: var(--tz-accent-on);
  transform: translateX(12px);
}

/* Pestañas: 44 px con puntero grueso (--tz-hit-min). */
.tz-analysis__tabs {
  display: flex;
  flex: none;
  gap: var(--tz-space-1);
  border-bottom: 1px solid var(--tz-border);
}

/* Pestañas: rótulo condensado en mayúsculas (D47). */
.tz-analysis__tab {
  min-height: var(--tz-hit-min);
  padding: 0 var(--tz-space-4);
  border: 0;
  border-bottom: 3px solid transparent;
  background: transparent;
  color: var(--tz-text-muted);
  font-family: var(--tz-font-display);
  font-size: var(--tz-text-sm);
  font-weight: var(--tz-weight-semibold);
  letter-spacing: var(--tz-tracking-caps);
  text-transform: uppercase;
  cursor: pointer;
  transition:
    color var(--tz-dur-fast) var(--tz-ease-standard),
    border-color var(--tz-dur-fast) var(--tz-ease-standard);
}

/*
 * Pestaña activa: el piano (kerb) como borde inferior (D47: solo aquí y bajo la marca). El color del borde queda de
 * respaldo para los colores forzados, que no pintan imágenes de borde.
 */
.tz-analysis__tab[aria-selected='true'] {
  border-bottom-color: var(--tz-accent);
  border-image: var(--tz-kerb) 0 0 1 0 / 0 0 3px 0;
  color: var(--tz-text);
}

@media (hover: hover) {
  .tz-analysis__tab:hover {
    color: var(--tz-text);
  }

  .tz-analysis__switch:hover {
    border-color: var(--tz-accent);
  }
}

.tz-analysis__panel {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}
</style>
