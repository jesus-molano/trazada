import { formatClock } from '~/engine/format/time'

/**
 * Dónde se dejó una sesión (ítem 13), como lo enseña el dock: «Vuelta 23/53 · 1:02:13» en carrera y sprint, y solo
 * el reloj visible en el resto (o antes de la salida). Lo usan el aviso del replay y la tarjeta de la portada.
 */
export function useResumeLabel(): (at: { lap: number | null; totalLaps: number | null; clockMs: number }) => string {
  const { t } = useI18n()
  return ({ lap, totalLaps, clockMs }) => {
    const clock = formatClock(clockMs)
    if (lap === null) return clock
    return totalLaps ? t('resume.at.lap', { lap, total: totalLaps, clock }) : t('resume.at.lapNoTotal', { lap, clock })
  }
}
