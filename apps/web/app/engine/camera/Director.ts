/**
 * Realización automática (ítem 9, D39): el director decide qué se ve y cuándo se corta. TS puro, sin Vue ni three;
 * el rig de cámara (TzCameraRig) le pasa el estado en cada frame y coloca la cámara según su plano.
 *
 * Qué elige:
 * - **El duelo más cerrado.** Con intervalos de la torre oficial (carrera o sprint): dos coches consecutivos de la
 *   torre, los dos a la vista y en pista, con intervalo < DUEL_MAX_MS. Puntuación = intervalo (s) + POSITION_WEIGHT_S ×
 *   posición del de delante, para que ganen los duelos de delante. Ese intervalo es la única cifra que se enseña.
 * - **Sin intervalos de la torre** (sesiones sin torre, como el fixture o las dev; y libres y clasificación, donde el
 *   intervalo de la torre es de mejor vuelta y no de distancia en pista): dos coches seguidos en pista y cerca. Se
 *   ordenan por lo que tardaría el de detrás, a su velocidad, en llegar a donde está el de delante. Esa cuenta solo
 *   sirve para elegir: nunca se enseña (el chip no da número). En carrera se usa la s acumulada, con las vueltas: un
 *   doblado no está en duelo con quien lo dobla.
 * - **Neutralizaciones**: con coche de seguridad (real o virtual), el líder de la clasificación (en carrera); con
 *   bandera roja, o sin líder a la vista, la vista general.
 * - **Sin duelo**: el líder en carrera; la vista general en el resto.
 *
 * Cuándo corta (reloj de pared, no de sesión):
 * - Un plano (los coches elegidos) dura al menos SHOT_MIN_MS, y entre dos cortes cualesquiera (también los cambios de
 *   cámara dentro de un plano) pasan al menos CUT_MIN_MS. Nunca más rápido.
 * - Cambia de duelo solo si el actual se rompe (intervalo de más de DUEL_BREAK_MS, un coche en el pit o fuera de la
 *   vista, ya no son consecutivos en la torre) o si hay otro claramente mejor (puntuación < SWITCH_RATIO × la actual).
 * - En pausa no corta. Tras un salto del reloj (`jump()`: seek), elige de cero y corta ya: la escena entera ha
 *   cambiado igualmente.
 *
 * Cámara del plano:
 * - Persecución ('chase'): detrás del coche de atrás en pista, mirando al centro de la pareja (o al líder).
 * - Fija en una curva ('corner', cornerCams.ts) cuando el coche de atrás está a CORNER_APPROACH_M o menos del vértice
 *   (y a CORNER_MIN_LEAD_M o más) y, a su velocidad y a la del reloj, se le verá pasar al menos CORNER_MIN_WALL_MS de
 *   pared; vuelve a la persecución cuando el de atrás deja el vértice CORNER_EXIT_M atrás.
 */
import type { TowerEntry } from '../leaderboard/leaderboard'
import type { NeutralKind } from '../trackstate/TrackState'

export const SHOT_MIN_MS = 7000
export const CUT_MIN_MS = 6000
export const DUEL_MAX_MS = 1000
export const DUEL_BREAK_MS = 1500
export const SWITCH_RATIO = 0.7
export const POSITION_WEIGHT_S = 0.05
/** Por debajo de esta velocidad, un coche no entra en un duelo por cercanía (parado, saliendo del garaje…). */
export const MIN_DUEL_SPEED_MPS = 12
/** Velocidad mínima con la que se convierte una distancia en tiempo (evita divisiones por casi 0). */
const MIN_TIME_SPEED_MPS = 10
export const CORNER_APPROACH_M = 250
export const CORNER_MIN_LEAD_M = 60
export const CORNER_EXIT_M = 100
export const CORNER_MIN_WALL_MS = 4000
/** Cortes recientes que se recuerdan (para depurar y para los e2e). */
const CUT_HISTORY = 16

export type ShotKind = 'duel' | 'leader' | 'overview'
/** De dónde sale un duelo: los intervalos de la torre oficial o la cercanía en pista (sin cifra). */
export type ShotBasis = 'tower' | 'proximity'
/** Por qué el plano: un duelo, una neutralización o que no hay ningún duelo cerca. */
export type ShotReason = 'duel' | 'neutral' | 'noDuel'
export type CameraKind = 'chase' | 'corner' | 'overview'

export interface DirectorCar {
  car: string
  visible: boolean
  inPit: boolean
  transition: boolean
  /** Distancia acumulada (m), con las vueltas (`CarState.s`). */
  s: number
  speedMps: number
}

export interface DirectorInput {
  /** Reloj de pared (ms): la histéresis y el ritmo de cortes van en tiempo real. */
  wallMs: number
  /** Reloj de sesión (ms). */
  timeMs: number
  /** Velocidad de reproducción (×1…×16). */
  rate: number
  /** Carrera o sprint. */
  race: boolean
  cars: readonly DirectorCar[]
  /** Torre oficial en t (`LeaderboardEngine.towerAt`); vacía sin torre. */
  tower: readonly TowerEntry[]
  /** Líder de la clasificación (posición 1 conocida), o null. Se pide solo cuando hace falta. */
  leader: () => string | null
  neutral: NeutralKind | null
  /** Longitud de la línea central (m). */
  trackLength: number
  /** s de los vértices con cámara fija (`cornerCams`), en orden. */
  corners: readonly number[]
}

export interface Shot {
  /** Sube con cada plano nuevo (otros coches u otro tipo). */
  readonly id: number
  readonly kind: ShotKind
  /** Duelo: [delante, detrás] al elegirlo; líder: [líder]; vista general: []. */
  readonly cars: readonly string[]
  readonly basis: ShotBasis | null
  readonly reason: ShotReason
  /** Neutralización vigente al elegirlo. */
  readonly neutral: NeutralKind | null
  /** Pared (ms) del corte que lo abrió. */
  readonly since: number
}

/** Lo que dice la torre ahora mismo de la pareja del plano (solo en duelos de la torre). */
export interface ShotLive {
  /** Intervalo oficial del de detrás con el de delante (ms); null sin dato o si ya no son consecutivos. */
  readonly intervalMs: number | null
  /** Posiciones oficiales [delante, detrás] y quién va delante; null sin dato. */
  readonly positions: readonly [number, number] | null
  readonly ahead: string | null
}

export interface CameraCue {
  readonly kind: CameraKind
  /** Índice de la cámara de curva (en `corners`), o −1. */
  readonly corner: number
  /** Sube con cada corte (plano nuevo o cambio de cámara). */
  readonly cut: number
}

interface Candidate {
  kind: ShotKind
  cars: string[]
  basis: ShotBasis | null
  reason: ShotReason
  neutral: NeutralKind | null
  score: number
}

const NO_LIVE: ShotLive = Object.freeze({ intervalMs: null, positions: null, ahead: null })

const onTrack = (c: DirectorCar | undefined): c is DirectorCar => !!c && c.visible && !c.inPit && !c.transition
const mod = (a: number, L: number) => ((a % L) + L) % L
const sameCars = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((c) => b.includes(c))

/**
 * Distancia en pista (m) del coche de detrás al de delante, y quién es cada uno. En carrera, con la s acumulada (un
 * doblado queda a una vuelta o más); fuera de carrera, sobre la vuelta (cada coche lleva su propia cuenta).
 */
export function trackGap(
  a: Pick<DirectorCar, 's'>,
  b: Pick<DirectorCar, 's'>,
  race: boolean,
  L: number,
): { gapM: number; aheadIsA: boolean } {
  if (race || !(L > 0)) return { gapM: Math.abs(a.s - b.s), aheadIsA: a.s >= b.s }
  const ab = mod(a.s - b.s, L) // lo que a va por delante de b
  return ab <= L / 2 ? { gapM: ab, aheadIsA: true } : { gapM: L - ab, aheadIsA: false }
}

/** Tiempo (ms) que tardaría el de detrás en recorrer el hueco a su velocidad. Solo para elegir: nunca se enseña. */
const gapTimeMs = (gapM: number, behind: DirectorCar) => (gapM / Math.max(behind.speedMps, MIN_TIME_SPEED_MPS)) * 1000

export class Director {
  /** Plano actual; null hasta la primera decisión. */
  shot: Shot | null = null
  camera: CameraCue = { kind: 'overview', corner: -1, cut: 0 }
  live: ShotLive = NO_LIVE
  /** Pared (ms) de los últimos cortes. */
  readonly cuts: number[] = []
  private lastCut = -Infinity
  private lastTime = Number.NaN
  private jumped = true
  private nextId = 1

  /** Salto del reloj (seek): la próxima decisión elige de cero y corta en el acto. */
  jump(): void {
    this.jumped = true
  }

  /** Olvida el plano (al salir de la realización). */
  reset(): void {
    this.shot = null
    this.camera = { kind: 'overview', corner: -1, cut: this.camera.cut }
    this.live = NO_LIVE
    this.cuts.length = 0
    this.lastCut = -Infinity
    this.lastTime = Number.NaN
    this.jumped = true
  }

  /**
   * Una decisión con el estado de este instante. Devuelve true si hay corte (plano nuevo o cambio de cámara): quien
   * coloca la cámara la pone en su sitio de golpe, sin vuelo.
   */
  update(input: DirectorInput): boolean {
    const fresh = this.jumped || this.shot === null || !(input.timeMs >= this.lastTime)
    const paused = !fresh && input.timeMs === this.lastTime
    this.jumped = false
    this.lastTime = input.timeMs
    const byCar = new Map(input.cars.map((c) => [c.car, c]))
    let cut = false

    if (fresh) {
      this.startShot(this.desired(input, byCar), input.wallMs)
      cut = true
    } else if (!paused) {
      const shot = this.shot!
      const wall = input.wallMs
      const next = this.desired(input, byCar)
      if (next.kind === shot.kind && sameCars(next.cars, shot.cars)) {
        // El mismo plano por otro motivo (p. ej. acaba el coche de seguridad y el líder sigue sin duelo): sin corte.
        if (next.reason !== shot.reason || next.neutral !== shot.neutral) {
          this.shot = Object.freeze({ ...shot, reason: next.reason, neutral: next.neutral })
        }
      } else if (
        wall - shot.since >= SHOT_MIN_MS &&
        wall - this.lastCut >= CUT_MIN_MS &&
        this.shouldSwitch(shot, next, input, byCar)
      ) {
        this.startShot(next, wall)
        cut = true
      }
      if (!cut) cut = this.cueCamera(input, byCar)
    }
    this.live = this.shot?.basis === 'tower' ? liveFromTower(this.shot.cars, input.tower) : NO_LIVE
    return cut
  }

  /** El coche de detrás en pista del plano (al que sigue la persecución), o null. */
  chased(cars: readonly DirectorCar[], race: boolean, L: number): DirectorCar | null {
    const shot = this.shot
    if (!shot || shot.kind === 'overview') return null
    const states = shot.cars.map((c) => cars.find((x) => x.car === c)).filter((c): c is DirectorCar => !!c?.visible)
    if (states.length === 0) return null
    if (states.length === 1 || shot.kind === 'leader') return states[0]!
    return trackGap(states[0]!, states[1]!, race, L).aheadIsA ? states[1]! : states[0]!
  }

  private startShot(c: Candidate, wall: number): void {
    this.shot = Object.freeze({
      id: this.nextId++,
      kind: c.kind,
      cars: Object.freeze([...c.cars]),
      basis: c.basis,
      reason: c.reason,
      neutral: c.neutral,
      since: wall,
    })
    this.cutTo(c.kind === 'overview' ? 'overview' : 'chase', -1, wall)
  }

  private cutTo(kind: CameraKind, corner: number, wall: number): void {
    this.camera = { kind, corner, cut: this.camera.cut + 1 }
    this.lastCut = wall
    this.cuts.push(wall)
    if (this.cuts.length > CUT_HISTORY) this.cuts.shift()
  }

  /** Lo que tocaría ver ahora, sin histéresis. */
  private desired(input: DirectorInput, byCar: ReadonlyMap<string, DirectorCar>): Candidate {
    const { neutral, race } = input
    const overview = (reason: ShotReason): Candidate => ({ kind: 'overview', cars: [], basis: null, reason, neutral, score: 0 })
    const leaderShot = (reason: ShotReason): Candidate | null => {
      const leader = race ? input.leader() : null
      return leader && onTrack(byCar.get(leader))
        ? { kind: 'leader', cars: [leader], basis: null, reason, neutral, score: 0 }
        : null
    }
    if (neutral === 'red') return overview('neutral')
    if (neutral !== null) return leaderShot('neutral') ?? overview('neutral')
    return bestDuel(input, byCar) ?? leaderShot('noDuel') ?? overview('noDuel')
  }

  private shouldSwitch(
    shot: Shot,
    next: Candidate,
    input: DirectorInput,
    byCar: ReadonlyMap<string, DirectorCar>,
  ): boolean {
    if (next.kind === shot.kind && sameCars(next.cars, shot.cars)) return false
    if (shot.kind === 'overview') return next.kind !== 'overview'
    if (shot.kind === 'leader') {
      // Se rompe si el líder ya no está en pista o es otro; un duelo (sin neutralización) gana siempre; con bandera
      // roja, a la vista general.
      if (!onTrack(byCar.get(shot.cars[0]!))) return true
      return next.kind !== 'overview' || input.neutral === 'red'
    }
    // Duelo: bajo neutralización, fuera; roto, al siguiente; si no, solo por otro claramente mejor.
    if (input.neutral !== null) return true
    const score = duelScore(shot, input, byCar)
    if (score === null) return true
    return next.kind === 'duel' && next.score < SWITCH_RATIO * score
  }

  /** Persecución ↔ cámara fija de curva dentro del plano (también cuenta como corte). */
  private cueCamera(input: DirectorInput, byCar: ReadonlyMap<string, DirectorCar>): boolean {
    const shot = this.shot
    const L = input.trackLength
    if (!shot || shot.kind === 'overview' || input.corners.length === 0 || !(L > 0)) return false
    if (input.wallMs - this.lastCut < CUT_MIN_MS) return false
    const chased = this.chased(input.cars, input.race, L)
    const cam = this.camera
    if (cam.kind === 'corner') {
      const apex = input.corners[cam.corner]
      const passed = apex === undefined || !chased ? Infinity : mod(chased.s - apex, L)
      // Pasado el vértice (o perdido de vista): vuelta a la persecución.
      if (!chased || !onTrack(byCar.get(chased.car)) || (passed > CORNER_EXIT_M && passed < L / 2)) {
        this.cutTo('chase', -1, input.wallMs)
        return true
      }
      return false
    }
    if (!onTrack(chased ?? undefined)) return false
    const sm = mod(chased!.s, L)
    let best = -1
    let ahead = Infinity
    input.corners.forEach((c, i) => {
      const d = mod(c - sm, L)
      if (d < ahead) {
        ahead = d
        best = i
      }
    })
    if (best < 0 || ahead > CORNER_APPROACH_M || ahead < CORNER_MIN_LEAD_M) return false
    const wallToExit = ((ahead + CORNER_EXIT_M) / Math.max(chased!.speedMps, 1) / Math.max(input.rate, 1e-3)) * 1000
    if (wallToExit < CORNER_MIN_WALL_MS) return false
    this.cutTo('corner', best, input.wallMs)
    return true
  }
}

/** Mejor duelo en este instante: de la torre si da intervalos (en carrera); si no, por cercanía en pista. */
function bestDuel(input: DirectorInput, byCar: ReadonlyMap<string, DirectorCar>): Candidate | null {
  const duels = towerMode(input) ? towerDuels(input, byCar) : proximityDuels(input)
  let best: Candidate | null = null
  for (const d of duels) if (!best || d.score < best.score) best = d
  return best
}

/** ¿Hay intervalos de la torre que valgan como distancia en pista? Solo en carrera (en el resto son de mejor vuelta). */
function towerMode(input: DirectorInput): boolean {
  return input.race && input.tower.some((e) => e.position > 0 && e.intervalMs !== null)
}

function towerDuels(input: DirectorInput, byCar: ReadonlyMap<string, DirectorCar>): Candidate[] {
  const ranked = input.tower.filter((e) => e.position > 0).sort((a, b) => a.position - b.position)
  const out: Candidate[] = []
  for (let i = 1; i < ranked.length; i++) {
    const ahead = ranked[i - 1]!
    const behind = ranked[i]!
    if (behind.position !== ahead.position + 1 || behind.intervalMs === null || behind.intervalMs >= DUEL_MAX_MS) continue
    if (!onTrack(byCar.get(ahead.car)) || !onTrack(byCar.get(behind.car))) continue
    out.push({
      kind: 'duel',
      cars: [ahead.car, behind.car],
      basis: 'tower',
      reason: 'duel',
      neutral: null,
      score: behind.intervalMs / 1000 + POSITION_WEIGHT_S * ahead.position,
    })
  }
  return out
}

function proximityDuels(input: DirectorInput): Candidate[] {
  const L = input.trackLength
  const on = input.cars.filter((c) => onTrack(c) && c.speedMps >= MIN_DUEL_SPEED_MPS)
  if (on.length < 2) return []
  const key = (c: DirectorCar) => (input.race || !(L > 0) ? c.s : mod(c.s, L))
  const sorted = [...on].sort((a, b) => key(b) - key(a) || a.car.localeCompare(b.car))
  const out: Candidate[] = []
  const pair = (ahead: DirectorCar, behind: DirectorCar, gapM: number) => {
    const ms = gapTimeMs(gapM, behind)
    if (ms < DUEL_MAX_MS) {
      out.push({ kind: 'duel', cars: [ahead.car, behind.car], basis: 'proximity', reason: 'duel', neutral: null, score: ms / 1000 })
    }
  }
  for (let i = 1; i < sorted.length; i++) pair(sorted[i - 1]!, sorted[i]!, key(sorted[i - 1]!) - key(sorted[i]!))
  // Fuera de carrera la vuelta es un círculo: el que acaba de pasar por la línea va delante del que está a punto.
  if (!input.race && L > 0 && sorted.length > 2) {
    const first = sorted[sorted.length - 1]!
    const last = sorted[0]!
    pair(first, last, key(first) + L - key(last))
  }
  return out
}

/** Puntuación vigente de un duelo (menor es más cerrado), o null si se ha roto. */
function duelScore(shot: Shot, input: DirectorInput, byCar: ReadonlyMap<string, DirectorCar>): number | null {
  const [a, b] = shot.cars.map((c) => byCar.get(c))
  if (!onTrack(a) || !onTrack(b)) return null
  if (shot.basis === 'tower') {
    const live = liveFromTower(shot.cars, input.tower)
    if (!live.positions || live.intervalMs === null || live.intervalMs > DUEL_BREAK_MS) return null
    return live.intervalMs / 1000 + POSITION_WEIGHT_S * live.positions[0]
  }
  const { gapM, aheadIsA } = trackGap(a, b, input.race, input.trackLength)
  const ms = gapTimeMs(gapM, aheadIsA ? b : a)
  return ms > DUEL_BREAK_MS ? null : ms / 1000
}

/** Lo que dice la torre ahora de la pareja: consecutivos (en el orden que sea) con el intervalo del de detrás. */
function liveFromTower(cars: readonly string[], tower: readonly TowerEntry[]): ShotLive {
  if (cars.length !== 2) return NO_LIVE
  const a = tower.find((e) => e.car === cars[0])
  const b = tower.find((e) => e.car === cars[1])
  if (!a || !b || a.position <= 0 || b.position <= 0 || Math.abs(a.position - b.position) !== 1) return NO_LIVE
  const [ahead, behind] = a.position < b.position ? [a, b] : [b, a]
  return { intervalMs: behind.intervalMs, positions: [ahead.position, behind.position], ahead: ahead.car }
}
