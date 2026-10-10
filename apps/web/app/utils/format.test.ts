import { describe, expect, it } from 'vitest'
import { formatBytes, formatDate, formatDateTime, formatSeconds } from './format'

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

  it('formatDateTime: día, mes y hora', () => {
    const ms = Date.UTC(2026, 6, 17, 10, 30)
    expect(formatDateTime(ms, 'en', 'UTC')).toBe('Jul 17, 10:30 AM')
    expect(formatDateTime(ms, 'es', 'UTC')).toMatch(/17 jul.*10:30/)
  })
})
