import { describe, expect, it } from 'vitest'
import { rcGlyph, rcTint, rcTone } from './rcKinds'

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

describe('columna de estado: glifo y tinte (D50)', () => {
  it('banderas con mástil, rótulos SC/VSC/PIT, comisarios, adelantamiento y un punto para lo demás', () => {
    const cases: [string, string][] = [
      ['sector_clear', 'flag-green'],
      ['green_light', 'flag-green'],
      ['sector_yellow', 'flag-yellow'],
      ['sector_double_yellow', 'flag-double-yellow'],
      ['blue_flag', 'flag-blue'],
      ['red_flag', 'flag-red'],
      ['chequered_flag', 'flag-chequered'],
      ['sc_deployed', 'sc'],
      ['sc_procedure', 'sc'],
      ['vsc_ending', 'vsc'],
      ['pit_exit_open', 'pit'],
      ['lap_deleted', 'stewards'],
      ['black_flag', 'stewards'],
      ['overtake_enabled', 'overtake'],
      ['drs_disabled', 'overtake'],
      ['info', 'dot'],
      ['no_such_kind', 'dot'],
    ]
    for (const [kind, glyph] of cases) expect(rcGlyph(kind), kind).toBe(glyph)
  })

  it('solo las neutralizaciones y la roja tiñen la fila entera', () => {
    expect(rcTint('sc_deployed')).toBe('is-neutral')
    expect(rcTint('vsc_deployed')).toBe('is-neutral')
    expect(rcTint('red_flag')).toBe('is-red')
    for (const kind of ['sector_yellow', 'lap_deleted', 'info', 'pit_exit_open']) expect(rcTint(kind), kind).toBe('')
  })
})
