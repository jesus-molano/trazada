<script setup lang="ts">
/**
 * Meteorología en la cabecera del replay (ítem 6, D36): un chip con el aire, la pista, la lluvia y el viento del
 * instante del reloj, que despliega el detalle (humedad, presión, antigüedad de la medida) y la dirección del viento en
 * una brújula con el norte arriba, junto a la miniatura del trazado (D27, también con el norte arriba). Nunca sobre el
 * mapa 3D: ese no está orientado al norte.
 *
 * Honestidad: el valor es la última medida con t ≤ reloj, sin interpolar; si tiene más de 150 s (o no hay ninguna
 * antes), «sin dato». Lluvia sí/no, nunca intensidad. Sin meteorología, el chip lo dice y por qué: la fuente no la trae
 * o la sesión se generó antes de que Trazada la guardara (volver a descargarla).
 *
 * La cabecera va justa (a 1280 y a 1440 px cabe en una fila con lo que ya hay, y la telemetría a 1280×800 no tiene
 * margen): por debajo de 1600 px, solo el icono, como el botón de Análisis, más «Lluvia» si llueve; desde 1600, el aire
 * y la pista; desde 1920, también la lluvia y el viento. Sin dato, el texto «sin dato» se ve siempre (un icono nunca lo
 * sustituye). Lo que se ve está siempre dentro del nombre accesible (WCAG 2.5.3), que lo dice todo, igual que el título.
 *
 * Rendimiento: lee el estado grueso (`playback.timeMs`, ≤ 10 Hz) y el índice de la muestra vigente es un número, así
 * que el chip solo se repinta al cambiar de muestra (una vez por minuto de sesión).
 */
import type { IconName } from '~/design/icons'
import {
  type CompassPoint,
  compassPoint,
  createWeatherModel,
  WEATHER_EXT,
  WEATHER_STALE_MS,
  weatherIndexAt,
} from '~/engine/weather/weather'
import { getRuntime, usePlaybackStore } from '~/stores/playback'
import { outlineFor } from '~/venues/outlines'

const { t, locale } = useI18n()
const playback = usePlaybackStore()
const rt = getRuntime()!
const { availability, series, lane } = rt.ext(WEATHER_EXT, createWeatherModel)
const { season, round, slug } = rt.session.manifest.session
/** Miniatura del trazado (norte arriba), o null: sin trazado conocido, solo la brújula. */
const outline = outlineFor(season, round, slug)
const staleS = WEATHER_STALE_MS / 1000

/** Índice de la muestra vigente (−1: sin dato). Al ser un número, lo que depende de él solo cambia con la muestra. */
const index = computed(() => (series ? weatherIndexAt(series, playback.timeMs) : -1))
const reading = computed(() => (series && index.value >= 0 ? series.rows[index.value]! : null))
/** Segundos desde la medida (solo en el panel). */
const ageS = computed(() => (reading.value ? Math.max(0, Math.floor((playback.timeMs - reading.value.t) / 1000)) : 0))

const fmt1 = computed(() => new Intl.NumberFormat(locale.value, { minimumFractionDigits: 1, maximumFractionDigits: 1 }))
const fmtUpTo1 = computed(() => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }))
const noData = () => t('weather.noData')
const celsius = (v: number | null) => (v === null ? noData() : t('weather.unit.celsius', { value: fmt1.value.format(v) }))
const percent = (v: number | null) => (v === null ? noData() : t('weather.unit.percent', { value: fmtUpTo1.value.format(v) }))
const hpa = (v: number | null) => (v === null ? noData() : t('weather.unit.hpa', { value: fmtUpTo1.value.format(v) }))
const ms = (v: number | null) => (v === null ? noData() : t('weather.unit.ms', { value: fmt1.value.format(v) }))

const POINT: Record<CompassPoint, () => string> = {
  n: () => t('weather.compass.point.n'),
  ne: () => t('weather.compass.point.ne'),
  e: () => t('weather.compass.point.e'),
  se: () => t('weather.compass.point.se'),
  s: () => t('weather.compass.point.s'),
  sw: () => t('weather.compass.point.sw'),
  w: () => t('weather.compass.point.w'),
  nw: () => t('weather.compass.point.nw'),
}

const windDeg = computed(() => reading.value?.windDeg ?? null)
const direction = computed(() =>
  windDeg.value === null ? noData() : t('weather.direction', { deg: windDeg.value, point: POINT[compassPoint(windDeg.value)]() }),
)
const needleStyle = computed(() => (windDeg.value === null ? undefined : { transform: `rotate(${windDeg.value}deg)` }))
const compassLabel = computed(() =>
  windDeg.value === null ? t('weather.compass.labelNoData') : t('weather.compass.label', { value: direction.value }),
)

function rainText(rain: boolean | null): string {
  if (rain === null) return t('weather.chip.rainNoData')
  return rain ? t('weather.chip.rain') : t('weather.chip.noRain')
}

/**
 * Piezas del chip, en el orden del nombre accesible, con desde qué ancho se ven: `always` (la lluvia, si llueve),
 * `mid` (≥ 1600 px: aire y pista) y `wide` (≥ 1920 px: «sin lluvia» y el viento).
 */
const pieces = computed(() => {
  const r = reading.value
  if (!r) return []
  return [
    { key: 'air', text: t('weather.chip.air', { value: celsius(r.airC) }), tier: 'mid' },
    { key: 'track', text: t('weather.chip.track', { value: celsius(r.trackC) }), tier: 'mid' },
    { key: 'rain', text: rainText(r.rain), tier: r.rain === true ? 'always' : 'wide' },
    {
      key: 'wind',
      text: r.windMs === null ? t('weather.chip.windNoData') : t('weather.chip.wind', { value: ms(r.windMs) }),
      tier: 'wide',
    },
  ] as const
})

/**
 * Una sesión de desarrollo (fuente secundaria, `trazada dev-ti`) no se vuelve a descargar desde el selector, y su fuente
 * no trae meteorología: decirle que la descargue de nuevo sería un consejo imposible.
 */
const devSource = (rt.session.manifest.quality.notes ?? []).some((n) => typeof n !== 'string' && n.code === 'dev-source')

const reason = computed(() => {
  if (availability === 'outdated' && devSource) return t('weather.reason.dev')
  if (availability === 'outdated') return t('weather.reason.outdated')
  if (availability === 'absent') return t('weather.reason.absent')
  return t('weather.reason.stale', { s: staleS })
})

/** Estado para los tests: hay medida, la medida caducó (o aún no hay), o la sesión no trae meteorología. */
const state = computed(() => (reading.value ? 'reading' : availability === 'present' ? 'stale' : availability))
const label = computed(() => (reading.value ? pieces.value.map((p) => p.text).join(' · ') : t('weather.chip.noData')))
const name = computed(() =>
  reading.value ? t('weather.chip.name', { reading: label.value }) : t('weather.chip.nameNoData', { reason: reason.value }),
)
const icon = computed<IconName>(() => (reading.value?.rain === true ? 'rain' : 'temperature'))

const rainSpans = lane?.rain.length ?? 0
const sessionRain = computed(() =>
  rainSpans ? t('weather.sessionRain.some', { n: rainSpans }, rainSpans) : t('weather.sessionRain.none'),
)
</script>

<script lang="ts">
/** Hueco `replay-header` (D29): chip de meteorología (ítem 6), junto al estado de pista, antes de los botones. */
export const order = 5
</script>

<template>
  <TzDisclosure
    :label="label"
    :name="name"
    :icon="icon"
    testid="weather"
    align="start"
    class="tz-weather"
    :data-state="state"
    :data-sample-t="reading?.t ?? ''"
  >
    <template #label>
      <span v-if="reading" class="tz-weather__pieces" :class="{ 'has-always': reading.rain === true }">
        <span
          v-for="p in pieces"
          :key="p.key"
          class="tz-weather__piece"
          :class="`is-${p.tier}`"
          :data-piece="p.key"
        >{{ p.text }}</span>
      </span>
      <span v-else class="tz-weather__nodata">
        <span class="tz-weather__nodata-long">{{ t('weather.chip.noData') }}</span>
        <span class="tz-weather__nodata-short">{{ t('weather.noData') }}</span>
      </span>
    </template>

    <p class="tz-weather__title">{{ t('weather.title') }}</p>
    <template v-if="reading">
      <dl class="tz-weather__list" data-testid="weather-readings">
        <div>
          <dt>{{ t('weather.field.air') }}</dt>
          <dd class="tz-tabular" data-field="air">{{ celsius(reading.airC) }}</dd>
        </div>
        <div>
          <dt>{{ t('weather.field.track') }}</dt>
          <dd class="tz-tabular" data-field="track">{{ celsius(reading.trackC) }}</dd>
        </div>
        <div>
          <dt>{{ t('weather.field.humidity') }}</dt>
          <dd class="tz-tabular" data-field="humidity">{{ percent(reading.humidity) }}</dd>
        </div>
        <div>
          <dt>{{ t('weather.field.pressure') }}</dt>
          <dd class="tz-tabular" data-field="pressure">{{ hpa(reading.pressureHpa) }}</dd>
        </div>
        <div>
          <dt>{{ t('weather.field.rain') }}</dt>
          <dd data-field="rain">
            {{ reading.rain === null ? t('weather.noData') : reading.rain ? t('weather.rain.yes') : t('weather.rain.no') }}
          </dd>
        </div>
        <div>
          <dt>{{ t('weather.field.wind') }}</dt>
          <dd class="tz-tabular" data-field="wind">{{ ms(reading.windMs) }}</dd>
        </div>
        <div>
          <dt>{{ t('weather.field.direction') }}</dt>
          <dd class="tz-tabular" data-field="direction">{{ direction }}</dd>
        </div>
      </dl>
      <p class="tz-weather__age tz-tabular" data-testid="weather-age">{{ t('weather.age', { s: ageS }) }}</p>
    </template>
    <p v-else class="tz-weather__reason" data-testid="weather-reason">{{ reason }}</p>

    <figure v-if="availability === 'present'" class="tz-weather__figure">
      <div class="tz-weather__dial-wrap">
        <span class="tz-weather__north" aria-hidden="true">{{ t('weather.compass.north') }}</span>
        <div
          class="tz-weather__dial"
          role="img"
          :aria-label="compassLabel"
          data-testid="weather-compass"
          :data-deg="windDeg ?? ''"
        >
          <TzTrackOutline v-if="outline" :d="outline" />
          <span v-if="needleStyle" class="tz-weather__needle" :style="needleStyle" aria-hidden="true"><span /></span>
        </div>
      </div>
      <figcaption class="tz-weather__caption">
        {{ t('weather.windNote') }}
        <template v-if="outline">{{ t('weather.compass.outline') }}</template>
      </figcaption>
    </figure>
    <p v-if="availability === 'present'" class="tz-weather__session" data-testid="weather-session-rain">{{ sessionRain }}</p>
    <p class="tz-weather__note">{{ t('weather.note', { s: staleS }) }}</p>
  </TzDisclosure>
</template>

<style scoped>
/*
 * Por debajo de 1600 px, solo el icono (y «Lluvia» si llueve); desde 1600, el aire y la pista; desde 1920, todo. Lo
 * que no se ve está en el nombre accesible, en el título y en el panel.
 */
.tz-weather__pieces {
  display: none;
  align-items: baseline;
}

.tz-weather__pieces.has-always {
  display: inline-flex;
}

.tz-weather__piece {
  display: none;
}

.tz-weather__piece.is-always {
  display: inline;
}

/* Separador entre piezas (fuera del texto: el nombre accesible ya lo dice todo). */
.tz-weather__piece + .tz-weather__piece::before {
  content: '·';
  margin: 0 var(--tz-space-1);
  color: var(--tz-text-muted);
}

/* Sola («Lluvia» por debajo de 1600 px), sin separador delante. */
.tz-weather__piece.is-always::before {
  content: none;
}

.tz-weather__nodata-long {
  display: none;
}

@media (width >= 1600px) {
  .tz-weather__pieces {
    display: inline-flex;
  }

  .tz-weather__piece.is-mid {
    display: inline;
  }

  .tz-weather__piece.is-always::before {
    content: '·';
  }

  .tz-weather__nodata-long {
    display: inline;
  }

  .tz-weather__nodata-short {
    display: none;
  }
}

@media (width >= 1920px) {
  .tz-weather__piece.is-wide {
    display: inline;
  }
}

.tz-weather__title {
  margin: 0 0 var(--tz-space-2);
  font-weight: var(--tz-weight-semibold);
}

.tz-weather__list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--tz-space-2) var(--tz-space-4);
  margin: 0;
}

.tz-weather__list div {
  display: flex;
  justify-content: space-between;
  gap: var(--tz-space-2);
  min-width: 0;
}

.tz-weather__list dt {
  color: var(--tz-text-muted);
}

.tz-weather__list dd {
  margin: 0;
  text-align: right;
}

/* La dirección (con su rumbo) ocupa la fila entera. */
.tz-weather__list div:last-child {
  grid-column: 1 / -1;
}

.tz-weather__age,
.tz-weather__reason,
.tz-weather__session,
.tz-weather__note {
  margin: var(--tz-space-2) 0 0;
}

.tz-weather__age,
.tz-weather__note {
  font-size: var(--tz-text-xs);
  color: var(--tz-text-muted);
}

.tz-weather__figure {
  display: flex;
  align-items: center;
  gap: var(--tz-space-4);
  margin: var(--tz-space-3) 0 0;
}

/* Brújula: el norte arriba (rótulo «N» encima del círculo); el punto marca la dirección que da el feed. */
.tz-weather__dial-wrap {
  position: relative;
  flex: none;
  padding-top: var(--tz-space-4);
}

.tz-weather__north {
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  font-size: var(--tz-text-xs);
  font-weight: var(--tz-weight-semibold);
  line-height: 1;
  color: var(--tz-text-muted);
}

.tz-weather__dial {
  position: relative;
  display: grid;
  place-items: center;
  width: 72px;
  height: 72px;
  border: 1px solid var(--tz-border-strong);
  border-radius: 50%;
}

.tz-weather__needle {
  position: absolute;
  inset: 0;
  transform-origin: 50% 50%;
}

.tz-weather__needle span {
  position: absolute;
  top: -6px;
  left: 50%;
  width: 11px;
  height: 11px;
  margin-left: -5.5px;
  border: 2px solid var(--tz-surface-2);
  border-radius: 50%;
  background: var(--tz-accent);
}

.tz-weather__caption {
  font-size: var(--tz-text-xs);
  color: var(--tz-text-muted);
}
</style>
