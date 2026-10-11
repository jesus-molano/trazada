/**
 * Selector de piloto de la hoja de análisis (D49): la lista de «Elegido ALO ▾» y su búsqueda por teclado. TS puro (sin
 * Vue), con tests al lado.
 */
import type { DriverInfo } from '@trazada/schema'
import type { DriverStyle } from './chart'

/** Lo que el selector necesita de una fila de la clasificación del instante (`LeaderboardRow`). */
export interface PickerRow {
  car: string
  position: number
  positionKnown: boolean
}

export interface PickerOption {
  car: string
  /** Sigla (o el número si no hay piloto en el manifest). */
  tla: string
  /** Nombre completo del manifest; vacío si no hay. */
  name: string
  /** Color de equipo, o null (el de «equipo desconocido»). */
  color: string | null
  /** Segundo piloto de su equipo: muestra discontinua, como en las gráficas. */
  dash: boolean
  /** Puesto en la clasificación del instante; null, sin dato (nunca uno inventado). */
  position: number | null
}

/**
 * Pilotos de la sesión para el selector, en el orden de la clasificación del instante (la de la torre de la izquierda)
 * y, después, los del manifest que no estén en ella. El puesto solo si la clasificación lo conoce.
 */
export function pickerOptions(
  rows: readonly PickerRow[],
  drivers: readonly DriverInfo[],
  styles: ReadonlyMap<string, DriverStyle>,
): PickerOption[] {
  const byCar = new Map(drivers.map((d) => [d.number, d]))
  const option = (car: string, row: PickerRow | null): PickerOption => {
    const d = byCar.get(car)
    const style = styles.get(car)
    return {
      car,
      tla: style?.label ?? d?.tla ?? car,
      name: d ? `${d.first} ${d.last}`.trim() : '',
      color: style?.color ?? null,
      dash: style?.dash ?? false,
      position: row?.positionKnown ? row.position : null,
    }
  }
  const seen = new Set<string>()
  const out: PickerOption[] = []
  for (const r of rows) {
    if (seen.has(r.car) || !byCar.has(r.car)) continue
    seen.add(r.car)
    out.push(option(r.car, r))
  }
  for (const d of drivers) if (!seen.has(d.number)) out.push(option(d.number, null))
  return out
}

/**
 * Búsqueda al teclear en la lista (patrón de listbox de WAI-ARIA): la siguiente opción, después de `from` y dando la
 * vuelta, cuyo texto empieza por lo tecleado (sin mayúsculas ni acentos). Si lo tecleado es una misma letra repetida,
 * recorre las que empiezan por ella. −1 si ninguna.
 */
export function typeahead(labels: readonly string[], from: number, typed: string): number {
  const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  const q = norm(typed)
  if (!q || labels.length === 0) return -1
  const same = [...q].every((c) => c === q[0])
  const query = same ? q[0]! : q
  // Con una sola letra (o la misma repetida) se empieza por la siguiente; con más, por la actual (sigue escribiendo).
  const start = same ? from + 1 : Math.max(0, from)
  for (let k = 0; k < labels.length; k++) {
    const i = (((start + k) % labels.length) + labels.length) % labels.length
    if (norm(labels[i]!).startsWith(query)) return i
  }
  return -1
}
