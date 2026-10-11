import { describe, expect, it } from 'vitest'
import { COUNTRY_ISO, countryLabel, ISO_CODES, isoForCountry } from './countries'
import { flagSrc, flagSvg } from './flags'
import { centerFor, outlineFor } from './outlines'

/** Valores de `Country` que da el calendario de FastF1 (backend 'fastf1') en 2018–2026. */
const FASTF1_COUNTRIES = [
  'Abu Dhabi', 'United Arab Emirates', 'Australia', 'Austria', 'Azerbaijan', 'Bahrain', 'Belgium', 'Brazil',
  'Canada', 'China', 'France', 'Germany', 'Great Britain', 'United Kingdom', 'Hungary', 'Italy', 'Japan',
  'Mexico', 'Monaco', 'Netherlands', 'Portugal', 'Qatar', 'Russia', 'Saudi Arabia', 'Singapore', 'Spain',
  'Turkey', 'United States',
] // prettier-ignore

/** Calendarios de FastF1 2023–2026: [temporada, ronda, slug de la localidad] (slug = regla de `event_slug`). */
const EVENTS: [number, number, string][] = [
  ...[
    'sakhir', 'jeddah', 'melbourne', 'baku', 'miami', 'monaco', 'barcelona', 'montreal', 'spielberg',
    'silverstone', 'budapest', 'spa-francorchamps', 'zandvoort', 'monza', 'marina-bay', 'suzuka', 'lusail',
    'austin', 'mexico-city', 'sao-paulo', 'las-vegas', 'yas-island',
  ].map((slug, i): [number, number, string] => [2023, i + 1, slug]),
  ...[
    'sakhir', 'jeddah', 'melbourne', 'suzuka', 'shanghai', 'miami', 'imola', 'monaco', 'montreal', 'barcelona',
    'spielberg', 'silverstone', 'budapest', 'spa-francorchamps', 'zandvoort', 'monza', 'baku', 'marina-bay',
    'austin', 'mexico-city', 'sao-paulo', 'las-vegas', 'lusail', 'yas-island',
  ].map((slug, i): [number, number, string] => [2024, i + 1, slug]),
  ...[
    'melbourne', 'shanghai', 'suzuka', 'sakhir', 'jeddah', 'miami-gardens', 'imola', 'monaco', 'barcelona',
    'montreal', 'spielberg', 'silverstone', 'spa-francorchamps', 'budapest', 'zandvoort', 'monza', 'baku',
    'marina-bay', 'austin', 'mexico-city', 'sao-paulo', 'las-vegas', 'lusail', 'yas-island',
  ].map((slug, i): [number, number, string] => [2025, i + 1, slug]),
  ...[
    'melbourne', 'shanghai', 'suzuka', 'miami-gardens', 'montreal', 'monte-carlo', 'barcelona', 'spielberg',
    'silverstone', 'spa-francorchamps', 'budapest', 'zandvoort', 'monza', 'madrid', 'baku', 'kuala-lumpur',
    'marina-bay', 'austin', 'mexico-city', 'sao-paulo', 'las-vegas', 'lusail', 'yas-marina',
  ].map((slug, i): [number, number, string] => [2026, i + 1, slug]),
] // prettier-ignore

describe('países y banderas', () => {
  it('todo país del calendario 2018–2026 tiene código ISO y bandera', () => {
    for (const country of FASTF1_COUNTRIES) {
      const iso = isoForCountry(country)
      expect(iso, country).not.toBeNull()
      expect(ISO_CODES).toContain(iso)
    }
    expect(new Set(Object.values(COUNTRY_ISO))).toEqual(new Set(ISO_CODES))
  })

  it('sin dato, sin bandera (nunca se adivina)', () => {
    expect(isoForCountry('')).toBeNull()
    expect(isoForCountry('Atlantis')).toBeNull()
    expect(isoForCountry(undefined)).toBeNull()
    expect(isoForCountry(' Belgium ')).toBe('BE')
  })

  it('las banderas son SVG autocontenidos: sin referencias externas, scripts ni imágenes', () => {
    for (const iso of ISO_CODES) {
      const svg = flagSvg(iso)
      expect(svg.startsWith('<svg'), iso).toBe(true)
      expect(svg, iso).not.toMatch(/href|<script|<image|<foreignObject|@import|url\(/i)
      expect(flagSrc(iso).startsWith('data:image/svg+xml,')).toBe(true)
    }
  })

  it('nombre del país en el idioma de la interfaz', () => {
    expect(countryLabel('United Kingdom', 'es')).toBe('Reino Unido')
    expect(countryLabel('Great Britain', 'en')).toBe('United Kingdom')
    expect(countryLabel('Abu Dhabi', 'es')).toBe('Emiratos Árabes Unidos')
    expect(countryLabel('Atlantis', 'es')).toBe('Atlantis')
  })
})

describe('miniaturas de trazado', () => {
  it('todos los Grandes Premios 2023–2026 tienen trazado', () => {
    const missing = EVENTS.filter(([season, round, slug]) => !outlineFor(season, round, slug))
    expect(missing).toEqual([])
    for (const [season, round, slug] of EVENTS) expect(outlineFor(season, round, slug)).toMatch(/^M[\d. ]+Z$/)
  })

  it('alias de localidad: mismo circuito con otro nombre según el año', () => {
    expect(outlineFor(2025, 8, 'monaco')).toBe(outlineFor(2026, 6, 'monte-carlo'))
    expect(outlineFor(2024, 24, 'yas-island')).toBe(outlineFor(2026, 23, 'yas-marina'))
    expect(outlineFor(2024, 6, 'miami')).toBe(outlineFor(2025, 6, 'miami-gardens'))
  })

  it('sin trazado conocido (o con otra configuración), null: nunca uno inventado', () => {
    expect(outlineFor(2026, 99, 'atlantis')).toBeNull()
    expect(outlineFor(2020, 16, 'sakhir')).toBeNull() // GP de Sakhir 2020: trazado exterior
    expect(outlineFor(2026, 1, '__proto__')).toBeNull()
    expect(outlineFor(2026, 1, 'constructor')).toBeNull()
  })
})

describe('centros de circuito (ambiente, D37)', () => {
  it('todos los Grandes Premios 2023–2026 tienen centro, con las mismas reglas que el trazado', () => {
    const missing = EVENTS.filter(([season, round, slug]) => !centerFor(season, round, slug))
    expect(missing).toEqual([])
    expect(centerFor(2025, 8, 'monaco')).toEqual(centerFor(2026, 6, 'monte-carlo'))
    expect(centerFor(2024, 24, 'yas-island')).toEqual(centerFor(2026, 23, 'yas-marina'))
  })

  it('cada centro está donde está el circuito (a 0,05°)', () => {
    const near = (season: number, round: number, slug: string, lat: number, lon: number) => {
      const c = centerFor(season, round, slug)!
      expect(Math.abs(c.lat - lat), slug).toBeLessThan(0.05)
      expect(Math.abs(c.lon - lon), slug).toBeLessThan(0.05)
    }
    near(2026, 10, 'spa-francorchamps', 50.437, 5.971)
    near(2026, 3, 'suzuka', 34.843, 136.541)
    near(2025, 18, 'marina-bay', 1.291, 103.864)
    near(2025, 24, 'yas-island', 24.467, 54.603)
    // GP de Baréin 2026 en Sepang (alias kuala-lumpur): la posición de Sepang, no la de Sakhir.
    near(2026, 16, 'kuala-lumpur', 2.761, 101.738)
  })

  it('sede desconocida o con otra configuración: null, nunca la posición de otro circuito', () => {
    expect(centerFor(2026, 99, 'atlantis')).toBeNull()
    expect(centerFor(2020, 16, 'sakhir')).toBeNull()
    expect(centerFor(2026, 1, '__proto__')).toBeNull()
    expect(centerFor(2026, 1, 'constructor')).toBeNull()
  })
})
