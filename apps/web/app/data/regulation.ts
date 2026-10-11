/**
 * Reglamento de 2026: ya no hay DRS, y lo nuevo (aerodinámica activa, modo adelantamiento por coche, Boost y energía de
 * la batería) no llega en el cronometraje público, por coche. Dirección de carrera solo publica avisos para toda la pista:
 * OVERTAKE ENABLED/DISABLED y el estado del modo recta (STRAIGHT MODE …) (docs/BRIEF.md, «Realidad de los datos»;
 * `trazada probe-feed` lo comprueba en una sesión concreta).
 *
 * La app lo dice con un aviso informativo propio (`regulation.*`) en los avisos de la sesión y en el «¿Por qué?» del DRS
 * de la telemetría. No es un aviso del manifest: sale de la temporada (`manifest.session.season`), sin tocar el esquema.
 */

/** Primera temporada del reglamento de 2026 (la siguiente a la última con DRS, `DRS_LAST_SEASON`). */
export const REGULATION_2026_FIRST_SEASON = 2026

/** ¿Lleva esta temporada el aviso del reglamento de 2026? Sin temporada conocida, no. */
export function hasRegulation2026Notice(season: number | null | undefined): boolean {
  return typeof season === 'number' && Number.isFinite(season) && season >= REGULATION_2026_FIRST_SEASON
}
