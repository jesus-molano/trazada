/**
 * Momentos desde la paleta (ítem 14b, con los del ítem 5, D35): ir al siguiente o al anterior adelantamiento o duelo
 * («siguiente adelantamiento», «duelo anterior», «next overtake», «previous battle»), a los de un piloto
 * («adelantamientos de VER», «duelo HAM») o a los de dos entre sí («duelo entre VER y HAM»). Español e inglés a la vez,
 * sin tildes ni mayúsculas, como el resto de la paleta. Sin dirección escrita, las dos (siguiente y anterior).
 *
 * Datos: el precálculo de los momentos de la sesión, el de los botones de salto del dock (servicio `moments`, que
 * registran esos botones; sin él no se ofrece), y sus mismas reglas de salto (`engine/moments/jumps.ts`): se llega 5 s
 * antes (dentro de la reproducción) y «anterior» deja el mismo margen que el botón. Como al pulsar en la pestaña
 * «Momentos», un adelantamiento elige al que adelanta y un duelo al perseguidor, comparado con el de delante; con un
 * piloto escrito, se elige a ese piloto (y en un duelo se compara con su rival).
 *
 * Honestidad:
 * - Un adelantamiento lo confirma el orden oficial en la línea de meta; su instante sale del GPS y lleva «Estimado»
 *   (`overtakeTime`). Sin cruce GPS, «momento exacto: sin dato» y se va al inicio de esa vuelta.
 * - Solo en carrera y sprint (en libres y clasificación, deshabilitado con el motivo); la vuelta 1 nunca. Sin estado de
 *   pista por vuelta, no se buscan duelos (y se dice). Lo que no hay, «sin dato» o «ninguno más».
 * - Sin spoilers: con «Sin spoilers» (activo por defecto, el de la hoja de análisis), lo que la línea aún no ha
 *   confirmado en el instante del reloj no dice quién adelanta a quién ni quiénes pelean: solo la vuelta y la hora,
 *   como los botones del dock, que nunca dicen qué pasa.
 */
import type { Duel } from '../../moments/duels'
import { type Moment, nextMoment, overtakeTime, prevMoment, seekTarget } from '../../moments/jumps'
import type { Overtake } from '../../moments/overtakes'
import { clockAt, inSession, tlaOf } from '../context'
import { type Dir, findDir } from '../direction'
import {
  allTokens,
  completion,
  findDrivers,
  findPhrase,
  type Phrase,
  penalize,
  phrases,
  unexplained,
  without,
} from '../match'
import type { Query } from '../parse'
import { type CommandContext, type CommandDef, type Suggestion, type Text, t } from '../types'

type Kind = 'overtake' | 'duel'

const KIND_WORDS: Readonly<Record<Kind, readonly Phrase[]>> = {
  overtake: phrases('adelantamiento', 'adelantamientos', 'adelanta', 'adelantar', 'adelanto', 'overtake', 'overtakes', 'overtaking'),
  duel: phrases('duelo', 'duelos', 'lucha', 'luchas', 'batalla', 'batallas', 'duel', 'duels', 'battle', 'battles', 'fight', 'fights'),
}

/** Lo que une a dos pilotos («duelo entre VER y HAM», «adelantamientos VER vs HAM»): no cuenta como sobrante. */
const BETWEEN = phrases('entre', 'between', 'vs', 'versus', 'contra')

/** Candidatos como mucho de un piloto ambiguo («sa»: Sainz y Sargeant). */
const CANDIDATES_MAX = 3

/** Un texto sin piloto, con uno (`{driver}`) y entre dos (`{a}` y `{b}`). */
interface ForCars {
  readonly any: Text
  readonly car: Text
  readonly pair: Text
}

/** Textos de cada clase: títulos por dirección y «ninguno en esta sesión». */
interface KindTexts {
  readonly next: ForCars
  readonly prev: ForCars
  readonly none: ForCars
}

const TEXTS: Readonly<Record<Kind, KindTexts>> = {
  overtake: {
    next: {
      any: t('moments.cmd.overtake.next'),
      car: t('moments.cmd.overtake.nextCar'),
      pair: t('moments.cmd.overtake.nextPair'),
    },
    prev: {
      any: t('moments.cmd.overtake.prev'),
      car: t('moments.cmd.overtake.prevCar'),
      pair: t('moments.cmd.overtake.prevPair'),
    },
    none: {
      any: t('moments.cmd.overtake.none'),
      car: t('moments.cmd.overtake.noneCar'),
      pair: t('moments.cmd.overtake.nonePair'),
    },
  },
  duel: {
    next: { any: t('moments.cmd.duel.next'), car: t('moments.cmd.duel.nextCar'), pair: t('moments.cmd.duel.nextPair') },
    prev: { any: t('moments.cmd.duel.prev'), car: t('moments.cmd.duel.prevCar'), pair: t('moments.cmd.duel.prevPair') },
    none: { any: t('moments.cmd.duel.none'), car: t('moments.cmd.duel.noneCar'), pair: t('moments.cmd.duel.nonePair') },
  },
}

/** El texto para los coches escritos. */
function forCars(ctx: CommandContext, texts: ForCars, cars: readonly string[]): Text {
  if (cars.length === 0) return texts.any
  if (cars.length === 1) return { key: texts.car.key, params: { driver: tlaOf(ctx, cars[0]!) } }
  return { key: texts.pair.key, params: { a: tlaOf(ctx, cars[0]!), b: tlaOf(ctx, cars[1]!) } }
}

/** ¿Están todos los coches escritos en el momento (adelantando o adelantado, delante o detrás)? */
const involves = (cars: readonly string[], a: string, b: string) => cars.every((c) => c === a || c === b)

/** Momentos de una clase entre los que saltar (los de los coches escritos), con su instante y su destino. */
interface Candidates<T> {
  readonly items: readonly T[]
  /** `index`: en `items`. */
  readonly moments: readonly Moment[]
}

function candidates<T>(ctx: CommandContext, kind: Kind, items: readonly T[], at: (x: T) => number): Candidates<T> {
  const { startMs, endMs } = ctx.session
  const moments: Moment[] = []
  items.forEach((x, index) => {
    const t0 = at(x)
    // Como los botones del dock: lo que cae fuera de la reproducción no es un momento al que saltar.
    if (inSession(ctx, t0)) moments.push({ kind, t: t0, seekMs: seekTarget(t0, startMs, endMs), index })
  })
  return { items, moments }
}

/** Lo que tiene el resto de la sugerencia en común. */
type Base = Pick<Suggestion, 'key' | 'group' | 'score' | 'title' | 'complete'>

function overtakeSuggestion(ctx: CommandContext, base: Base, o: Overtake, seekMs: number, cars: readonly string[]): Suggestion {
  const revealed = !ctx.services.moments!.noSpoilers || o.confirmedMs <= ctx.state.timeMs
  const located = o.atMs !== null
  const clock = clockAt(ctx, overtakeTime(o))
  // Se elige al piloto escrito o, sin él (o con dos), al que adelanta: como al pulsarlo en la pestaña.
  const select = cars.length === 1 ? cars[0]! : o.passer
  let detail: Text
  if (revealed) {
    const params = { lap: o.lap, clock, passer: tlaOf(ctx, o.passer), passed: tlaOf(ctx, o.passed), select: tlaOf(ctx, select) }
    detail = located ? t('moments.cmd.overtake.detail', params) : t('moments.cmd.overtake.detailNoTime', params)
  } else {
    detail = located ? t('moments.cmd.overtake.hidden', { lap: o.lap, clock }) : t('moments.cmd.overtake.hiddenNoTime', { lap: o.lap, clock })
  }
  return {
    ...base,
    detail,
    ...(located ? { estimated: 'overtakeTime' as const } : {}),
    seekTo: seekMs,
    // El color de quien queda elegido, solo si no destapa nada (ya confirmado, o el piloto que se ha escrito).
    ...(revealed || cars.length === 1 ? { car: select } : {}),
    run: () => {
      const pb = ctx.services.playback!
      pb.seek(seekMs)
      pb.select(select)
    },
  }
}

function duelSuggestion(ctx: CommandContext, base: Base, d: Duel, seekMs: number, cars: readonly string[]): Suggestion {
  const revealed = !ctx.services.moments!.noSpoilers || d.confirmedMs <= ctx.state.timeMs
  const clock = clockAt(ctx, d.startMs)
  // Al perseguidor (o al piloto escrito), comparado con su rival si está la comparación (ítem 1).
  const select = cars.length === 1 ? cars[0]! : d.chaser
  const rival = select === d.chaser ? d.leader : d.chaser
  const compare = ctx.services.compare
  let detail: Text
  if (revealed) {
    const params = {
      lap: d.firstLap,
      clock,
      chaser: tlaOf(ctx, d.chaser),
      leader: tlaOf(ctx, d.leader),
      select: tlaOf(ctx, select),
      rival: tlaOf(ctx, rival),
    }
    detail = compare ? t('moments.cmd.duel.detail', params) : t('moments.cmd.duel.detailNoCompare', params)
  } else {
    detail = t('moments.cmd.duel.hidden', { lap: d.firstLap, clock })
  }
  return {
    ...base,
    detail,
    seekTo: seekMs,
    ...(revealed || cars.length === 1 ? { car: select } : {}),
    run: () => {
      ctx.services.playback!.seek(seekMs)
      if (compare) compare.compare(select, rival)
      else ctx.services.playback!.select(select)
    },
  }
}

/** Sugerencias de una clase, en las direcciones pedidas, para los coches escritos (ninguno, uno o dos). */
function momentSuggestions(
  ctx: CommandContext,
  kind: Kind,
  dirs: readonly Dir[],
  cars: readonly string[],
  score: (dir: Dir) => number,
  complete: string | undefined,
): Suggestion[] {
  const key = (dir: Dir) => `moments.${kind}.${dir}${cars.length ? `.${cars.join('.')}` : ''}`
  const base = (dir: Dir): Base => ({
    key: key(dir),
    group: 'goto',
    score: score(dir),
    title: forCars(ctx, TEXTS[kind][dir], cars),
    ...(complete === undefined ? {} : { complete }),
  })
  const mark = cars.length === 1 ? { car: cars[0]! } : {}
  const disabled = (reason: Text): Suggestion[] => [{ ...base(dirs[0]!), ...mark, disabled: reason }]
  if (!ctx.session.race) return disabled(t('moments.cmd.onlyRace'))

  const service = ctx.services.moments!
  const now = ctx.state.timeMs
  const step = (list: Candidates<unknown>, dir: Dir): Moment | null =>
    dir === 'next' ? nextMoment(list.moments, now) : prevMoment(list.moments, now)
  const noMore = (dir: Dir): Suggestion => {
    const clock = clockAt(ctx, now)
    return {
      ...base(dir),
      ...mark,
      disabled: dir === 'next' ? t('palette.cmd.jump.noneAfter', { clock }) : t('palette.cmd.jump.noneBefore', { clock }),
    }
  }

  if (kind === 'overtake') {
    const list = candidates(
      ctx,
      kind,
      service.overtakes().filter((o) => involves(cars, o.passer, o.passed)),
      overtakeTime,
    )
    if (list.moments.length === 0) return disabled(forCars(ctx, TEXTS[kind].none, cars))
    return dirs.map((dir) => {
      const m = step(list, dir)
      return m ? overtakeSuggestion(ctx, base(dir), list.items[m.index]!, m.seekMs, cars) : noMore(dir)
    })
  }
  const duels = service.duels()
  if (duels.status === 'noTrackStatus') return disabled(t('moments.cmd.duel.noTrackStatus'))
  const list = candidates(
    ctx,
    kind,
    duels.duels.filter((d) => involves(cars, d.leader, d.chaser)),
    (d) => d.startMs,
  )
  if (list.moments.length === 0) return disabled(forCars(ctx, TEXTS[kind].none, cars))
  return dirs.map((dir) => {
    const m = step(list, dir)
    return m ? duelSuggestion(ctx, base(dir), list.items[m.index]!, m.seekMs, cars) : noMore(dir)
  })
}

/** Quita de los libres las palabras que unen a dos pilotos. */
function withoutConnectors(q: Query, free: ReadonlySet<number>): Set<number> {
  let rest = new Set(free)
  for (let m = findPhrase(q.tokens, BETWEEN, rest); m; m = findPhrase(q.tokens, BETWEEN, rest)) rest = without(rest, m.used)
  return rest
}

function momentCommand(kind: Kind): CommandDef {
  return {
    id: `moments.${kind}`,
    needs: ['playback', 'moments'],
    suggest(q, ctx) {
      if (q.empty) return []
      const word = findPhrase(q.tokens, KIND_WORDS[kind])
      if (!word) return []
      let rest = without(allTokens(q.tokens), word.used)
      const dir = findDir(q, rest)
      if (dir) rest = without(rest, dir.m.used)
      const refs = findDrivers(q.tokens, ctx.session.drivers, rest, 2)
      for (const ref of refs) rest = without(rest, ref.used)
      if (refs.length) rest = withoutConnectors(q, rest)
      const left = unexplained(q.tokens, rest)
      const dirs: readonly Dir[] = dir ? [dir.dir] : ['next', 'prev']
      // Como los demás saltos: la media de lo que encaja; sin dirección, «anterior» un poco por debajo.
      const scoreOf = (driver: number | null) => (d: Dir) => {
        const parts = [word.score, ...(dir ? [dir.m.score] : []), ...(driver === null ? [] : [driver])]
        const s = parts.reduce((a, b) => a + b, 0) / parts.length
        return penalize(dir || d === 'next' ? s : s * 0.9, left)
      }
      const last = q.tokens.length - 1
      if (refs.length === 2) {
        const a = refs[0]!.candidates[0]!
        const b = refs[1]!.candidates[0]!
        const cars = a.car === b.car ? [a.car] : [a.car, b.car]
        const complete = completion(q.text, tlaOf(ctx, b.car), refs[1]!.used.includes(last))
        return momentSuggestions(ctx, kind, dirs, cars, scoreOf((a.score + b.score) / 2), complete)
      }
      if (refs.length === 1) {
        const ref = refs[0]!
        return ref.candidates.slice(0, CANDIDATES_MAX).flatMap((c) =>
          momentSuggestions(ctx, kind, dirs, [c.car], scoreOf(c.score), completion(q.text, tlaOf(ctx, c.car), ref.used.includes(last))),
        )
      }
      return momentSuggestions(ctx, kind, dirs, [], scoreOf(null), undefined)
    },
  }
}

export const commands: readonly CommandDef[] = [momentCommand('overtake'), momentCommand('duel')]
