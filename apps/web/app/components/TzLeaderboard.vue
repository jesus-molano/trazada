<script setup lang="ts">
/**
 * Leaderboard del replay: posición, gap/intervalo, neumático y estado de cada piloto, y detrás las columnas de otras
 * funciones (hueco `components/leaderboard-cells/`, D29) que salen en el diseño `preset`.
 *
 * Clasificación animada (ítem 8, D42): al cambiar el orden, las filas se deslizan (FLIP de <TransitionGroup>) solo
 * con reproducción a ≤ ×4 y sin salto del reloj; con reduced motion, al instante. Una fila que gana o pierde puestos
 * lleva unos segundos una flecha con la cifra y su texto (nunca solo el color) y un destello breve.
 *
 * Comparar dos pilotos (ítem 1, D31): con un coche seleccionado, Mayús+clic en otra fila lo elige para comparar (otra
 * vez, lo quita). Mientras se compara, las dos filas llevan su marca «A» y «B» (letra y texto, con el color de cada uno).
 *
 * Jerarquía (D44, D47): posiciones en la condensada, cada fila con su `--team` (franja y, en la fila elegida, un tinte
 * y un filo; nunca como color de texto), el modo del gap como control segmentado (la opción elegida, placa maciza) y la
 * bandera azul con su icono, su título y su texto (nunca solo el color).
 *
 * Diseños (ítem 15): el ancho sale de la página (`--replay-lb-w`, que el usuario cambia con el asa que la página pone
 * en el hueco por defecto); en «Análisis», las columnas opcionales llevan su rótulo encima y, si alguna enseña algo
 * estimado (la vuelta 1 en «Última»), su etiqueta «Estimado» va en el pie (dentro del botón de una fila no cabe un
 * control). Microinteracciones (21b, D42): los chips PIT y «sin señal» entran con un fundido solo con reproducción a
 * ≤ ×4 (tras un seek, al instante) y la fila elegida con el teclado o la paleta se desplaza a la vista.
 */
import type { RankBadge } from '~/composables/useLeaderboard'
import { LIST_MOTION_MAX_RATE, useReducedMotion } from '~/design/motion'
import { BLUE_FLAG_MS, type LeaderboardRow } from '~/engine/leaderboard/leaderboard'
import { compoundLetter, compoundToken } from '~/engine/timing/compound'
import { cellsFor, LEADERBOARD_CELLS, type LayoutPreset } from '~/slots/leaderboard-cells'
import { useCompareStore } from '~/stores/compare'
import { usePlaybackStore } from '~/stores/playback'
import { useSessionStore } from '~/stores/session'
import { useSettingsStore } from '~/stores/settings'

const props = withDefaults(defineProps<{ preset?: LayoutPreset }>(), { preset: 'spectator' })
const cells = computed(() => cellsFor(LEADERBOARD_CELLS, props.preset))
/** Rótulos de las columnas extra (diseño «Análisis»): solo si alguna lo trae. */
const labelled = computed(() => cells.value.some((c) => c.label !== null))
/** Lo estimado que enseñan ahora las celdas (su etiqueta «Estimado» va en el pie). */
const { fields: estimatedFields } = provideLeaderboardEstimated()
/**
 * Pistas de la rejilla de cada fila para las columnas extra (solo si hay alguna) y lo que se ensancha el panel por
 * ellas (sus anchos más un hueco de la rejilla por cada una): las columnas fijas no ceden sitio.
 */
const cellsStyle = computed(() => {
  const widths = cells.value.map((c) => c.width)
  if (!widths.length) return undefined
  return { '--lb-cells': widths.join(' '), '--lb-cells-w': `calc(${widths.join(' + ')} + ${widths.length} * var(--lb-gap))` }
})

const { t, locale } = useI18n()
const playback = usePlaybackStore()
const settings = useSettingsStore()
const compare = useCompareStore()
const { rows, animate, changes, announcement, race } = useLeaderboard()
settings.hydrate()
const reduced = useReducedMotion()
/** Con reproducción a ≤ ×4 y movimiento permitido, los chips que entran lo hacen con un fundido (tras un seek, no). */
const live = computed(() => playback.playing && playback.rate <= LIST_MOTION_MAX_RATE && !reduced.value)
const season = useSessionStore().data?.manifest.session.season ?? 0
/** Color del compuesto (según la temporada) para el borde de su letra. */
const compoundStyle = (compound: string) => ({ '--compound': `var(${compoundToken(season, compound)})` })
/** Color del equipo de una fila (franja y tinte de la fila elegida); sin dato, el gris de «sin dato», nunca uno inventado. */
const teamStyle = (r: LeaderboardRow) => ({ '--team': r.driver?.color || 'var(--tz-team-unknown)' })
/** Compuesto y vueltas del neumático: título (ratón) y texto para lectores de pantalla (en iPad un título no se ve). */
function tyreText(r: LeaderboardRow): string {
  const compound = t(`compound.${r.compound}`)
  return r.tyreLife === null ? t('leaderboard.tyreNoLife', { compound }) : t('leaderboard.tyre', { compound, laps: r.tyreLife }, r.tyreLife)
}

const gapFmt = computed(() => new Intl.NumberFormat(locale.value, { minimumFractionDigits: 3, maximumFractionDigits: 3 }))

function gapText(r: LeaderboardRow): string {
  if (r.position === 1 && r.positionKnown) return r.gapMs === null && r.bestLapMs === null ? '' : t('leaderboard.leader')
  if (r.lapsBehind > 0 && settings.gapMode === 'leader') return t('leaderboard.lapsBehind', { n: r.lapsBehind })
  const ms = settings.gapMode === 'leader' ? r.gapMs : r.intervalMs
  // Un gap negativo no existe: sin dato (el motor ya no los da; esto lo garantiza en pantalla).
  if (ms === null || ms < 0) return '—'
  const s = ms / 1000
  const fmt = gapFmt.value
  if (s >= 60) {
    const m = Math.floor(s / 60)
    return `+${m}:${fmt.format(s - m * 60).padStart(6, '0')}`
  }
  return `+${fmt.format(s)}`
}

/** Filas con su flecha de cambio de puesto (null si no la llevan). */
const items = computed(() => rows.value.map((r) => ({ r, b: changes.value.get(r.car) ?? null })))

/** «ganó 2 posiciones» / «perdió 1 posición». */
function changeText(b: Pick<RankBadge, 'delta'>): string {
  const n = Math.abs(b.delta)
  return b.delta > 0 ? t('rank.gained', { n }, n) : t('rank.lost', { n }, n)
}

/** Lo que compara la flecha: el orden anterior en carrera; el orden por mejor vuelta en libres y clasificación. */
function changeTitle(b: Pick<RankBadge, 'delta'>): string {
  const change = changeText(b)
  return race ? t('rank.titleRace', { change }) : t('rank.titleBestLap', { change })
}

/** Resumen para lectores de pantalla (aria-live, como mucho uno cada pocos segundos). */
const liveText = computed(() => {
  const a = announcement.value
  if (!a) return ''
  const parts = a.items.map((i) => t('rank.announceItem', { driver: i.tla, change: changeText(i), position: i.position }))
  if (a.more > 0) parts.push(t('rank.announceMore', { n: a.more }))
  return [race ? t('rank.announceRace') : t('rank.announceBestLap'), ...parts].join(' ')
})

function select(car: string) {
  playback.selectCar(playback.selectedCar === car ? null : car)
}

/** Clic en una fila: selecciona (o deselecciona); con Mayús y un coche ya seleccionado, lo elige para comparar. */
function onRow(car: string, event: MouseEvent) {
  if (event.shiftKey && compare.pick(car)) return
  select(car)
}

/** Mayús+clic no debe seleccionar el texto de las filas. */
function onRowDown(event: MouseEvent) {
  if (event.shiftKey) event.preventDefault()
}

const root = ref<HTMLElement | null>(null)

/**
 * La fila elegida (con ↑/↓, la paleta o el mapa) se desplaza a la vista dentro de la lista, sin mover nada más de la
 * página; con reduced motion, sin animación.
 */
function reveal(car: string) {
  const list = root.value?.querySelector<HTMLElement>('.tz-lb__rows')
  const row = list && [...list.children].find((el) => (el as HTMLElement).dataset.car === car)
  if (!list || !row) return
  const lr = list.getBoundingClientRect()
  const rr = row.getBoundingClientRect()
  const delta = rr.top < lr.top ? rr.top - lr.top : rr.bottom > lr.bottom ? rr.bottom - lr.bottom : 0
  if (delta !== 0 && typeof list.scrollBy === 'function') list.scrollBy({ top: delta, behavior: reduced.value ? 'auto' : 'smooth' })
}

watch(
  () => playback.selectedCar,
  async (car) => {
    if (!car) return
    await nextTick()
    reveal(car)
  },
)

/** «A» (el seleccionado) o «B» (el comparado) mientras se compara. */
function compareRole(car: string): 'a' | 'b' | null {
  if (!compare.comparing) return null
  if (car === playback.selectedCar) return 'a'
  return car === compare.compareCar ? 'b' : null
}
</script>

<template>
  <section
    id="tz-leaderboard"
    ref="root"
    class="tz-lb"
    :class="{ 'has-cells': cells.length > 0, 'has-labels': labelled }"
    :style="cellsStyle"
    :aria-label="t('leaderboard.title')"
    :data-preset="preset"
    data-testid="leaderboard"
  >
    <header class="tz-lb__head">
      <h2 class="tz-panel-title tz-lb__title">{{ t('leaderboard.title') }}</h2>
      <div class="tz-segmented tz-lb__modes" role="group" :aria-label="t('leaderboard.gapMode')">
        <button
          type="button"
          class="tz-lb__mode"
          :aria-pressed="settings.gapMode === 'leader'"
          data-testid="gap-leader"
          @click="settings.setGapMode('leader')"
        >
          {{ t('leaderboard.toLeader') }}
        </button>
        <button
          type="button"
          class="tz-lb__mode"
          :aria-pressed="settings.gapMode === 'interval'"
          data-testid="gap-interval"
          @click="settings.setGapMode('interval')"
        >
          {{ t('leaderboard.interval') }}
        </button>
      </div>
    </header>

    <!-- Rótulos de las columnas extra (cada celda lleva además su título y su texto para lectores de pantalla). -->
    <div v-if="labelled" class="tz-lb__cols" aria-hidden="true" data-testid="lb-columns">
      <span class="tz-lb__colfixed" />
      <span v-for="c in cells" :key="c.name" class="tz-lb__col" :data-cell="c.name"><template v-if="c.label">{{ t(c.label) }}</template></span>
    </div>

    <!-- Sin animación (move-class sin transición), Vue no desliza las filas: ×8/×16, saltos y reduced motion. -->
    <TransitionGroup
      tag="ol"
      class="tz-lb__rows"
      role="list"
      :move-class="animate ? 'tz-lb-move' : 'tz-lb-still'"
      data-testid="lb-rows"
    >
      <li
        v-for="{ r, b } in items"
        :key="r.car"
        class="tz-lb__row"
        :class="{ 'is-selected': playback.selectedCar === r.car, 'is-nosignal': r.noSignal, 'is-compare': compareRole(r.car) === 'b' }"
        :data-car="r.car"
        :data-position="r.position"
        :data-position-known="r.positionKnown"
        :data-change="b ? (b.delta > 0 ? 'up' : 'down') : undefined"
        :data-compare="compareRole(r.car) ?? undefined"
        :style="teamStyle(r)"
      >
        <button
          type="button"
          class="tz-lb__btn"
          :aria-pressed="playback.selectedCar === r.car"
          @mousedown="onRowDown"
          @click="onRow(r.car, $event)"
        >
          <span
            class="tz-lb__pos tz-tabular"
            :title="r.positionKnown ? undefined : t('leaderboard.positionUnknown')"
            data-testid="lb-position"
          >{{ r.positionKnown ? r.position : '—' }}</span>
          <span class="tz-lb__team" aria-hidden="true" />
          <span class="tz-lb__tla">{{ r.driver?.tla ?? r.car }}</span>
          <span class="tz-lb__flags">
            <span
              v-if="compareRole(r.car)"
              class="tz-lb__chip tz-lb__role"
              :class="`is-${compareRole(r.car)}`"
              :title="compareRole(r.car) === 'a' ? t('compare.roleATitle') : t('compare.roleBTitle')"
              data-testid="compare-role"
            >
              <span aria-hidden="true">{{ compareRole(r.car) === 'a' ? t('compare.roleA') : t('compare.roleB') }}</span>
              <span class="tz-visually-hidden">{{ compareRole(r.car) === 'a' ? t('compare.roleATitle') : t('compare.roleBTitle') }}</span>
            </span>
            <span
              v-if="b"
              class="tz-lb__change"
              :class="b.delta > 0 ? 'is-gain' : 'is-loss'"
              :title="changeTitle(b)"
              data-testid="rank-change"
            >
              <TzIcon :name="b.delta > 0 ? 'gain' : 'loss'" size="sm" />
              <span class="tz-tabular" aria-hidden="true">{{ Math.abs(b.delta) }}</span>
              <span class="tz-visually-hidden">{{ changeText(b) }}</span>
            </span>
            <span
              v-if="r.blueFlag && settings.showBlueFlags"
              class="tz-lb__blue"
              :title="t('leaderboard.blueFlag', { s: BLUE_FLAG_MS / 1000 })"
              data-testid="blue-flag"
            >
              <TzIcon name="flag" size="sm" />
              <span class="tz-visually-hidden">{{ t('leaderboard.blueFlag', { s: BLUE_FLAG_MS / 1000 }) }}</span>
            </span>
            <Transition name="tz-lb-chip" :css="live">
              <span v-if="r.inPit" key="pit" class="tz-lb__chip tz-lb__chip--pit">{{ t('leaderboard.pit') }}</span>
              <span v-else-if="r.noSignal" key="nosignal" class="tz-lb__chip" data-testid="no-signal">{{ t('leaderboard.noSignal') }}</span>
            </Transition>
          </span>
          <span class="tz-lb__gap tz-tabular">{{ gapText(r) }}</span>
          <span class="tz-lb__tyre" :style="compoundStyle(r.compound)" :title="tyreText(r)">
            <span class="tz-lb__compound" :class="{ 'is-long': compoundLetter(r.compound).length > 1 }" aria-hidden="true">{{
              compoundLetter(r.compound)
            }}</span>
            <span class="tz-lb__life tz-tabular" aria-hidden="true">{{ r.tyreLife ?? '' }}</span>
            <span class="tz-visually-hidden">{{ tyreText(r) }}</span>
          </span>
          <component :is="c.component" v-for="c in cells" :key="c.name" :row="r" :preset="preset" />
        </button>
        <!-- Destello único por cambio (la clave lo repite con el siguiente); encima del botón, sin captar clics. -->
        <span
          v-if="b?.flash"
          :key="b.seq"
          class="tz-lb__flash"
          :class="b.delta > 0 ? 'is-gain' : 'is-loss'"
          aria-hidden="true"
          data-testid="rank-flash"
        />
      </li>
    </TransitionGroup>
    <p class="tz-visually-hidden" role="status" aria-live="polite" data-testid="rank-live">{{ liveText }}</p>

    <label class="tz-lb__opt">
      <input
        type="checkbox"
        :checked="settings.showBlueFlags"
        data-testid="toggle-blue-flags"
        @change="settings.setShowBlueFlags(($event.target as HTMLInputElement).checked)"
      >
      {{ t('leaderboard.showBlueFlags') }}
    </label>
    <!-- Etiquetas «Estimado» de lo que enseñan las columnas (la vuelta 1 estimada en «Última»), mientras se vea. -->
    <p v-if="estimatedFields.length" class="tz-lb__estimated" data-testid="lb-estimated">
      <TzEstimated v-for="f in estimatedFields" :key="f" :field="f" />
      <span class="tz-lb__estimated-note">{{ t('layout.cells.estimatedNote') }}</span>
    </p>
    <!-- Asa para cambiar el ancho (la pone la página, salvo en tablet en vertical). -->
    <slot />
  </section>
</template>

<style scoped>
.tz-lb {
  /*
   * Columnas fijas de cada fila; con celdas de otras funciones (leaderboard-cells/), sus pistas van detrás y el panel
   * se ensancha lo que ocupan (`--lb-cells-w`).
   */
  --lb-cols: 22px 4px 38px 1fr 76px 38px;
  --lb-gap: var(--tz-space-2);
  /* Ancho elegido con el asa o el del diseño (lo pone la página); sin página, el de los tokens. */
  --lb-w: var(--replay-lb-w, var(--tz-panel-w));
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  width: var(--lb-w);
  max-height: 100%;
  padding: var(--tz-space-2);
  border: 1px solid var(--tz-border);
  border-radius: var(--tz-radius-lg);
  background: var(--tz-overlay);
  box-shadow: var(--tz-shadow-panel);
}

.tz-lb__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--tz-space-2);
  padding: var(--tz-space-1) var(--tz-space-2) var(--tz-space-2);
}

/* Título de panel común (.tz-panel-title: condensada, mayúsculas, --tz-tracking-caps, una línea). */
.tz-lb__title {
  flex: 0 1 auto;
}

/* «Líder / Intervalo»: control segmentado (.tz-segmented); la opción elegida es una placa maciza de pintura. */
.tz-lb__modes {
  flex: none;
}

.tz-lb__rows {
  flex: 1;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
  /* El FLIP mide las filas en cada reordenación: que el reflow no salga de la lista. */
  contain: layout paint;
}

.tz-lb__row {
  position: relative;
}

/* Reordenación (FLIP): solo transform y solo cuando se anima (move-class `tz-lb-still`, sin transición, si no). */
.tz-lb-move {
  transition: transform var(--tz-dur-slow) var(--tz-ease-standard);
}

/* Destello único al ganar o perder puestos: un velo del color del cambio que se desvanece (con reduce, 0 ms). */
.tz-lb__flash {
  position: absolute;
  inset: 0;
  border-radius: var(--tz-radius-sm);
  opacity: 0;
  pointer-events: none;
  animation: tz-lb-flash var(--tz-dur-flash) var(--tz-ease-exit);
}

.tz-lb__flash.is-gain {
  background: var(--tz-gain);
}

.tz-lb__flash.is-loss {
  background: var(--tz-loss);
}

@keyframes tz-lb-flash {
  from {
    opacity: 0.22;
  }
}

/* Flecha ↑↓ con la cifra (y su texto oculto): forma y número, nunca solo el color. */
.tz-lb__change {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 1px;
  font-size: var(--tz-text-2xs);
  font-weight: var(--tz-weight-semibold);
  white-space: nowrap;
}

.tz-lb__change :deep(.tz-icon) {
  width: var(--tz-text-xs);
  height: var(--tz-text-xs);
}

.tz-lb__change.is-gain {
  color: var(--tz-gain);
}

.tz-lb__change.is-loss {
  color: var(--tz-loss);
}

/* Fila de --tz-row-h (densidad: 28 px en pantallas altas, 24 en las bajas); la clasificación cabe entera. */
.tz-lb__btn {
  display: grid;
  grid-template-columns: var(--lb-cols);
  align-items: center;
  gap: var(--lb-gap);
  width: 100%;
  min-height: var(--tz-row-h);
  padding: 3px var(--tz-space-2);
  border: 0;
  border-radius: var(--tz-radius-sm);
  background: transparent;
  font-size: var(--tz-text-sm);
  text-align: start;
  cursor: pointer;
}

.tz-lb.has-cells {
  width: calc(var(--lb-w) + var(--lb-cells-w));
}

.tz-lb.has-cells .tz-lb__btn {
  grid-template-columns: var(--lb-cols) var(--lb-cells);
}

@media (hover: hover) {
  .tz-lb__btn:hover {
    background: var(--tz-surface-2);
  }
}

/*
 * Fila elegida: un tinte del color del equipo (≤ --tz-team-tint) y su filo a la izquierda; sin color-mix, la superficie
 * lisa. El texto sigue en los colores del tema: el color de equipo nunca es color de texto.
 */
.is-selected .tz-lb__btn {
  background: var(--tz-surface-3);
  background: color-mix(in oklab, var(--team) var(--tz-team-tint), var(--tz-surface-2));
  outline: 1px solid var(--tz-border-strong);
  box-shadow: inset 3px 0 0 var(--team);
}

.is-nosignal .tz-lb__tla,
.is-nosignal .tz-lb__gap {
  color: var(--tz-text-faint);
}

/* Posición en la condensada, como en una torre de tiempos pintada. */
.tz-lb__pos {
  font-family: var(--tz-font-display);
  font-weight: var(--tz-weight-semibold);
  color: var(--tz-text-muted);
  text-align: end;
}

.tz-lb__team {
  width: 4px;
  height: 16px;
  border-radius: var(--tz-radius-sm);
  background: var(--team);
}

.tz-lb__tla {
  font-family: var(--tz-font-mono);
  font-weight: var(--tz-weight-semibold);
  letter-spacing: var(--tz-tracking-mono);
}

.tz-lb__flags {
  display: inline-flex;
  align-items: center;
  gap: var(--tz-space-1);
  min-width: 0;
}

/* Bandera azul: el icono teñido (con su título y su texto oculto), nunca un cuadrado de color suelto. */
.tz-lb__blue {
  display: inline-flex;
  flex: none;
  color: var(--tz-flag-blue);
}

.tz-lb__blue :deep(.tz-icon) {
  fill: currentColor;
}

.tz-lb__chip {
  padding: 0 4px;
  border: 1px solid var(--tz-border-strong);
  border-radius: var(--tz-radius-sm);
  font-size: var(--tz-text-2xs);
  color: var(--tz-text-muted);
  white-space: nowrap;
}

.tz-lb__chip--pit {
  border-color: var(--tz-pit);
  color: var(--tz-pit);
}

/* Comparación (ítem 1): «A» y «B» con la letra (y su texto oculto); el color de cada uno solo en el borde. */
.tz-lb__role {
  font-weight: var(--tz-weight-semibold);
  color: var(--tz-text);
}

.tz-lb__role.is-a {
  border-color: var(--tz-compare-a);
}

.tz-lb__role.is-b {
  border-color: var(--tz-compare-b);
}

.is-compare .tz-lb__btn {
  outline: 1px dashed var(--tz-compare-b);
}

.tz-lb__gap {
  font-family: var(--tz-font-mono);
  font-size: var(--tz-text-xs);
  text-align: end;
}

.tz-lb__tyre {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  justify-self: end;
}

.tz-lb__compound {
  display: inline-grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border: 2px solid var(--compound, var(--tz-tyre-unknown));
  border-radius: 50%;
  font-size: var(--tz-text-2xs);
  font-weight: var(--tz-weight-bold);
  line-height: var(--tz-leading-none);
}

/* Compuestos de 2018 con dos letras (HS, US, SS): más juntas y algo menores, dentro del círculo. */
.tz-lb__compound.is-long {
  letter-spacing: -0.06em;
  font-size: calc(var(--tz-text-2xs) * 0.75);
}

.tz-lb__life {
  min-width: 14px;
  font-size: var(--tz-text-2xs);
  color: var(--tz-text-muted);
}

@media (width <= 1100px) {
  .tz-lb {
    --lb-cols: 20px 4px 34px 1fr 64px 38px;
    --lb-gap: 6px;
    --lb-w: var(--replay-lb-w, var(--tz-panel-w-narrow));
  }
}

@media (width <= 900px) and (orientation: portrait) {
  .tz-lb,
  .tz-lb.has-cells {
    width: auto;
  }
}

/*
 * Rótulos de las columnas extra: la misma rejilla que las filas, sobre sus columnas. Los dos reservan el hueco de la
 * barra de desplazamiento de la lista (si la hay), así los rótulos no se desalinean cuando la lista no cabe entera.
 */
.tz-lb.has-labels .tz-lb__rows {
  scrollbar-gutter: stable;
}

/*
 * No encoge (`flex: none`): con `overflow: hidden` (lo pide `scrollbar-gutter`), su alto mínimo automático sería 0 y, con
 * la clasificación más baja que su contenido, la columna lo recortaba a la mitad. Lo que falte lo cede la lista.
 */
.tz-lb__cols {
  flex: none;
  overflow: hidden;
  scrollbar-gutter: stable;
  display: grid;
  grid-template-columns: var(--lb-cols) var(--lb-cells);
  gap: var(--lb-gap);
  padding: 0 var(--tz-space-2) var(--tz-space-0-5);
  font-family: var(--tz-font-display);
  font-size: var(--tz-text-2xs);
  font-weight: var(--tz-weight-semibold);
  letter-spacing: var(--tz-tracking-caps);
  line-height: var(--tz-leading-tight);
  text-transform: uppercase;
  color: var(--tz-text-muted);
}

.tz-lb__colfixed {
  grid-column: 1 / span 6;
}

.tz-lb__col {
  overflow: hidden;
  text-align: end;
  white-space: nowrap;
}

/* Chips PIT y «sin señal» que entran con reproducción a ≤ ×4: un fundido (con reduce, la duración es 0). */
.tz-lb-chip-enter-active {
  animation: tz-fade var(--tz-dur-base) var(--tz-ease-enter);
}

.tz-lb__estimated {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--tz-space-1) var(--tz-space-2);
  margin: 0;
  padding: var(--tz-space-1) var(--tz-space-2) 0;
}

.tz-lb__estimated-note {
  font-size: var(--tz-text-2xs);
  color: var(--tz-text-muted);
}

.tz-lb__opt {
  display: flex;
  align-items: center;
  gap: var(--tz-space-2);
  padding: var(--tz-space-2) var(--tz-space-2) var(--tz-space-1);
  border-top: 1px solid var(--tz-border);
  font-size: var(--tz-text-xs);
  color: var(--tz-text-muted);
}
</style>
