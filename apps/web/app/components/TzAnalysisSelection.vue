<script setup lang="ts">
/**
 * Coche elegido en la cabecera de la hoja de análisis (D49): «Elegido ALO · la cámara lo sigue ▾ ×» o, sin ninguno,
 * «Elegir piloto ▾». La hoja tapa el panel de telemetría (donde están «Vista general» y su ×) y Esc cierra antes la hoja:
 * desde aquí se elige otro piloto o ninguno sin salir del análisis.
 *
 * - El botón despliega la lista de pilotos (botón con `aria-haspopup="listbox"` y su listbox, con
 *   `aria-activedescendant` como la paleta de comandos): «Ninguno» y cada piloto de la sesión con su puesto en la
 *   clasificación del instante (sin dato, «—»), la muestra de su equipo (discontinua para el segundo piloto) y su
 *   sigla, en el orden de la clasificación al abrirla (no baila mientras está abierta).
 * - Elegir a otro lo destaca en las gráficas y, si la cámara seguía al anterior, pasa a seguirlo (`selectCar` no toca
 *   el seguimiento); «Ninguno» es lo mismo que el ×: quita la selección y el seguimiento.
 * - Teclado: Intro, espacio, ↓ o ↑ la abren; dentro, ↑/↓, Inicio, Fin y teclear la sigla mueven, Intro o espacio eligen
 *   y Esc o Tab la cierran sin elegir (Esc no llega a cerrar la hoja). Al elegir o cerrar, el foco vuelve al botón;
 *   ninguna tecla llega a los atajos del replay mientras está abierta. Un clic fuera la cierra.
 * - El × quita la selección de un clic; el foco pasa al botón, que ya dice «Elegir piloto».
 * - Coche elegido = borde de pintura de 1 px, como la entrada destacada de la leyenda; nunca la placa maciza, que es
 *   «activado» (D47). Desplegado, el relleno suave.
 */
import { driverStyles } from '~/analysis/chart'
import { type PickerOption, pickerOptions, typeahead } from '~/analysis/selection'
import { getRuntime, usePlaybackStore } from '~/stores/playback'

const { t } = useI18n()
const rt = getRuntime()!
const playback = usePlaybackStore()
const styles = driverStyles(rt.drivers)

const root = ref<HTMLElement | null>(null)
const button = ref<HTMLButtonElement | null>(null)
const list = ref<HTMLElement | null>(null)

const car = computed(() => playback.selectedCar)
const style = computed(() => (car.value ? styles.get(car.value) : undefined))
const driver = computed(() => style.value?.label ?? car.value ?? '')

const id = useId()
const listId = `${id}-list`
/** Clave de una opción: el número del coche, o '' para «Ninguno». */
const optionId = (key: string) => `${id}-opt-${key === '' ? 'none' : key.replace(/[^\w-]/g, '_')}`

// --- Lista ---

const open = ref(false)
/** Pilotos al abrir (la clasificación de ese instante): la lista no se reordena mientras está abierta. */
const options = shallowRef<PickerOption[]>([])
/** Opción activa (la del foco del teclado): número del coche, o '' para «Ninguno». */
const active = ref('')
const keys = computed(() => ['', ...options.value.map((o) => o.car)])
const labels = computed(() => [t('analysis.selection.none'), ...options.value.map((o) => o.tla)])
/** Alto máximo de la lista (px): lo que quede hasta el borde de abajo de la hoja (que recorta lo que se salga). */
const maxHeight = ref<number | null>(null)
/** Desplazamiento horizontal (px) para que la lista quede dentro de la hoja. */
const shift = ref(0)
const listStyle = computed(() => ({
  ...(maxHeight.value !== null ? { '--list-max': `${maxHeight.value}px` } : {}),
  ...(shift.value ? { transform: `translateX(${shift.value}px)` } : {}),
}))

const MARGIN_PX = 8
/** Lo tecleado para buscar por sigla (se vacía tras una pausa y al abrir la lista). */
let typed = ''
let typedAt = 0
const TYPEAHEAD_MS = 700

function rows() {
  try {
    return rt.leaderboard.compute(rt.clock.timeMs, rt.model.states)
  } catch {
    return []
  }
}

/** Dentro de la hoja: alto hasta su borde de abajo y, si se sale por un lado, desplazada lo justo. */
function fit() {
  const el = list.value
  if (!open.value || !el) return
  const sheet = root.value?.closest('[data-testid="analysis-sheet"]')?.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  const bottom = sheet ? sheet.bottom : window.innerHeight
  maxHeight.value = Math.max(120, Math.floor(bottom - r.top - MARGIN_PX))
  const lo = (sheet?.left ?? 0) + MARGIN_PX
  const hi = (sheet?.right ?? document.documentElement.clientWidth) - MARGIN_PX
  const left = r.left - shift.value
  const right = r.right - shift.value
  shift.value = right > hi ? Math.max(lo - left, hi - right) : left < lo ? lo - left : 0
}

async function show() {
  if (open.value) return
  options.value = pickerOptions(rows(), rt.drivers, styles)
  active.value = car.value ?? ''
  typed = ''
  maxHeight.value = null
  shift.value = 0
  open.value = true
  await nextTick()
  fit()
  list.value?.focus()
  scrollActive(true)
}

/** Cierra la lista; con `focus`, el foco vuelve al botón. */
function hide(focus: boolean) {
  if (!open.value) return
  open.value = false
  if (focus) button.value?.focus()
}

function toggle() {
  if (open.value) hide(true)
  else void show()
}

function choose(next: string | null) {
  hide(true)
  // Otro clic en el elegido lo deja como está (nunca lo quita).
  if (next === playback.selectedCar) return
  playback.selectCar(next)
}

/** × : quita la selección (y el seguimiento); el foco, al botón, que ya dice «Elegir piloto». */
async function clear() {
  hide(false)
  playback.selectCar(null)
  await nextTick()
  button.value?.focus()
}

/**
 * La opción activa, a la vista dentro de la lista (sin desplazar la hoja ni la página, como haría `scrollIntoView`): al
 * abrirla, centrada (se ven los de delante y los de detrás del elegido); al moverse, lo justo.
 */
function scrollActive(center = false) {
  void nextTick(() => {
    const el = list.value
    const opt = document.getElementById(optionId(active.value))
    if (!el || !opt) return
    const top = opt.offsetTop
    const bottom = top + opt.offsetHeight
    if (center) el.scrollTop = Math.max(0, top - (el.clientHeight - opt.offsetHeight) / 2)
    else if (top < el.scrollTop) el.scrollTop = top
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight
  })
}

function move(to: number) {
  const k = keys.value
  if (!k.length) return
  active.value = k[Math.min(Math.max(0, to), k.length - 1)]!
  scrollActive()
}

function onButtonKeydown(event: KeyboardEvent) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  // Las flechas abren la lista (y no llegan al atajo de elegir el coche anterior o siguiente).
  event.preventDefault()
  void show()
}

function onListKeydown(event: KeyboardEvent) {
  // Ninguna tecla llega a los atajos del replay (flechas, espacio, 1–5…).
  event.stopPropagation()
  if (event.isComposing) return
  const i = keys.value.indexOf(active.value)
  switch (event.key) {
    case 'Escape':
      event.preventDefault()
      hide(true)
      return
    case 'Tab':
      // Sin elegir; el foco sigue desde el botón (Tab al siguiente control, Mayús+Tab al anterior).
      hide(true)
      return
    case 'ArrowDown':
      event.preventDefault()
      move(i + 1)
      return
    case 'ArrowUp':
      event.preventDefault()
      move(i - 1)
      return
    case 'Home':
    case 'PageUp':
      event.preventDefault()
      move(0)
      return
    case 'End':
    case 'PageDown':
      event.preventDefault()
      move(keys.value.length - 1)
      return
    case 'Enter':
    case ' ':
      event.preventDefault()
      choose(active.value === '' ? null : active.value)
      return
  }
  if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && /\p{L}/u.test(event.key)) {
    event.preventDefault()
    const now = performance.now()
    typed = now - typedAt > TYPEAHEAD_MS ? event.key : typed + event.key
    typedAt = now
    const next = typeahead(labels.value, i, typed)
    if (next >= 0) move(next)
  }
}

/** Un clic o un toque fuera la cierra (sin mover el foco: va a donde se pulsó). */
function onOutside(event: PointerEvent) {
  if (open.value && root.value && !root.value.contains(event.target as Node | null)) hide(false)
}

/** El foco sale de la lista a otro sitio (no a su botón): se cierra. */
function onFocusOut(event: FocusEvent) {
  const to = event.relatedTarget as Node | null
  if (to && root.value?.contains(to)) return
  hide(false)
}

watch(open, (isOpen) => {
  if (isOpen) {
    document.addEventListener('pointerdown', onOutside, true)
    window.addEventListener('resize', fit)
  } else {
    document.removeEventListener('pointerdown', onOutside, true)
    window.removeEventListener('resize', fit)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onOutside, true)
  window.removeEventListener('resize', fit)
})

const buttonName = computed(() => {
  if (!car.value) return undefined
  return playback.following ? t('analysis.selection.changeFollowing', { driver: driver.value }) : t('analysis.selection.change', { driver: driver.value })
})
const swatchStyle = (color: string | null | undefined) => (color ? { '--swatch': color } : undefined)
</script>

<template>
  <div
    ref="root"
    role="group"
    class="tz-aselect"
    :class="{ 'is-chosen': !!car, 'is-open': open }"
    :aria-label="car ? t('analysis.selection.group', { driver }) : t('analysis.selection.groupNone')"
    data-testid="analysis-selection"
    :data-car="car ?? undefined"
    :data-following="playback.following"
  >
    <button
      ref="button"
      type="button"
      class="tz-aselect__btn"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-controls="open ? listId : undefined"
      :aria-label="buttonName"
      :title="car ? buttonName : t('analysis.selection.chooseHint')"
      data-testid="analysis-selection-picker"
      @click="toggle()"
      @keydown="onButtonKeydown"
    >
      <template v-if="car">
        <span class="tz-aselect__swatch" :class="{ 'is-dash': style?.dash }" :style="swatchStyle(style?.color)" aria-hidden="true" />
        <span class="tz-aselect__label">{{ t('analysis.selection.label') }}</span>
        <span class="tz-aselect__tla">{{ driver }}</span>
        <span v-if="playback.following" class="tz-aselect__follow">· {{ t('analysis.selection.following') }}</span>
      </template>
      <span v-else class="tz-aselect__choose">{{ t('analysis.selection.choose') }}</span>
      <TzIcon name="chevron" size="sm" class="tz-aselect__chevron" />
    </button>
    <button
      v-if="car"
      type="button"
      class="tz-iconbtn tz-aselect__clear"
      :aria-label="playback.following ? t('analysis.selection.clearFollowing', { driver }) : t('analysis.selection.clear', { driver })"
      :title="playback.following ? t('analysis.selection.clearFollowing', { driver }) : t('analysis.selection.clear', { driver })"
      data-testid="analysis-selection-clear"
      @click="clear()"
    >
      <TzIcon name="close" size="sm" />
    </button>

    <div
      v-if="open"
      :id="listId"
      ref="list"
      class="tz-aselect__list"
      role="listbox"
      tabindex="0"
      :aria-label="t('analysis.selection.list')"
      :aria-activedescendant="optionId(active)"
      :style="listStyle"
      data-testid="analysis-selection-list"
      @keydown="onListKeydown"
      @focusout="onFocusOut"
    >
      <div
        :id="optionId('')"
        class="tz-aselect__option is-none"
        :class="{ 'is-active': active === '' }"
        role="option"
        :aria-selected="!car"
        data-testid="analysis-selection-option"
        data-car=""
        @mousedown.prevent
        @pointermove="active = ''"
        @click="choose(null)"
      >
        <span class="tz-aselect__pos" aria-hidden="true" />
        <span class="tz-aselect__swatch is-none" aria-hidden="true" />
        <span class="tz-aselect__text">
          <span class="tz-aselect__name-main">{{ t('analysis.selection.none') }}</span>
          <span v-if="car" class="tz-aselect__name">{{
            playback.following ? t('analysis.selection.noneHintFollowing') : t('analysis.selection.noneHint')
          }}</span>
        </span>
        <TzIcon v-if="!car" name="check" size="sm" class="tz-aselect__check" />
      </div>
      <div
        v-for="o in options"
        :id="optionId(o.car)"
        :key="o.car"
        class="tz-aselect__option"
        :class="{ 'is-active': active === o.car }"
        role="option"
        :aria-selected="o.car === car"
        data-testid="analysis-selection-option"
        :data-car="o.car"
        @mousedown.prevent
        @pointermove="active = o.car"
        @click="choose(o.car)"
      >
        <span class="tz-aselect__pos tz-tabular">
          <template v-if="o.position !== null">{{ t('analysis.selection.position', { pos: o.position }) }}</template>
          <template v-else>
            <span aria-hidden="true">—</span>
            <span class="tz-visually-hidden">{{ t('analysis.selection.noPosition') }}</span>
          </template>
        </span>
        <span class="tz-aselect__swatch" :class="{ 'is-dash': o.dash }" :style="swatchStyle(o.color)" aria-hidden="true" />
        <span class="tz-aselect__text">
          <span class="tz-aselect__tla">{{ o.tla }}</span>
          <span v-if="o.name" class="tz-aselect__name">{{ o.name }}</span>
        </span>
        <TzIcon v-if="o.car === car" name="check" size="sm" class="tz-aselect__check" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.tz-aselect {
  position: relative;
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 var(--tz-space-0-5) 0 0;
  border: 1px solid var(--tz-border-strong);
  border-radius: var(--tz-radius-pill);
  background: var(--tz-surface-2);
  font-size: var(--tz-text-sm);
  white-space: nowrap;
  /* Sin animación de entrada: está siempre, y una animación con relleno le daría su propio contexto de apilamiento
     (la lista quedaría debajo de las gráficas). */
}

/* Sin coche elegido, sin × : el botón llega al borde. */
.tz-aselect:not(.is-chosen) {
  padding-right: 0;
}

/* Coche elegido: borde de pintura de 1 px (nunca la placa maciza, D47). */
.tz-aselect.is-chosen {
  border-color: var(--tz-accent);
}

/* Desplegado: el relleno suave con borde de pintura (como un menú abierto). */
.tz-aselect.is-open {
  border-color: var(--tz-accent);
  background: var(--tz-accent-soft);
}

.tz-aselect__btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: var(--tz-space-2);
  min-height: 26px;
  padding: 0 var(--tz-space-2) 0 var(--tz-space-3);
  border: 0;
  border-radius: var(--tz-radius-pill);
  background: transparent;
  color: var(--tz-text);
  font: inherit;
  cursor: pointer;
}

/* Zona táctil de --tz-hit-min con puntero grueso, sin mover el layout. */
.tz-aselect__btn::after {
  content: '';
  position: absolute;
  inset: min(0px, calc((100% - var(--tz-hit-min)) / 2)) 0;
}

@media (hover: hover) {
  .tz-aselect:not(.is-open):has(.tz-aselect__btn:hover) {
    border-color: var(--tz-accent);
  }
}

/* Muestra del coche: el trazo de su serie, como en la leyenda (discontinuo para el segundo piloto de su equipo). */
.tz-aselect__swatch {
  flex: none;
  width: 14px;
  height: 0;
  border-top: 2px solid var(--swatch, var(--tz-team-unknown));
}

.tz-aselect__swatch.is-dash {
  border-top-style: dashed;
}

/* «Ninguno»: sin color de equipo, solo el hueco de la muestra. */
.tz-aselect__swatch.is-none {
  border-top-color: transparent;
}

.tz-aselect__label {
  color: var(--tz-text-muted);
}

.tz-aselect__choose {
  font-weight: var(--tz-weight-semibold);
}

.tz-aselect__tla {
  font-family: var(--tz-font-mono);
  font-weight: var(--tz-weight-semibold);
  letter-spacing: var(--tz-tracking-mono);
  color: var(--tz-text);
}

.tz-aselect__follow {
  font-size: var(--tz-text-xs);
  color: var(--tz-text-muted);
}

.tz-aselect__chevron {
  flex: none;
  color: var(--tz-text-muted);
  transition: transform var(--tz-dur-fast) var(--tz-ease-standard);
}

.tz-aselect.is-open .tz-aselect__chevron {
  transform: rotate(180deg);
}

/* 24 px visibles; su ::after (de .tz-iconbtn) lleva la zona táctil a --tz-hit-min. */
.tz-aselect__clear {
  width: var(--tz-space-6);
  height: var(--tz-space-6);
}

/* Lista: bajo el control, alineada a su izquierda (se desplaza si se sale de la hoja), por encima de las gráficas. */
.tz-aselect__list {
  position: absolute;
  top: calc(100% + var(--tz-space-1));
  left: 0;
  z-index: var(--tz-z-overlay);
  display: grid;
  gap: 1px;
  min-width: max(100%, 260px);
  max-height: min(var(--list-max, 70vh), 520px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--tz-space-1) 0;
  border: 1px solid var(--tz-border-strong);
  border-radius: var(--tz-radius-md);
  background: var(--tz-surface-2);
  box-shadow: var(--tz-shadow-panel);
  white-space: nowrap;
  animation: tz-enter var(--tz-dur-fast) var(--tz-ease-enter) both;
}

/* El foco está en la lista; la opción activa se marca como en la paleta de comandos. */
.tz-aselect__list:focus-visible {
  outline-offset: -2px;
}

/* Una opción: puesto, muestra, sigla y nombre, y la marca de la elegida. Alto de --tz-hit-min (44 px en táctil). */
.tz-aselect__option {
  display: flex;
  align-items: center;
  gap: var(--tz-space-2);
  min-height: var(--tz-hit-min);
  margin: 0 var(--tz-space-1);
  padding: 0 var(--tz-space-2);
  border-radius: var(--tz-radius-md);
  cursor: pointer;
}

.tz-aselect__option.is-active {
  background: var(--tz-accent-soft);
  box-shadow: inset 2px 0 0 var(--tz-accent);
}

.tz-aselect__option.is-none {
  margin-bottom: var(--tz-space-1);
  box-shadow: 0 1px 0 var(--tz-border);
}

.tz-aselect__option.is-none.is-active {
  box-shadow:
    inset 2px 0 0 var(--tz-accent),
    0 1px 0 var(--tz-border);
}

.tz-aselect__pos {
  flex: none;
  min-width: 3ch;
  font-family: var(--tz-font-mono);
  font-size: var(--tz-text-xs);
  color: var(--tz-text-muted);
  text-align: right;
}

.tz-aselect__text {
  display: flex;
  flex: 1 1 auto;
  align-items: baseline;
  gap: var(--tz-space-2);
  min-width: 0;
}

.tz-aselect__name-main {
  font-weight: var(--tz-weight-semibold);
}

.tz-aselect__name {
  overflow: hidden;
  font-size: var(--tz-text-xs);
  color: var(--tz-text-muted);
  text-overflow: ellipsis;
}

.tz-aselect__check {
  flex: none;
  margin-left: auto;
  color: var(--tz-accent-strong);
}

/* Estrecho (tablet en vertical): sin «la cámara lo sigue» (el nombre del botón y el del × lo siguen diciendo). */
@media (width < 900px) {
  .tz-aselect__follow {
    display: none;
  }
}
</style>
