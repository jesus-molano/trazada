<script setup lang="ts">
/**
 * Ficha de una serie del race trace (D49): en la vuelta señalada, la posición en la línea (`posAtLine`, el orden de
 * paso de esa vuelta) y la diferencia con el primero (el mismo valor que se dibuja, con un decimal); el primero de esa
 * vuelta, «primero en la línea»; sin paso por meta, «sin paso por meta». Después, lo que cuentan los datos del coche
 * (`TzCarStory`; en la forma corta de la ficha, `compact`, un solo mensaje). Todo hasta el corte de la pestaña.
 */
import type { RaceTrace } from '~/engine/analysis/raceTrace'

const props = defineProps<{ car: string; index: number; cutoffMs: number; trace: RaceTrace; stopped: boolean; compact?: boolean }>()

const { t, locale } = useI18n()
const gapFmt = computed(() => new Intl.NumberFormat(locale.value, { minimumFractionDigits: 1, maximumFractionDigits: 1 }))

const line = computed(() => {
  const tr = props.trace
  const lap = tr.laps[props.index]
  if (lap === undefined) return ''
  const x = t('analysis.lapShort', { lap })
  const s = tr.series.find((x) => x.car === props.car)
  const gap = s?.gapMs[props.index]
  if (!s || gap === undefined || Number.isNaN(gap)) return t('analysis.card.lapNone', { x })
  if (tr.leaderCar[props.index] === props.car) return t('analysis.card.lapFirst', { x })
  return t('analysis.card.lapPos', { x, pos: s.posAtLine[props.index]!, gap: gapFmt.value.format(gap / 1000) })
})
</script>

<template>
  <p data-testid="analysis-card-lap">{{ line }}</p>
  <TzCarStory :car="car" :cutoff-ms="cutoffMs" :stopped="stopped" :compact="compact" />
</template>
