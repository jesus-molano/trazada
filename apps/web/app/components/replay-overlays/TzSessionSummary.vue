<script setup lang="ts">
/**
 * Tarjeta de fin de sesión (ítem 12, D40): los tres primeros según el cronometraje al terminar (sin sanciones
 * posteriores), la vuelta rápida y, en carrera, las paradas con su tiempo en el pit lane (no el de la parada en el
 * box, que no está en los datos). Lo que falta dice «sin dato». Se abre sola al cruzar el fin reproduciendo; el botón
 * del dock la vuelve a abrir (`useSessionSummary`).
 *
 * Diálogo modal: el foco va al botón de cerrar y no sale de la tarjeta (Tab y Mayús+Tab dan la vuelta); al cerrarla
 * vuelve a donde estaba. Se cierra con ×, con Esc (el registro de Esc, prioridad `ESC_PRIORITY.summary`, la primera)
 * o con un clic fuera. Entrada suave con los tokens de movimiento (escalonada con `--tz-stagger`); con movimiento
 * reducido, sin animación.
 */
import { useReducedMotion } from '~/design/motion'
import { formatLapTime } from '~/engine/format/time'
import { type PitVisit, SUMMARY_PLACES, type SummaryRow } from '~/engine/summary/sessionSummary'
import { compoundLetter, compoundToken } from '~/engine/timing/compound'
import { ESC_PRIORITY, registerEscape } from '~/replay/keys'
import { getRuntime } from '~/stores/playback'

const { t, locale } = useI18n()
const route = useRoute()
const rt = getRuntime()!
const state = useSessionSummary()
const { summary, open } = state
// En el bench no se abre sola: taparía la escena que se está midiendo.
state.autoOpen = route.query.bench !== '1'
const reduced = useReducedMotion()

const meta = rt.session.manifest.session
const id = useId()
const titleId = `${id}-title`
const basisId = `${id}-basis`
const subtitle = computed(() => t('summary.subtitle', { event: meta.event, session: t(`session.${meta.type}`) }))
const basis = computed(() => (summary.end.source === 'data-end' ? t('summary.basisDataEnd') : t('summary.basisEnd')))
/** Puestos sin coche con posición conocida (siempre se ven los tres). */
const empty = Array.from({ length: Math.max(0, SUMMARY_PLACES - summary.rows.length) }, (_, i) => summary.rows.length + i + 1)

const gapFmt = computed(() => new Intl.NumberFormat(locale.value, { minimumFractionDigits: 3, maximumFractionDigits: 3 }))
const secFmt = computed(() => new Intl.NumberFormat(locale.value, { minimumFractionDigits: 1, maximumFractionDigits: 1 }))

/** Un valor o «sin dato» (que se pinta distinto). */
interface Shown {
  text: string
  missing: boolean
}
const value = (text: string): Shown => ({ text, missing: false })
const missing = (text: string): Shown => ({ text, missing: true })

function gapText(ms: number): string {
  const s = ms / 1000
  if (s >= 60) {
    const m = Math.floor(s / 60)
    return `+${m}:${gapFmt.value.format(s - m * 60).padStart(6, '0')}`
  }
  return `+${gapFmt.value.format(s)}`
}

/** Cifra principal: en carrera, el gap al primero; en libres y clasificación, la mejor vuelta. */
function mainValue(r: SummaryRow): Shown {
  if (!summary.race) return r.bestLapMs === null ? missing(t('summary.noData')) : value(formatLapTime(r.bestLapMs, locale.value))
  if (r.position === 1) return value(t('summary.leader'))
  if (r.lapsBehind > 0) return value(t('summary.lapsBehind', { n: r.lapsBehind }))
  return r.gapMs === null ? missing(t('summary.noData')) : value(gapText(r.gapMs))
}

/** En libres y clasificación, el gap con la mejor vuelta del primero (el primero no lleva). */
function bestLapGap(r: SummaryRow): Shown | null {
  if (summary.race || r.position === 1) return null
  return r.gapMs === null ? missing(t('summary.gapNoData')) : value(gapText(r.gapMs))
}

function lapsText(r: SummaryRow): Shown {
  return r.laps === null ? missing(t('summary.lapsNoData')) : value(t('summary.laps', { n: r.laps }, r.laps))
}

const season = meta.season
const compoundStyle = (compound: string) => ({ '--compound': `var(${compoundToken(season, compound)})` })
const compoundName = (c: string) => (c === 'UNKNOWN' ? t('summary.compoundNoData') : t(`compound.${c}`))
const tyresText = (r: SummaryRow) => t('summary.tyres', { list: r.stints.map(compoundName).join(', ') })

const stopsOf = (r: SummaryRow) => (r.pits ?? []).filter((v) => v.kind === 'stop')
const passesOf = (r: SummaryRow) => (r.pits ?? []).filter((v) => v.kind === 'pass')
const unknownOf = (r: SummaryRow) => (r.pits ?? []).filter((v) => v.kind === 'unknown')
function visitText(v: PitVisit): Shown {
  return v.pitLaneMs === null
    ? missing(t('summary.pitLaneNoTime', { lap: v.lap }))
    : value(t('summary.pitLaneTime', { lap: v.lap, s: secFmt.value.format(v.pitLaneMs / 1000) }))
}

const fastest = summary.fastest
const teamColor = (color: string | undefined) => ({ background: color ?? 'var(--tz-team-unknown)' })
const fullName = (r: { driver: SummaryRow['driver']; car: string }) =>
  r.driver ? `${r.driver.first} ${r.driver.last}`.trim() || r.driver.tla : r.car
/** Índice de la entrada escalonada (cabecera 0, nota 1, título de los puestos 2, puestos 3–5, vuelta rápida 6). */
const step = (i: number) => ({ '--i': i })

// Foco: al abrir, al botón de cerrar; no sale de la tarjeta; al cerrar, vuelve a donde estaba.
const card = ref<HTMLElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)
let returnTo: HTMLElement | null = null

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
function focusables(): HTMLElement[] {
  return [...(card.value?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((e) => e.getClientRects().length > 0 || e === closeButton.value)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Tab') return
  const items = focusables()
  const first = items[0]
  const last = items[items.length - 1]
  if (!first || !last) return
  const active = document.activeElement
  const inside = !!active && !!card.value?.contains(active)
  if (event.shiftKey && (active === first || !inside)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (active === last || !inside)) {
    event.preventDefault()
    first.focus()
  }
}

/** El foco no sale de la tarjeta mientras está abierta. */
function onFocusIn(event: FocusEvent) {
  if (card.value && !card.value.contains(event.target as Node | null)) closeButton.value?.focus()
}

watch(open, async (isOpen) => {
  if (isOpen) {
    returnTo = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
    await nextTick()
    closeButton.value?.focus()
    document.addEventListener('focusin', onFocusIn, true)
  } else {
    document.removeEventListener('focusin', onFocusIn, true)
    const back = returnTo
    returnTo = null
    if (back?.isConnected) back.focus()
  }
})

let offEscape: (() => void) | null = null
onMounted(() => {
  offEscape = registerEscape(ESC_PRIORITY.summary, { active: () => open.value, run: () => state.close() })
})
onBeforeUnmount(() => {
  offEscape?.()
  document.removeEventListener('focusin', onFocusIn, true)
})
</script>

<script lang="ts">
/** Hueco `replay-overlays` (D29): tarjeta de fin de sesión (ítem 12). */
export const order = 10
</script>

<template>
  <div v-if="open" class="tz-summary" :class="{ 'is-still': reduced }" data-testid="summary-scrim" @click.self="state.close()">
    <section
      ref="card"
      class="tz-summary__card tz-panel"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      :aria-describedby="basisId"
      data-testid="session-summary"
      :data-race="summary.race"
      :data-source="summary.end.source"
      @keydown="onKeydown"
    >
      <header class="tz-summary__head tz-panel__head tz-summary__step" :style="step(0)">
        <div class="tz-summary__heading">
          <h2 :id="titleId" class="tz-summary__title">
            <TzIcon name="summary" size="sm" />
            {{ t('summary.title') }}
          </h2>
          <p class="tz-summary__subtitle">{{ subtitle }}</p>
        </div>
        <button
          ref="closeButton"
          type="button"
          class="tz-iconbtn"
          :aria-label="t('summary.close')"
          data-testid="summary-close"
          @click="state.close()"
        >
          <TzIcon name="close" />
        </button>
      </header>

      <p :id="basisId" class="tz-summary__basis tz-summary__step" :style="step(1)" data-testid="summary-basis">
        <TzIcon name="info" size="sm" />
        <span>{{ basis }}</span>
      </p>

      <h3 class="tz-summary__section tz-summary__step" :style="step(2)">{{ summary.race ? t('summary.topRace') : t('summary.topBestLap') }}</h3>
      <ol class="tz-summary__rows" role="list">
        <li
          v-for="(r, i) in summary.rows"
          :key="r.car"
          class="tz-summary__row tz-summary__step"
          :style="step(3 + i)"
          data-testid="summary-row"
          :data-car="r.car"
          :data-position="r.position"
        >
          <span class="tz-summary__pos tz-tabular">{{ r.position }}</span>
          <span class="tz-summary__team" :style="teamColor(r.driver?.color)" aria-hidden="true" />
          <span class="tz-summary__who">
            <span class="tz-summary__tla">{{ r.driver?.tla ?? r.car }}</span>
            <span class="tz-summary__name">{{ fullName(r) }}</span>
          </span>
          <span class="tz-summary__value tz-tabular" :class="{ 'is-missing': mainValue(r).missing }" data-testid="summary-value">
            {{ mainValue(r).text }}
          </span>

          <!-- Libres y clasificación: gap con la mejor vuelta y vueltas completadas. -->
          <p v-if="!summary.race" class="tz-summary__detail">
            <span
              v-if="bestLapGap(r)"
              class="tz-tabular"
              :class="{ 'is-missing': bestLapGap(r)!.missing }"
              data-testid="summary-gap"
            >{{ bestLapGap(r)!.text }}</span>
            <span :class="{ 'is-missing': lapsText(r).missing }" data-testid="summary-laps">{{ lapsText(r).text }}</span>
          </p>

          <!-- Carrera: neumáticos por stint, paradas y tiempo en el pit lane. -->
          <template v-else>
            <p class="tz-summary__detail" data-testid="summary-stops">
              <span v-if="r.stints.length" class="tz-summary__tyres">
                <span class="tz-visually-hidden">{{ tyresText(r) }}</span>
                <template v-for="(c, k) in r.stints" :key="k">
                  <TzIcon v-if="k > 0" name="next" size="sm" class="tz-summary__arrow" />
                  <span
                    class="tz-summary__compound"
                    :class="{ 'is-long': compoundLetter(c).length > 1 }"
                    :style="compoundStyle(c)"
                    :title="compoundName(c)"
                    aria-hidden="true"
                  >{{ compoundLetter(c) }}</span>
                </template>
              </span>
              <span v-else class="is-missing">{{ t('summary.tyresNoData') }}</span>
              <span v-if="r.pits" data-testid="summary-stop-count">{{ t('summary.stops', { n: stopsOf(r).length }, stopsOf(r).length) }}</span>
              <span v-else class="is-missing">{{ t('summary.stopsNoData') }}</span>
            </p>
            <p v-if="stopsOf(r).length" class="tz-summary__detail tz-summary__pits">
              <span class="tz-summary__label">{{ t('summary.pitLane') }}</span>
              <TzHint :label="t('summary.pitLane')" :text="t('summary.pitLaneHint')" testid="summary-pit-hint" />
              <span
                v-for="v in stopsOf(r)"
                :key="v.inMs"
                class="tz-tabular"
                :class="{ 'is-missing': visitText(v).missing }"
                data-testid="summary-pit-time"
              >{{ visitText(v).text }}</span>
            </p>
            <p v-if="passesOf(r).length" class="tz-summary__detail tz-summary__pits" data-testid="summary-passes">
              <span>{{ t('summary.passes', { n: passesOf(r).length }, passesOf(r).length) }}</span>
              <span v-for="v in passesOf(r)" :key="v.inMs" class="tz-tabular" :class="{ 'is-missing': visitText(v).missing }">{{ visitText(v).text }}</span>
            </p>
            <p v-if="unknownOf(r).length" class="tz-summary__detail tz-summary__pits" data-testid="summary-unknown-visits">
              <span class="is-missing">{{ t('summary.unknownVisits', { n: unknownOf(r).length }, unknownOf(r).length) }}</span>
              <span v-for="v in unknownOf(r)" :key="v.inMs" class="tz-tabular" :class="{ 'is-missing': visitText(v).missing }">{{ visitText(v).text }}</span>
            </p>
          </template>
        </li>
        <li
          v-for="(n, i) in empty"
          :key="`empty-${n}`"
          class="tz-summary__row is-empty tz-summary__step"
          :style="step(3 + summary.rows.length + i)"
          data-testid="summary-row"
          data-empty="true"
          :data-position="n"
        >
          <span class="tz-summary__pos tz-tabular">{{ n }}</span>
          <span class="tz-summary__team" aria-hidden="true" />
          <span class="tz-summary__who is-missing">{{ t('summary.positionNoData', { n }) }}</span>
        </li>
      </ol>

      <section class="tz-summary__fastest tz-summary__step" :style="step(6)" data-testid="summary-fastest" :data-car="fastest?.car">
        <h3 class="tz-summary__section">{{ t('summary.fastest') }}</h3>
        <p v-if="fastest" class="tz-summary__fast">
          <span class="tz-summary__team" :style="teamColor(fastest.driver?.color)" aria-hidden="true" />
          <span class="tz-summary__who">
            <span class="tz-summary__tla">{{ fastest.driver?.tla ?? fastest.car }}</span>
            <span class="tz-summary__name">{{ fullName(fastest) }}</span>
          </span>
          <span class="tz-summary__value tz-tabular" data-testid="summary-fastest-time">{{ formatLapTime(fastest.lapMs, locale) }}</span>
          <span class="tz-summary__lap">{{ t('summary.fastestLap', { lap: fastest.lap }) }}</span>
        </p>
        <p v-else class="tz-summary__fast is-missing" data-testid="summary-fastest-nodata">{{ t('summary.noData') }}</p>
      </section>
    </section>
  </div>
</template>

<style scoped>
/* Capa sobre todo el replay: un clic fuera de la tarjeta la cierra. */
.tz-summary {
  position: fixed;
  inset: 0;
  z-index: var(--tz-z-overlay);
  display: grid;
  place-items: center;
  padding: var(--tz-space-6) var(--tz-space-4);
  background: transparent;
  background: color-mix(in srgb, var(--tz-bg) 45%, transparent);
  animation: summary-fade var(--tz-dur-base) var(--tz-ease-standard) both;
}

/* Tablet en vertical: los paneles van en la franja inferior; la tarjeta, sobre el mapa. */
@media (width <= 900px) and (orientation: portrait) {
  .tz-summary {
    place-items: start center;
    padding-bottom: 38vh;
  }
}

.tz-summary__card {
  width: min(420px, 100%);
  max-height: 100%;
  overflow-y: auto;
  overscroll-behavior: contain;
  background: var(--tz-surface-1);
  box-shadow: var(--tz-shadow-panel);
}

/* Entrada escalonada: fundido y desplazamiento corto (tokens; 0 con movimiento reducido). */
.tz-summary__step {
  animation: tz-enter var(--tz-dur-slow) var(--tz-ease-enter) both;
  animation-delay: calc(var(--tz-stagger) * var(--i, 0));
}

.tz-summary.is-still,
.tz-summary.is-still .tz-summary__step {
  animation: none;
}

@keyframes summary-fade {
  from {
    opacity: 0;
  }
}

.tz-summary__head {
  align-items: flex-start;
}

.tz-summary__heading {
  min-width: 0;
}

.tz-summary__title {
  display: flex;
  align-items: center;
  gap: var(--tz-space-2);
  margin: 0;
  font-size: var(--tz-text-lg);
  font-weight: var(--tz-weight-semibold);
  line-height: var(--tz-leading-tight);
}

.tz-summary__subtitle {
  margin: var(--tz-space-1) 0 0;
  font-size: var(--tz-text-sm);
  color: var(--tz-text-muted);
}

.tz-summary__basis {
  display: flex;
  align-items: flex-start;
  gap: var(--tz-space-2);
  margin: 0;
  font-size: var(--tz-text-xs);
  line-height: var(--tz-leading-normal);
  color: var(--tz-text-muted);
}

.tz-summary__basis .tz-icon {
  margin-top: 2px;
}

.tz-summary__section {
  margin: 0 0 var(--tz-space-2);
  font-size: var(--tz-text-xs);
  font-weight: var(--tz-weight-semibold);
  letter-spacing: var(--tz-tracking-caps);
  text-transform: uppercase;
  color: var(--tz-text-muted);
}

.tz-summary__rows {
  display: grid;
  gap: var(--tz-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

/* Puesto: posición, franja de equipo, piloto y cifra; debajo, los detalles a todo lo ancho. */
.tz-summary__row {
  display: grid;
  grid-template-columns: 20px 4px minmax(0, 1fr) auto;
  align-items: center;
  column-gap: var(--tz-space-2);
  row-gap: var(--tz-space-1);
  padding: var(--tz-space-2);
  border: 1px solid var(--tz-border);
  border-radius: var(--tz-radius-md);
  background: var(--tz-surface-2);
}

.tz-summary__pos {
  font-size: var(--tz-text-lg);
  font-weight: var(--tz-weight-bold);
  text-align: end;
}

.tz-summary__team {
  align-self: stretch;
  min-height: 20px;
  border-radius: 2px;
  background: var(--tz-border-strong);
}

.tz-summary__who {
  display: flex;
  align-items: baseline;
  gap: var(--tz-space-2);
  min-width: 0;
}

.tz-summary__tla {
  font-family: var(--tz-font-mono);
  font-weight: var(--tz-weight-semibold);
  letter-spacing: var(--tz-tracking-mono);
}

.tz-summary__name {
  overflow: hidden;
  font-size: var(--tz-text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--tz-text-muted);
}

.tz-summary__value {
  font-family: var(--tz-font-mono);
  font-size: var(--tz-text-md);
  font-weight: var(--tz-weight-semibold);
  text-align: end;
}

.tz-summary__detail {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--tz-space-1) var(--tz-space-3);
  grid-column: 3 / -1;
  margin: 0;
  font-size: var(--tz-text-xs);
  color: var(--tz-text-muted);
}

.tz-summary__pits {
  gap: var(--tz-space-1) var(--tz-space-2);
}

.tz-summary__label {
  font-weight: var(--tz-weight-semibold);
}

.tz-summary__tyres {
  display: inline-flex;
  align-items: center;
  gap: var(--tz-space-1);
}

.tz-summary__arrow {
  color: var(--tz-text-faint);
}

.tz-summary__compound {
  display: inline-grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border: 2px solid var(--compound, var(--tz-tyre-unknown));
  border-radius: 50%;
  font-size: var(--tz-text-2xs);
  font-weight: var(--tz-weight-bold);
  color: var(--tz-text);
}

.tz-summary__compound.is-long {
  font-size: 8px;
  letter-spacing: -0.06em;
}

.is-missing {
  font-style: italic;
  color: var(--tz-text-faint);
}

.tz-summary__value.is-missing {
  font-family: var(--tz-font-sans);
  font-weight: var(--tz-weight-regular);
}

.tz-summary__row.is-empty .tz-summary__who {
  grid-column: 3 / -1;
}

/* Vuelta rápida: marca con el token de mejor vuelta (el texto, con el color normal). */
.tz-summary__fastest {
  padding: var(--tz-space-2) var(--tz-space-3);
  border: 1px solid var(--tz-border);
  border-left: 3px solid var(--tz-best);
  border-radius: var(--tz-radius-md);
  background: var(--tz-surface-2);
}

.tz-summary__fast {
  display: grid;
  grid-template-columns: 4px minmax(0, 1fr) auto;
  align-items: center;
  column-gap: var(--tz-space-2);
  margin: 0;
}

.tz-summary__fast.is-missing {
  display: block;
}

.tz-summary__lap {
  grid-column: 2 / -1;
  font-size: var(--tz-text-xs);
  color: var(--tz-text-muted);
}
</style>
