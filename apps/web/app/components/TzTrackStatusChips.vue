<script setup lang="ts">
/**
 * Chips del estado de la pista (presentacional, sin runtime): neutralización, banderas por sector, amarilla y ventana
 * de overtake/DRS de un `TrackStateSnapshot`. Lo usan la cabecera del replay (`TzTrackStatus`, el instante del reloj)
 * y la vista previa del timeline (`TzTimelinePreview`, otro instante). El color nunca va solo: siempre hay texto. Un
 * estado de pista deducido (no oficial) lleva su etiqueta «Estimado».
 */
import type { TrackStateSnapshot } from '~/engine/trackstate/TrackState'

const props = withDefaults(
  defineProps<{
    state: TrackStateSnapshot
    /** Sin estado de pista oficial (se deduce de race control): se marca como Estimado. */
    inferred: boolean
    /** Hay geometría de sectores de comisarios; si no, el chip de sector lo explica en su título. */
    placeable: boolean
    /** Prefijo de los `data-testid` de los chips (`track` en la cabecera; otro donde se repitan, sin duplicados). */
    testid?: string
    /** Texto de un chip para cuando no hay nada que mostrar (la cabecera no lo pinta). */
    emptyLabel?: string
  }>(),
  { testid: 'track', emptyLabel: '' },
)

const { t } = useI18n()

const sectors = computed(() =>
  Object.entries(props.state.sectors)
    .map(([n, flag]) => ({ n: Number(n), flag }))
    .sort((a, b) => a.n - b.n),
)
const yellowOnly = computed(() => props.state.yellow && !sectors.value.length && !props.state.neutral)
const empty = computed(
  () => !props.state.neutral && !sectors.value.length && !yellowOnly.value && !props.state.overtake && !props.state.drs,
)
const flagClass = { YELLOW: 'is-yellow', 'DOUBLE YELLOW': 'is-double-yellow', RED: 'is-red' } as const
const flagKey = { YELLOW: 'yellow', 'DOUBLE YELLOW': 'doubleYellow', RED: 'red' } as const
</script>

<template>
  <div class="tz-ts">
    <TzEstimated v-if="inferred" field="trackStatus" />
    <span
      v-if="state.neutral"
      class="tz-ts__chip tz-ts__chip--strong"
      :class="`is-${state.neutral}`"
      :data-testid="`${testid}-neutral`"
      :data-kind="state.neutral"
    >
      {{ t(`trackStatus.neutral.${state.neutral}`) }}
    </span>
    <span
      v-for="s in sectors"
      :key="s.n"
      class="tz-ts__chip"
      :class="flagClass[s.flag]"
      :data-testid="`${testid}-sector`"
      :data-sector="s.n"
      :data-flag="s.flag"
      :title="placeable ? undefined : t('trackStatus.noGeometry')"
    >
      {{ t(`trackStatus.sector.${flagKey[s.flag]}`, { n: s.n }) }}
    </span>
    <span v-if="yellowOnly" class="tz-ts__chip is-yellow" :data-testid="`${testid}-yellow`">
      {{ t('trackStatus.yellow') }}
    </span>
    <span v-if="state.overtake" class="tz-ts__chip tz-ts__chip--quiet" :data-testid="`${testid}-overtake`">
      {{ t('trackStatus.overtake') }}
    </span>
    <span v-if="state.drs" class="tz-ts__chip tz-ts__chip--quiet" :data-testid="`${testid}-drs`">
      {{ t('trackStatus.drs') }}
    </span>
    <span v-if="empty && emptyLabel" class="tz-ts__chip tz-ts__chip--quiet" :data-testid="`${testid}-clear`">
      {{ emptyLabel }}
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
