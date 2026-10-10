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

/** 91234 → "1:31.234" (tiempos de vuelta). */
export function formatLapTime(ms: number): string {
  if (!(ms >= 0)) return '—'
  const m = Math.floor(ms / 60000)
  const s = (ms % 60000) / 1000
  return m > 0 ? `${m}:${s.toFixed(3).padStart(6, '0')}` : s.toFixed(3)
}
