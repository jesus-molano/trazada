/**
 * Comandos de momentos (ítem 14b, con los momentos del ítem 5, D35) sobre la carrera sintética de
 * `testing/commands.ts` (reproducción de 0 a 600 s, salida y reloj 0:00 a 60 s; ahora, 100 s) y unos adelantamientos
 * y duelos escritos a mano:
 *
 * - V2: VER (3) adelanta a NOR (1) hacia 170 s (GPS); la línea lo confirma a 245 s.
 * - V4: NOR (1) adelanta a PIA (81) sin cruce GPS (momento exacto: sin dato; la vuelta empieza a 335 s), confirmado a 425 s.
 * - V5: PIA (81) adelanta a VER (3) hacia 450 s, confirmado a 515 s.
 * - Duelo NOR tras VER desde la V2 (245 s), duelo desde la tercera vuelta (425 s); SAI tras PIA desde la V3 (300 s; 480 s).
 *
 * Cada salto llega 5 s antes (`JUMP_LEAD_MS`), como los botones del dock.
 */
import { describe, expect, it } from 'vitest'
import { recordingServices, type MomentsServiceOptions, paletteContext, type PaletteContextOptions } from '../../../testing/commands'
import type { Duel } from '../../moments/duels'
import { JUMP_LEAD_MS } from '../../moments/jumps'
import type { Overtake } from '../../moments/overtakes'
import { BUILTIN_COMMANDS, suggest } from '../registry'
import type { Suggestion } from '../types'

const overtake = (o: Pick<Overtake, 'passer' | 'passed' | 'lap' | 'atMs' | 'fromMs' | 'confirmedMs'>): Overtake => ({
  ...o,
  toMs: o.confirmedMs,
  gapBeforeMs: 400,
  gapAfterMs: 300,
})

const duel = (d: Pick<Duel, 'leader' | 'chaser' | 'firstLap' | 'startMs' | 'confirmedMs'>): Duel => ({
  ...d,
  lastLap: d.firstLap + 2,
  endMs: d.confirmedMs,
  minGapMs: 400,
  minGapLap: d.firstLap,
  open: false,
  endedInOvertake: false,
})

const OVERTAKES: Overtake[] = [
  overtake({ passer: '3', passed: '1', lap: 2, atMs: 170_000, fromMs: 155_000, confirmedMs: 245_000 }),
  overtake({ passer: '1', passed: '81', lap: 4, atMs: null, fromMs: 335_000, confirmedMs: 425_000 }),
  overtake({ passer: '81', passed: '3', lap: 5, atMs: 450_000, fromMs: 425_000, confirmedMs: 515_000 }),
]
const DUELS: Duel[] = [
  duel({ leader: '3', chaser: '1', firstLap: 2, startMs: 245_000, confirmedMs: 425_000 }),
  duel({ leader: '81', chaser: '55', firstLap: 3, startMs: 300_000, confirmedMs: 480_000 }),
]

interface RunOptions extends PaletteContextOptions {
  moments?: MomentsServiceOptions
  /** Sin el servicio de comparar (los duelos solo eligen al perseguidor). */
  noCompare?: boolean
}

function run(input: string, o: RunOptions = {}) {
  const rec = recordingServices({ moments: { overtakes: OVERTAKES, duels: { status: 'ok', duels: DUELS }, ...o.moments } })
  const { compare: _compare, ...withoutCompare } = rec.services
  const ctx = paletteContext({ ...o, services: o.noCompare ? withoutCompare : rec.services })
  return { list: suggest(BUILTIN_COMMANDS, input, ctx), calls: rec.calls }
}
const top = (input: string, o?: RunOptions): Suggestion => {
  const s = run(input, o).list[0]
  if (!s) throw new Error(`sin sugerencias para «${input}»`)
  return s
}
const keys = (input: string, o?: RunOptions) => run(input, o).list.map((s) => s.key)
/** Ejecuta la primera sugerencia y devuelve lo que pidió a los servicios. */
const runTop = (input: string, o?: RunOptions) => {
  const { list, calls } = run(input, o)
  list[0]!.run!()
  return calls
}

describe('tabla de entradas → sugerencia (es y en a la vez, sin tildes ni mayúsculas)', () => {
  const table: [string, string][] = [
    ['siguiente adelantamiento', 'moments.overtake.next'],
    ['próximo adelantamiento', 'moments.overtake.next'],
    ['next overtake', 'moments.overtake.next'],
    ['adelantamiento anterior', 'moments.overtake.prev'],
    ['previous overtake', 'moments.overtake.prev'],
    ['adelantamientos', 'moments.overtake.next'],
    ['adelantamientos de VER', 'moments.overtake.next.3'],
    ['adelantamientos de verstappen', 'moments.overtake.next.3'],
    ['overtakes VER', 'moments.overtake.next.3'],
    ['siguiente adelantamiento de NOR', 'moments.overtake.next.1'],
    ['adelantamientos entre NOR y PIA', 'moments.overtake.next.1.81'],
    ['siguiente duelo', 'moments.duel.next'],
    ['DUELO ANTERIOR', 'moments.duel.prev'],
    ['next battle', 'moments.duel.next'],
    ['duelo NOR', 'moments.duel.next.1'],
    ['battles of norris', 'moments.duel.next.1'],
    ['duelo entre VER y NOR', 'moments.duel.next.3.1'],
    ['lucha VER vs NOR', 'moments.duel.next.3.1'],
  ]
  it.each(table)('«%s» → %s', (input, key) => {
    expect(top(input).key).toBe(key)
  })

  it('sin dirección, las dos: siguiente y, un poco por debajo, anterior', () => {
    const list = keys('adelantamientos de VER')
    expect(list.slice(0, 2)).toEqual(['moments.overtake.next.3', 'moments.overtake.prev.3'])
  })

  it('un piloto ambiguo a medio escribir: un candidato por piloto («sa»: Sainz y Sargeant)', () => {
    const list = keys('duelo sa').filter((k) => k.startsWith('moments.duel.next.'))
    expect(list.sort()).toEqual(['moments.duel.next.2', 'moments.duel.next.55'])
  })

  it('Tab completa el piloto con su sigla', () => {
    expect(top('adelantamientos de verst').complete).toBe('adelantamientos de VER ')
  })
})

describe('adónde lleva: 5 s antes, como los botones del dock', () => {
  it('siguiente adelantamiento: 5 s antes de su instante GPS; elige al que adelanta', () => {
    const s = top('siguiente adelantamiento')
    expect(s.seekTo).toBe(170_000 - JUMP_LEAD_MS)
    expect(runTop('siguiente adelantamiento')).toEqual([`seek:${170_000 - JUMP_LEAD_MS}`, 'select:3'])
  })

  it('sin cruce GPS, al inicio de esa vuelta («momento exacto: sin dato»), sin «Estimado»', () => {
    const s = top('siguiente adelantamiento', { state: { timeMs: 300_000 } })
    expect(s.seekTo).toBe(335_000 - JUMP_LEAD_MS)
    expect(s.detail?.key).toBe('moments.cmd.overtake.hiddenNoTime')
    expect(s.detail?.params).toEqual({ lap: 4, clock: '4:35' })
    expect(s.estimated).toBeUndefined()
  })

  it('pulsar dos veces avanza; «anterior» deja el margen del botón (no vuelve al mismo justo después de saltar)', () => {
    expect(top('siguiente adelantamiento', { state: { timeMs: 165_000 } }).seekTo).toBe(335_000 - JUMP_LEAD_MS)
    expect(top('adelantamiento anterior', { state: { timeMs: 166_000 } }).disabled?.key).toBe('palette.cmd.jump.noneBefore')
    expect(top('adelantamiento anterior', { state: { timeMs: 300_000 } }).seekTo).toBe(170_000 - JUMP_LEAD_MS)
  })

  it('ninguno más hacia ese lado: deshabilitado con el reloj', () => {
    const s = top('adelantamiento anterior')
    expect(s.run).toBeUndefined()
    expect(s.disabled).toEqual({ key: 'palette.cmd.jump.noneBefore', params: { clock: '0:40' } })
    expect(top('siguiente adelantamiento', { state: { timeMs: 500_000 } }).disabled?.key).toBe('palette.cmd.jump.noneAfter')
  })

  it('con un piloto escrito, se elige a ese piloto (aunque sea el adelantado)', () => {
    expect(runTop('adelantamientos de NOR')).toEqual([`seek:${170_000 - JUMP_LEAD_MS}`, 'select:1'])
    expect(top('adelantamientos de NOR').car).toBe('1')
    expect(top('adelantamientos de NOR').title).toEqual({ key: 'moments.cmd.overtake.nextCar', params: { driver: 'NOR' } })
  })

  it('entre dos pilotos, solo los suyos (cualquiera de los dos adelantando)', () => {
    expect(top('adelantamientos entre NOR y PIA').seekTo).toBe(335_000 - JUMP_LEAD_MS)
    expect(top('adelantamientos entre PIA y VER').seekTo).toBe(450_000 - JUMP_LEAD_MS)
    expect(top('adelantamientos entre NOR y PIA').title).toEqual({
      key: 'moments.cmd.overtake.nextPair',
      params: { a: 'NOR', b: 'PIA' },
    })
  })

  it('duelo: al inicio, eligiendo al perseguidor comparado con el de delante; con un piloto escrito, a ese', () => {
    expect(top('siguiente duelo').seekTo).toBe(245_000 - JUMP_LEAD_MS)
    expect(runTop('siguiente duelo')).toEqual([`seek:${245_000 - JUMP_LEAD_MS}`, 'compare:1:3'])
    expect(runTop('duelo VER')).toEqual([`seek:${245_000 - JUMP_LEAD_MS}`, 'compare:3:1'])
    expect(runTop('duelo SAI')).toEqual([`seek:${300_000 - JUMP_LEAD_MS}`, 'compare:55:81'])
  })

  it('duelo sin el servicio de comparar: solo elige', () => {
    expect(runTop('siguiente duelo', { noCompare: true })).toEqual([`seek:${245_000 - JUMP_LEAD_MS}`, 'select:1'])
    const s = top('duelo anterior', { noCompare: true, state: { timeMs: 500_000 } })
    expect(s.detail?.key).toBe('moments.cmd.duel.detailNoCompare')
  })

  it('lo que cae fuera de la reproducción no es un destino', () => {
    const s = top('siguiente adelantamiento', { startMs: 200_000, state: { timeMs: 200_000 } })
    expect(s.seekTo).toBe(335_000 - JUMP_LEAD_MS)
    expect(top('adelantamientos de VER', { startMs: 200_000, endMs: 440_000, state: { timeMs: 200_000 } }).disabled?.key).toBe(
      'moments.cmd.overtake.noneCar',
    )
  })
})

describe('honestidad', () => {
  it('el instante GPS lleva «Estimado» (overtakeTime) y «≈»', () => {
    const s = top('siguiente adelantamiento', { moments: { noSpoilers: false } })
    expect(s.estimated).toBe('overtakeTime')
    expect(s.detail).toEqual({
      key: 'moments.cmd.overtake.detail',
      params: { lap: 2, clock: '1:50', passer: 'VER', passed: 'NOR', select: 'VER' },
    })
  })

  it('«Sin spoilers»: lo que la línea aún no confirma no dice quién adelanta a quién ni lleva su color', () => {
    const s = top('siguiente adelantamiento')
    expect(s.detail).toEqual({ key: 'moments.cmd.overtake.hidden', params: { lap: 2, clock: '1:50' } })
    expect(s.car).toBeUndefined()
    // Sigue siendo un destino (como el botón del dock) y su instante GPS sigue siendo una estimación.
    expect(s.run).toBeDefined()
    expect(s.estimated).toBe('overtakeTime')
    const d = top('siguiente duelo')
    expect(d.detail).toEqual({ key: 'moments.cmd.duel.hidden', params: { lap: 2, clock: '3:05' } })
    expect(d.car).toBeUndefined()
    // Con el piloto escrito, su color no destapa nada.
    expect(top('siguiente duelo de SAI').car).toBe('55')
  })

  it('ya confirmado en la línea (o sin «Sin spoilers»), con nombres', () => {
    const prev = top('adelantamiento anterior', { state: { timeMs: 300_000 } })
    expect(prev.detail?.key).toBe('moments.cmd.overtake.detail')
    expect(prev.car).toBe('3')
    const d = top('duelo anterior', { state: { timeMs: 500_000 } })
    expect(d.detail).toEqual({
      key: 'moments.cmd.duel.detail',
      params: { lap: 3, clock: '4:00', chaser: 'SAI', leader: 'PIA', select: 'SAI', rival: 'PIA' },
    })
    expect(top('siguiente duelo', { moments: { noSpoilers: false } }).detail?.key).toBe('moments.cmd.duel.detail')
  })

  it('en libres y clasificación: deshabilitado, solo en carrera y sprint (una sola sugerencia)', () => {
    const list = run('adelantamientos', { type: 'fp1' }).list.filter((s) => s.key.startsWith('moments.'))
    expect(list).toHaveLength(1)
    expect(list[0]!.disabled?.key).toBe('moments.cmd.onlyRace')
    expect(top('duelo NOR', { type: 'q' }).disabled?.key).toBe('moments.cmd.onlyRace')
  })

  it('ninguno en la sesión: «sin dato» (con el piloto o la pareja)', () => {
    expect(top('siguiente adelantamiento', { moments: { overtakes: [] } }).disabled?.key).toBe('moments.cmd.overtake.none')
    expect(top('adelantamientos de SAR').disabled).toEqual({ key: 'moments.cmd.overtake.noneCar', params: { driver: 'SAR' } })
    expect(top('adelantamientos entre VER y SAI').disabled).toEqual({
      key: 'moments.cmd.overtake.nonePair',
      params: { a: 'VER', b: 'SAI' },
    })
    expect(top('duelo PER').disabled?.key).toBe('moments.cmd.duel.noneCar')
  })

  it('sin estado de pista por vuelta no se buscan duelos, y se dice', () => {
    const s = top('siguiente duelo', { moments: { duels: { status: 'noTrackStatus', duels: [] } } })
    expect(s.disabled?.key).toBe('moments.cmd.duel.noTrackStatus')
  })

  it('sin el servicio de momentos (sin los botones del dock), no se ofrecen', () => {
    const rec = recordingServices()
    const { moments: _moments, ...rest } = rec.services
    const list = suggest(BUILTIN_COMMANDS, 'siguiente adelantamiento', paletteContext({ services: rest }))
    expect(list.some((s) => s.key.startsWith('moments.'))).toBe(false)
  })

  it('nada es irreversible: mover el reloj, elegir o comparar', () => {
    const allowed = /^(seek|select|compare):/
    for (const input of ['siguiente adelantamiento', 'adelantamientos de NOR', 'siguiente duelo', 'duelo VER', 'duelo anterior']) {
      const { list, calls } = run(input, { state: { timeMs: 300_000 } })
      for (const s of list) s.run?.()
      for (const c of calls) expect(c, input).toMatch(allowed)
    }
  })
})

describe('no se cruzan con los otros comandos', () => {
  it('«seguir ver», «parada de nor», «siguiente sc», «siguiente momento» y «vuelta 3» siguen igual', () => {
    expect(keys('seguir ver').some((k) => k.startsWith('moments.'))).toBe(false)
    expect(top('seguir ver').key).toBe('drivers.follow.3')
    expect(top('parada de nor').key).toBe('goto.pit.next.1')
    expect(top('siguiente sc').key).toBe('goto.sc.next')
    expect(top('vuelta 3').key).toBe('goto.lap.3')
    expect(top('siguiente momento', { moments: { list: [{ t: 300_000 }] } }).key).toBe('goto.moment.next')
  })

  it('«duelo VER vs NOR» no es «comparar»: el duelo va primero', () => {
    expect(top('duelo VER vs NOR').key).toBe('moments.duel.next.3.1')
  })
})
