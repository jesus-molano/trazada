import { describe, expect, it } from 'vitest'
import { formatBytes, formatDate, formatSeconds } from './format'

describe('formato', () => {
  it('bytes', () => {
    expect(formatBytes(512, 'es')).toBe('512 B')
    expect(formatBytes(270_405, 'es')).toBe('270 KB')
    expect(formatBytes(1_840_000, 'es')).toBe('1,8 MB')
    expect(formatBytes(1_840_000, 'en')).toBe('1.8 MB')
  })

  it('fechas y segundos', () => {
    expect(formatDate('2026-07-17', 'en')).toBe('Jul 17')
    expect(formatDate('no-es-fecha', 'es')).toBe('no-es-fecha')
    expect(formatSeconds(487, 'es')).toBe('0,5')
  })
})
