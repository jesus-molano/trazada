/**
 * Meteorología (ítem 6, D36): el chip de la cabecera y el carril del timeline con el runtime real del fixture (Bélgica
 * FP1, con meteorología de la caché de FastF1), y sus estados sin dato: la medida caducó (> 150 s), la fuente no la
 * trae (`absent`) o la sesión es de antes de 1.1.0 (sin canal: volver a descargarla). Nunca un valor inventado.
 */
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { SessionWeather } from '@trazada/schema'
import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import TzWeather from '~/components/replay-header/TzWeather.vue'
import TzWeatherLane from '~/components/timeline-lanes/TzWeatherLane.vue'
import type { LoadedSession } from '~/data/types'
import { WEATHER_STALE_MS } from '~/engine/weather/weather'
import { createReplayRuntime, type ReplayRuntime } from '~/replay/runtime'
import { REPLAY_HEADER } from '~/slots/replay'
import { TIMELINE_LANES } from '~/slots/timeline-lanes'
import { usePlaybackStore } from '~/stores/playback'
import { loadFixture } from '~/testing/fixture'

afterEach(() => usePlaybackStore().detach())

async function attach(edit?: (s: LoadedSession) => LoadedSession): Promise<ReplayRuntime> {
  const base = await loadFixture()
  const rt = createReplayRuntime(edit ? edit(base) : base)
  usePlaybackStore().attach(rt)
  return rt
}

async function seek(rt: ReplayRuntime, ms: number) {
  rt.clock.seek(ms)
  await nextTick()
}

/** La sesión del fixture con otra meteorología (o sin ella) y otro canal en el manifest. */
function withWeather(weather: SessionWeather | undefined, channel: 'present' | 'absent' | undefined) {
  return (s: LoadedSession): LoadedSession => {
    const { weather: _w, ...events } = s.events
    const { weather: _c, ...channels } = s.manifest.channels
    return {
      ...s,
      events: weather ? { ...events, weather } : events,
      manifest: { ...s.manifest, channels: channel ? { ...channels, weather: channel } : channels },
    }
  }
}

describe('huecos reales', () => {
  it('el chip va en la cabecera, antes de los botones, y el carril en el timeline', () => {
    const header = REPLAY_HEADER.map((h) => h.name)
    expect(header).toContain('TzWeather')
    expect(header.indexOf('TzWeather')).toBeLessThan(header.indexOf('TzAnalysisButton'))
    expect(TIMELINE_LANES.map((l) => l.name)).toContain('TzWeatherLane')
  })
})

describe('chip de meteorología', () => {
  it('con meteorología: aire, pista, lluvia y viento de la última medida, sin interpolar', async () => {
    const rt = await attach()
    const w = await mountSuspended(TzWeather)
    const root = w.find('.tz-weather')
    expect(root.attributes('data-state')).toBe('reading')
    const rows = rt.session.events.weather!
    const first = Number(root.attributes('data-sample-t'))
    expect(first).toBe(rows.t[0]) // la vigente al empezar: la anterior al inicio de la reproducción
    const chip = w.find('[data-testid="weather"]')
    expect(chip.attributes('aria-expanded')).toBe('false')
    const pieces = w.findAll('[data-piece]').map((p) => [p.attributes('data-piece'), p.classes().find((c) => c.startsWith('is-'))])
    // Desde qué ancho se ve cada una: sin lluvia, por debajo de 1600 px solo el icono.
    expect(pieces).toEqual([
      ['air', 'is-mid'],
      ['track', 'is-mid'],
      ['rain', 'is-wide'],
      ['wind', 'is-wide'],
    ])
    expect(w.find('.tz-weather__pieces').classes()).not.toContain('has-always')
    expect(w.find('[data-piece="air"]').text()).toMatch(/^(Aire|Air) 23[,.]7 °C$/)
    expect(w.find('[data-piece="rain"]').text()).toMatch(/^(Sin lluvia|No rain)$/)
    // Lo visible es el principio del nombre accesible (WCAG 2.5.3), que lo dice todo.
    const name = chip.attributes('aria-label')!
    expect(name.startsWith(w.findAll('[data-piece]').slice(0, 2).map((p) => p.text()).join(' · '))).toBe(true)
    expect(name).toMatch(/(Viento|Wind) 0[,.]9 m\/s/)

    // A mitad de un minuto, el valor sigue siendo el de la última medida (escalonado).
    await seek(rt, (rows.t[2]! + rows.t[3]!) / 2)
    expect(Number(w.find('.tz-weather').attributes('data-sample-t'))).toBe(rows.t[2])
    expect(w.find('[data-piece="air"]').text()).toMatch(/24[,.]1 °C/)
  })

  it('el panel: detalle, antigüedad de la medida y la brújula con el norte arriba, junto al trazado', async () => {
    const rt = await attach()
    const w = await mountSuspended(TzWeather)
    await w.find('[data-testid="weather"]').trigger('click')
    expect(w.find('[data-testid="weather"]').attributes('aria-expanded')).toBe('true')
    const panel = w.find('[data-testid="weather-panel"]')
    const field = (f: string) => panel.find(`[data-field="${f}"]`).text()
    expect(field('humidity')).toMatch(/41[,.]1 %/)
    expect(field('pressure')).toMatch(/966[,.]8 hPa/)
    expect(field('rain')).toMatch(/^(No)$/)
    expect(field('direction')).toBe('4° (N)')
    const age = Math.floor((rt.clock.timeMs - rt.session.events.weather!.t[0]!) / 1000)
    expect(panel.find('[data-testid="weather-age"]').text()).toContain(`${age} s`)
    const compass = panel.find('[data-testid="weather-compass"]')
    expect(compass.attributes('role')).toBe('img')
    expect(compass.attributes('aria-label')).toContain('4°')
    expect(compass.attributes('data-deg')).toBe('4')
    expect(compass.find('.tz-weather__needle').attributes('style')).toContain('rotate(4deg)')
    expect(compass.find('[data-testid="track-outline"]').exists()).toBe(true) // Spa: trazado con el norte arriba
    expect(panel.find('[data-testid="weather-session-rain"]').text()).toMatch(/(Ninguna medida con lluvia|No reading with rain)/)
    expect(panel.text()).toMatch(/(no está orientado al norte|not north-up)/)
  })

  it('una medida de más de 150 s caduca: «sin dato», nunca la última arrastrada', async () => {
    const rt = await attach((s) => {
      const src = s.events.weather!
      const keep = (col: readonly unknown[]) => col.slice(0, 2)
      const weather = Object.fromEntries(Object.entries(src).map(([k, v]) => [k, keep(v)])) as unknown as SessionWeather
      return withWeather(weather, 'present')(s)
    })
    const w = await mountSuspended(TzWeather)
    expect(w.find('.tz-weather').attributes('data-state')).toBe('reading')
    const last = rt.session.events.weather!.t[1]!
    await seek(rt, last + WEATHER_STALE_MS)
    expect(w.find('.tz-weather').attributes('data-state')).toBe('reading')
    await seek(rt, last + WEATHER_STALE_MS + 1000)
    expect(w.find('.tz-weather').attributes('data-state')).toBe('stale')
    // «sin dato» se ve a cualquier ancho (largo desde 1600 px, corto por debajo): un icono nunca lo sustituye.
    expect(w.find('.tz-weather__nodata-long').text()).toMatch(/^(Meteo: sin dato|Weather: no data)$/)
    expect(w.find('.tz-weather__nodata-short').text()).toMatch(/^(sin dato|no data)$/)
    expect(w.find('[data-testid="weather-reason"]').text()).toMatch(/150 s/)
    expect(w.find('[data-piece]').exists()).toBe(false)
  })

  it('la fuente no la trae: «sin dato» y por qué', async () => {
    await attach(withWeather(undefined, 'absent'))
    const w = await mountSuspended(TzWeather)
    expect(w.find('.tz-weather').attributes('data-state')).toBe('absent')
    expect(w.find('.tz-weather__nodata-long').text()).toMatch(/^(Meteo: sin dato|Weather: no data)$/)
    expect(w.find('[data-testid="weather-reason"]').text()).toMatch(/(La fuente no trae|The source has no)/)
    expect(w.find('[data-testid="weather-compass"]').exists()).toBe(false)
  })

  it('sesión de antes de 1.1.0 (sin canal): «sin dato» y volver a descargarla', async () => {
    await attach(withWeather(undefined, undefined))
    const w = await mountSuspended(TzWeather)
    expect(w.find('.tz-weather').attributes('data-state')).toBe('outdated')
    expect(w.find('[data-testid="weather"]').attributes('aria-label')).toMatch(/(vuelve a descargarla|download it again)/)
  })

  it('con lluvia: el icono y la palabra se ven también en el chip compacto', async () => {
    const rt = await attach((s) => {
      const src = s.events.weather!
      return withWeather({ ...src, rain: src.rain.map(() => true) }, 'present')(s)
    })
    const w = await mountSuspended(TzWeather)
    const rain = w.find('[data-piece="rain"]')
    expect(rain.text()).toMatch(/^(Lluvia|Rain)$/)
    expect(rain.classes()).toContain('is-always') // por debajo de 1600 px también se ve
    expect(w.find('.tz-weather__pieces').classes()).toContain('has-always')
    expect(w.find('[data-piece="air"]').classes()).toContain('is-mid')
    expect(w.find('[data-piece="wind"]').classes()).toContain('is-wide')
    expect(w.find('[data-testid="weather"] [data-icon]').attributes('data-icon')).toBe('rain')
    expect(rt.session.events.weather!.rain.every(Boolean)).toBe(true)
  })
})

describe('carril de meteorología del timeline', () => {
  it('un escalón de temperatura de pista por medida, recortado a la reproducción, con mínimo y máximo', async () => {
    const rt = await attach()
    const w = await mountSuspended(TzWeatherLane)
    const lane = w.find('[data-testid="weather-lane"]')
    const n = rt.session.events.weather!.t.length
    expect(Number(lane.attributes('data-steps'))).toBe(n)
    expect(lane.attributes('data-rain-spans')).toBe('0')
    const steps = w.findAll('[data-marker="track-temp"]')
    expect(steps).toHaveLength(n)
    expect(steps[0]!.attributes('style')).toMatch(/left: 0\.0000%/) // la vigente al empezar, desde el inicio
    expect(lane.attributes('title')).toMatch(/34[,.]8 °C.*35[,.]8 °C/)
    expect(lane.attributes('aria-hidden')).toBe('true')
  })

  it('con lluvia, sus tramos; sin meteorología, no hay carril', async () => {
    await attach((s) => {
      const src = s.events.weather!
      return withWeather({ ...src, rain: src.rain.map((_, i) => i >= 3 && i <= 5) }, 'present')(s)
    })
    const w = await mountSuspended(TzWeatherLane)
    expect(w.findAll('[data-marker="rain"]')).toHaveLength(1)
    expect(w.find('[data-testid="weather-lane"]').attributes('title')).toMatch(/(1 tramo|1 stretch)/)
    usePlaybackStore().detach()

    await attach(withWeather(undefined, 'absent'))
    const none = await mountSuspended(TzWeatherLane)
    expect(none.find('[data-testid="weather-lane"]').exists()).toBe(false)
  })
})
