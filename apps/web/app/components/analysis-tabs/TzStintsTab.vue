<script setup lang="ts">
/**
 * Neumáticos (ítem 3, D33): una fila por piloto con sus stints (`engine/analysis/stints.ts`) coloreados por
 * compuesto (tokens de neumático de la temporada), con su letra y, en el nombre accesible y el título, las vueltas,
 * la edad del juego (TyreLife: puede incluir vueltas de otras sesiones, lo explica la pista ⓘ) y si es nuevo o
 * usado. Lo que no viene, «sin dato» (gris y «?» en el compuesto). Rayado: juego usado.
 *
 * En carrera y sprint, por vuelta; en libres y clasificación, por el momento de la sesión (un stint es una tanda en
 * pista). La línea del instante actual cruza todas las filas (una variable CSS: moverla no rehace las filas). Pulsar
 * un stint salta a su salida.
 */
import { driverStyles } from '~/analysis/chart'
import { leaderLapAt } from '~/engine/analysis/raceTrace'
import { type Stint, stintEventTimes, stints } from '~/engine/analysis/stints'
import { formatClock } from '~/engine/format/time'
import { clockOrigin } from '~/engine/timeline/markers'
import { compoundLetter, compoundToken } from '~/engine/timing/compound'
import { getRuntime, usePlaybackStore } from '~/stores/playback'

const { t } = useI18n()
const rt = getRuntime()!
const playback = usePlaybackStore()
const st = useAnalysis()
const table = st.table
const race = table.race
const season = rt.session.manifest.session.season
const styles = driverStyles(rt.drivers)
const { startMs: playStart, endMs: playEnd } = rt.session.manifest.session.playback
/** Origen del reloj visible (el del dock): en libres, el eje se rotula igual que el reproductor. */
const origin = clockOrigin(rt.session.manifest.session.type, rt.session.timing, rt.session.manifest.session.playback)
/** Coches en el orden del manifest (los que solo están en la tabla de vueltas, después). */
const cars = [...rt.drivers.map((d) => d.number).filter((c) => table.cars.has(c)), ...[...table.cars.keys()].filter((c) => !styles.has(c))]
let maxLap = 0
for (const c of table.cars.values()) for (const lap of c.lap) maxLap = Math.max(maxLap, lap)

const times = rt.ext('analysis:stintTimes', (r) => stintEventTimes(r.leaderboard.lapTable))
const cutoff = useEffectiveCutoff(times, st.cutoffMs)
const byCar = computed(() => markRaw(new Map(stints(table, cutoff.value).map((c) => [c.car, c.stints]))))
/** Sin corte («Sin spoilers» desactivado o el reloj al final de la reproducción); cambia poco (no con cada aviso del reloj). */
const uncut = computed(() => cutoff.value === Infinity)
const leadLap = computed(() => (race ? leaderLapAt(table, playback.timeMs) : null))

/** Eje: vueltas [0, N] (la vuelta k ocupa (k−1, k]) o instantes de la sesión. */
const domain = computed<[number, number]>(() => {
  const all = [...byCar.value.values()].flat()
  if (race) {
    const shown = all.reduce((n, s) => Math.max(n, s.lastLap), 0)
    const hi = uncut.value ? maxLap : Math.max(shown, leadLap.value ?? 0)
    return [0, Math.max(1, hi)]
  }
  const starts = all.map((s) => s.startMs).filter(Number.isFinite)
  const ends = all.map((s) => s.endMs).filter(Number.isFinite)
  const lo = Math.min(playStart, ...starts)
  const hi = uncut.value ? Math.max(playEnd, ...ends) : playEnd
  return [lo, hi > lo ? hi : lo + 1]
})

const compoundText = (c: string) => (c === 'UNKNOWN' ? t('analysis.stints.compoundNoData') : t(`compound.${c}`))

function describe(s: Stint, driver: string): string {
  const laps = t('analysis.stints.laps', { from: s.firstLap, to: s.lastLap }, s.firstLap === s.lastLap ? 1 : 2)
  const tyre =
    s.tyreLifeFirst === null
      ? t('analysis.stints.tyreLifeNoData')
      : t('analysis.stints.tyreLife', { from: s.tyreLifeFirst, to: s.tyreLifeLast ?? s.tyreLifeFirst })
  const fresh = s.fresh === true ? t('analysis.stints.new') : s.fresh === false ? t('analysis.stints.used') : t('analysis.stints.freshNoData')
  const state = s.open ? `${fresh}, ${t('analysis.stints.open')}` : fresh
  return t('analysis.stints.bar', { driver, compound: compoundText(s.compound), laps, tyre, state })
}

interface Bar {
  key: string
  left: number
  width: number
  compound: string
  token: string
  letter: string
  fresh: boolean | null
  open: boolean
  text: string
  seekMs: number | null
}

const pct = (v: number, [d0, d1]: [number, number]) => Math.min(100, Math.max(0, ((v - d0) / (d1 - d0)) * 100))

/** Textos de cada stint: solo cambian con los datos (no con el reloj). */
const texts = computed(() => {
  const out = new Map<Stint, string>()
  for (const [car, list] of byCar.value) {
    const label = styles.get(car)?.label ?? car
    for (const s of list) out.set(s, describe(s, label))
  }
  return out
})

const rows = computed(() => {
  const d = domain.value
  const text = texts.value
  // En libres, con corte, un stint en curso llega hasta el reloj (no hasta el último instante de cambio). Solo entonces
  // depende del reloj (≤ 10 Hz); en carrera, solo de los instantes de cambio.
  const now = race || uncut.value ? 0 : playback.timeMs
  return cars.map((car) => {
    const style = styles.get(car)
    const label = style?.label ?? car
    const list = byCar.value.get(car) ?? []
    const bars: Bar[] = []
    for (const s of list) {
      const a = race ? s.firstLap - 1 : s.startMs
      const b = race ? s.lastLap : s.open && !uncut.value ? Math.max(s.startMs, now) : s.endMs
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue
      const left = pct(a, d)
      bars.push({
        key: `${s.firstLap}-${s.stint}`,
        left,
        width: Math.max(0.5, pct(b, d) - left),
        compound: s.compound,
        token: compoundToken(season, s.compound),
        letter: compoundLetter(s.compound),
        fresh: s.fresh,
        open: s.open,
        text: text.get(s) ?? '',
        seekMs: Number.isFinite(s.startMs) ? s.startMs : null,
      })
    }
    return { car, label, color: style?.color ?? null, bars, empty: list.length === 0 }
  })
})

/** Compuestos que aparecen, para la leyenda. */
const compounds = computed(() => [...new Set([...byCar.value.values()].flat().map((s) => s.compound))])

/** Posición de la línea del instante actual (CSS), o nada si cae fuera del eje. */
const cursorStyle = computed(() => {
  const d = domain.value
  const x = race ? leadLap.value : playback.timeMs
  if (x === null || x < d[0] || x > d[1]) return undefined
  return { '--cursor': `${pct(x, d)}%` }
})
const axisText = computed(() => {
  const [d0, d1] = domain.value
  return race ? [t('analysis.lapShort', { lap: 1 }), t('analysis.lapShort', { lap: d1 })] : [formatClock(d0 - origin), formatClock(d1 - origin)]
})

function seek(ms: number | null) {
  if (ms !== null) playback.seek(ms)
}
</script>

<script lang="ts">
/** Hueco `analysis-tabs` (ítem 3): stints de neumáticos. */
export const order = 30
export const tab = 'stints'
export const label = (t: (key: string) => string) => t('analysis.tabs.stints')
</script>

<template>
  <div class="tz-atab" data-testid="stints" :data-axis="race ? 'lap' : 'time'">
    <p v-if="table.cars.size === 0" class="tz-atab__empty" data-testid="analysis-no-laps">{{ t('analysis.noLaps') }}</p>
    <template v-else>
      <p class="tz-atab__note">{{ race ? t('analysis.stints.basisRace') : t('analysis.stints.basisRuns') }}</p>
      <ul class="tz-stints" :class="{ 'has-cursor': cursorStyle }" :style="cursorStyle" :aria-label="t('analysis.stints.label')">
        <li v-for="r in rows" :key="r.car" class="tz-stints__row" data-testid="stint-row" :data-car="r.car">
          <span class="tz-stints__who">
            <span class="tz-stints__team" :style="r.color ? { background: r.color } : undefined" aria-hidden="true" />
            <span class="tz-stints__tla">{{ r.label }}</span>
          </span>
          <span class="tz-stints__track">
            <button
              v-for="b in r.bars"
              :key="b.key"
              type="button"
              class="tz-stints__bar"
              :class="{ 'is-used': b.fresh === false, 'is-unknown': b.fresh === null, 'is-open': b.open }"
              :style="{ left: `${b.left}%`, width: `${b.width}%`, '--compound': `var(${b.token})` }"
              :aria-label="b.text"
              :title="b.text"
              :disabled="b.seekMs === null"
              data-testid="stint-bar"
              :data-compound="b.compound"
              :data-start-ms="b.seekMs ?? undefined"
              @click="seek(b.seekMs)"
            >
              <span class="tz-stints__letter" aria-hidden="true">{{ b.letter }}</span>
            </button>
            <span v-if="r.empty" class="tz-stints__none">{{ t('analysis.stints.noStints') }}</span>
          </span>
        </li>
      </ul>
      <p class="tz-stints__axis tz-tabular" aria-hidden="true">
        <span>{{ axisText[0] }}</span>
        <span>{{ axisText[1] }}</span>
      </p>
      <div class="tz-stints__legend">
        <span class="tz-stints__legend-title">{{ t('analysis.stints.compounds') }}</span>
        <span v-for="c in compounds" :key="c" class="tz-stints__key">
          <span class="tz-stints__chip" :style="{ '--compound': `var(${compoundToken(season, c)})` }" aria-hidden="true">{{ compoundLetter(c) }}</span>
          {{ compoundText(c) }}
        </span>
        <span class="tz-stints__key">
          <span class="tz-stints__chip is-used-key" aria-hidden="true" />
          {{ t('analysis.stints.usedKey') }}
        </span>
        <span class="tz-stints__key">
          {{ t('analysis.stints.tyreLifeLabel') }}
          <TzHint :label="t('analysis.stints.tyreLifeLabel')" :text="t('analysis.stints.tyreLifeHint')" testid="stints-tyre-life-hint" />
        </span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.tz-atab {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--tz-space-2);
  padding-top: var(--tz-space-3);
}

.tz-atab__empty {
  max-width: 64ch;
  margin: var(--tz-space-4) 0;
  font-size: var(--tz-text-md);
  font-style: italic;
  color: var(--tz-text-muted);
}

.tz-atab__note {
  max-width: 96ch;
  margin: 0;
  font-size: var(--tz-text-xs);
  line-height: var(--tz-leading-normal);
  color: var(--tz-text-muted);
}

.tz-stints {
  display: grid;
  gap: var(--tz-space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

/* Sigla y pista de stints; la pista lleva la línea del instante actual (`--cursor`). */
.tz-stints__row {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr);
  align-items: center;
  gap: var(--tz-space-2);
  min-height: 22px;
}

.tz-stints__who {
  display: inline-flex;
  align-items: center;
  gap: var(--tz-space-1);
}

.tz-stints__team {
  width: 3px;
  height: 14px;
  border-radius: 2px;
  background: var(--tz-team-unknown);
}

.tz-stints__tla {
  font-family: var(--tz-font-mono);
  font-size: var(--tz-text-xs);
  font-weight: var(--tz-weight-semibold);
  letter-spacing: var(--tz-tracking-mono);
}

.tz-stints__track {
  position: relative;
  display: block;
  height: 18px;
  border-radius: var(--tz-radius-sm);
  background: var(--tz-surface-2);
}

/* Con un halo del color del fondo: sobre el neumático duro (blanco), la pintura sola apenas se ve (D47). */
.tz-stints.has-cursor .tz-stints__track::after {
  content: '';
  position: absolute;
  top: -2px;
  bottom: -2px;
  left: var(--cursor);
  border-left: 2px solid var(--tz-accent-strong);
  box-shadow: 0 0 0 1px var(--tz-bg);
  pointer-events: none;
}

.tz-stints__bar {
  position: absolute;
  top: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  min-width: 4px;
  padding: 0 2px;
  overflow: hidden;
  border: 0;
  border-radius: var(--tz-radius-sm);
  background-color: var(--compound, var(--tz-tyre-unknown));
  cursor: pointer;
}

/* Usado: rayado sobre el color del compuesto (la forma lo dice, no solo el color). */
.tz-stints__bar.is-used,
.tz-stints__chip.is-used-key {
  background-image: repeating-linear-gradient(135deg, transparent 0 4px, var(--tz-overlay) 4px 6px);
}

.tz-stints__bar.is-unknown {
  outline: 1px dashed var(--tz-text-faint);
  outline-offset: -1px;
}

.tz-stints__bar:disabled {
  cursor: default;
}

/* Letra del compuesto en un chip oscuro: legible sobre cualquier color de neumático. */
.tz-stints__letter,
.tz-stints__chip {
  display: inline-grid;
  place-items: center;
  min-width: 14px;
  height: 14px;
  padding: 0 2px;
  border-radius: var(--tz-radius-sm);
  background: var(--tz-surface-1);
  color: var(--tz-text);
  font-size: var(--tz-text-2xs);
  font-weight: var(--tz-weight-bold);
  line-height: 1;
}

.tz-stints__chip {
  border: 2px solid var(--compound, var(--tz-border-strong));
}

.tz-stints__chip.is-used-key {
  border: 0;
  background-color: var(--tz-text-muted);
}

.tz-stints__none {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  padding: 0 var(--tz-space-2);
  font-size: var(--tz-text-xs);
  font-style: italic;
  color: var(--tz-text-faint);
}

.tz-stints__axis {
  display: flex;
  justify-content: space-between;
  margin: 0 0 0 60px;
  font-size: var(--tz-text-2xs);
  color: var(--tz-text-muted);
}

.tz-stints__legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--tz-space-2) var(--tz-space-4);
  font-size: var(--tz-text-xs);
  color: var(--tz-text-muted);
}

.tz-stints__legend-title {
  font-weight: var(--tz-weight-semibold);
}

.tz-stints__key {
  display: inline-flex;
  align-items: center;
  gap: var(--tz-space-1);
}
</style>
