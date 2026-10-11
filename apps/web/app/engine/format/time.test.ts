import { describe, expect, it } from 'vitest'
import { formatClock, formatLapTime } from './time'

describe('formato de tiempo', () => {
  it('reloj', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(83_999)).toBe('1:23')
    expect(formatClock(3_723_000)).toBe('1:02:03')
    expect(formatClock(-5_000)).toBe('−0:05')
    expect(formatClock(-5_999)).toBe('−0:05')
    // Menos de un segundo antes del cero: sin signo (nunca «−0:00»).
    expect(formatClock(-500)).toBe('0:00')
    expect(formatClock(-1)).toBe('0:00')
    expect(formatClock(-1_000)).toBe('−0:01')
  })
  it('tiempo de vuelta', () => {
    expect(formatLapTime(91_234)).toBe('1:31.234')
    expect(formatLapTime(59_001)).toBe('59.001')
    expect(formatLapTime(-1)).toBe('—')
    expect(formatLapTime(91_234, 'es')).toBe('1:31,234')
    expect(formatLapTime(61_005, 'es')).toBe('1:01,005')
  })
})
