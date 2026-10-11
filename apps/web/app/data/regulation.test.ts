import { describe, expect, it } from 'vitest'
import { DRS_LAST_SEASON } from '../engine/drs/zones'
import { hasRegulation2026Notice, REGULATION_2026_FIRST_SEASON } from './regulation'

describe('aviso del reglamento de 2026', () => {
  it('empieza justo después de la última temporada con DRS', () => {
    expect(REGULATION_2026_FIRST_SEASON).toBe(DRS_LAST_SEASON + 1)
  })

  it('solo desde 2026 (y nunca sin temporada conocida)', () => {
    expect(hasRegulation2026Notice(2026)).toBe(true)
    expect(hasRegulation2026Notice(2027)).toBe(true)
    for (const season of [2025, 2018, undefined, null, Number.NaN]) expect(hasRegulation2026Notice(season)).toBe(false)
  })
})
