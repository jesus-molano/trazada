import { describe, expect, it } from 'vitest'
import { loadFixture } from '../../testing/fixture'
import { carTracks } from '../replay/motion'
import { ReplayModel } from '../replay/ReplayModel'
import { circuitModel } from '../track/circuit'
import {
  RANK_CHANGE_HOLD_UPDATES,
  RANK_CHANGE_TTL_MS,
  type RankChange,
  RankChangeTracker,
  rankedOrder,
  rankEligible,
  type RankRow,
} from './changes'
import { LeaderboardEngine } from './leaderboard'

/** Filas en el orden dado, con puestos 1…N conocidos y vuelta cronometrada salvo que se diga otra cosa. */
function order(cars: string[], over: Record<string, Partial<RankRow>> = {}): RankRow[] {
  return cars.map((car, i) => ({ car, position: i + 1, positionKnown: true, noSignal: false, bestLapMs: 90_000, ...over[car] }))
}

/** El mismo orden en `n` actualizaciones seguidas (un cambio se confirma al mantenerse). */
function hold(tr: RankChangeTracker, rows: RankRow[], now: number, n = RANK_CHANGE_HOLD_UPDATES): RankChange[] {
  const out: RankChange[] = []
  for (let i = 0; i < n; i++) out.push(...tr.update(rows, now + i * 150))
  return out
}

const deltas = (changes: Iterable<RankChange>) => Object.fromEntries([...changes].map((c) => [c.car, c.delta]))

describe('RankChangeTracker: flechas entre dos órdenes calculados seguidos', () => {
  it('un adelantamiento: +1 para quien pasa y −1 para quien es pasado, con el puesto nuevo', () => {
    const tr = new RankChangeTracker({ race: true })
    tr.reset(order(['VER', 'NOR', 'LEC', 'PIA']))
    const got = hold(tr, order(['VER', 'LEC', 'NOR', 'PIA']), 1000)
    expect(deltas(got)).toEqual({ LEC: 1, NOR: -1 })
    expect(tr.active.get('LEC')).toMatchObject({ delta: 1, position: 2 })
    expect(tr.active.get('NOR')).toMatchObject({ delta: -1, position: 3 })
    expect(tr.active.has('VER')).toBe(false)
  })

  it('varios puestos de golpe (una parada): −3 y +1 para cada uno de los que pasan', () => {
    const tr = new RankChangeTracker({ race: true })
    tr.reset(order(['A', 'B', 'C', 'D', 'E']))
    expect(deltas(hold(tr, order(['A', 'C', 'D', 'E', 'B']), 0))).toEqual({ B: -3, C: 1, D: 1, E: 1 })
  })

  it('un vaivén de una sola actualización (la torre) no deja flecha', () => {
    const tr = new RankChangeTracker({ race: true })
    const base = order(['VER', 'NOR', 'LEC'])
    tr.reset(base)
    expect(tr.update(order(['NOR', 'VER', 'LEC']), 0)).toEqual([])
    expect(tr.update(base, 150)).toEqual([])
    expect(tr.update(base, 300)).toEqual([])
    expect(tr.active.size).toBe(0)
  })

  it('el cambio se confirma en la actualización número `hold`, no antes', () => {
    const tr = new RankChangeTracker({ race: true, hold: 3 })
    tr.reset(order(['A', 'B']))
    const next = order(['B', 'A'])
    expect(tr.update(next, 0)).toEqual([])
    expect(tr.update(next, 150)).toEqual([])
    expect(deltas(tr.update(next, 300))).toEqual({ B: 1, A: -1 })
    // Ya confirmado: el mismo orden después no repite flechas.
    expect(tr.update(next, 450)).toEqual([])
  })

  it('tras un salto (reset) no hay flechas: el orden nuevo es la referencia, aunque sea muy distinto', () => {
    const tr = new RankChangeTracker({ race: true })
    tr.reset(order(['A', 'B', 'C']))
    hold(tr, order(['B', 'A', 'C']), 0)
    expect(tr.active.size).toBe(2)
    expect(tr.reset(order(['C', 'B', 'A']))).toBe(true)
    expect(tr.active.size).toBe(0)
    expect(hold(tr, order(['C', 'B', 'A']), 1000)).toEqual([])
    // Un cambio a medio confirmar antes del salto tampoco se arrastra.
    tr.update(order(['B', 'C', 'A']), 2000)
    tr.reset(order(['C', 'B', 'A']))
    expect(tr.update(order(['B', 'C', 'A']), 2150)).toEqual([])
  })

  it('posición sin dato («—»): nunca gana ni pierde puestos, ni al aparecer ni al desaparecer', () => {
    const tr = new RankChangeTracker({ race: true })
    tr.reset(order(['A', 'B', 'C'], { C: { positionKnown: false } }))
    // C pasa de «—» a P1 (su primer paso por meta): no es una ganancia. A y B sí bajan un puesto.
    expect(deltas(hold(tr, order(['C', 'A', 'B']), 0))).toEqual({ A: -1, B: -1 })
    // A pasa a «—» en otro puesto de la lista: sin flecha para A, y pierde al momento la que tenía.
    const v = tr.version
    expect(tr.update(order(['C', 'B', 'A'], { A: { positionKnown: false } }), 1000)).toEqual([])
    expect(tr.active.has('A')).toBe(false)
    expect(tr.version).toBeGreaterThan(v)
    expect(deltas(tr.update(order(['C', 'B', 'A'], { A: { positionKnown: false } }), 1150))).toEqual({ B: 1 })
  })

  it('posición 0 (la torre no lo incluye) cuenta como sin dato', () => {
    const tr = new RankChangeTracker({ race: true })
    const rows = order(['A', 'B'])
    tr.reset([rows[0]!, { ...rows[1]!, position: 0 }])
    expect(hold(tr, order(['B', 'A']), 0).map((c) => c.car)).toEqual(['A'])
  })

  it('sin señal: su fila no lleva flecha (no se ha visto qué pasó)', () => {
    const tr = new RankChangeTracker({ race: true })
    tr.reset(order(['A', 'B', 'C']))
    expect(deltas(hold(tr, order(['A', 'C', 'B'], { B: { noSignal: true } }), 0))).toEqual({ C: 1 })
    expect(tr.active.has('B')).toBe(false)
    // Al volver la señal en el mismo puesto, tampoco: no hubo un cambio visto.
    expect(hold(tr, order(['A', 'C', 'B']), 1000)).toEqual([])
  })

  it('version solo crece cuando cambian las flechas vigentes', () => {
    const tr = new RankChangeTracker({ race: true })
    tr.reset(order(['A', 'B']))
    const v0 = tr.version
    hold(tr, order(['A', 'B']), 0)
    expect(tr.version).toBe(v0)
    hold(tr, order(['B', 'A']), 200)
    const v1 = tr.version
    expect(v1).toBeGreaterThan(v0)
    expect(tr.expire(201)).toBe(false)
    expect(tr.version).toBe(v1)
    tr.reset(order(['B', 'A']))
    expect(tr.version).toBeGreaterThan(v1)
  })

  it('libres y clasificación: la primera vuelta cronometrada no cuenta (de último a P1 no es adelantar)', () => {
    const tr = new RankChangeTracker({ race: false })
    tr.reset(order(['A', 'B', 'C'], { C: { bestLapMs: null } }))
    // C marca su primera vuelta y salta a P1: sin flecha para C; A y B sí pierden un puesto en el orden.
    expect(deltas(hold(tr, order(['C', 'A', 'B']), 0))).toEqual({ A: -1, B: -1 })
    // Después, C mejora y gana o pierde puestos con normalidad.
    expect(deltas(hold(tr, order(['A', 'C', 'B']), 5000))).toEqual({ A: 1, C: -1 })
  })

  it('en carrera, la mejor vuelta no importa: cuenta cualquier puesto conocido', () => {
    const tr = new RankChangeTracker({ race: true })
    tr.reset(order(['A', 'B'], { A: { bestLapMs: null }, B: { bestLapMs: null } }))
    expect(deltas(hold(tr, order(['B', 'A'], { A: { bestLapMs: null }, B: { bestLapMs: null } }), 0))).toEqual({ B: 1, A: -1 })
  })

  it('rankEligible resume las reglas', () => {
    const r = order(['A'])[0]!
    expect(rankEligible(r, true)).toBe(true)
    expect(rankEligible({ ...r, positionKnown: false }, true)).toBe(false)
    expect(rankEligible({ ...r, position: 0 }, true)).toBe(false)
    expect(rankEligible({ ...r, noSignal: true }, true)).toBe(false)
    expect(rankEligible({ ...r, bestLapMs: null }, true)).toBe(true)
    expect(rankEligible({ ...r, bestLapMs: null }, false)).toBe(false)
  })

  it('cambios seguidos en el mismo sentido se suman; en sentido contrario, manda el último', () => {
    const tr = new RankChangeTracker({ race: true })
    tr.reset(order(['A', 'B', 'C', 'D']))
    hold(tr, order(['A', 'B', 'D', 'C']), 0)
    hold(tr, order(['A', 'D', 'B', 'C']), 500)
    expect(tr.active.get('D')).toMatchObject({ delta: 2, position: 2 })
    expect(tr.active.get('C')).toMatchObject({ delta: -1, position: 4 })
    // B recupera el puesto: D pierde uno (sustituye al +2) y B gana uno (sustituye al −1).
    hold(tr, order(['A', 'B', 'D', 'C']), 1000)
    expect(tr.active.get('D')).toMatchObject({ delta: -1, position: 3 })
    expect(tr.active.get('B')).toMatchObject({ delta: 1, position: 2 })
  })

  it('las flechas caducan RANK_CHANGE_TTL_MS después de su último cambio; nextExpiry dice cuándo', () => {
    const tr = new RankChangeTracker({ race: true })
    tr.reset(order(['A', 'B', 'C']))
    expect(tr.nextExpiry()).toBeNull()
    hold(tr, order(['B', 'A', 'C']), 0)
    const at = tr.active.get('B')!.at
    expect(tr.nextExpiry()).toBe(at + RANK_CHANGE_TTL_MS)
    expect(tr.expire(at + RANK_CHANGE_TTL_MS - 1)).toBe(false)
    expect(tr.active.size).toBe(2)
    expect(tr.expire(at + RANK_CHANGE_TTL_MS)).toBe(true)
    expect(tr.active.size).toBe(0)
    expect(tr.nextExpiry()).toBeNull()
  })

  it('cada cambio confirmado tiene un `seq` mayor (clave del destello)', () => {
    const tr = new RankChangeTracker({ race: true })
    tr.reset(order(['A', 'B', 'C']))
    const first = hold(tr, order(['B', 'A', 'C']), 0)
    const second = hold(tr, order(['B', 'C', 'A']), 1000)
    const seqs = [...first, ...second].map((c) => c.seq)
    expect(new Set(seqs).size).toBe(seqs.length)
    expect(Math.min(...second.map((c) => c.seq))).toBeGreaterThan(Math.max(...first.map((c) => c.seq)))
  })

  it('un coche que entra en la lista sin referencia no lleva flecha', () => {
    const tr = new RankChangeTracker({ race: true })
    tr.reset(order(['A', 'B']))
    expect(deltas(hold(tr, order(['C', 'A', 'B']), 0))).toEqual({ A: -1, B: -1 })
  })

  it('rankedOrder: solo los puestos conocidos, en el orden de la lista', () => {
    expect(rankedOrder(order(['A', 'B', 'C'], { B: { positionKnown: false } }))).toEqual(['A', 'C'])
    expect(rankedOrder(order(['A', 'B'], { A: { position: 0 } }))).toEqual(['B'])
  })
})

describe('RankChangeTracker con el fixture (Spa, libres 1)', () => {
  /** Reproducción continua a ×1 con la cadencia del leaderboard (150 ms): cambios confirmados en la ventana. */
  async function playback(race: boolean, zeroTower: boolean) {
    const s = await loadFixture()
    const model = new ReplayModel(carTracks(s.motion, s.tangents), circuitModel(s.circuit), s.manifest.drivers)
    const st = s.timing.tables.stream!
    const timing = zeroTower
      ? { ...s.timing, tables: { ...s.timing.tables, stream: { rows: st.rows, columns: { ...st.columns, position: new Uint8Array(st.rows) } } } }
      : s.timing
    const lb = new LeaderboardEngine(race ? 'race' : s.manifest.session.type, timing, s.events, s.manifest.drivers)
    const { startMs, endMs } = s.manifest.session.playback
    const tr = new RankChangeTracker({ race: lb.race })
    const confirmed: (RankChange & { t: number })[] = []
    for (let t = startMs; t <= endMs; t += 150) {
      model.update(t)
      const rows = lb.compute(t, model.states)
      if (t === startMs) tr.reset(rows)
      else for (const c of tr.update(rows, t - startMs)) confirmed.push({ ...c, t })
    }
    return confirmed
  }

  it('libres con torre: el orden oficial no cambia en la ventana del fixture, así que ninguna flecha', async () => {
    expect(await playback(false, false)).toEqual([])
  })

  it('servido como carrera sin torre (datos sintéticos del e2e): el orden en la línea cambia y hay flechas', async () => {
    const changes = await playback(true, true)
    expect(changes.length).toBeGreaterThan(10)
    // El caso que usa tests/e2e/leaderboard.spec.ts: el 55 pasa al 12 por el primer puesto al cruzar la línea.
    const pass = changes.filter((c) => c.t > 4_250_000 && c.t < 4_251_000)
    expect(deltas(pass)).toEqual({ '55': 1, '12': -1 })
    expect(pass.find((c) => c.car === '55')!.position).toBe(1)
    // Ninguna flecha sale de una posición desconocida ni deja un puesto fuera de la lista.
    for (const c of changes) expect(c.position).toBeGreaterThan(0)
  })
})
