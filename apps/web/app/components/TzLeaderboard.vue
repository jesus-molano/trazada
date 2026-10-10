<script setup lang="ts">
/** Leaderboard del replay: posición, gap/intervalo, neumático y estado de cada piloto. */
import { BLUE_FLAG_MS, type LeaderboardRow } from '~/engine/leaderboard/leaderboard'
import { compoundLetter, compoundToken } from '~/engine/timing/compound'
import { usePlaybackStore } from '~/stores/playback'
import { useSessionStore } from '~/stores/session'
import { useSettingsStore } from '~/stores/settings'

const { t, locale } = useI18n()
const playback = usePlaybackStore()
const settings = useSettingsStore()
const rows = useLeaderboard()
settings.hydrate()
const season = useSessionStore().data?.manifest.session.season ?? 0
/** Color del compuesto (según la temporada) para el borde de su letra. */
const compoundStyle = (compound: string) => ({ '--compound': `var(${compoundToken(season, compound)})` })

const gapFmt = computed(() => new Intl.NumberFormat(locale.value, { minimumFractionDigits: 3, maximumFractionDigits: 3 }))

function gapText(r: LeaderboardRow): string {
  if (r.position === 1) return r.gapMs === null && r.bestLapMs === null ? '' : t('leaderboard.leader')
  if (r.lapsBehind > 0 && settings.gapMode === 'leader') return t('leaderboard.lapsBehind', { n: r.lapsBehind })
  const ms = settings.gapMode === 'leader' ? r.gapMs : r.intervalMs
  if (ms === null) return '—'
  const s = ms / 1000
  const fmt = gapFmt.value
  if (s >= 60) {
    const m = Math.floor(s / 60)
    return `+${m}:${fmt.format(s - m * 60).padStart(6, '0')}`
  }
  return `+${fmt.format(s)}`
}

function select(car: string) {
  playback.selectCar(playback.selectedCar === car ? null : car)
}
</script>

<template>
  <section class="tz-lb" :aria-label="t('leaderboard.title')" data-testid="leaderboard">
    <header class="tz-lb__head">
      <h2 class="tz-lb__title">{{ t('leaderboard.title') }}</h2>
      <div class="tz-lb__modes" role="group" :aria-label="t('leaderboard.gapMode')">
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

    <ol class="tz-lb__rows" role="list">
      <li
        v-for="r in rows"
        :key="r.car"
        class="tz-lb__row"
        :class="{ 'is-selected': playback.selectedCar === r.car, 'is-nosignal': r.noSignal }"
        :data-car="r.car"
        :data-position="r.position"
      >
        <button type="button" class="tz-lb__btn" :aria-pressed="playback.selectedCar === r.car" @click="select(r.car)">
          <span class="tz-lb__pos tz-tabular">{{ r.position }}</span>
          <span class="tz-lb__team" :style="{ background: r.driver?.color ?? 'var(--tz-team-unknown)' }" aria-hidden="true" />
          <span class="tz-lb__tla">{{ r.driver?.tla ?? r.car }}</span>
          <span class="tz-lb__flags">
            <span
              v-if="r.blueFlag && settings.showBlueFlags"
              class="tz-lb__blue"
              :title="t('leaderboard.blueFlag', { s: BLUE_FLAG_MS / 1000 })"
              data-testid="blue-flag"
            >
              <span class="tz-visually-hidden">{{ t('leaderboard.blueFlag', { s: BLUE_FLAG_MS / 1000 }) }}</span>
            </span>
            <span v-if="r.inPit" class="tz-lb__chip tz-lb__chip--pit">{{ t('leaderboard.pit') }}</span>
            <span v-else-if="r.noSignal" class="tz-lb__chip" data-testid="no-signal">{{ t('leaderboard.noSignal') }}</span>
          </span>
          <span class="tz-lb__gap tz-tabular">{{ gapText(r) }}</span>
          <span
            class="tz-lb__tyre"
            :style="compoundStyle(r.compound)"
            :title="
              r.tyreLife === null
                ? t('leaderboard.tyreNoLife', { compound: t(`compound.${r.compound}`) })
                : t('leaderboard.tyre', { compound: t(`compound.${r.compound}`), laps: r.tyreLife }, r.tyreLife)
            "
          >
            <span class="tz-lb__compound" :class="{ 'is-long': compoundLetter(r.compound).length > 1 }">{{ compoundLetter(r.compound) }}</span>
            <span class="tz-lb__life tz-tabular">{{ r.tyreLife ?? '' }}</span>
          </span>
        </button>
      </li>
    </ol>

    <label class="tz-lb__opt">
      <input
        type="checkbox"
        :checked="settings.showBlueFlags"
        data-testid="toggle-blue-flags"
        @change="settings.setShowBlueFlags(($event.target as HTMLInputElement).checked)"
      >
      {{ t('leaderboard.showBlueFlags') }}
    </label>
  </section>
</template>

<style scoped>
.tz-lb {
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  width: 290px;
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

.tz-lb__title {
  margin: 0;
  font-size: var(--tz-text-xs);
  font-weight: var(--tz-weight-semibold);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--tz-text-muted);
}

.tz-lb__modes {
  display: inline-flex;
  gap: 2px;
}

.tz-lb__mode {
  padding: 2px var(--tz-space-2);
  border: 1px solid var(--tz-border);
  border-radius: var(--tz-radius-sm);
  background: transparent;
  font-size: var(--tz-text-2xs);
  cursor: pointer;
}

.tz-lb__mode[aria-pressed='true'] {
  border-color: var(--tz-accent);
  color: var(--tz-accent-strong);
}

.tz-lb__rows {
  flex: 1;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.tz-lb__btn {
  display: grid;
  grid-template-columns: 22px 4px 38px 1fr 76px 38px;
  align-items: center;
  gap: var(--tz-space-2);
  width: 100%;
  padding: 3px var(--tz-space-2);
  border: 0;
  border-radius: var(--tz-radius-sm);
  background: transparent;
  font-size: var(--tz-text-sm);
  text-align: start;
  cursor: pointer;
}

.tz-lb__btn:hover {
  background: var(--tz-surface-2);
}

.is-selected .tz-lb__btn {
  background: var(--tz-surface-3);
  outline: 1px solid var(--tz-border-strong);
}

.is-nosignal .tz-lb__tla,
.is-nosignal .tz-lb__gap {
  color: var(--tz-text-faint);
}

.tz-lb__pos {
  color: var(--tz-text-muted);
  text-align: end;
}

.tz-lb__team {
  width: 4px;
  height: 16px;
  border-radius: 2px;
}

.tz-lb__tla {
  font-family: var(--tz-font-mono);
  font-weight: var(--tz-weight-semibold);
  letter-spacing: 0.04em;
}

.tz-lb__flags {
  display: inline-flex;
  align-items: center;
  gap: var(--tz-space-1);
  min-width: 0;
}

.tz-lb__blue {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background: var(--tz-flag-blue);
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
  width: 16px;
  height: 16px;
  border: 2px solid var(--compound, var(--tz-tyre-unknown));
  border-radius: 50%;
  font-size: 9px;
  font-weight: var(--tz-weight-bold);
}

.tz-lb__compound.is-long {
  letter-spacing: -0.06em;
  font-size: 7px;
}

.tz-lb__life {
  min-width: 14px;
  font-size: var(--tz-text-2xs);
  color: var(--tz-text-muted);
}

@media (width <= 1100px) {
  .tz-lb {
    width: 250px;
  }

  .tz-lb__btn {
    grid-template-columns: 20px 4px 34px 1fr 64px 34px;
    gap: 6px;
  }
}

@media (width <= 900px) and (orientation: portrait) {
  .tz-lb {
    width: auto;
  }
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
