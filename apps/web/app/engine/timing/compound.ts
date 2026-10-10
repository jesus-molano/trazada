/**
 * Color y letra de cada compuesto de neumático. En 2018 los compuestos tenían nombre propio y color fijo
 * (hiperblando rosa, ultrablando morado, superblando rojo, blando amarillo, medio blanco, duro azul hielo);
 * desde 2019, blando/medio/duro son relativos a cada Gran Premio (rojo, amarillo, blanco). Sin dato
 * (UNKNOWN, TEST_UNKNOWN o un valor desconocido), el gris de «sin dato».
 */
export type CompoundToken = `--tz-tyre-${string}`

const TOKEN: Record<string, string> = {
  SOFT: 'soft',
  MEDIUM: 'medium',
  HARD: 'hard',
  INTERMEDIATE: 'inter',
  WET: 'wet',
  HYPERSOFT: 'hypersoft',
  ULTRASOFT: 'ultrasoft',
  SUPERSOFT: 'supersoft',
}
const TOKEN_2018: Record<string, string> = { SOFT: 'soft-2018', MEDIUM: 'medium-2018', HARD: 'hard-2018' }

export function compoundToken(season: number, compound: string): CompoundToken {
  const own = (season <= 2018 && Object.hasOwn(TOKEN_2018, compound) ? TOKEN_2018[compound] : undefined) ?? (Object.hasOwn(TOKEN, compound) ? TOKEN[compound] : undefined)
  return `--tz-tyre-${own ?? 'unknown'}`
}

const LETTER: Record<string, string> = {
  SOFT: 'S',
  MEDIUM: 'M',
  HARD: 'H',
  INTERMEDIATE: 'I',
  WET: 'W',
  HYPERSOFT: 'HS',
  ULTRASOFT: 'US',
  SUPERSOFT: 'SS',
}

/** Letra del compuesto en la clasificación ('?' sin dato). */
export function compoundLetter(compound: string): string {
  return Object.hasOwn(LETTER, compound) ? LETTER[compound]! : '?'
}
