/**
 * Países del calendario (D27): el `Country` de FastF1 (en inglés, tal cual) → código ISO 3166-1 alfa-2, para la
 * bandera y el nombre localizado. Cubre todos los valores de 2018–2026 y algunos alias por si cambian.
 */
export const ISO_CODES = [
  'AE', 'AT', 'AU', 'AZ', 'BE', 'BH', 'BR', 'CA', 'CN', 'DE', 'ES', 'FR', 'GB', 'HU',
  'IT', 'JP', 'MC', 'MX', 'MY', 'NL', 'PT', 'QA', 'RU', 'SA', 'SG', 'TR', 'US',
] as const // prettier-ignore
export type IsoCode = (typeof ISO_CODES)[number]

export const COUNTRY_ISO: Readonly<Record<string, IsoCode>> = {
  'Abu Dhabi': 'AE',
  'United Arab Emirates': 'AE',
  UAE: 'AE',
  Australia: 'AU',
  Austria: 'AT',
  Azerbaijan: 'AZ',
  Bahrain: 'BH',
  Belgium: 'BE',
  Brazil: 'BR',
  Canada: 'CA',
  China: 'CN',
  France: 'FR',
  Germany: 'DE',
  'Great Britain': 'GB',
  'United Kingdom': 'GB',
  UK: 'GB',
  Hungary: 'HU',
  Italy: 'IT',
  Japan: 'JP',
  Malaysia: 'MY',
  Mexico: 'MX',
  Monaco: 'MC',
  Netherlands: 'NL',
  'The Netherlands': 'NL',
  Portugal: 'PT',
  Qatar: 'QA',
  Russia: 'RU',
  'Saudi Arabia': 'SA',
  Singapore: 'SG',
  Spain: 'ES',
  Turkey: 'TR',
  Türkiye: 'TR',
  'United States': 'US',
  'United States of America': 'US',
  USA: 'US',
}

/** Código ISO del país, o null si no se conoce (nunca se adivina: sin dato, sin bandera). */
export function isoForCountry(country: string | null | undefined): IsoCode | null {
  return (country && COUNTRY_ISO[country.trim()]) || null
}

const displayNames = new Map<string, Intl.DisplayNames | null>()

/** Nombre del país en el idioma de la interfaz (Intl), o el texto original si no hay código o Intl falla. */
export function countryLabel(country: string, locale: string): string {
  const iso = isoForCountry(country)
  if (!iso) return country
  if (!displayNames.has(locale)) {
    let names: Intl.DisplayNames | null
    try {
      names = new Intl.DisplayNames([locale], { type: 'region' })
    } catch {
      names = null
    }
    displayNames.set(locale, names)
  }
  return displayNames.get(locale)?.of(iso) ?? country
}
