/**
 * Ficha de cada serie del race trace (D49) con una carrera sintética sobre el fixture (Spa 2026): NOR (1) gana todas
 * las vueltas; VER (3) va a 1,2 s; ALB (23) entra en el pit lane en su vuelta 3 y ya no cruza la línea; BOR (5) y PER
 * (11) dejan de cruzarla tras la 2. Dirección de carrera nombra a ALB tres veces (incidente, sanción y coche detenido)
 * y le muestra una bandera azul (que la ficha no cuenta). La ficha dice la posición en la línea y la diferencia con el
 * primero (con un decimal, el valor que se dibuja), el último paso por meta de un detenido, la entrada al pit lane y que
 * la fuente no dice por qué; nunca que se retiró o se estrelló. «Sin spoilers» corta todo en el instante de la pestaña.
 * Sin Canvas 2D: la ficha se abre desde la leyenda (foco del teclado) o montando la ficha sola.
 */
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import TzRaceTraceCard from '~/components/TzRaceTraceCard.vue'
import TzAnalysis from '~/components/replay-overlays/TzAnalysis.vue'
import { useAnalysis } from '~/composables/useAnalysis'
import { useReplayShortcuts } from '~/composables/useReplayShortcuts'
import type { LoadedSession } from '~/data/types'
import { raceTrace } from '~/engine/analysis/raceTrace'
import { createReplayRuntime, type ReplayRuntime } from '~/replay/runtime'
import { usePlaybackStore } from '~/stores/playback'
import { loadFixture } from '~/testing/fixture'
import { rcMessage } from '~/testing/laps'
import { type RaceCar, raceSession } from '~/testing/moments'

let fixture: LoadedSession
let rt: ReplayRuntime
let S = 0
const unmounts: (() => void)[] = []

beforeEach(async () => {
  fixture ??= await loadFixture()
  S = fixture.manifest.session.playback.startMs
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.stubGlobal('cancelAnimationFrame', () => {})
})
afterEach(() => {
  for (const u of unmounts.splice(0)) u()
  usePlaybackStore().detach()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const $$ = <T extends Element = HTMLElement>(sel: string) => [...document.querySelectorAll<T>(sel)]
const settle = async () => {
  await nextTick()
  await nextTick()
}

/** La carrera: pasos por meta de NOR a S + 60, 120, 180, 240 y 300 s. */
function storyRace(base: LoadedSession): LoadedSession {
  const S = base.manifest.session.playback.startMs
  const cars: RaceCar[] = [
    { car: 1, lapMs: [60_000, 60_000, 60_000, 60_000, 60_000] },
    { car: 3, lapMs: [61_200, 60_000, 60_000, 60_000, 60_000] },
    { car: 23, lapMs: [62_000, 60_000, 60_000], each: (i) => (i === 2 ? { pitInMs: S + 175_000 } : {}) },
    { car: 5, lapMs: [63_000, 60_000] },
    { car: 11, lapMs: [64_000, 60_000] },
  ]
  return raceSession(base, cars, {
    raceControl: [
      rcMessage(S + 50_000, 'blue_flag', 'WAVED BLUE FLAG FOR CAR 23 (ALB) TIMED AT 13:05:12', ['23']),
      rcMessage(S + 100_000, 'incident', 'FIA STEWARDS: TURN 16 INCIDENT INVOLVING CARS 23 (ALB) AND 5 (BOR) NOTED', ['23', '5']),
      rcMessage(S + 150_000, 'penalty', 'FIA STEWARDS: 5 SECOND TIME PENALTY FOR CAR 23 (ALB)', ['23']),
      rcMessage(S + 190_000, 'car_stopped', 'CAR 23 (ALB) STOPPED AT TURN 7', ['23']),
    ],
  })
}

function attach(session: LoadedSession) {
  rt = createReplayRuntime(session)
  usePlaybackStore().attach(rt)
}

/** La hoja abierta (con los atajos del replay, para el Esc) y el race trace a la vista. */
async function openSheet() {
  const Shortcuts = defineComponent({
    setup() {
      useReplayShortcuts()
      return () => null
    },
  })
  const keys = await mountSuspended(Shortcuts, { attachTo: document.body })
  const sheet = await mountSuspended(TzAnalysis, { attachTo: document.body })
  unmounts.push(() => sheet.unmount(), () => keys.unmount())
  useAnalysis().show()
  await settle()
  expect($('[data-testid="analysis-sheet"]')!.dataset.tab).toBe('raceTrace')
}

const card = () => $('[data-testid="analysis-card"]')!
const key = (car: string) => $<HTMLButtonElement>(`[data-testid="race-trace-chart"] [data-testid="analysis-legend-item"][data-car="${car}"]`)!

/** Ficha de un coche desde la leyenda, con el foco del teclado. */
async function focusKey(car: string) {
  key(car).focus()
  await settle()
  expect(card().dataset.shown).toBe('true')
  expect(card().dataset.car).toBe(car)
}

async function mountCard(car: string, index: number, cutoffMs = Infinity, stopped = false) {
  const trace = raceTrace(rt.leaderboard.lapTable, cutoffMs)
  const w = await mountSuspended(TzRaceTraceCard, { props: { car, index, cutoffMs, trace, stopped }, attachTo: document.body })
  unmounts.push(() => w.unmount())
  return w
}

const DISHONEST = /retir|abandon|estrell|accident|crash/i

describe('ficha del race trace (D49)', () => {
  it('en la línea: posición y diferencia con el primero, con un decimal; el primero, «primero en la línea»', async () => {
    attach(storyRace(fixture))
    const ver = await mountCard('3', 2)
    expect(ver.find('[data-testid="analysis-card-lap"]').text()).toMatch(
      /^(V3: P2 en la línea, a \+1,2 s del primero|L3: P2 at the line, \+1\.2 s behind the leader)$/,
    )
    const nor = await mountCard('1', 2)
    expect(nor.find('[data-testid="analysis-card-lap"]').text()).toMatch(/^(V3: primero en la línea|L3: first across the line)$/)
    // ALB en su vuelta 4, que no cruzó: «sin paso por meta».
    const alb = await mountCard('23', 3, Infinity, true)
    expect(alb.find('[data-testid="analysis-card-lap"]').text()).toMatch(/^(V4: sin paso por meta|L4: no line crossing)$/)
    // Las cifras son las de la gráfica: el gap de la serie, en segundos y con un decimal.
    expect(raceTrace(rt.leaderboard.lapTable).series.find((s) => s.car === '3')!.gapMs[2]).toBe(1200)
  })

  it('un detenido: último paso, la entrada al pit lane, que la fuente no dice por qué y hasta dos mensajes («y 1 más»)', async () => {
    attach(storyRace(fixture))
    useAnalysis().noSpoilers.value = false
    await openSheet()
    // Con la sesión entera, ALB (V3), BOR y PER (V2) dejaron de pasar por meta.
    expect(key('23').textContent).toMatch(/(hasta|to) [VL]3/)
    await focusKey('23')
    const text = card().textContent!
    expect(card().getAttribute('role')).toBe('tooltip')
    expect($('[data-testid="analysis-card-head"]')!.textContent).toMatch(/ALB\s*· Alexander Albon/)
    expect($('[data-testid="analysis-card-last"]')!.textContent).toMatch(/^(Último paso por meta: V3\.|Last line crossing: L3\.)$/)
    expect($('[data-testid="analysis-card-pit"]')).not.toBeNull()
    expect($('[data-testid="analysis-card-after"]')!.textContent).toMatch(/la fuente no dice por qué|the source doesn't say why/)
    const rc = $$('[data-testid="analysis-card-rc"]')
    expect(rc.map((li) => li.querySelector('[lang="en"]')!.textContent)).toEqual([
      'CAR 23 (ALB) STOPPED AT TURN 7',
      'FIA STEWARDS: 5 SECOND TIME PENALTY FOR CAR 23 (ALB)',
    ])
    expect(rc[0]!.textContent).toMatch(/Coche detenido|Car stopped/)
    // Comisarios: su glifo de la columna de estado (D50), no una franja.
    expect(rc[1]!.querySelector('[data-glyph]')!.getAttribute('data-glyph')).toBe('stewards')
    expect($('[data-testid="analysis-card-rc-more"]')!.textContent).toMatch(/^(y 1 más en dirección de carrera|and 1 more in race control)$/)
    // Ni la bandera azul ni las horas del texto.
    expect(text).not.toMatch(/BLUE FLAG/)
    expect(text).not.toMatch(DISHONEST)
  })

  it('«Sin spoilers»: nada después del corte de la pestaña (ni mensajes, ni que se detuvo)', async () => {
    attach(storyRace(fixture))
    await openSheet()
    // A S + 160 s, el último paso por meta es el de PER en la 2 (S + 124 s): el corte de la pestaña.
    rt.clock.seek(S + 160_000)
    await settle()
    expect(key('23').querySelector('[data-testid="analysis-legend-until"]')).toBeNull()
    await focusKey('23')
    expect($('[data-testid="analysis-card-last"]')).toBeNull()
    expect($$('[data-testid="analysis-card-rc"]').map((li) => li.querySelector('[lang="en"]')!.textContent)).toEqual([
      'FIA STEWARDS: TURN 16 INCIDENT INVOLVING CARS 23 (ALB) AND 5 (BOR) NOTED',
    ])
    expect($('[data-testid="analysis-card-rc-more"]')).toBeNull()
    expect(card().textContent).not.toMatch(DISHONEST)
  })

  it('ninguna ficha ni la leyenda dicen que alguien se retiró, abandonó o se estrelló', async () => {
    attach(storyRace(fixture))
    useAnalysis().noSpoilers.value = false
    await openSheet()
    for (const car of ['1', '3', '23', '5', '11']) {
      await focusKey(car)
      expect(card().textContent, car).not.toMatch(DISHONEST)
    }
    expect($('[data-testid="race-trace-chart"] figcaption')!.textContent).not.toMatch(DISHONEST)
    expect($('[data-testid="race-trace"]')!.textContent).not.toMatch(DISHONEST)
  })
})
