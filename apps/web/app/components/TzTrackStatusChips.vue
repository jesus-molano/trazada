<script setup lang="ts">
/**
 * Chips del estado de la pista (presentacional, sin runtime): neutralización, banderas por sector, amarilla y ventana
 * de overtake/DRS de un `TrackStateSnapshot`. Como en la lámina de D50: la neutralización (SC, VSC, roja) es la única
 * placa maciza, del color de la bandera y con texto oscuro; las banderas y las ventanas van en un chip de tono con el
 * glifo de la hoja de tiempos delante (`TzRcGlyph`). Nunca una franja de color. Lo usan la cabecera del replay (`TzTrackStatus`, el instante del reloj)
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
/** Glifo de cada bandera (el de la hoja de tiempos de dirección de carrera, `TzRcGlyph`). */
const GLYPH_KIND = { YELLOW: 'sector_yellow', 'DOUBLE YELLOW': 'sector_double_yellow', RED: 'red_flag' } as const

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
      class="tz-ts__plate"
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
      <TzRcGlyph :kind="GLYPH_KIND[s.flag]" />{{ s.text }}
    </span>
    <TzHint
      v-if="interactive && !placeable && sectorChips.length"
      class="tz-ts__hint"
      :label="t('trackStatus.noGeometryLabel')"
      :text="t('trackStatus.noGeometry')"
      :testid="`${testid}-no-geometry`"
    />
    <span v-if="yellowOnly" class="tz-ts__chip is-yellow" :data-testid="`${testid}-yellow`">
      <TzRcGlyph kind="sector_yellow" />{{ t('trackStatus.yellow') }}
    </span>
    <span v-if="state.overtake" class="tz-ts__chip tz-ts__chip--quiet" :data-testid="`${testid}-overtake`">
      <TzRcGlyph kind="overtake_enabled" />{{ t('trackStatus.overtake') }}
    </span>
    <span v-if="state.drs" class="tz-ts__chip tz-ts__chip--quiet" :data-testid="`${testid}-drs`">
      <TzRcGlyph kind="drs_enabled" />{{ t('trackStatus.drs') }}
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

/* Bandera o ventana: chip de tono con su glifo delante y el texto (nunca solo el color). */
.tz-ts__chip {
  display: inline-flex;
  align-items: center;
  gap: var(--tz-space-1);
  height: 26px;
  padding: 0 var(--tz-space-2) 0 var(--tz-space-1);
  border-radius: var(--tz-radius-md);
  background: var(--tz-surface-2);
  font-size: var(--tz-text-sm);
  font-weight: var(--tz-weight-medium);
  white-space: nowrap;
}

/* Ventanas de overtake/DRS: lo mismo, más tenue. */
.tz-ts__chip--quiet {
  color: var(--tz-text-muted);
}

/*
 * Neutralización: la única placa maciza (del color de la bandera, con texto oscuro). El VSC que acaba, con el borde
 * discontinuo y sin relleno: se va. En forced-colors, el fondo desaparece y queda un borde.
 */
.tz-ts__plate {
  display: inline-flex;
  align-items: center;
  height: 26px;
  padding: 0 var(--tz-space-2);
  border: 1px solid transparent;
  border-radius: var(--tz-radius-md);
  color: var(--tz-text-inverse);
  font-size: var(--tz-text-sm);
  font-weight: var(--tz-weight-semibold);
  white-space: nowrap;
}

.tz-ts__plate.is-sc {
  background: var(--tz-sc);
}

.tz-ts__plate.is-vsc {
  background: var(--tz-vsc);
}

.tz-ts__plate.is-vsc-ending {
  border-color: var(--tz-vsc);
  border-style: dashed;
  color: var(--tz-vsc);
}

.tz-ts__plate.is-red {
  background: var(--tz-flag-red);
}

/* La pista no alarga la fila de chips (su zona táctil sigue entera). */
.tz-ts__hint {
  margin-block: calc(-1 * var(--tz-space-1));
}

@media (forced-colors: active) {
  .tz-ts__plate {
    border-color: CanvasText;
  }
}
</style>
