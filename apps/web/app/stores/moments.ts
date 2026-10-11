import { defineStore } from 'pinia'
import { type DuelsResult, type Duel, duels } from '~/engine/moments/duels'
import {
  buildMoments,
  MOMENT_KINDS,
  type Moment,
  type MomentKind,
  nextMoment,
  overtakeTime,
  prevMoment,
  seekTarget,
} from '~/engine/moments/jumps'
import { type Overtake, overtakes } from '~/engine/moments/overtakes'
import { registerSceneStat } from '~/replay/debug'
import type { ReplayRuntime } from '~/replay/runtime'
import { useCompareStore } from './compare'
import { getRuntime, usePlaybackStore } from './playback'

/** Precálculo de los momentos de una sesión (ítem 5, D35): uno por runtime (`rt.ext`), al primer uso. */
export interface MomentsModel {
  /** Carrera o sprint (solo ahí hay adelantamientos y duelos). */
  readonly race: boolean
  /** Adelantamientos de toda la sesión, situados con el GPS cuando se puede. */
  readonly overtakes: readonly Overtake[]
  /** Duelos de toda la sesión (sin corte) o por qué no se buscan. */
  readonly duels: DuelsResult
  /** Momentos a los que saltar, por tiempo. */
  readonly moments: readonly Moment[]
  /** Clases con algún momento en la reproducción. */
  readonly kinds: ReadonlySet<MomentKind>
  dispose(): void
}

export const MOMENTS_EXT = 'moments'

export function createMomentsModel(rt: ReplayRuntime): MomentsModel {
  const table = rt.leaderboard.lapTable
  const list = overtakes(table, new Map(rt.model.tracks.map((t) => [t.car, t])))
  const d = duels(table, Infinity, list)
  const moments = buildMoments({
    overtakes: list,
    duels: d.duels,
    neutralisations: rt.session.events.windows,
    raceControl: rt.raceControl,
    startMs: rt.clock.startMs,
    endMs: rt.clock.endMs,
  })
  const kinds = new Set(moments.map((m) => m.kind))
  // Para los e2e (`window.__trazada.scene.moments`).
  const off = registerSceneStat('moments', () => ({
    overtakes: list.length,
    located: list.filter((o) => o.atMs !== null).length,
    duels: d.duels.length,
    duelsStatus: d.status,
    moments: moments.length,
    kinds: MOMENT_KINDS.filter((k) => kinds.has(k)),
    targets: moments.map((m) => ({ kind: m.kind, t: m.t, seekMs: m.seekMs })),
  }))
  return { race: table.race, overtakes: list, duels: d, moments, kinds, dispose: off }
}

/** Qué recorren los botones ⏮ ⏭: todos los momentos o una sola clase. */
export const JUMP_FILTERS = ['all', ...MOMENT_KINDS] as const
export type JumpFilter = (typeof JUMP_FILTERS)[number]

export const isJumpFilter = (x: unknown): x is JumpFilter => (JUMP_FILTERS as readonly unknown[]).includes(x)

/**
 * Momentos (ítem 5): saltos al momento anterior o siguiente (botones del dock, atajos y la pestaña «Momentos») y lo que
 * pasa al ir a uno: el reloj salta unos segundos antes y, en un adelantamiento o un duelo, se selecciona al que adelanta
 * o persigue (en un duelo elegido en la lista, además, se compara con el de delante). Estado grueso: el precálculo vive
 * en el runtime (`rt.ext`) y lo que depende del reloj se calcula con el estado grueso (≤ 10 Hz).
 */
export const useMomentsStore = defineStore('moments', () => {
  const playback = usePlaybackStore()
  const filter = ref<JumpFilter>('all')

  /** Precálculo de la sesión enganchada (null sin runtime). */
  function model(): MomentsModel | null {
    const rt = getRuntime()
    return rt ? rt.ext(MOMENTS_EXT, createMomentsModel) : null
  }

  const kindsOf = (f: JumpFilter): ReadonlySet<MomentKind> | undefined => (f === 'all' ? undefined : new Set([f]))

  function target(dir: 1 | -1, nowMs: number): Moment | null {
    const m = model()
    if (!m) return null
    return dir > 0 ? nextMoment(m.moments, nowMs, kindsOf(filter.value)) : prevMoment(m.moments, nowMs, kindsOf(filter.value))
  }

  /**
   * Adónde saltan ⏮ ⏭ (de la clase elegida), por tiempo: el servicio de momentos de la paleta de comandos (ítem 14),
   * que así recorre los mismos destinos que los botones del dock.
   */
  function targets(): { t: number }[] {
    const m = model()
    if (!m) return []
    const kinds = kindsOf(filter.value)
    return m.moments.filter((x) => !kinds || kinds.has(x.kind)).map((x) => ({ t: x.seekMs }))
  }

  /** Momentos a los que saltar ahora (con el reloj grueso): para habilitar los botones. */
  const next = computed(() => (playback.attached ? target(1, playback.timeMs) : null))
  const prev = computed(() => (playback.attached ? target(-1, playback.timeMs) : null))

  function setFilter(value: JumpFilter): void {
    if (isJumpFilter(value)) filter.value = value
  }

  function seek(t: number): void {
    const rt = getRuntime()
    if (rt) playback.seek(seekTarget(t, rt.clock.startMs, rt.clock.endMs))
  }

  /** Va a un adelantamiento: unos segundos antes de su instante (o del inicio de su vuelta) y elige al que adelanta. */
  function goToOvertake(o: Overtake): void {
    seek(overtakeTime(o))
    playback.selectCar(o.passer)
  }

  /** Va al inicio de un duelo y elige al perseguidor; con `compare`, lo compara con el de delante (ítem 1). */
  function goToDuel(d: Duel, opts: { compare?: boolean } = {}): void {
    seek(d.startMs)
    playback.selectCar(d.chaser)
    if (opts.compare) useCompareStore().setCompareCar(d.leader)
  }

  function go(m: Moment): void {
    const mm = model()
    if (m.kind === 'overtake' && mm?.overtakes[m.index]) goToOvertake(mm.overtakes[m.index]!)
    else if (m.kind === 'duel' && mm?.duels.duels[m.index]) goToDuel(mm.duels.duels[m.index]!)
    else playback.seek(m.seekMs)
  }

  /** Salta al momento siguiente (1) o anterior (−1) desde el instante exacto del reloj. ¿Había alguno? */
  function jump(dir: 1 | -1): boolean {
    const rt = getRuntime()
    const m = rt ? target(dir, rt.clock.timeMs) : null
    if (m) go(m)
    return m !== null
  }

  // Otra sesión, otros momentos: se vuelve a «todos».
  watch(
    () => playback.attached,
    (attached) => {
      if (!attached) filter.value = 'all'
    },
    { flush: 'sync' },
  )

  return { filter, next, prev, model, targets, setFilter, jump, go, goToOvertake, goToDuel }
})
