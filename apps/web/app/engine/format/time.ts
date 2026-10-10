/** Formatos de tiempo del replay (sin dependencia del idioma: dígitos y separadores fijos). */

/** 3723000 → "1:02:03"; 83000 → "1:23"; negativos con signo. */
export function formatClock(ms: number): string {
  const sign = ms < 0 ? '−' : ''
  const total = Math.floor(Math.abs(ms) / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${sign}${h}:${String(m).padStart(2, '0')}:${ss}` : `${sign}${m}:${ss}`
}

const lapFormats = new Map<string, [Intl.NumberFormat, Intl.NumberFormat]>()

/** 91234 → "1:31.234" en inglés y "1:31,234" en español (tiempos de vuelta, con el decimal del idioma). */
export function formatLapTime(ms: number, locale = 'en'): string {
  if (!(ms >= 0)) return '—'
  let fmts = lapFormats.get(locale)
  if (!fmts) {
    const base = { minimumFractionDigits: 3, maximumFractionDigits: 3, useGrouping: false } as const
    fmts = [new Intl.NumberFormat(locale, base), new Intl.NumberFormat(locale, { ...base, minimumIntegerDigits: 2 })]
    lapFormats.set(locale, fmts)
  }
  const m = Math.floor(ms / 60000)
  const s = (ms % 60000) / 1000
  return m > 0 ? `${m}:${fmts[1].format(s)}` : fmts[0].format(s)
}
