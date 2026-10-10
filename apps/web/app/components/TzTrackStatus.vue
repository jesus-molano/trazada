<script setup lang="ts">
/**
 * Estado de la pista en texto: neutralización vigente, banderas por sector y ventana de overtake/DRS.
 * Se actualiza solo cuando cambia el estado (no en cada frame). El color nunca va solo: siempre hay texto.
 */
import type { TrackStateSnapshot } from '~/engine/trackstate/TrackState'
import { getRuntime } from '~/stores/playback'

const { t } = useI18n()
const rt = getRuntime()!
const state = shallowRef<TrackStateSnapshot>(rt.trackState.snapshot)
const placeable = rt.circuit.marshalSectors.length > 0

const sectors = computed(() =>
  Object.entries(state.value.sectors)
    .map(([n, flag]) => ({ n: Number(n), flag }))
    .sort((a, b) => a.n - b.n),
)
const flagClass = { YELLOW: 'is-yellow', 'DOUBLE YELLOW': 'is-double-yellow', RED: 'is-red' } as const
const flagKey = { YELLOW: 'yellow', 'DOUBLE YELLOW': 'doubleYellow', RED: 'red' } as const

let seen = -1
let off: (() => void) | null = null
onMounted(() => {
  off = rt.onFrame(() => {
    if (rt.trackState.version === seen) return
    seen = rt.trackState.version
    state.value = rt.trackState.snapshot
  })
})
onBeforeUnmount(() => off?.())
</script>

<template>
  <div class="tz-ts" role="status" :aria-label="t('trackStatus.label')" data-testid="track-status">
    <span
      v-if="state.neutral"
      class="tz-ts__chip tz-ts__chip--strong"
      :class="`is-${state.neutral}`"
      data-testid="track-neutral"
      :data-kind="state.neutral"
    >
      {{ t(`trackStatus.neutral.${state.neutral}`) }}
    </span>
    <span
      v-for="s in sectors"
      :key="s.n"
      class="tz-ts__chip"
      :class="flagClass[s.flag]"
      data-testid="track-sector"
      :data-sector="s.n"
      :data-flag="s.flag"
      :title="placeable ? undefined : t('trackStatus.noGeometry')"
    >
      {{ t(`trackStatus.sector.${flagKey[s.flag]}`, { n: s.n }) }}
    </span>
    <span v-if="state.yellow && !sectors.length && !state.neutral" class="tz-ts__chip is-yellow">
      {{ t('trackStatus.yellow') }}
    </span>
    <span v-if="state.overtake" class="tz-ts__chip tz-ts__chip--quiet" data-testid="track-overtake">
      {{ t('trackStatus.overtake') }}
    </span>
    <span v-if="state.drs" class="tz-ts__chip tz-ts__chip--quiet" data-testid="track-drs">
      {{ t('trackStatus.drs') }}
    </span>
  </div>
</template>

<style scoped>
.tz-ts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--tz-space-2);
  min-width: 0;
}

.tz-ts__chip {
  display: inline-flex;
  align-items: center;
  gap: var(--tz-space-1);
  padding: 2px var(--tz-space-2);
  border: 1px solid var(--tz-border-strong);
  border-left-width: 4px;
  border-radius: var(--tz-radius-sm);
  background: var(--tz-overlay);
  font-size: var(--tz-text-xs);
  font-weight: var(--tz-weight-semibold);
  white-space: nowrap;
}

.tz-ts__chip--strong {
  font-size: var(--tz-text-sm);
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.tz-ts__chip--quiet {
  border-left-color: var(--tz-accent);
  font-weight: var(--tz-weight-regular);
  color: var(--tz-text-muted);
}

.is-yellow {
  border-left-color: var(--tz-flag-yellow);
}

.is-double-yellow {
  border-left-color: var(--tz-flag-double-yellow);
}

.is-red {
  border-left-color: var(--tz-flag-red);
}

.is-sc {
  border-left-color: var(--tz-sc);
}

.is-vsc,
.is-vsc-ending {
  border-left-color: var(--tz-vsc);
  border-left-style: dashed;
}
</style>
