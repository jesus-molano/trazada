import type { CatalogEvent, SessionType } from '@trazada/schema'
import { describe, expect, it } from 'vitest'
import {
  availableFrom,
  type BrowseEvent,
  type BrowseSession,
  DATA_DELAY_MIN,
  downloadable,
  featuredEvent,
  type Job,
  jobKey,
  mergeEvents,
  parseJob,
  parseSchedule,
  queueSummary,
  readyCount,
  type ScheduleEvent,
  type SessionView,
  sessionView,
} from './model'

const CATALOG: CatalogEvent[] = [
  {
    round: 3,
    slug: 'suzuka',
    event: 'Japanese Grand Prix',
    country: 'Japan',
    dateStart: '2026-03-29',
    sessions: [{ session: 'race', name: 'Race', status: 'ok', path: 'sessions/2026/03-suzuka/race/manifest.json' }],
  },
  {
    round: 99,
    slug: 'otro',
    event: 'Solo en el catálogo',
    country: 'X',
    sessions: [{ session: 'fp1', name: 'Practice 1', status: 'ok', path: 'sessions/2026/99-otro/fp1/manifest.json' }],
  },
]

const SCHEDULE: ScheduleEvent[] = [
  {
    round: 10,
    slug: 'spa-francorchamps',
    event: 'Belgian Grand Prix',
    country: 'Belgium',
    dateStart: '2026-07-17',
    sessions: [
      { session: 'fp1', startUtc: '2026-07-17T10:30:00Z' },
      { session: 'race', startUtc: '2026-07-19T13:00:00Z' },
    ],
  },
  {
    round: 3,
    slug: 'suzuka',
    event: 'Japanese Grand Prix',
    country: 'Japan',
    dateStart: '2026-03-27',
    sessions: [
      { session: 'q', startUtc: '2026-03-28T06:00:00Z' },
      { session: 'fp1', startUtc: '2026-03-27T02:30:00Z' },
    ],
  },
]

const job = (over: Partial<Job>): Job => ({
  id: '1',
  season: 2026,
  round: 10,
  session: 'fp1',
  state: 'queued',
  pct: 0,
  phase: null,
  error: null,
  result: null,
  createdAt: '2026-10-10T08:00:00.000Z',
  ...over,
})

describe('mergeEvents', () => {
  it('sin calendario, exactamente el catálogo', () => {
    const events = mergeEvents(CATALOG, null)
    expect(events.map((e) => e.key)).toEqual(['03-suzuka', '99-otro'])
    expect(events.every((e) => !e.scheduled)).toBe(true)
    expect(events[0]!.sessions[0]).toMatchObject({ session: 'race', startUtc: null })
    expect(events[0]!.dateStart).toBe('2026-03-29')
  })

  it('con calendario: une por ronda y slug, ordena sesiones y conserva lo que no casa', () => {
    const events = mergeEvents(CATALOG, SCHEDULE)
    expect(events.map((e) => e.key)).toEqual(['03-suzuka', '10-spa-francorchamps', '99-otro'])
    const suzuka = events[0]!
    expect(suzuka.scheduled).toBe(true)
    expect(suzuka.dateStart).toBe('2026-03-27') // la del calendario
    expect(suzuka.sessions.map((s) => s.session)).toEqual(['fp1', 'q', 'race'])
    expect(suzuka.sessions.find((s) => s.session === 'race')!.catalog?.status).toBe('ok')
    expect(suzuka.sessions.find((s) => s.session === 'fp1')!.catalog).toBeNull()
    expect(events[2]!.scheduled).toBe(false)
  })
})

describe('sessionView', () => {
  const NOW = Date.parse('2026-07-19T14:00:00Z') // carrera de Bélgica en curso
  const s = (session: BrowseSession['session'], startUtc: string | null, catalog: BrowseSession['catalog'] = null) =>
    ({ session, startUtc, catalog }) as BrowseSession

  it('generada → enlace; sin posiciones → no disponible', () => {
    const cat = { session: 'fp1', name: 'Practice 1', status: 'ok', path: 'sessions/2026/10-spa-francorchamps/fp1/manifest.json', bytes: 10, dev: true } as const
    expect(sessionView(s('fp1', null, cat), null, NOW, true)).toEqual({
      kind: 'link',
      to: '/replay?s=2026/10-spa-francorchamps/fp1',
      bytes: 10,
      dev: true,
    })
    expect(sessionView(s('fp1', null, { ...cat, status: 'no-position' }), null, NOW, false)).toEqual({
      kind: 'unavailable',
      reason: 'no-position',
    })
  })

  it('una entrada de catálogo con ruta no válida no se abre, pero no se atribuye a la falta de posiciones', () => {
    const bad = { session: 'fp1', name: 'Practice 1', status: 'ok', path: '../../fuera/manifest.json' } as const
    expect(sessionView(s('fp1', null, bad), null, NOW, true)).toEqual({ kind: 'unavailable', reason: 'invalid' })
  })

  it('pasada y sin generar → descargar (solo con gestor); futura o en curso → con fecha', () => {
    expect(sessionView(s('fp1', '2026-07-17T10:30:00Z'), null, NOW, true)).toEqual({ kind: 'download' })
    expect(sessionView(s('fp1', '2026-07-17T10:30:00Z'), null, NOW, false).kind).toBe('future')
    const race = sessionView(s('race', '2026-07-19T13:00:00Z'), null, NOW, true)
    expect(race).toEqual({ kind: 'future', at: Date.parse('2026-07-19T13:00:00Z') + (120 + DATA_DELAY_MIN) * 60_000 })
    expect(sessionView(s('fp1', null), null, NOW, true)).toEqual({ kind: 'download' })
  })

  it('el trabajo manda mientras está en cola o en curso; luego, el catálogo o el resultado', () => {
    const base = s('fp1', '2026-07-17T10:30:00Z')
    expect(sessionView(base, job({ state: 'queued' }), NOW, true).kind).toBe('queued')
    expect(sessionView(base, job({ state: 'running', pct: 40 }), NOW, true).kind).toBe('running')
    expect(sessionView(base, job({ state: 'error', error: { code: 'empty', message: '' } }), NOW, true).kind).toBe('error')
    expect(sessionView(base, job({ state: 'cancelled' }), NOW, true).kind).toBe('download')
    const done = job({
      state: 'done',
      result: { session: '2026/10-spa-francorchamps/fp1', status: 'ok', bytes: 5, dev: false },
    })
    expect(sessionView(base, done, NOW, true)).toMatchObject({ kind: 'link', to: '/replay?s=2026/10-spa-francorchamps/fp1' })
    const bogus = job({ state: 'done', result: { session: '../../x', status: 'ok', bytes: 5, dev: false } })
    expect(sessionView(base, bogus, NOW, true).kind).toBe('download')
    const empty = job({ state: 'done', result: { session: '2026/10-spa-francorchamps/fp1', status: 'no-position', bytes: 5, dev: false } })
    expect(sessionView(base, empty, NOW, true)).toEqual({ kind: 'unavailable', reason: 'no-position' })
  })

  it('recién descargada y sin releer el catálogo: la insignia DEV sale ya (del resultado del pipeline)', () => {
    const base = s('fp1', '2026-07-17T10:30:00Z')
    const done = job({ state: 'done', result: { session: '2026/03-suzuka/fp1', status: 'ok', bytes: 5, dev: true } })
    expect(sessionView(base, done, NOW, true)).toEqual({ kind: 'link', to: '/replay?s=2026/03-suzuka/fp1', bytes: 5, dev: true })
  })

  it('readyCount: solo las sesiones que se pueden ver (las «no disponibles» no cuentan como descargadas)', () => {
    const views: SessionView[] = [
      { kind: 'link', to: '/replay?s=2026/10-spa-francorchamps/fp1', bytes: 1, dev: false },
      { kind: 'unavailable', reason: 'no-position' },
      { kind: 'unavailable', reason: 'invalid' },
      { kind: 'download' },
      { kind: 'future', at: null },
    ]
    expect(readyCount(views)).toBe(1)
    expect(readyCount([])).toBe(0)
  })
})

describe('descargas en bloque y cola', () => {
  it('downloadable: lo pasado sin generar ni en curso; con `only`, un tipo', () => {
    const now = Date.parse('2026-08-01T00:00:00Z')
    const events = mergeEvents(CATALOG, SCHEDULE)
    const suzuka = events[0]!
    expect(downloadable(2026, suzuka, new Map(), now)).toEqual([
      { season: 2026, round: 3, session: 'fp1' },
      { season: 2026, round: 3, session: 'q' },
    ])
    const running = job({ round: 3, session: 'fp1', state: 'running' })
    expect(downloadable(2026, suzuka, new Map([[jobKey(running), running]]), now)).toEqual([
      { season: 2026, round: 3, session: 'q' },
    ])
    expect(events.flatMap((e) => downloadable(2026, e, new Map(), now, 'race'))).toEqual([
      { season: 2026, round: 10, session: 'race' },
    ])
    expect(downloadable(2026, events[2]!, new Map(), now)).toEqual([]) // fuera del calendario
  })

  it('queueSummary', () => {
    expect(queueSummary([job({ state: 'running' }), job({ state: 'queued' }), job({ state: 'done' })])).toMatchObject({
      active: 2,
      queued: 1,
    })
    expect(queueSummary([job({ state: 'error' })])).toEqual({ active: 0, queued: 0, running: null })
  })

  it('availableFrom', () => {
    expect(availableFrom({ session: 'q', startUtc: null })).toBeNull()
    expect(availableFrom({ session: 'q', startUtc: 'mañana' })).toBeNull()
  })
})

describe('validación de respuestas', () => {
  it('parseSchedule', () => {
    expect(parseSchedule({ season: 2026, events: SCHEDULE }, 2026)?.events).toHaveLength(2)
    expect(parseSchedule({ season: 2026, events: SCHEDULE }, 2025)).toBeNull()
    expect(parseSchedule({ season: 2026, events: [{ ...SCHEDULE[0], slug: '../x' }] }, 2026)).toBeNull()
    expect(parseSchedule({ season: 2026, events: [{ ...SCHEDULE[0], sessions: [{ session: 'x' }] }] }, 2026)).toBeNull()
  })

  it('parseJob normaliza y descarta lo que no encaja', () => {
    expect(parseJob({ id: '1', season: 2026, round: 3, session: 'fp1', state: 'running', pct: 140 })).toMatchObject({
      pct: 100,
      phase: null,
    })
    expect(
      parseJob({ id: '1', season: 2026, round: 3, session: 'fp1', state: 'error', error: { code: 'raro', message: 1 } })
        ?.error,
    ).toEqual({ code: 'failed', message: '' })
    expect(parseJob({ id: 1, season: 2026, round: 3, session: 'fp1', state: 'done' })).toBeNull()
    const result = (dev: unknown) =>
      parseJob({ id: '1', season: 2026, round: 3, session: 'fp1', state: 'done', result: { session: 'x', status: 'ok', dev } })
        ?.result?.dev
    expect(result(true)).toBe(true)
    expect([result(false), result('sí'), result(undefined)]).toEqual([false, false, false])
    expect(parseJob({ id: '1', season: 2026, round: 3, session: 'fp1', state: 'otro' })).toBeNull()
  })
})

describe('el Gran Premio del momento (portada)', () => {
  const ev = (round: number, sessions: [SessionType, string][]): BrowseEvent => ({
    key: `2026-${round}`,
    round,
    slug: `r${round}`,
    event: `GP ${round}`,
    country: 'X',
    scheduled: true,
    sessions: sessions.map(([session, startUtc]) => ({ session, catalog: null, startUtc })),
  })
  const singapore = ev(18, [
    ['fp1', '2026-10-09T09:30:00Z'],
    ['q', '2026-10-10T13:00:00Z'],
    ['race', '2026-10-11T12:00:00Z'],
  ])
  const austin = ev(19, [
    ['fp1', '2026-10-23T17:30:00Z'],
    ['sprint', '2026-10-24T18:00:00Z'],
    ['race', '2026-10-25T19:00:00Z'],
  ])
  const events = [singapore, austin]
  const at = (iso: string) => Date.parse(iso)

  it('entre semanas, el último que empezó; desde el día de los primeros libres, el del fin de semana', () => {
    expect(featuredEvent(events, at('2026-10-15T10:00:00'))).toEqual({ event: singapore, when: 'last' })
    // El mismo día de los primeros libres, aunque aún no hayan empezado.
    expect(featuredEvent(events, at('2026-10-23T08:00:00'))).toEqual({ event: austin, when: 'live' })
    expect(featuredEvent(events, at('2026-10-25T23:00:00'))).toEqual({ event: austin, when: 'live' })
    // Pasado el día después de la carrera, sigue siendo el último (hasta los libres del siguiente).
    expect(featuredEvent(events, at('2026-10-28T10:00:00'))).toEqual({ event: austin, when: 'last' })
  })

  it('en pretemporada, el próximo; sin fechas, ninguno; sin calendario, el primer día del catálogo', () => {
    expect(featuredEvent(events, at('2026-01-10T10:00:00'))).toEqual({ event: singapore, when: 'next' })
    expect(featuredEvent([ev(1, [['race', '']])], at('2026-10-15T10:00:00'))).toBeNull()
    const fromCatalog: BrowseEvent = { ...ev(3, []), dateStart: '2026-03-27' }
    expect(featuredEvent([fromCatalog], at('2026-03-28T12:00:00'))).toEqual({ event: fromCatalog, when: 'live' })
    expect(featuredEvent([fromCatalog], at('2026-04-10T12:00:00'))).toEqual({ event: fromCatalog, when: 'last' })
  })
})
