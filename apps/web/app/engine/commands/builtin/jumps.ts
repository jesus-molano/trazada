/**
 * Saltos (ítem 14): a una vuelta («vuelta 30», «v30», «lap 30», «vuelta 7 de VER»), a la siguiente o la anterior
 * («siguiente vuelta», «vuelta anterior») y a los marcadores del timeline: coche de seguridad, virtual, bandera roja,
 * amarilla, bandera a cuadros y entradas en boxes («siguiente sc», «parada de NOR»: todas las entradas en el pit lane
 * que da el cronometraje, también un drive-through o una vuelta al garaje, así que el título dice «entrada en boxes» y
 * «parada» queda como otra forma de pedirlo). Con el servicio de momentos (ítem 5), también
 * al siguiente o al anterior momento; sin él, no se ofrece.
 *
 * Datos: los marcadores (`TimelineMarkers`, de `timing` y `events`) y las vueltas de cada coche (`LapTable`). La «vuelta
 * N» a secas es la del líder y solo existe en carrera y sprint; en libres y clasificación cada piloto lleva las suyas,
 * así que se pide piloto. Lo que no está en los datos sale deshabilitado con su motivo.
 */
import { leaderLapAt } from '../../timeline/markers'
import { carLapStart, carLapStarts, clockAt, driverParams, inSession, NEAR_MS, tlaOf } from '../context'
import { type Dir, findDir } from '../direction'
import {
  allTokens,
  completion,
  type DriverRef,
  findDrivers,
  findPhrase,
  type Phrase,
  type PhraseMatch,
  penalize,
  phrases,
  unexplained,
  without,
} from '../match'
import type { Query } from '../parse'
import { type CommandContext, type CommandDef, type Suggestion, type Text, t } from '../types'

const LAP = phrases('vuelta', 'lap')

type MarkerTarget = 'sc' | 'vsc' | 'red' | 'yellow' | 'chequered' | 'pit' | 'moment'

const TARGET_WORDS: Readonly<Record<MarkerTarget, readonly Phrase[]>> = {
  sc: phrases('coche de seguridad', 'safety car', 'sc', 'safety'),
  vsc: phrases('coche de seguridad virtual', 'virtual safety car', 'vsc', 'virtual'),
  red: phrases('bandera roja', 'roja', 'red flag', 'red', 'interrupcion'),
  yellow: phrases('bandera amarilla', 'amarilla', 'yellow flag', 'yellow'),
  chequered: phrases('bandera a cuadros', 'cuadros', 'chequered flag', 'chequered', 'checkered flag', 'checkered'),
  pit: phrases(
    'parada',
    'paradas',
    'pit stop',
    'pit',
    'pits',
    'box',
    'boxes',
    'entrada a boxes',
    'entrada en boxes',
    'pit lane',
    'pit entry',
  ),
  moment: phrases('momento', 'momentos', 'moment', 'moments'),
}
const TARGETS = Object.keys(TARGET_WORDS) as MarkerTarget[]
/** Destinos que salen a la vez: los que encajan casi tanto como el mejor. */
const TARGET_MARGIN = 0.1

/** Textos de cada destino: siguiente, anterior, ninguno en los datos y el detalle con la hora. */
const TARGET_TEXT: Readonly<Record<MarkerTarget, { next: Text; prev: Text; none: Text }>> = {
  sc: { next: t('palette.cmd.jump.sc.next'), prev: t('palette.cmd.jump.sc.prev'), none: t('palette.cmd.jump.sc.none') },
  vsc: { next: t('palette.cmd.jump.vsc.next'), prev: t('palette.cmd.jump.vsc.prev'), none: t('palette.cmd.jump.vsc.none') },
  red: { next: t('palette.cmd.jump.red.next'), prev: t('palette.cmd.jump.red.prev'), none: t('palette.cmd.jump.red.none') },
  yellow: {
    next: t('palette.cmd.jump.yellow.next'),
    prev: t('palette.cmd.jump.yellow.prev'),
    none: t('palette.cmd.jump.yellow.none'),
  },
  chequered: {
    next: t('palette.cmd.jump.chequered.next'),
    prev: t('palette.cmd.jump.chequered.prev'),
    none: t('palette.cmd.jump.chequered.none'),
  },
  pit: { next: t('palette.cmd.jump.pit.next'), prev: t('palette.cmd.jump.pit.prev'), none: t('palette.cmd.jump.pit.none') },
  moment: {
    next: t('palette.cmd.jump.moment.next'),
    prev: t('palette.cmd.jump.moment.prev'),
    none: t('palette.cmd.jump.moment.none'),
  },
}

/** Un instante al que saltar (con su coche o su sector, si lo tiene). */
interface Mark {
  t: number
  car?: string
  sector?: number | null
}

function marksOf(ctx: CommandContext, target: MarkerTarget, car: string | null): Mark[] | null {
  const { markers } = ctx.session
  const windows = (kind: string) => markers.windows.filter((w) => w.kind === kind).map((w) => ({ t: w.fromMs }))
  const flags = (kinds: readonly string[]) =>
    markers.flags.filter((f) => kinds.includes(f.kind)).map((f) => ({ t: f.t, sector: f.sector }))
  let list: Mark[]
  switch (target) {
    case 'sc':
      list = windows('sc')
      break
    case 'vsc':
      list = windows('vsc')
      break
    case 'red': {
      // Las ventanas de bandera roja; sin ellas, los mensajes de bandera roja de race control.
      const w = windows('red')
      list = w.length ? w : flags(['red_flag'])
      break
    }
    case 'yellow':
      list = flags(['sector_yellow', 'sector_double_yellow'])
      break
    case 'chequered':
      list = flags(['chequered_flag'])
      break
    case 'pit':
      list = markers.pits.filter((p) => car === null || p.car === car).map((p) => ({ t: p.inMs, car: p.car }))
      break
    case 'moment': {
      const service = ctx.services.moments
      if (!service) return null
      list = service.list().map((m) => ({ t: m.t }))
      break
    }
  }
  return list.filter((m) => inSession(ctx, m.t)).sort((a, b) => a.t - b.t)
}

/** El primero después de ahora o el último antes (lo que está justo en el instante actual no cuenta). */
function pick<T extends { t: number }>(list: readonly T[], now: number, dir: Dir): T | undefined {
  if (dir === 'next') return list.find((m) => m.t > now + NEAR_MS)
  for (let i = list.length - 1; i >= 0; i--) if (list[i]!.t < now - NEAR_MS) return list[i]
  return undefined
}

function markSuggestions(
  ctx: CommandContext,
  target: MarkerTarget,
  dirs: readonly Dir[],
  car: string | null,
  score: (dir: Dir) => number,
): Suggestion[] {
  const marks = marksOf(ctx, target, car)
  if (marks === null) return []
  const text = TARGET_TEXT[target]
  const who = car === null ? {} : driverParams(ctx, car)
  const titleOf = (dir: Dir) =>
    car === null
      ? text[dir]
      : dir === 'next'
        ? t('palette.cmd.jump.pit.nextCar', who)
        : t('palette.cmd.jump.pit.prevCar', who)
  const key = (dir: Dir) => `goto.${target}.${dir}${car === null ? '' : `.${car}`}`
  if (marks.length === 0) {
    const dir = dirs[0]!
    return [
      {
        key: key(dir),
        group: 'goto',
        score: score(dir),
        title: titleOf(dir),
        disabled: car === null ? text.none : t('palette.cmd.jump.pit.noneCar', who),
      },
    ]
  }
  const now = ctx.state.timeMs
  return dirs.map((dir): Suggestion => {
    const base = { key: key(dir), group: 'goto', score: score(dir), title: titleOf(dir) } as const
    const m = pick(marks, now, dir)
    if (!m) {
      const clock = clockAt(ctx, now)
      return { ...base, disabled: dir === 'next' ? t('palette.cmd.jump.noneAfter', { clock }) : t('palette.cmd.jump.noneBefore', { clock }) }
    }
    const clock = clockAt(ctx, m.t)
    let detail: Text
    if (m.car !== undefined) detail = t('palette.cmd.jump.pitDetail', { ...driverParams(ctx, m.car), clock })
    else if (m.sector !== undefined && m.sector !== null) detail = t('palette.cmd.jump.sectorDetail', { sector: m.sector, clock })
    else detail = t('palette.cmd.jump.atDetail', { clock })
    const pitCar = target === 'pit' ? m.car : undefined
    return {
      ...base,
      detail,
      seekTo: m.t,
      car: pitCar,
      run: () => {
        const pb = ctx.services.playback!
        pb.seek(m.t)
        // La parada de un coche: también se le selecciona (para verlo entrar).
        if (pitCar !== undefined) pb.select(pitCar)
      },
    }
  })
}

const markerJumps: CommandDef = {
  id: 'goto.markers',
  needs: ['playback'],
  suggest(q, ctx) {
    if (q.empty) {
      // Destacados: la siguiente neutralización (bandera roja o coche de seguridad) y la siguiente parada, si las hay.
      const out: Suggestion[] = []
      const ahead = (target: MarkerTarget) => {
        const marks = marksOf(ctx, target, null)
        return !!marks && !!pick(marks, ctx.state.timeMs, 'next')
      }
      const neutral = (['red', 'sc', 'vsc'] as const).find(ahead)
      if (neutral) out.push(...markSuggestions(ctx, neutral, ['next'], null, () => 0.6))
      if (ahead('pit')) out.push(...markSuggestions(ctx, 'pit', ['next'], null, () => 0.5))
      return out
    }
    const free = allTokens(q.tokens)
    const dir = findDir(q, free)
    const afterDir = dir ? without(free, dir.m.used) : free
    // Los destinos que encajan (varios mientras se escribe: «siguiente p…»), el mejor primero.
    const found: { target: MarkerTarget; m: PhraseMatch }[] = []
    for (const target of TARGETS) {
      const m = findPhrase(q.tokens, TARGET_WORDS[target], afterDir)
      if (m) found.push({ target, m })
    }
    found.sort((a, b) => b.m.score - a.m.score || b.m.used.length - a.m.used.length)
    const top = found[0]?.m.score ?? 0
    const targets = found.filter((f) => f.m.score >= top - TARGET_MARGIN)
    if (!targets.length) {
      // Solo la dirección («siguiente», «anterior»): los destinos que tienen algo.
      if (!dir || unexplained(q.tokens, afterDir) > 0) return []
      return TARGETS.flatMap((target, i) => {
        const marks = marksOf(ctx, target, null)
        if (!marks || !pick(marks, ctx.state.timeMs, dir.dir)) return []
        return markSuggestions(ctx, target, [dir.dir], null, () => dir.m.score * 0.7 - i * 0.01)
      })
    }
    return targets.flatMap(({ target, m }) => {
      let rest = without(afterDir, m.used)
      // «parada de NOR»: las de ese coche.
      let ref: DriverRef | undefined
      if (target === 'pit') {
        ref = findDrivers(q.tokens, ctx.session.drivers, rest, 1)[0]
        if (ref) rest = without(rest, ref.used)
      }
      const left = unexplained(q.tokens, rest)
      const dirs: readonly Dir[] = dir ? [dir.dir] : ['next', 'prev']
      const scoreOf = (car: number) => (d: Dir) => {
        const parts = [m.score, ...(dir ? [dir.m.score] : []), ...(ref ? [car] : [])]
        const s = parts.reduce((a, b) => a + b, 0) / parts.length
        return penalize(dir || d === 'next' ? s : s * 0.9, left)
      }
      if (ref) return ref.candidates.flatMap((c) => markSuggestions(ctx, target, dirs, c.car, scoreOf(c.score)))
      return markSuggestions(ctx, target, dirs, null, scoreOf(1))
    })
  },
}

/** Vuelta N del líder (carrera y sprint). */
function leaderLap(ctx: CommandContext, lap: number, score: number): Suggestion {
  const base = { key: `goto.lap.${lap}`, group: 'goto', score, title: t('palette.cmd.lap.title', { lap }) } as const
  const laps = ctx.session.markers.laps
  const found = laps.find((l) => l.lap === lap)
  if (found && inSession(ctx, found.t)) {
    return {
      ...base,
      detail: t('palette.cmd.lap.detail', { lap, clock: clockAt(ctx, found.t) }),
      seekTo: found.t,
      run: () => ctx.services.playback!.seek(found.t),
    }
  }
  if (lap < 1) return { ...base, disabled: t('palette.cmd.lap.fromOne') }
  const total = ctx.session.totalLaps
  if (total !== null && lap > total) return { ...base, disabled: t('palette.cmd.lap.beyondTotal', { total }) }
  const max = laps.length ? laps[laps.length - 1]!.lap : null
  return { ...base, disabled: max === null ? t('palette.cmd.lap.noData') : t('palette.cmd.lap.noDataMax', { max }) }
}

/** Vuelta N de un coche: al empezarla (y se le selecciona). */
function carLap(ctx: CommandContext, car: string, lap: number, score: number, complete?: string): Suggestion {
  const who = driverParams(ctx, car)
  const base = {
    key: `goto.lap.${lap}.${car}`,
    group: 'goto',
    score,
    car,
    complete,
    title: t('palette.cmd.lap.carTitle', { lap, ...who }),
  } as const
  const found = carLapStart(ctx, car, lap)
  if (found.kind === 'start' && inSession(ctx, found.t)) {
    const at = found.t
    return {
      ...base,
      detail: t('palette.cmd.lap.carDetail', { lap, clock: clockAt(ctx, at), ...who }),
      seekTo: at,
      run: () => {
        ctx.services.playback!.seek(at)
        ctx.services.playback!.select(car)
      },
    }
  }
  if (found.kind === 'start') return { ...base, disabled: t('palette.cmd.lap.carOutside', { lap, ...who }) }
  if (found.kind === 'no-start') return { ...base, disabled: t('palette.cmd.lap.carNoStart', { lap, ...who }) }
  if (found.last === null) return { ...base, disabled: t('palette.cmd.lap.carNoLaps', who) }
  return { ...base, disabled: t('palette.cmd.lap.carNoLap', { lap, last: found.last, ...who }) }
}

/** «vuelta 30» en libres o clasificación: hace falta un piloto. */
function lapNeedsDriver(q: Query, lap: number, score: number): Suggestion {
  return {
    key: `goto.lap.${lap}.needsDriver`,
    group: 'goto',
    score,
    title: t('palette.cmd.lap.title', { lap }),
    disabled: t('palette.cmd.lap.needsDriver', { lap }),
    complete: `${q.text} `,
  }
}

/** Siguiente o anterior vuelta: la del líder en carrera; la del coche (escrito o seleccionado) en el resto. */
function stepLap(ctx: CommandContext, dir: Dir, car: string | null, score: number): Suggestion {
  const title = dir === 'next' ? t('palette.cmd.lap.next') : t('palette.cmd.lap.prev')
  const base = { key: `goto.lap.${dir}${car === null ? '' : `.${car}`}`, group: 'goto', score, title } as const
  const now = ctx.state.timeMs
  const useLeader = car === null && ctx.session.race
  if (!useLeader && car === null) return { ...base, disabled: t('palette.cmd.lap.stepNeedsDriver') }
  const list = useLeader ? ctx.session.markers.laps.filter((l) => inSession(ctx, l.t)) : carLapStarts(ctx, car!).filter((l) => inSession(ctx, l.t))
  const found = pick(list, now, dir)
  if (!found) {
    const clock = clockAt(ctx, now)
    return { ...base, disabled: dir === 'next' ? t('palette.cmd.jump.noneAfter', { clock }) : t('palette.cmd.jump.noneBefore', { clock }) }
  }
  const clock = clockAt(ctx, found.t)
  return {
    ...base,
    car: car ?? undefined,
    detail: useLeader
      ? t('palette.cmd.lap.leaderStep', { lap: found.lap, clock })
      : t('palette.cmd.lap.carStep', { lap: found.lap, clock, ...driverParams(ctx, car!) }),
    seekTo: found.t,
    run: () => ctx.services.playback!.seek(found.t),
  }
}

const lapJumps: CommandDef = {
  id: 'goto.lap',
  needs: ['playback'],
  suggest(q, ctx) {
    if (q.empty) {
      // Destacado en carrera: la siguiente vuelta del líder.
      if (!ctx.session.race || leaderLapAt(ctx.session.markers, ctx.state.timeMs) < 1) return []
      const s = stepLap(ctx, 'next', null, 0.55)
      return s.run ? [s] : []
    }
    const free = allTokens(q.tokens)
    const word = findPhrase(q.tokens, LAP)
    let rest = word ? without(free, word.used) : free
    // El número de vuelta: «v30» o, tras «vuelta», un número.
    let lapAt = [...rest].find((i) => q.tokens[i]!.kind === 'lap')
    if (lapAt === undefined && word) lapAt = [...rest].find((i) => q.tokens[i]!.kind === 'number')
    const dir = findDir(q, rest)
    if (dir) rest = without(rest, dir.m.used)
    if (lapAt !== undefined) rest = without(rest, [lapAt])
    const refs = findDrivers(q.tokens, ctx.session.drivers, rest, 1)
    const ref = refs[0]
    if (ref) rest = without(rest, ref.used)
    const left = unexplained(q.tokens, rest)
    const last = q.tokens.length - 1

    if (lapAt !== undefined) {
      const lap = q.tokens[lapAt]!.value!
      const kw = word ? word.score : 1
      if (ref) {
        return ref.candidates.map((c) =>
          carLap(ctx, c.car, lap, penalize((kw + c.score + 1) / 3, left), completion(q.text, tlaOf(ctx, c.car), ref.used.includes(last))),
        )
      }
      const score = penalize(kw, left)
      if (ctx.session.race) return [leaderLap(ctx, lap, score)]
      const out = [lapNeedsDriver(q, lap, score * 0.9)]
      const sel = ctx.state.selectedCar
      if (sel !== null) out.unshift(carLap(ctx, sel, lap, score * 0.95))
      return out
    }
    if (word || (dir && !ref && left === 0)) {
      // «siguiente vuelta», «vuelta anterior», «vuelta» sola (o «siguiente» solo, por debajo).
      const car = ref?.candidates[0]?.car ?? (ctx.session.race ? null : ctx.state.selectedCar)
      // Sin piloto en libres o clasificación, una sola sugerencia que lo pide.
      const dirs: readonly Dir[] = dir ? [dir.dir] : car === null && !ctx.session.race ? ['next'] : ['next', 'prev']
      const kw = word ? word.score : 0.7
      const base = dir ? (kw + dir.m.score) / 2 : kw * 0.9
      return dirs.map((d, i) => stepLap(ctx, d, car, penalize(word ? base - i * 0.05 : base * 0.7, left)))
    }
    // Un número a secas en carrera: también puede ser una vuelta (por debajo del dorsal).
    const n = q.tokens.length === 1 && q.tokens[0]!.kind === 'number' ? q.tokens[0]!.value! : null
    if (n !== null && ctx.session.race) return [leaderLap(ctx, n, 0.55)]
    return []
  },
}

export const commands: readonly CommandDef[] = [lapJumps, markerJumps]
