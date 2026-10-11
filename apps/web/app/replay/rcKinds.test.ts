import { describe, expect, it } from 'vitest'
import { rcTone } from './rcKinds'

describe('tono de los mensajes de dirección de carrera', () => {
  it('los mismos grupos que tenía el panel de dirección de carrera', () => {
    // Los conjuntos que TzRaceControl tenía dentro antes de D49, tal cual.
    const flag = ['sector_yellow', 'sector_double_yellow', 'sector_clear', 'blue_flag', 'chequered_flag', 'green_light', 'track_clear']
    const neutral = ['sc_deployed', 'sc_ending', 'sc_in_this_lap', 'vsc_deployed', 'vsc_ending', 'red_flag']
    const stewards = [
      'incident',
      'penalty',
      'penalty_served',
      'lap_deleted',
      'lap_reinstated',
      'track_limits',
      'black_and_white_flag',
      'black_and_orange_flag',
      'black_flag',
    ]
    const former = (kind: string) => {
      if (neutral.includes(kind)) return 'is-neutral'
      if (kind === 'sector_yellow' || kind === 'sector_double_yellow') return 'is-yellow'
      if (flag.includes(kind)) return 'is-flag'
      if (stewards.includes(kind)) return 'is-stewards'
      return ''
    }
    for (const kind of [...flag, ...neutral, ...stewards, 'info', 'car_stopped', 'spun', 'other', 'drs_enabled', '']) {
      expect(rcTone(kind), kind).toBe(former(kind))
    }
    expect(rcTone('sector_double_yellow')).toBe('is-yellow')
    expect(rcTone('incident')).toBe('is-stewards')
    expect(rcTone('sc_deployed')).toBe('is-neutral')
    expect(rcTone('green_light')).toBe('is-flag')
    expect(rcTone('car_stopped')).toBe('')
  })
})
