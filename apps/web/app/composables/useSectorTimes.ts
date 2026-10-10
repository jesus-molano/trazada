/**
 * Colores de sector de la sesión (ítem 4, D34): un precálculo por runtime (`rt.ext`, perezoso y memoizado), sobre el
 * índice de vueltas que ya construyó la clasificación (`rt.leaderboard.lapTable`). Lo comparten las celdas de la
 * clasificación (hueco `leaderboard-cells`) y el panel del coche seleccionado (TzLapInfo). Se mide con
 * `performance.measure('tz:sectors')`.
 */
import { formatLapTime } from '~/engine/format/time'
import { type LapSectors, type SectorCell, type SectorStatus, SectorTimes } from '~/engine/timing/sectors'
import type { ReplayRuntime } from '~/replay/runtime'
import { getRuntime } from '~/stores/playback'

export const SECTORS_EXT = 'sectors'

export function runtimeSectors(rt: ReplayRuntime): SectorTimes {
  return rt.ext(SECTORS_EXT, (r) => {
    const start = performance.now()
    const sectors = new SectorTimes(r.leaderboard.lapTable)
    performance.measure('tz:sectors', { start, end: performance.now() })
    return sectors
  })
}

/** Colores de sector del runtime activo (el replay solo monta sus paneles con el runtime enganchado). */
export function useSectorTimes(): SectorTimes {
  return runtimeSectors(getRuntime()!)
}

/** Lo que se pinta de un sector: su color, «sin dato» o, si su vuelta ya está anulada, anulado (sin color de mejora). */
export type SectorMark = SectorStatus | 'deleted'

export function sectorMark(cell: SectorCell, lapDeleted: boolean): SectorMark {
  if (cell.ms === null) return 'none'
  return lapDeleted ? 'deleted' : cell.status
}

/** Textos de los sectores (el color nunca va solo: título y texto para lectores de pantalla). */
export function useSectorText() {
  const { t, locale } = useI18n()

  function status(s: SectorStatus): string {
    switch (s) {
      case 'best':
        return t('sectors.status.best')
      case 'personal':
        return t('sectors.status.personal')
      case 'normal':
        return t('sectors.status.normal')
      default:
        return t('sectors.status.none')
    }
  }

  /** «31,488» (o «1:02,345»); sin dato, «—». */
  const time = (ms: number | null) => (ms === null ? '—' : formatLapTime(ms, locale.value))

  /** «S1 31,488 (mejor personal)»; de una vuelta anulada, sin estado; sin tiempo, «S1: sin dato». `i` = 0, 1 o 2. */
  function cell(i: number, c: SectorCell, lapDeleted: boolean): string {
    const n = i + 1
    if (c.ms === null) return t('sectors.cellNoData', { n })
    if (lapDeleted) return t('sectors.cellDeleted', { n, time: time(c.ms) })
    return t('sectors.cell', { n, time: time(c.ms), status: status(c.status) })
  }

  /** Los tres sectores de la vuelta en una frase; sin vuelta completada, «sin dato». */
  function lap(x: LapSectors | null): string {
    if (!x) return t('sectors.noLap')
    const list = x.sectors.map((c, i) => cell(i, c, x.deleted)).join(', ')
    return x.deleted ? t('sectors.lapDeleted', { lap: x.lap, list }) : t('sectors.lap', { lap: x.lap, list })
  }

  return { status, time, cell, lap, basis: () => t('sectors.basis') }
}
