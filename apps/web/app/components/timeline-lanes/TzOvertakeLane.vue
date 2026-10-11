<script setup lang="ts">
/**
 * Marcas de adelantamiento en el timeline (ítem 5, D35; hueco `timeline-lanes`): una por adelantamiento confirmado en
 * la línea de meta, en su instante aproximado (GPS); sin él, una marca hueca al inicio de la vuelta («momento exacto:
 * sin dato»). Solo en carrera y sprint, y con «Sin spoilers» (activo por defecto, el de la hoja de análisis) solo
 * los confirmados hasta el instante del reloj: aparecen cuando la línea los confirma.
 *
 * No añade alto al timeline: va en la franja libre de la pista por encima del riel (de 0 a 6 px). Dentro del slider,
 * cuyo contenido no leen los lectores de pantalla: el resumen va en el `title` y el detalle, en la pestaña «Momentos».
 * Estático salvo al cruzar un paso por meta con «Sin spoilers» (nada por frame).
 */
import { crossingTimes } from '~/engine/analysis/raceTrace'
import { overtakeTime } from '~/engine/moments/jumps'
import { getRuntime } from '~/stores/playback'
import { useMomentsStore } from '~/stores/moments'

const { t } = useI18n()
const rt = getRuntime()!
const clock = rt.clock
const model = useMomentsStore().model()!
const st = useAnalysis()
const tla = new Map(rt.drivers.map((d) => [d.number, d.tla]))
const name = (car: string) => tla.get(car) ?? car

const times = rt.ext('analysis:crossings', (r) => crossingTimes(r.leaderboard.lapTable))
const cutoff = useEffectiveCutoff(times, st.cutoffMs)

const pct = (ms: number) => `${(((ms - clock.startMs) / clock.duration) * 100).toFixed(4)}%`

const ticks = computed(() =>
  model.overtakes
    .filter((o) => o.confirmedMs <= cutoff.value)
    .map((o) => ({ o, t: overtakeTime(o) }))
    .filter(({ t: x }) => x >= clock.startMs && x <= clock.endMs)
    .map(({ o, t: x }) => {
      const params = { lap: o.lap, passer: name(o.passer), passed: name(o.passed) }
      return {
        key: `${o.passer}-${o.passed}-${o.lap}`,
        style: { left: pct(x) },
        located: o.atMs !== null,
        title: o.atMs !== null ? t('moments.lane.tick', params) : t('moments.lane.tickNoData', params),
      }
    }),
)

const title = computed(() =>
  st.noSpoilers.value ? t('moments.lane.titleSoFar', { n: ticks.value.length }) : t('moments.lane.title', { n: ticks.value.length }),
)
</script>

<script lang="ts">
/** Hueco `timeline-lanes` (D29): detrás de la meteorología. */
export const order = 20
</script>

<template>
  <div
    v-if="model.race && model.overtakes.length"
    class="tz-olane"
    :title="title"
    aria-hidden="true"
    data-testid="overtake-lane"
    :data-ticks="ticks.length"
  >
    <span
      v-for="k in ticks"
      :key="k.key"
      class="tz-olane__tick"
      :class="{ 'is-unlocated': !k.located }"
      :style="k.style"
      :title="k.title"
      data-marker="overtake"
      :data-located="k.located"
    />
  </div>
</template>

<style scoped>
/*
 * En la franja libre de la pista por encima del riel (el riel empieza a 6 px): fuera del flujo de los carriles, así
 * que no suma alto al timeline.
 */
.tz-olane {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  height: 5px;
}

.tz-olane__tick {
  position: absolute;
  top: 0;
  width: 3px;
  height: 5px;
  border-radius: 1px;
  background: var(--tz-gain);
  transform: translateX(-50%);
}

/* Sin instante GPS: marca hueca al inicio de la vuelta (la forma lo dice, no solo el color). */
.tz-olane__tick.is-unlocated {
  border: 1px solid var(--tz-gain);
  background: transparent;
}
</style>
