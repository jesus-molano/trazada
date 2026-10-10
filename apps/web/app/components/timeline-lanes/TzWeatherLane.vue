<script setup lang="ts">
/**
 * Franja de meteorología del timeline (ítem 6, D36; hueco `timeline-lanes`): los tramos con lluvia y la temperatura de
 * la pista, un tramo por medida (más opaco, más caliente, entre el mínimo y el máximo de la reproducción). Cada medida
 * vale de su instante a la siguiente o, como mucho, 150 s, como en el chip de la cabecera: sin interpolar, y un hueco
 * del feed queda vacío. Estático: se calcula una vez por runtime (`rt.ext`), nada por frame.
 *
 * Es una franja fina (como la de OVERTAKE/DRS bajo el riel) metida en los 3 px libres del pie de la fila de marcas
 * (vueltas, banderas y paradas acaban 3 px antes): no añade alto al timeline. La telemetría a 1280×800 va sin margen,
 * y un carril más alto le quitaría sitio. Los carriles que vengan detrás se apilan debajo, como dice el hueco.
 *
 * Va dentro del slider del timeline, cuyo contenido no leen los lectores de pantalla: el resumen va en el `title` (el
 * mínimo y el máximo al pasar por encima) y el detalle, en el panel del chip de meteorología. Sin meteorología, no hay
 * franja (el chip ya dice «sin dato» y por qué).
 */
import { createWeatherModel, WEATHER_EXT } from '~/engine/weather/weather'
import { getRuntime } from '~/stores/playback'

const { t, locale } = useI18n()
const rt = getRuntime()!
const clock = rt.clock
const { lane } = rt.ext(WEATHER_EXT, createWeatherModel)
const range = lane?.trackRange ?? null
const shown = !!lane && (lane.trackTemp.length > 0 || lane.rain.length > 0)

const pct = (ms: number) => `${(((ms - clock.startMs) / clock.duration) * 100).toFixed(4)}%`
const span = (from: number, to: number) => ({ left: pct(from), width: `${(((to - from) / clock.duration) * 100).toFixed(4)}%` })

/** Opacidad del tramo: del 0,25 (mínimo de la reproducción) al 0,9 (máximo); si no varía, todos iguales. */
function opacity(v: number): string {
  if (!range || range.max === range.min) return '0.6'
  return (0.25 + (0.65 * (v - range.min)) / (range.max - range.min)).toFixed(3)
}

const fmt = computed(() => new Intl.NumberFormat(locale.value, { minimumFractionDigits: 1, maximumFractionDigits: 1 }))
const celsius = (v: number) => t('weather.unit.celsius', { value: fmt.value.format(v) })

const steps = computed(() =>
  (lane?.trackTemp ?? []).map((s) => ({
    style: { ...span(s.fromMs, s.toMs), opacity: opacity(s.value) },
    title: t('weather.lane.step', { value: celsius(s.value) }),
  })),
)
const rain = (lane?.rain ?? []).map((r) => span(r.fromMs, r.toMs))

const title = computed(() => {
  const n = rain.length
  const rainText = n ? t('weather.lane.rainSome', { n }, n) : t('weather.lane.rainNone')
  return range
    ? t('weather.lane.title', { min: celsius(range.min), max: celsius(range.max), rain: rainText })
    : t('weather.lane.titleNoTemp', { rain: rainText })
})
</script>

<script lang="ts">
/** Hueco `timeline-lanes` (D29): el primero, al pie de la fila de marcas. */
export const order = 10
</script>

<template>
  <div
    v-if="shown"
    class="tz-wlane"
    :title="title"
    aria-hidden="true"
    data-testid="weather-lane"
    :data-rain-spans="rain.length"
    :data-steps="steps.length"
  >
    <span
      v-for="(s, i) in steps"
      :key="`s${i}`"
      class="tz-wlane__temp"
      :style="s.style"
      :title="s.title"
      data-marker="track-temp"
    />
    <span
      v-for="(r, i) in rain"
      :key="`r${i}`"
      class="tz-wlane__rain"
      :style="r"
      :title="t('weather.lane.rainSpan')"
      data-marker="rain"
    />
  </div>
</template>

<style scoped>
/*
 * 3 px al pie de la fila de marcas (que mide 36 px y cuyo contenido acaba a los 33): el margen negativo la sube ahí y
 * el carril no suma alto. La lluvia va encima de la temperatura.
 */
.tz-wlane {
  position: relative;
  height: 3px;
  margin-top: -3px;
  border-radius: 1px;
  overflow: hidden;
}

.tz-wlane__temp,
.tz-wlane__rain {
  position: absolute;
  top: 0;
  bottom: 0;
}

.tz-wlane__temp {
  background: var(--tz-weather-temp);
}

.tz-wlane__rain {
  background: var(--tz-rain);
  opacity: 0.9;
}
</style>
