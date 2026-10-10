/**
 * Registro de todo lo que se puede pintar como estimación (principio de datos honestos). Cada campo
 * tiene su etiqueta "Estimado: …" (`estimated.fields.<campo>`) y su explicación (`estimated.hints.<campo>`).
 * Un test de componentes recorre esta lista: un campo nuevo sin su caso hace fallar el test.
 */
export const ESTIMATED_FIELDS = ['elevation', 'separation', 'lap1', 'positions', 'telemetry', 'trackStatus'] as const
export type EstimatedField = (typeof ESTIMATED_FIELDS)[number]

/** Los que activa el usuario desde las opciones. */
export const USER_FIELDS: readonly EstimatedField[] = ['elevation', 'separation', 'lap1']
/** Los que declara el manifest (`quality.estimated`) y dónde se pintan. */
export const MANIFEST_FIELDS: readonly EstimatedField[] = ['positions', 'telemetry', 'trackStatus']

export function isEstimatedField(x: string): x is EstimatedField {
  return (ESTIMATED_FIELDS as readonly string[]).includes(x)
}

/**
 * Campos del manifest que se muestran en la escena: `positions` y cualquiera desconocido (versión de
 * datos más nueva), para que nada estimado quede sin etiqueta. `telemetry` y `trackStatus` van en su panel.
 */
export function sceneManifestFields(estimated: readonly string[]): string[] {
  return estimated.filter((f) => f === 'positions' || !isEstimatedField(f))
}
