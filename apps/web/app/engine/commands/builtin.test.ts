/**
 * Los comandos de serie (`builtin/*.ts`) con la carrera y los libres sintéticos de `testing/commands.ts`: de lo escrito
 * (español e inglés, sin tildes ni mayúsculas) a la sugerencia, lo que hará y lo deshabilitado con su motivo.
 */
import { describe, expect, it } from 'vitest'
import { type PaletteContextOptions, paletteContext, recordingServices, withoutMoments } from '../../testing/commands'
import { loadFixture } from '../../testing/fixture'
import { buildLapTable } from '../analysis/lapTable'
import { buildTimelineMarkers } from '../timeline/markers'
import { commandSessionInfo } from './context'
import { BUILTIN_COMMANDS, suggest } from './registry'
import type { CommandContext, Suggestion } from './types'

/** Carrera: salida a 60 s (reloj 0:00); ahora, a 100 s (reloj 0:40), en pausa a ×1, sin selección. */
function run(input: string, o: PaletteContextOptions = {}) {
  const rec = recordingServices()
  const ctx = paletteContext({ services: withoutMoments(rec.services), ...o })
  return { list: suggest(BUILTIN_COMMANDS, input, ctx), calls: rec.calls }
}
const top = (input: string, o?: PaletteContextOptions): Suggestion => {
  const s = run(input, o).list[0]
  if (!s) throw new Error(`sin sugerencias para «${input}»`)
  return s
}
const keys = (input: string, o?: PaletteContextOptions) => run(input, o).list.map((s) => s.key)

describe('tabla de entradas → sugerencia (es y en a la vez)', () => {
  const table: [string, string][] = [
    ['seguir ver', 'drivers.follow.3'],
    ['sigue a verstappen', 'drivers.follow.3'],
    ['Sigue a Pérez', 'drivers.follow.11'],
    ['SIGUE A PEREZ', 'drivers.follow.11'],
    ['follow 1', 'drivers.follow.1'],
    ['ver', 'drivers.select.3'],
    ['carlos sainz', 'drivers.select.55'],
    ['seleccionar hulkenberg', 'drivers.select.27'],
    ['vista general', 'drivers.overview'],
    ['overview', 'drivers.overview'],
    ['v3', 'goto.lap.3'],
    ['vuelta 3', 'goto.lap.3'],
    ['lap 3', 'goto.lap.3'],
    ['go to lap 3', 'goto.lap.3'],
    ['2:30', 'goto.time.150000'],
    ['minuto 2', 'goto.time.120000'],
    ['x4', 'playback.rate.4'],
    ['4x', 'playback.rate.4'],
    ['×4', 'playback.rate.4'],
    ['velocidad 8', 'playback.rate.8'],
    ['speed 16', 'playback.rate.16'],
    ['reproducir', 'playback.play'],
    ['play', 'playback.play'],
    ['+30', 'goto.relative.30000'],
    ['-10s', 'goto.relative.-10000'],
    ['adelante 2 min', 'goto.relative.120000'],
    ['siguiente sc', 'goto.sc.next'],
    ['next safety car', 'goto.sc.next'],
    ['próximo coche de seguridad', 'goto.sc.next'],
    ['parada de nor', 'goto.pit.next.1'],
    ['pit NOR', 'goto.pit.next.1'],
    ['siguiente amarilla', 'goto.yellow.next'],
    ['bandera a cuadros', 'goto.chequered.next'],
    ['siguiente vuelta', 'goto.lap.next'],
    ['comparar nor y pia', 'compare.1.81'],
    ['NOR vs PIA', 'compare.1.81'],
    ['compare NOR and PIA', 'compare.1.81'],
    ['desde el principio', 'resume.restart'],
    ['from the start', 'resume.restart'],
  ]
  it.each(table)('«%s» → %s', (input, key) => {
    expect(top(input).key).toBe(key)
  })
})

describe('lo que hará antes de Enter', () => {
  it('seguir: selecciona y sigue al coche', () => {
    const { list, calls } = run('seguir ver')
    expect(list[0]!.detail?.key).toBe('palette.cmd.follow.detail')
    expect(list[0]!.detail?.params).toEqual({ driver: 'VER', name: 'Max Verstappen' })
    list[0]!.run!()
    expect(calls).toEqual(['select:3', 'follow:true'])
  })

  it('una hora es la del reloj visible (desde la salida en carrera)', () => {
    const s = top('0:40')
    expect(s.seekTo).toBe(60_000 + 40_000)
    expect(s.detail?.params).toEqual({ clock: '0:40' })
  })

  it('la parada de un coche: va a su entrada al pit lane y lo selecciona', () => {
    const { list, calls } = run('parada de nor')
    expect(list[0]!.seekTo).toBe(330_000)
    list[0]!.run!()
    expect(calls).toEqual(['seek:330000', 'select:1'])
  })

  it('velocidad', () => {
    const { list, calls } = run('x4')
    list[0]!.run!()
    expect(calls).toEqual(['rate:4'])
  })

  it('comparar: selecciona a A y abre la comparación con B', () => {
    const { list, calls } = run('comparar nor y pia')
    list[0]!.run!()
    expect(calls).toEqual(['compare:1:81'])
  })

  it('«comparar con PIA» usa el seleccionado como A', () => {
    const s = top('comparar con pia', { state: { selectedCar: '3' } })
    expect(s.key).toBe('compare.3.81')
    expect(s.run).toBeDefined()
  })

  it('volver a donde lo dejaste: al instante retomado al abrir', () => {
    const rec = recordingServices({ resumedMs: 300_000 })
    const [s] = suggest(BUILTIN_COMMANDS, 'volver a donde lo dejé', paletteContext({ services: withoutMoments(rec.services) }))
    expect(s!.key).toBe('resume.back')
    expect(s!.seekTo).toBe(300_000)
  })

  it('desde el principio: al instante por defecto (en carrera, poco antes de la salida)', () => {
    const s = top('desde el principio')
    expect(s.seekTo).toBe(55_000)
    expect(s.detail?.key).toBe('palette.cmd.resume.restartRace')
  })
})

describe('ambigüedad, dorsales y vueltas', () => {
  it('«sa» a medio escribir: dos candidatos (Sainz y Sargeant)', () => {
    const follow = keys('seguir sa').filter((k) => k.startsWith('drivers.follow.'))
    expect(follow.sort()).toEqual(['drivers.follow.2', 'drivers.follow.55'])
  })

  it('un número a secas es antes un dorsal que una vuelta; «v30» solo es una vuelta', () => {
    const list = keys('30')
    expect(list[0]).toBe('drivers.select.30')
    expect(list).toContain('goto.lap.30')
    expect(list.indexOf('goto.lap.30')).toBeGreaterThan(list.indexOf('drivers.follow.30'))
    expect(keys('v30')).toEqual(['goto.lap.30'])
  })

  it('vuelta fuera de rango: deshabilitada con el motivo (sin dato)', () => {
    const s = top('vuelta 70')
    expect(s.run).toBeUndefined()
    expect(s.disabled).toEqual({ key: 'palette.cmd.lap.beyondTotal', params: { total: 5 } })
    expect(top('vuelta 0').disabled?.key).toBe('palette.cmd.lap.fromOne')
    expect(top('vuelta 6', { totalLaps: null }).disabled).toEqual({ key: 'palette.cmd.lap.noDataMax', params: { max: 5 } })
  })

  it('vuelta del líder: cuando el primero la empieza', () => {
    expect(top('vuelta 2').seekTo).toBe(60_000 + 95_000)
  })

  it('vuelta N de un piloto, también en carrera', () => {
    const s = top('vuelta 2 de VER')
    expect(s.key).toBe('goto.lap.2.3')
    expect(s.seekTo).toBe(60_000 + 96_000)
  })

  it('hora fuera de la sesión: deshabilitada con el intervalo que sí hay', () => {
    const s = top('1:02:30')
    expect(s.run).toBeUndefined()
    expect(s.disabled).toEqual({ key: 'palette.cmd.time.outside', params: { from: '−1:00', to: '9:00' } })
  })

  it('velocidad que no existe', () => {
    expect(top('x3').disabled?.key).toBe('palette.cmd.rate.invalid')
  })

  it('un piloto que no está: deshabilitado, sin elegir a otro', () => {
    const s = top('seguir xyz')
    expect(s.key).toBe('drivers.follow.unknown')
    expect(s.disabled).toEqual({ key: 'palette.cmd.driverUnknown', params: { q: 'xyz' } })
  })

  it('dos veces el mismo piloto no se compara', () => {
    expect(top('comparar nor nor').disabled?.key).toBe('palette.cmd.compare.same')
  })

  it('«comparar con PIA» sin nadie seleccionado: pide A', () => {
    expect(top('comparar con pia').disabled?.key).toBe('palette.cmd.compare.needsA')
  })
})

describe('comparar no se cuela en los otros comandos', () => {
  const compareKeys = (input: string, o?: PaletteContextOptions) => keys(input, o).filter((k) => k.startsWith('compare.'))

  it('«seguir ver»: ni «Comparar con «seguir»» ni comparar con VER («ver» es VER, no el principio de «versus»)', () => {
    // Antes: «ver» a medio escribir encajaba con «versus», el verbo de comparar, y «seguir» quedaba como un piloto
    // desconocido: «Comparar con «seguir» — Sin dato: ningún piloto «seguir» en esta sesión».
    expect(compareKeys('seguir ver')).toEqual([])
    expect(compareKeys('seguir ver', { state: { selectedCar: '1' } })).toEqual([])
    expect(compareKeys('sigue a vers')).toEqual([])
    expect(top('seguir ver').key).toBe('drivers.follow.3')
  })

  it('«Comparar con «X»» sin piloto X solo cuando la consulta empieza por un verbo de comparar', () => {
    expect(top('comparar xyz').key).toBe('compare.unknown')
    expect(top('comparar xyz').disabled).toEqual({ key: 'palette.cmd.driverUnknown', params: { q: 'xyz' } })
    expect(compareKeys('xyz vs')).toEqual([])
    expect(compareKeys('parada vs')).toEqual([])
  })

  it('una sigla que también es el principio de un verbo es antes un piloto', () => {
    // «ver nor»: VER y NOR, no «versus NOR».
    expect(compareKeys('ver nor', { state: { selectedCar: '81' } })).toEqual([])
    // Con el verbo escrito, «ver» es el piloto A.
    expect(top('comparar ver y nor').key).toBe('compare.3.1')
    expect(top('ver vs nor').key).toBe('compare.3.1')
    expect(top('vs nor', { state: { selectedCar: '81' } }).key).toBe('compare.81.1')
  })
})

describe('libres y clasificación: cada piloto lleva sus vueltas', () => {
  const fp = { type: 'fp1' } as const

  it('«vuelta 2» sin piloto pide uno (y Tab deja escribirlo)', () => {
    const s = top('vuelta 2', fp)
    expect(s.key).toBe('goto.lap.2.needsDriver')
    expect(s.disabled?.key).toBe('palette.cmd.lap.needsDriver')
    expect(s.complete).toBe('vuelta 2 ')
  })

  it('con un piloto seleccionado, la suya primero', () => {
    const s = top('vuelta 2', { ...fp, state: { selectedCar: '1' } })
    expect(s.key).toBe('goto.lap.2.1')
    expect(s.seekTo).toBe(120_000)
  })

  it('«vuelta 2 de NOR» va a su inicio; sin inicio o sin esa vuelta, deshabilitada', () => {
    expect(top('vuelta 2 de NOR', fp).seekTo).toBe(120_000)
    expect(top('vuelta 2 de VER', fp).disabled?.key).toBe('palette.cmd.lap.carNoStart')
    expect(top('vuelta 9 de NOR', fp).disabled).toEqual({
      key: 'palette.cmd.lap.carNoLap',
      params: { lap: 9, last: 3, driver: 'NOR', name: 'Lando Norris' },
    })
    expect(top('lap 1 of PIA', fp).disabled?.key).toBe('palette.cmd.lap.carNoLaps')
  })

  it('la hora es desde el inicio de la sesión («Started»)', () => {
    expect(top('1:00', fp).seekTo).toBe(10_000 + 60_000)
  })

  it('«siguiente vuelta» sin piloto lo pide; con uno, la suya', () => {
    expect(top('siguiente vuelta', fp).disabled?.key).toBe('palette.cmd.lap.stepNeedsDriver')
    const s = top('siguiente vuelta', { ...fp, state: { selectedCar: '1' } })
    expect(s.seekTo).toBe(120_000)
  })
})

describe('siguiente y anterior', () => {
  it('sin dirección, las dos; ya pasado el último, «ninguno más»', () => {
    const list = run('sc', { state: { timeMs: 230_000 } }).list
    const next = list.find((s) => s.key === 'goto.sc.next')!
    const prev = list.find((s) => s.key === 'goto.sc.prev')!
    expect(next.disabled?.key).toBe('palette.cmd.jump.noneAfter')
    expect(prev.seekTo).toBe(200_000)
  })

  it('lo que está justo en el instante actual no cuenta (pulsar dos veces avanza)', () => {
    expect(top('siguiente vuelta', { state: { timeMs: 155_000 } }).seekTo).toBe(60_000 + 95_000 + 90_000)
  })

  it('nada de eso en los datos: «sin dato»', () => {
    expect(top('siguiente bandera roja').disabled?.key).toBe('palette.cmd.jump.red.none')
    expect(top('parada de ver').disabled?.key).toBe('palette.cmd.jump.pit.noneCar')
  })

  it('momentos: solo con el servicio del ítem 5', () => {
    expect(keys('siguiente momento').some((k) => k.startsWith('goto.moment'))).toBe(false)
    const rec = recordingServices()
    const services = { ...rec.services, moments: { list: () => [{ t: 300_000 }] } }
    const [s] = suggest(BUILTIN_COMMANDS, 'siguiente momento', paletteContext({ services }))
    expect(s!.key).toBe('goto.moment.next')
    expect(s!.seekTo).toBe(300_000)
  })
})

describe('con el fixture (Spa, libres 1; lo mismo que comprueba palette.spec.ts)', () => {
  /** En pausa al principio del extracto, sin selección (como al abrir la sesión). */
  async function fixtureContext(): Promise<CommandContext> {
    const session = await loadFixture()
    const { type, playback } = session.manifest.session
    const info = commandSessionInfo(
      {
        session,
        drivers: session.manifest.drivers,
        markers: buildTimelineMarkers(type, session.timing, session.events, playback.endMs),
        leaderboard: { lapTable: buildLapTable(type, session.timing, session.events.raceControl) },
      },
      playback.startMs,
    )
    return {
      session: info,
      state: { timeMs: playback.startMs, playing: false, rate: 1, selectedCar: null, following: false, order: [] },
      services: withoutMoments(recordingServices().services),
    }
  }
  const first = async (input: string) => suggest(BUILTIN_COMMANDS, input, await fixtureContext())[0]!

  it('vuelta 17 de NOR, al inicio de su vuelta; la 15 empieza antes del extracto; «vuelta 17» pide piloto', async () => {
    expect((await first('vuelta 17 de NOR')).seekTo).toBe(4_380_686)
    expect((await first('vuelta 15 de NOR')).disabled?.key).toBe('palette.cmd.lap.carOutside')
    expect((await first('vuelta 17')).key).toBe('goto.lap.17.needsDriver')
  })

  it('reloj desde el «Started»; bandera a cuadros; parada de VER; sin coche de seguridad', async () => {
    expect((await first('1:00:00')).seekTo).toBe(816_881 + 3_600_000)
    expect((await first('bandera a cuadros')).seekTo).toBe(4_416_828)
    expect((await first('parada de VER')).seekTo).toBe(4_304_043)
    expect((await first('siguiente sc')).disabled?.key).toBe('palette.cmd.jump.sc.none')
  })
})

describe('estados y destacados', () => {
  it('reproducir ya reproduciendo, pausar en pausa, ×1 a ×1: deshabilitados con su motivo', () => {
    expect(top('play', { state: { playing: true } }).disabled?.key).toBe('palette.cmd.play.already')
    expect(top('pausa').disabled?.key).toBe('palette.cmd.pause.already')
    expect(top('x1').disabled?.key).toBe('palette.cmd.rate.already')
    expect(top('seguir ver', { state: { selectedCar: '3', following: true } }).disabled?.key).toBe('palette.cmd.follow.already')
  })

  it('con la consulta vacía: reproducir o pausar, seguir al seleccionado, el siguiente coche de seguridad', () => {
    expect(keys('')).toEqual(expect.arrayContaining(['playback.play', 'drivers.follow.1', 'goto.sc.next', 'goto.pit.next', 'goto.lap.next']))
    expect(keys('', { state: { playing: true, selectedCar: '1' } })).toEqual(
      expect.arrayContaining(['playback.pause', 'drivers.follow.1']),
    )
    expect(keys('', { state: { selectedCar: '1', following: true } })).toContain('drivers.overview')
  })

  it('«seguir» solo: el seleccionado primero y luego la clasificación', () => {
    const list = keys('seguir', { state: { selectedCar: '81', order: ['3', '1', '81'] } })
    expect(list.slice(0, 3)).toEqual(['drivers.follow.81', 'drivers.follow.3', 'drivers.follow.1'])
  })

  it('sin el servicio de comparar, no se ofrece comparar', () => {
    const rec = recordingServices()
    const list = suggest(BUILTIN_COMMANDS, 'comparar nor y pia', paletteContext({ services: { playback: rec.services.playback } }))
    expect(list.some((s) => s.group === 'compare')).toBe(false)
  })

  it('nada es irreversible: toda sugerencia habilitada mueve el reloj, elige, sigue, compara o cambia la velocidad', () => {
    const inputs = ['seguir ver', 'ver', 'vuelta 3', '2:30', 'x4', '+30', 'siguiente sc', 'parada de nor', 'comparar nor pia', 'vista general', 'play', 'desde el principio']
    const allowed = /^(seek|select|follow|rate|play|pause|compare):?/
    for (const input of inputs) {
      const { list, calls } = run(input, { state: { selectedCar: '3', following: true } })
      for (const s of list) s.run?.()
      for (const c of calls) expect(c, input).toMatch(allowed)
    }
  })
})
