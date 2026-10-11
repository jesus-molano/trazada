<script setup lang="ts">
/**
 * Chips del estado de la pista (presentacional, sin runtime): neutralización, banderas por sector, amarilla y ventana
 * de overtake/DRS de un `TrackStateSnapshot`. Lo usan la cabecera del replay (`TzTrackStatus`, el instante del reloj)
 * y la vista previa del timeline (`TzTimelinePreview`, otro instante). El color nunca va solo: siempre hay texto. Un
 * estado de pista deducido (no oficial) lleva su etiqueta «Estimado». Las banderas de sector de la misma clase van en
 * un solo chip («Doble amarilla · sectores 20 y 21», `data-sectors="20 21"`), de la más grave a la más leve: así la
 * cabecera cabe en una fila más a menudo.
 *
 * `interactive` (la cabecera): la etiqueta «Estimado» se pulsa para ver por qué y, si hay banderas de sector sin
 * geometría para situarlas en el mapa, una pista ⓘ lo explica (en iPad un título no se ve). Sin él (la vista previa es
 * un `role="tooltip"`, que no admite controles), todo va en títulos y texto. `compactEstimated`: la etiqueta se acorta
 * por debajo de 1920 px (la cabecera tiene que caber en una fila).
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
    /** Con controles: «Estimado» pulsable y la pista de «sin geometría» (la cabecera). */
    interactive?: boolean
    /** «Estimado» corto por debajo de 1920 px (la cabecera). */
    compactEstimated?: boolean
  }>(),
  { testid: 'track', emptyLabel: '', interactive: false, compactEstimated: false },
)

const { t, locale } = useI18n()

type SectorFlag = TrackStateSnapshot['sectors'][number]
/** De la más grave a la más leve: el orden de los chips de sector. */
const FLAG_ORDER: readonly SectorFlag[] = ['RED', 'DOUBLE YELLOW', 'YELLOW']
const flagClass = { YELLOW: 'is-yellow', 'DOUBLE YELLOW': 'is-double-yellow', RED: 'is-red' } as const
const flagKey = { YELLOW: 'yellow', 'DOUBLE YELLOW': 'doubleYellow', RED: 'red' } as const

/** «20 y 21», «7, 8 y 9» (en el idioma de la interfaz). */
const listFmt = computed(() => new Intl.ListFormat(locale.value, { style: 'long', type: 'conjunction' }))

/** Un chip por clase de bandera, con sus sectores en orden. */
const sectorChips = computed(() => {
  const by = new Map<SectorFlag, number[]>()
  for (const [n, flag] of Object.entries(props.state.sectors)) {
    const list = by.get(flag) ?? []
    list.push(Number(n))
    by.set(flag, list)
  }
  return FLAG_ORDER.filter((flag) => by.has(flag)).map((flag) => {
    const ns = by.get(flag)!.sort((a, b) => a - b)
    return {
      flag,
      sectors: ns.join(' '),
      text: t(`trackStatus.sector.${flagKey[flag]}`, { list: listFmt.value.format(ns.map(String)) }, ns.length),
    }
  })
})
const yellowOnly = computed(() => props.state.yellow && !sectorChips.value.length && !props.state.neutral)
const empty = computed(
  () => !props.state.neutral && !sectorChips.value.length && !yellowOnly.value && !props.state.overtake && !props.state.drs,
)
</script>

<template>
  <div class="tz-ts">
    <TzEstimated v-if="inferred" field="trackStatus" :plain="!interactive" :compact="compactEstimated" />
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
      v-for="s in sectorChips"
      :key="s.flag"
      class="tz-ts__chip"
      :class="flagClass[s.flag]"
      :data-testid="`${testid}-sector`"
      :data-sectors="s.sectors"
      :data-flag="s.flag"
      :title="placeable ? undefined : t('trackStatus.noGeometry')"
    >
      {{ s.text }}
    </span>
    <TzHint
      v-if="interactive && !placeable && sectorChips.length"
      class="tz-ts__hint"
      :label="t('trackStatus.noGeometryLabel')"
      :text="t('trackStatus.noGeometry')"
      :testid="`${testid}-no-geometry`"
    />
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
  font-family: var(--tz-font-display);
  font-size: var(--tz-text-sm);
  letter-spacing: var(--tz-tracking-display);
  text-transform: uppercase;
}

/* Franja de categoría (ventanas de overtake/DRS): pintura de pista, no el acento de los controles (D47). */
.tz-ts__chip--quiet {
  border-left-color: var(--tz-paint);
  font-weight: var(--tz-weight-regular);
  color: var(--tz-text-muted);
}

/* Sobre la escena (cabecera del replay), con el fondo de los paneles para leerse. */
.tz-ts > .tz-estimated {
  background: var(--tz-overlay);
}

/* La pista no alarga la fila de chips (su zona táctil sigue entera). */
.tz-ts__hint {
  margin-block: calc(-1 * var(--tz-space-1));
}

/*
 * Banderas y neutralizaciones: la franja del color de la bandera y un tinte suave del mismo color (≤ 20 %; sin
 * color-mix, el fondo de los paneles). El texto sigue en el color del tema: siempre hay texto, nunca solo el color.
 */
.is-yellow {
  border-left-color: var(--tz-flag-yellow);
  background: color-mix(in oklab, var(--tz-flag-yellow) 20%, var(--tz-surface-1));
}

.is-double-yellow {
  border-left-color: var(--tz-flag-double-yellow);
  background: color-mix(in oklab, var(--tz-flag-double-yellow) 20%, var(--tz-surface-1));
}

.is-red {
  border-left-color: var(--tz-flag-red);
  background: color-mix(in oklab, var(--tz-flag-red) 20%, var(--tz-surface-1));
}

.is-sc {
  border-left-color: var(--tz-sc);
  background: color-mix(in oklab, var(--tz-sc) 20%, var(--tz-surface-1));
}

.is-vsc,
.is-vsc-ending {
  border-left-color: var(--tz-vsc);
  border-left-style: dashed;
  background: color-mix(in oklab, var(--tz-vsc) 20%, var(--tz-surface-1));
}
</style>
