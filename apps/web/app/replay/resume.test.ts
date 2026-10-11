import type { Catalog, Manifest, SessionEvents } from '@trazada/schema'
import { describe, expect, it, vi } from 'vitest'
import type { LoadedSession } from '../data/types'
import { SessionClock } from '../engine/clock/SessionClock'
import { buildTimelineMarkers } from '../engine/timeline/markers'
import { VERSION_FIELD } from '../stores/persisted'
import { fakeTrzb } from '../testing/fixture'
import {
  continueItems,
  createResumeSaver,
  createResumeStore,
  parseTimeParam,
  planResume,
  relativeTime,
  RESUME_DEBOUNCE_MS,
  RESUME_KEY,
  RESUME_MAX,
  RESUME_SAVE_EVERY_MS,
  RESUME_VERSION,
  type ResumeEntry,
  resumeAt,
  resumeEntry,
  resumeInfo,
  type ResumeSessionInfo,
  type ResumeTimers,
  resumeVerdict,
  saveResume,
  shiftT0,
  trackResume,
  validResumeEntry,
} from './resume'

/** localStorage mínimo en memoria. */
function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial))
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  }
}

const FP1 = '2026/10-spa-francorchamps/fp1'
const RACE = '2026/10-spa-francorchamps/race'
const T0 = '2026-07-17T11:16:23.172Z'

const entry = (over: Partial<ResumeEntry> = {}): ResumeEntry => ({
  id: FP1,
  t: 4_430_000,
  car: '1',
  follow: true,
  rate: 4,
  savedAt: 1_000,
  t0Utc: T0,
  startMs: 4_230_000,
  endMs: 4_770_000,
  event: 'Belgian Grand Prix',
  lap: null,
  totalLaps: null,
  clockMs: 200_000,
  ...over,
})

const target = {
  t0Utc: T0,
  startMs: 4_230_000,
  endMs: 4_770_000,
  defaultMs: 4_230_000,
  cars: ['1', '44', '81'],
}

describe('almacén de reanudar (D41)', () => {
  it('ida y vuelta, con versión, en trazada.resume', () => {
    const storage = memoryStorage()
    const store = createResumeStore({ storage: () => storage })
    expect(store.list()).toEqual([])
    store.put(entry())
    expect(store.get(FP1)).toEqual(entry())
    expect(store.get(RACE)).toBeNull()
    const raw = JSON.parse(storage.getItem(RESUME_KEY)!)
    expect(raw[VERSION_FIELD]).toBe(RESUME_VERSION)
    expect(raw.sessions).toEqual([entry()])
    store.forget(FP1)
    expect(store.list()).toEqual([])
  })

  it('JSON roto, otra versión o algo que no es una lista: vacío, sin lanzar', () => {
    for (const raw of ['{roto', '[]', '{"sessions":{}}', `{"sessions":[1,2],"${VERSION_FIELD}":1}`, `{"sessions":[]}`]) {
      const store = createResumeStore({ storage: () => memoryStorage({ [RESUME_KEY]: raw }) })
      expect(store.list(), raw).toEqual([])
    }
    const other = JSON.stringify({ sessions: [entry()], [VERSION_FIELD]: RESUME_VERSION + 1 })
    expect(createResumeStore({ storage: () => memoryStorage({ [RESUME_KEY]: other }) }).list()).toEqual([])
    const blocked = createResumeStore({
      storage: () => {
        throw new DOMException('bloqueado', 'SecurityError')
      },
    })
    expect(blocked.list()).toEqual([])
    expect(() => blocked.put(entry())).not.toThrow()
    expect(() => blocked.forget(FP1)).not.toThrow()
  })

  it('LRU: la última guardada va primera, refrescar no duplica y se poda a 20', () => {
    const storage = memoryStorage()
    const store = createResumeStore({ storage: () => storage })
    for (let i = 1; i <= RESUME_MAX + 1; i++) {
      store.put(entry({ id: `2026/${String(i).padStart(2, '0')}-x/race`, savedAt: i }))
    }
    let ids = store.list().map((e) => e.id)
    expect(ids).toHaveLength(RESUME_MAX)
    expect(ids[0]).toBe('2026/21-x/race')
    expect(ids).not.toContain('2026/01-x/race') // la más antigua sale
    store.put(entry({ id: '2026/05-x/race', savedAt: 100 }))
    ids = store.list().map((e) => e.id)
    expect(ids).toHaveLength(RESUME_MAX)
    expect(ids[0]).toBe('2026/05-x/race')
    expect(ids.filter((id) => id === '2026/05-x/race')).toHaveLength(1)
  })

  it('olvidar lo que no está no escribe', () => {
    const storage = memoryStorage()
    const setItem = vi.spyOn(storage, 'setItem')
    createResumeStore({ storage: () => storage }).forget(FP1)
    expect(setItem).not.toHaveBeenCalled()
  })

  it('valida campo a campo: id inválido, tiempos rotos o sin reloj → fuera; lo accesorio, a su valor neutro', () => {
    expect(validResumeEntry(entry())).toEqual(entry())
    for (const bad of [
      { id: '../../etc/passwd' },
      { id: '2026/10-spa/fp9' },
      { t: Number.NaN },
      { t: '4430000' },
      { endMs: 4_230_000 },
      { savedAt: null },
      { clockMs: undefined },
      { t0Utc: 7 },
    ]) {
      expect(validResumeEntry({ ...entry(), ...bad }), JSON.stringify(bad)).toBeNull()
    }
    expect(validResumeEntry(null)).toBeNull()
    expect(validResumeEntry([entry()])).toBeNull()
    const loose = validResumeEntry({ ...entry(), car: 44, follow: 'sí', rate: 3, lap: 0, totalLaps: -2, event: 5 })
    expect(loose).toMatchObject({ car: null, follow: false, rate: 1, lap: null, totalLaps: null, event: '' })
    // Sin coche no hay seguimiento.
    expect(validResumeEntry({ ...entry(), car: null, follow: true })!.follow).toBe(false)
  })

  it('una entrada repetida (otra mano) cuenta una vez: la más reciente', () => {
    const raw = JSON.stringify({ sessions: [entry({ savedAt: 1 }), entry({ savedAt: 9, t: 4_500_000 })], [VERSION_FIELD]: 1 })
    const list = createResumeStore({ storage: () => memoryStorage({ [RESUME_KEY]: raw }) }).list()
    expect(list).toHaveLength(1)
    expect(list[0]!.t).toBe(4_500_000)
  })
})

describe('qué se retoma al abrir la sesión', () => {
  it('el instante, el coche, el seguimiento y la velocidad', () => {
    expect(planResume(entry(), target)).toEqual({ t: 4_430_000, car: '1', follow: true, rate: 4 })
    expect(planResume(null, target)).toBeNull()
  })

  it('un coche que ya no está en la sesión se ignora (y el seguimiento con él)', () => {
    expect(planResume(entry({ car: '999' }), target)).toEqual({ t: 4_430_000, car: null, follow: false, rate: 4 })
  })

  it('se recorta al intervalo de reproducción', () => {
    expect(planResume(entry({ t: 1_000 }), { ...target, defaultMs: 4_300_000 })!.t).toBe(target.startMs)
    expect(planResume(entry({ t: 9e9 }), target)).toBeNull() // recortado al final: vista
  })

  it('a menos de 30 s del final cuenta como vista; junto al instante por defecto, como no empezada', () => {
    expect(planResume(entry({ t: target.endMs - 29_000 }), target)).toBeNull()
    expect(planResume(entry({ t: target.endMs - 31_000 }), target)).not.toBeNull()
    expect(planResume(entry({ t: target.defaultMs + 9_000 }), target)).toBeNull()
    expect(resumeVerdict(target.endMs, target)).toBe('watched')
    expect(resumeVerdict(target.defaultMs, target)).toBe('unstarted')
    expect(resumeVerdict(target.defaultMs + 60_000, target)).toBe('resume')
  })

  it('si la sesión se reconstruye con otro t0, el instante se corrige: t + (t0 viejo − t0 nuevo)', () => {
    expect(shiftT0(100, T0, T0)).toBe(100)
    expect(shiftT0(100_000, '2026-07-17T11:16:23.172Z', '2026-07-17T11:16:13.172Z')).toBe(110_000)
    expect(shiftT0(100_000, 'roto', T0)).toBeNull()
    const plan = planResume(entry({ t0Utc: '2026-07-17T11:16:33.172Z' }), target)
    expect(plan!.t).toBe(4_440_000)
    expect(planResume(entry({ t0Utc: 'no es una fecha' }), target)).toBeNull()
  })
})

describe('?t=', () => {
  it('ms de sesión; cualquier otra cosa, null', () => {
    expect(parseTimeParam('4430000')).toBe(4_430_000)
    expect(parseTimeParam('4430000.5')).toBe(4_430_000.5)
    expect(parseTimeParam('-1500')).toBe(-1500)
    for (const bad of [undefined, null, '', 'abc', '1e9', '12px', ['1'], 4_430_000, 'Infinity']) {
      expect(parseTimeParam(bad), String(bad)).toBeNull()
    }
  })
})

// Carrera de prueba: 3 vueltas del líder (empiezan en 1000, 91000 y 181000 ms) y salida en 1000.
const timing = fakeTrzb('timing', {
  laps: {
    car: [1, 1, 1, 44, 44],
    lap: [1, 2, 3, 1, 2],
    startMs: [1000, 91000, 181000, 1000, 92000],
    endMs: [91000, 181000, 271000, 92000, 190000],
    lapMs: [-1, 90000, 90000, -1, 98000],
    pitInMs: [-1, -1, -1, -1, -1],
    pitOutMs: [-1, -1, -1, -1, -1],
    position: [1, 1, 1, 2, 2],
    compound: [2, 2, 2, 2, 2],
    deleted: [0, 0, 0, 0, 0],
  },
})
const events: SessionEvents = { schema: 'trazada.events', schemaVersion: '1.0.0', raceControl: [], sectorFlags: [], windows: [] }

function raceSession(type: 'race' | 'fp1' = 'race', totalLaps: number | null = 44): LoadedSession {
  const manifest = {
    session: {
      season: 2026,
      round: 10,
      slug: 'spa-francorchamps',
      event: 'Belgian Grand Prix',
      type,
      t0Utc: T0,
      playback: { startMs: 0, endMs: 300_000, lightsOutMs: type === 'race' ? 1000 : null },
      totalLaps,
    },
    drivers: [{ number: '1' }, { number: '44' }],
  } as unknown as Manifest
  return { id: type === 'race' ? RACE : FP1, manifest, timing } as unknown as LoadedSession
}

function infoOf(type: 'race' | 'fp1' = 'race', totalLaps: number | null = 44): ResumeSessionInfo {
  const session = raceSession(type, totalLaps)
  return resumeInfo(session, buildTimelineMarkers(type, timing, events, 300_000), 0)
}

describe('dónde se deja (vuelta y reloj visible, como el dock)', () => {
  it('en carrera: vuelta del líder y reloj desde la salida; antes de la salida, sin vuelta', () => {
    const info = infoOf()
    expect(info.cars).toEqual(['1', '44'])
    expect(resumeAt(info, 95_000)).toEqual({ lap: 2, totalLaps: 44, clockMs: 94_000 })
    expect(resumeAt(info, 500)).toEqual({ lap: null, totalLaps: 44, clockMs: -500 })
  })

  it('en libres, sin vuelta: solo el reloj', () => {
    const info = infoOf('fp1', null)
    expect(resumeAt(info, 95_000).lap).toBeNull()
    expect(resumeAt(info, 95_000).totalLaps).toBeNull()
  })

  it('la entrada guarda el estado, la sesión y la posición; sin coche, sin seguimiento', () => {
    const e = resumeEntry(infoOf(), { t: 95_000, car: null, follow: true, rate: 2 }, 42)
    expect(e).toEqual({
      id: RACE,
      t: 95_000,
      car: null,
      follow: false,
      rate: 2,
      savedAt: 42,
      t0Utc: T0,
      startMs: 0,
      endMs: 300_000,
      event: 'Belgian Grand Prix',
      lap: 2,
      totalLaps: 44,
      clockMs: 94_000,
    })
    expect(validResumeEntry(e)).toEqual(e)
  })

  it('guardar: lo que se puede retomar se guarda; casi al final o sin empezar, se olvida', () => {
    const storage = memoryStorage()
    const store = createResumeStore({ storage: () => storage })
    const info = infoOf()
    saveResume(store, info, { t: 95_000, car: '1', follow: false, rate: 1 }, 1)
    expect(store.get(RACE)!.t).toBe(95_000)
    saveResume(store, info, { t: 290_000, car: '1', follow: false, rate: 1 }, 2)
    expect(store.get(RACE)).toBeNull()
    saveResume(store, info, { t: 95_000, car: '1', follow: false, rate: 1 }, 3)
    saveResume(store, info, { t: 3_000, car: '1', follow: false, rate: 1 }, 4)
    expect(store.get(RACE)).toBeNull()
  })
})

/** Temporizadores a mano: `advance(ms)` dispara lo que toque. */
function manualTimers() {
  let now = 0
  let seq = 0
  const pending = new Map<number, { at: number; fn: () => void }>()
  const timers: ResumeTimers = {
    now: () => now,
    setTimeout: (fn, ms) => {
      pending.set(++seq, { at: now + ms, fn })
      return seq
    },
    clearTimeout: (h) => void pending.delete(h as number),
  }
  return {
    timers,
    advance(ms: number) {
      now += ms
      for (const [h, p] of [...pending]) {
        if (p.at <= now) {
          pending.delete(h)
          p.fn()
        }
      }
    },
  }
}

describe('cuándo se guarda (nunca por frame)', () => {
  it('reproduciendo, como mucho cada 5 s', () => {
    const { timers, advance } = manualTimers()
    const save = vi.fn()
    const saver = createResumeSaver(save, timers)
    saver.tick(false)
    expect(save).not.toHaveBeenCalled()
    saver.tick(true)
    expect(save).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 49; i++) {
      advance(100) // estado grueso a 10 Hz durante 4,9 s
      saver.tick(true)
    }
    expect(save).toHaveBeenCalledTimes(1)
    advance(RESUME_SAVE_EVERY_MS - 4_900)
    saver.tick(true)
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('tras un cambio, 1 s después del último; flush guarda ya y anula lo pendiente', () => {
    const { timers, advance } = manualTimers()
    const save = vi.fn()
    const saver = createResumeSaver(save, timers)
    saver.touch()
    advance(600)
    saver.touch()
    advance(600)
    expect(save).not.toHaveBeenCalled()
    advance(RESUME_DEBOUNCE_MS)
    expect(save).toHaveBeenCalledTimes(1)
    saver.touch()
    saver.flush()
    expect(save).toHaveBeenCalledTimes(2)
    advance(5_000)
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('trackResume: seek y pausa con debounce, coarse cada 5 s; stop guarda por última vez y suelta los oyentes', () => {
    const { timers, advance } = manualTimers()
    const storage = memoryStorage()
    const store = createResumeStore({ storage: () => storage })
    const clock = new SessionClock(0, 300_000, 0)
    let coarse: ((s: { timeMs: number; playing: boolean; rate: 1 }) => void) | null = null
    const offCoarse = vi.fn()
    const rt = {
      clock,
      onCoarse: (cb: typeof coarse) => {
        coarse = cb
        return offCoarse
      },
    } as unknown as Parameters<typeof trackResume>[0]
    let car: string | null = '44'
    const tracker = trackResume(rt, infoOf(), () => ({ car, follow: true }), store, timers)

    clock.seek(95_000)
    expect(store.get(RACE)).toBeNull()
    advance(RESUME_DEBOUNCE_MS)
    expect(store.get(RACE)).toMatchObject({ t: 95_000, car: '44', follow: true, lap: 2 })

    clock.play()
    clock.tick(50) // 95 050
    coarse!({ timeMs: clock.timeMs, playing: true, rate: 1 })
    advance(5_000)
    clock.tick(100)
    coarse!({ timeMs: clock.timeMs, playing: true, rate: 1 })
    expect(store.get(RACE)!.t).toBe(95_150)

    car = null
    tracker.touch()
    tracker.stop()
    expect(store.get(RACE)).toMatchObject({ t: 95_150, car: null, follow: false })
    expect(offCoarse).toHaveBeenCalled()
    // Después de stop, nada más se guarda.
    clock.seek(150_000)
    advance(RESUME_DEBOUNCE_MS)
    tracker.flush()
    expect(store.get(RACE)!.t).toBe(95_150)
  })
})

const catalog: Catalog = {
  schema: 'trazada.catalog',
  schemaVersion: '1.0.0',
  generatedAt: '',
  seasons: [
    {
      season: 2026,
      events: [
        {
          round: 10,
          slug: 'spa-francorchamps',
          event: 'Belgian Grand Prix',
          country: 'Belgium',
          sessions: [
            { session: 'fp1', name: 'Practice 1', status: 'ok', path: `sessions/${FP1}/manifest.json` },
            { session: 'fp2', name: 'Practice 2', status: 'no-position', path: 'sessions/2026/10-spa-francorchamps/fp2/manifest.json' },
            { session: 'q', name: 'Qualifying', status: 'partial', path: 'sessions/2026/10-spa-francorchamps/q/manifest.json' },
          ],
        },
      ],
    },
  ],
}

describe('«Seguir viendo» de la portada', () => {
  it('solo las sesiones que siguen en el catálogo y se pueden reproducir, las 3 más recientes, con su progreso', () => {
    const entries = [
      entry({ id: '2026/11-nowhere/race', savedAt: 9 }), // ya no está en el catálogo
      entry({ id: '2026/10-spa-francorchamps/fp2', savedAt: 8 }), // sin posiciones
      entry({ id: FP1, savedAt: 7 }),
      entry({ id: '2026/10-spa-francorchamps/q', savedAt: 6, t: 4_230_000 }),
    ]
    const items = continueItems(entries, catalog)
    expect(items.map((i) => i.entry.id)).toEqual([FP1, '2026/10-spa-francorchamps/q'])
    expect(items[0]).toMatchObject({ season: 2026, type: 'fp1', event: 'Belgian Grand Prix', country: 'Belgium' })
    expect(items[0]!.progress).toBeCloseTo(200 / 540)
    expect(items[1]!.progress).toBe(0)
    expect(continueItems(entries, null)).toEqual([])
    expect(continueItems([], catalog)).toEqual([])
    expect(continueItems(entries, catalog, 1)).toHaveLength(1)
  })

  it('«hace cuánto», en la unidad que se lee mejor', () => {
    const min = 60_000
    expect(relativeTime(-5_000)).toEqual({ value: 0, unit: 'second' })
    expect(relativeTime(30_000)).toEqual({ value: 0, unit: 'second' })
    expect(relativeTime(5 * min)).toEqual({ value: -5, unit: 'minute' })
    expect(relativeTime(125 * min)).toEqual({ value: -2, unit: 'hour' })
    expect(relativeTime(26 * 60 * min)).toEqual({ value: -1, unit: 'day' })
    expect(relativeTime(15 * 24 * 60 * min)).toEqual({ value: -2, unit: 'week' })
    expect(relativeTime(70 * 24 * 60 * min)).toEqual({ value: -2, unit: 'month' })
    expect(relativeTime(800 * 24 * 60 * min)).toEqual({ value: -2, unit: 'year' })
  })
})
