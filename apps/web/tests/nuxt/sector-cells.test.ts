/**
 * Colores de sector (ítem 4, D34) en la clasificación (hueco leaderboard-cells) y en el panel del coche seleccionado:
 * estado de cada sector en el instante del reloj, nunca solo el color (título y texto para lectores de pantalla), el
 * aviso de que los calcula Trazada, «sin dato» y vueltas anuladas.
 */
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import TzLapInfo from '~/components/TzLapInfo.vue'
import TzLeaderboard from '~/components/TzLeaderboard.vue'
import type { LeaderboardRow } from '~/engine/leaderboard/leaderboard'
import { LEADERBOARD_CELLS } from '~/slots/leaderboard-cells'
import { usePlaybackStore } from '~/stores/playback'
import { lapDeletedMessage, type LapInput, timingBuilder } from '~/testing/laps'
import { testLapTable, withExt } from '~/testing/runtime'

/** Vuelta de `start` a `start` + S1 + S2 + S3 con esos sectores. */
function lap(start: number, sectors: [number, number, number], over: LapInput = {}): LapInput {
  const ms = sectors.reduce((a, b) => a + b, 0)
  return { startMs: start, endMs: start + ms, lapMs: ms, sectors, ...over }
}

// Coche 1: vuelta 1 (fin 100 000) con los primeros tiempos de la sesión; vuelta 2 (fin 201 000) con S1 morado y S2 y
// S3 sin mejora, anulada por dirección de carrera a los 230 000. Coche 2: vuelta 1 (fin 120 500) sin tiempo de S3.
// Coche 3 (fuera de la clasificación falsa): vuelta 1 y un registro residual de 5 s (sin paso por meta real).
const timing = timingBuilder()
  .lap(1, 1, lap(0, [30_000, 40_000, 30_000]))
  .lap(1, 2, lap(100_000, [29_000, 41_000, 31_000], { deleted: true }))
  .lap(2, 1, { startMs: 20_000, endMs: 120_500, lapMs: 100_500, sectors: [29_500, 39_000, -1] })
  .lap(3, 1, lap(0, [31_000, 41_000, 31_000]))
  .lap(3, 2, { startMs: 103_000, endMs: 108_000 })
  .build()
const raceControl = [lapDeletedMessage(230_000, '1', 101_000)]

const driver = (number: string, tla: string) => ({ number, tla, first: '', last: '', team: '', color: '#3366FF' })
const row = (car: string, tla: string, position: number): LeaderboardRow => ({
  car,
  driver: driver(car, tla),
  position,
  positionKnown: true,
  gapMs: position === 1 ? null : 500,
  intervalMs: 500,
  lapsBehind: 0,
  lap: 2,
  compound: 'SOFT',
  tyreLife: 3,
  bestLapMs: 100_000,
  inPit: false,
  noSignal: false,
  blueFlag: false,
})

/** Runtime falso con la tabla de vueltas de arriba; `seek` mueve el estado grueso del reloj (lo que leen las celdas). */
function attach(timeMs: number) {
  let push: ((s: { timeMs: number; playing: boolean; rate: 1 }) => void) | null = null
  const rows = [row('1', 'AAA', 1), row('2', 'BBB', 2)]
  const rt = withExt({
    session: {
      manifest: { session: { type: 'fp1', season: 2026, playback: { startMs: 0, endMs: 300_000 } } },
      timing,
      events: { raceControl },
    },
    clock: { timeMs, rate: 1, playing: false },
    model: { states: [] },
    leaderboard: { race: false, compute: () => rows, lapTable: testLapTable('fp1', timing, raceControl) },
    drivers: rows.map((r) => r.driver),
    onFrame: () => () => {},
    onCoarse: (cb: NonNullable<typeof push>) => {
      push = cb
      cb({ timeMs, playing: false, rate: 1 })
      return () => {}
    },
    requestFrame: () => {},
    dispose: () => {},
  })
  usePlaybackStore().attach(rt as never)
  return {
    async seek(t: number) {
      push!({ timeMs: t, playing: false, rate: 1 })
      await nextTick()
    },
  }
}

const states = (w: VueWrapper, car: string) =>
  w.findAll(`[data-car="${car}"] [data-testid="lb-sectors"] [data-sector]`).map((m) => m.attributes('data-state'))
const cell = (w: VueWrapper, car: string) => w.find(`[data-car="${car}"] [data-testid="lb-sectors"]`)

const BASIS = /(Colores calculados por Trazada con los tiempos oficiales; no son las marcas del cronometraje|Colours calculated by Trazada from the official times; they are not the timing feed's marks)/

describe('colores de sector en la clasificación (ítem 4)', () => {
  afterEach(() => usePlaybackStore().detach())

  it('es una celda del hueco leaderboard-cells, en todos los diseños, y el panel se ensancha lo que ocupa', async () => {
    const entry = LEADERBOARD_CELLS.find((c) => c.name === 'TzSectorCells')
    expect(entry?.width).toBe('22px')
    expect(entry?.presets).toEqual(['spectator', 'analysis'])
    attach(150_000)
    const w = await mountSuspended(TzLeaderboard)
    const lb = w.find('[data-testid="leaderboard"]')
    expect(lb.classes()).toContain('has-cells')
    expect(lb.attributes('style')).toContain('--lb-cells: 22px')
    expect(lb.attributes('style')).toMatch(/--lb-cells-w: calc\(22px \+ 1 \* var\(--lb-gap\)\)/)
  })

  it('morado, verde, amarillo y gris en el instante del reloj, con su texto (nunca solo el color)', async () => {
    const clock = attach(50_000)
    const w = await mountSuspended(TzLeaderboard)
    // Sin vuelta completada: las tres marcas «sin dato».
    expect(states(w, '1')).toEqual(['none', 'none', 'none'])
    expect(cell(w, '1').find('.tz-visually-hidden').text()).toMatch(/(sin vuelta completada|no completed lap)/)

    await clock.seek(150_000)
    expect(states(w, '1')).toEqual(['best', 'best', 'best'])
    // Coche 2: S1 y S2 mejoran los del coche 1 (morado); S3 sin tiempo: gris «sin dato».
    expect(states(w, '2')).toEqual(['best', 'best', 'none'])
    const c2 = cell(w, '2')
    expect(c2.attributes('data-lap')).toBe('1')
    const text = c2.find('.tz-visually-hidden').text()
    expect(text).toMatch(/S1 29[.,]500 \((mejor de la sesión al completarlo|session best when set)\)/)
    expect(text).toMatch(/S3: (sin dato|no data)/)
    // El título repite el texto y avisa de que no son las marcas del cronometraje.
    expect(c2.attributes('title')).toContain(text)
    expect(c2.attributes('title')).toMatch(BASIS)
    // Las marcas son decorativas para los lectores de pantalla: el texto va aparte.
    for (const m of c2.findAll('[data-sector]')) expect(m.attributes('aria-hidden')).toBe('true')

    // Vuelta 2 del coche 1: S1 mejora el morado del coche 2; S2 y S3 no mejoran ni su marca.
    await clock.seek(210_000)
    expect(states(w, '1')).toEqual(['best', 'normal', 'normal'])
    expect(cell(w, '1').find('.tz-visually-hidden').text()).toMatch(/S2 41[.,]000 \((sin mejora|no improvement)\)/)
    // Lo ya pintado del coche 2 no cambia aunque lo hayan mejorado.
    expect(states(w, '2')).toEqual(['best', 'best', 'none'])
  })

  it('vuelta anulada: desde el mensaje de dirección de carrera, sin color de mejora y dicho en el texto', async () => {
    const clock = attach(229_999)
    const w = await mountSuspended(TzLeaderboard)
    expect(states(w, '1')).toEqual(['best', 'normal', 'normal'])
    expect(cell(w, '1').attributes('data-deleted')).toBe('false')
    await clock.seek(230_000)
    expect(states(w, '1')).toEqual(['deleted', 'deleted', 'deleted'])
    expect(cell(w, '1').attributes('data-deleted')).toBe('true')
    expect(cell(w, '1').find('.tz-visually-hidden').text()).toMatch(/(anulada por dirección de carrera|deleted by race control)/)
  })
})

describe('colores de sector en el panel del coche seleccionado (ítem 4)', () => {
  afterEach(() => usePlaybackStore().detach())

  const sectors = (w: VueWrapper) => w.findAll('[data-testid="lap-sector"]')

  it('tiempos oficiales de la última vuelta completada con su color y su estado en texto', async () => {
    const clock = attach(150_000)
    const w = await mountSuspended(TzLapInfo, { props: { car: '2' } })
    const row = w.find('[data-testid="lap-sectors"]')
    expect(row.attributes('data-lap')).toBe('1')
    expect(row.find('dt').text()).toMatch(/^(Sectores|Sectors) \(1\)/)
    expect(sectors(w).map((s) => s.attributes('data-state'))).toEqual(['best', 'best', 'none'])
    expect(sectors(w)[0]!.text()).toMatch(/S1\s*29[.,]500/)
    expect(sectors(w)[2]!.text()).toMatch(/S3\s*—/)
    expect(sectors(w)[1]!.find('.tz-visually-hidden').text()).toMatch(/S2 39[.,]000 \((mejor de la sesión al completarlo|session best when set)\)/)
    expect(row.find('dd').attributes('title')).toMatch(BASIS)
    // La pista explica los colores (también en iPad, donde un título no se ve).
    expect(w.find('[data-testid="sectors-hint"]').attributes('aria-label')).toMatch(/(colores de sector|sector colours)/)
    expect(w.find('[data-testid="sectors-hint-panel"]').text()).toMatch(BASIS)
    // Nunca una «mejor vuelta posible».
    expect(w.text()).not.toMatch(/(mejor vuelta posible|best possible lap|ideal)/i)

    // Sin vuelta completada: la misma línea, con los tres «sin dato» (gris y «—»), y dicho en el texto.
    await clock.seek(50_000)
    expect(sectors(w).map((s) => s.attributes('data-state'))).toEqual(['none', 'none', 'none'])
    expect(sectors(w)[0]!.text()).toMatch(/S1\s*—/)
    expect(w.find('[data-testid="lap-sectors-none"]').text()).toMatch(/(sin vuelta completada|no completed lap)/)
  })

  it('el número de vuelta solo se repite si no es la de «Última vuelta» (registro residual sin paso por meta)', async () => {
    attach(150_000)
    const w = await mountSuspended(TzLapInfo, { props: { car: '2' } })
    // «Última vuelta (1)» y sus sectores: sin etiqueta propia.
    expect(w.find('[data-testid="lap-sectors"] dd').text()).not.toMatch(/^(V|L)1/)
    // Coche 3: la «última vuelta» es el registro residual (la 2) y los sectores, los de la vuelta 1, que lo dicen.
    const w3 = await mountSuspended(TzLapInfo, { props: { car: '3' } })
    expect(w3.find('[data-testid="lap-last"]').text()).toBe('—')
    expect(w3.find('[data-testid="lap-sectors"]').attributes('data-lap')).toBe('1')
    expect(w3.find('[data-testid="lap-sectors"] dd').text()).toMatch(/^(V|L)1/)
  })

  it('vuelta anulada: tiempos tachados y sin color de mejora; la insignia «Anulada», una vez', async () => {
    attach(240_000)
    const w = await mountSuspended(TzLapInfo, { props: { car: '1' } })
    expect(w.find('[data-testid="lap-sectors"]').attributes('data-lap')).toBe('2')
    expect(sectors(w).map((s) => s.attributes('data-state'))).toEqual(['deleted', 'deleted', 'deleted'])
    expect(sectors(w)[0]!.find('.is-deleted').text()).toMatch(/^29[.,]000$/)
    expect(sectors(w)[0]!.find('.tz-visually-hidden').text()).toMatch(/^S1 29[.,]000$/)
    // Es la misma vuelta que «Última vuelta (2)», que ya lleva la insignia: no se repite en los sectores.
    expect(w.find('[data-testid="lap-last-deleted"]').text()).toMatch(/^(Anulada|Deleted)$/)
    expect(w.find('[data-testid="lap-sectors-deleted"]').exists()).toBe(false)
    expect(w.find('[data-testid="lap-sectors"] dd').attributes('title')).toMatch(/(anulada por dirección de carrera|deleted by race control)/)
  })
})
