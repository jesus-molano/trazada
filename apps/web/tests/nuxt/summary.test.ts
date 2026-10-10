/**
 * Tarjeta de fin de sesión (ítem 12, D40): lo que falta dice «sin dato» (nunca un valor inventado); se abre sola solo
 * al cruzar el fin reproduciendo (no con un salto del reloj ni en el bench); Esc la cierra antes que nada; el foco no
 * sale de ella y vuelve a su sitio al cerrar; el botón del dock la reabre y desaparece al volver atrás; con movimiento
 * reducido, sin animación. El bucle de frames va a mano (requestAnimationFrame sustituido).
 */
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { DriverInfo } from '@trazada/schema'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import TzSummaryButton from '~/components/replay-dock/TzSummaryButton.vue'
import TzSessionSummary from '~/components/replay-overlays/TzSessionSummary.vue'
import { useSessionSummary } from '~/composables/useSessionSummary'
import type { LoadedSession } from '~/data/types'
import type { SessionSummary } from '~/engine/summary/sessionSummary'
import { ESC_PRIORITY, handleEscape, registerEscape } from '~/replay/keys'
import { createReplayRuntime, type ReplayRuntime } from '~/replay/runtime'
import { usePlaybackStore } from '~/stores/playback'
import { loadFixture } from '~/testing/fixture'

/** Callbacks pendientes de requestAnimationFrame (el del runtime y los de quien más lo pida, p. ej. el router). */
let pending: FrameRequestCallback[] = []
let now = 0
/** Un frame del bucle (16 ms de reloj de pared). */
function frame() {
  const cbs = pending
  pending = []
  now += 16
  for (const cb of cbs) cb(now)
}
const frames = (n: number) => {
  for (let i = 0; i < n; i++) frame()
}

let session: LoadedSession
let rt: ReplayRuntime
const unmounts: (() => void)[] = []
const offs: (() => void)[] = []

beforeEach(async () => {
  session ??= await loadFixture()
  pending = []
  now = 0
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => pending.push(cb))
  // Un runtime desechado ya no hace nada en su callback: no hace falta cancelarlo.
  vi.stubGlobal('cancelAnimationFrame', () => {})
  rt = createReplayRuntime(session)
  usePlaybackStore().attach(rt)
})
afterEach(() => {
  for (const off of offs.splice(0)) off()
  for (const u of unmounts.splice(0)) u()
  usePlaybackStore().detach()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

/** La tarjeta y su botón del dock, montados en la página (el foco necesita el documento). */
async function mountBoth(route?: string) {
  const card = await mountSuspended(TzSessionSummary, { attachTo: document.body, ...(route ? { route } : {}) })
  const button = await mountSuspended(TzSummaryButton, { attachTo: document.body })
  unmounts.push(() => card.unmount(), () => button.unmount())
  return { card, button }
}

const dialog = () => document.querySelector<HTMLElement>('[data-testid="session-summary"]')
const dockButton = () => document.querySelector<HTMLButtonElement>('[data-testid="summary-button"]')
const text = (sel: string, root: ParentNode = document) => root.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim()

/** Seek y el frame que lo atiende. */
function seek(t: number) {
  rt.clock.seek(t)
  frame()
}

describe('sin dato, nunca un valor inventado', () => {
  const driver: DriverInfo = { number: '1', tla: 'AAA', first: 'Ana', last: 'Alonso', team: 'Equipo', color: '#123456' }

  it('gap, neumáticos, paradas, tiempo en el pit lane, puesto vacío y vuelta rápida que faltan dicen «sin dato»', async () => {
    const start = rt.clock.startMs
    // Resumen de carrera hecho a mano, al principio de la reproducción (ya disponible), antes de montar nada.
    const fake: SessionSummary = {
      type: 'race',
      race: true,
      end: { t: start, source: 'data-end' },
      showMs: start,
      rows: [
        {
          position: 1,
          car: '1',
          driver,
          gapMs: 0,
          lapsBehind: 0,
          bestLapMs: null,
          laps: 30,
          stints: ['MEDIUM', 'UNKNOWN'],
          pits: [
            { lap: 12, inMs: start + 1, outMs: null, pitLaneMs: null, kind: 'stop' },
            { lap: 20, inMs: start + 2, outMs: start + 19_802, pitLaneMs: 19_800, kind: 'pass' },
          ],
        },
        { position: 2, car: '44', driver: null, gapMs: null, lapsBehind: 0, bestLapMs: null, laps: null, stints: [], pits: null },
      ],
      fastest: null,
    }
    rt.ext('summary', () => fake)
    await mountBoth()
    frame()
    await nextTick()
    expect(dockButton()).not.toBeNull()
    dockButton()!.click()
    await nextTick()
    await nextTick()
    const d = dialog()!
    expect(d.getAttribute('data-source')).toBe('data-end')
    expect(text('[data-testid="summary-basis"]')).toMatch(/(final de los datos|end of the data)/)
    expect(text('[data-testid="summary-basis"]')).toMatch(/(sanciones posteriores|later penalties)/)

    const rows = [...d.querySelectorAll<HTMLElement>('[data-testid="summary-row"]')]
    expect(rows.map((r) => r.getAttribute('data-position'))).toEqual(['1', '2', '3'])
    const [p1, p2, p3] = rows as [HTMLElement, HTMLElement, HTMLElement]
    expect(text('[data-testid="summary-value"]', p1)).toMatch(/^(Líder|Leader)$/)
    expect(text('[data-testid="summary-stop-count"]', p1)).toMatch(/^1 (parada|stop)$/)
    // Una parada sin salida conocida: su tiempo en el pit lane es «sin dato», no un número.
    expect(text('[data-testid="summary-pit-time"]', p1)).toMatch(/^[VL]12: (sin dato|no data)$/)
    expect(text('[data-testid="summary-passes"]', p1)).toMatch(/1 (paso|pit lane pass).*[VL]20: 19[,.]8 s/)
    // Un compuesto sin dato: «?» con su texto.
    expect(p1.querySelector('[title="Compuesto sin dato"], [title="Compound: no data"]')?.textContent).toBe('?')
    expect(p1.textContent).toMatch(/(Neumáticos por stint: Medio, Compuesto sin dato|Tyres by stint: Medium, Compound: no data)/)

    expect(text('[data-testid="summary-value"]', p2)).toMatch(/^(sin dato|no data)$/)
    expect(p2.querySelector('[data-testid="summary-value"]')!.classList).toContain('is-missing')
    expect(p2.textContent).toMatch(/(Neumáticos: sin dato|Tyres: no data)/)
    expect(p2.textContent).toMatch(/(Paradas: sin dato|Stops: no data)/)
    expect(p2.querySelector('.tz-summary__tla')!.textContent).toBe('44')

    expect(p3.getAttribute('data-empty')).toBe('true')
    expect(p3.textContent).toMatch(/(Posición 3: sin dato|Position 3: no data)/)
    expect(text('[data-testid="summary-fastest"]')).toMatch(/(sin dato|no data)$/)
  })

  it('libres: mejor vuelta, gap con el primero y vueltas; sin mejor vuelta ni vueltas, «sin dato»', async () => {
    const start = rt.clock.startMs
    const row = (position: number, car: string, bestLapMs: number | null, gapMs: number | null, laps: number | null) => ({
      position,
      car,
      driver: null,
      gapMs,
      lapsBehind: 0,
      bestLapMs,
      laps,
      stints: [],
      pits: null,
    })
    rt.ext('summary', (): SessionSummary => ({
      type: 'fp1',
      race: false,
      end: { t: start, source: 'finished' },
      showMs: start,
      rows: [row(1, '1', 107_070, 0, 22), row(2, '44', 107_215, 145, 20), row(3, '16', null, null, null)],
      fastest: { car: '1', driver: null, lap: 9, lapMs: 107_070, atMs: start },
    }))
    await mountBoth()
    frame()
    await nextTick()
    useSessionSummary().show()
    await nextTick()
    const d = dialog()!
    expect(d.getAttribute('data-race')).toBe('false')
    expect(text('[data-testid="summary-basis"]')).toMatch(/(al terminar la sesión|at the end of the session)/)
    const rows = [...d.querySelectorAll<HTMLElement>('[data-testid="summary-row"]')]
    const values = rows.map((r) => text('[data-testid="summary-value"]', r))
    expect(values[0]).toMatch(/^1:47[.,]070$/)
    expect(values[1]).toMatch(/^1:47[.,]215$/)
    expect(values[2]).toMatch(/^(sin dato|no data)$/)
    expect(rows[0]!.querySelector('[data-testid="summary-gap"]')).toBeNull()
    expect(text('[data-testid="summary-gap"]', rows[1])).toMatch(/^\+0[.,]145$/)
    expect(text('[data-testid="summary-gap"]', rows[2])).toMatch(/(Gap: sin dato|Gap: no data)/)
    expect(text('[data-testid="summary-laps"]', rows[0])).toMatch(/^22 (vueltas|laps)$/)
    expect(text('[data-testid="summary-laps"]', rows[2])).toMatch(/(Vueltas: sin dato|Laps: no data)/)
    expect(text('[data-testid="summary-fastest-time"]')).toMatch(/^1:47[.,]070$/)
    expect(text('[data-testid="summary-fastest"]')).toMatch(/(vuelta|lap) 9/)
  })
})

describe('cuándo aparece', () => {
  it('se abre sola al cruzar el fin reproduciendo; Esc la cierra; el botón la reabre; al volver atrás, se cierra y el botón desaparece', async () => {
    const { summary } = useSessionSummary()
    await mountBoth()
    seek(summary.showMs - 40)
    await nextTick()
    expect(dockButton()).toBeNull()
    expect(dialog()).toBeNull()

    const play = document.createElement('button')
    document.body.append(play)
    play.focus()
    rt.clock.play()
    frames(6)
    await nextTick()
    await nextTick()
    expect(rt.clock.timeMs).toBeGreaterThanOrEqual(summary.showMs)
    expect(dialog()).not.toBeNull()
    expect(document.activeElement?.getAttribute('data-testid')).toBe('summary-close')
    expect(dockButton()!.getAttribute('aria-expanded')).toBe('true')
    // Los tres primeros, los de la clasificación en ese instante.
    rt.model.update(rt.clock.timeMs)
    const lb = rt.leaderboard.compute(rt.clock.timeMs, rt.model.states).slice(0, 3).map((r) => r.car)
    expect([...dialog()!.querySelectorAll('[data-testid="summary-row"]')].map((r) => r.getAttribute('data-car'))).toEqual(lb)

    // Esc (registro de Esc): la cierra y el foco vuelve a donde estaba.
    expect(handleEscape()).toBe(true)
    await nextTick()
    expect(dialog()).toBeNull()
    expect(document.activeElement).toBe(play)

    dockButton()!.click()
    await nextTick()
    expect(dialog()).not.toBeNull()

    // Volver atrás (un seek antes del fin): se cierra y el botón desaparece.
    rt.clock.pause()
    seek(summary.showMs - 60_000)
    await nextTick()
    expect(dialog()).toBeNull()
    expect(dockButton()).toBeNull()

    // Un salto por encima del fin no la abre: solo deja el botón.
    seek(summary.showMs + 60_000)
    await nextTick()
    expect(dialog()).toBeNull()
    expect(dockButton()).not.toBeNull()
  })

  it('en el bench no se abre sola (taparía la escena que se mide), pero el botón sí la abre', async () => {
    const { summary } = useSessionSummary()
    await mountBoth('/replay?bench=1')
    seek(summary.showMs - 40)
    rt.clock.play()
    frames(6)
    await nextTick()
    expect(rt.clock.timeMs).toBeGreaterThanOrEqual(summary.showMs)
    expect(dialog()).toBeNull()
    dockButton()!.click()
    await nextTick()
    expect(dialog()).not.toBeNull()
  })
})

describe('diálogo', () => {
  async function opened() {
    const { summary, show } = useSessionSummary()
    await mountBoth()
    seek(summary.showMs + 1_000)
    show()
    await nextTick()
    await nextTick()
    return dialog()!
  }

  it('modal con nombre y descripción; Esc la cierra antes que la selección y el seguimiento', async () => {
    const d = await opened()
    expect(d.getAttribute('role')).toBe('dialog')
    expect(d.getAttribute('aria-modal')).toBe('true')
    expect(document.getElementById(d.getAttribute('aria-labelledby')!)?.textContent).toMatch(/(Resumen de la sesión|Session summary)/)
    expect(document.getElementById(d.getAttribute('aria-describedby')!)?.getAttribute('data-testid')).toBe('summary-basis')

    let followClosed = false
    offs.push(registerEscape(ESC_PRIORITY.follow, { active: () => !followClosed, run: () => (followClosed = true) }))
    handleEscape()
    await nextTick()
    expect(dialog()).toBeNull()
    expect(followClosed).toBe(false)
    handleEscape()
    expect(followClosed).toBe(true)
  })

  it('el foco no sale de la tarjeta: Tab y Mayús+Tab dan la vuelta, y un foco fuera vuelve al botón de cerrar', async () => {
    // Carrera con una parada: además del botón de cerrar, la pista «ⓘ» del tiempo en el pit lane.
    const start = rt.clock.startMs
    rt.ext('summary', (): SessionSummary => ({
      type: 'race',
      race: true,
      end: { t: start, source: 'finished' },
      showMs: start,
      rows: [
        {
          position: 1,
          car: '1',
          driver: null,
          gapMs: 0,
          lapsBehind: 0,
          bestLapMs: null,
          laps: 3,
          stints: ['SOFT', 'HARD'],
          pits: [{ lap: 1, inMs: start + 1, outMs: start + 22_001, pitLaneMs: 22_000, kind: 'stop' }],
        },
      ],
      fastest: null,
    }))
    const d = await opened()
    const focusable = [...d.querySelectorAll<HTMLElement>('button')]
    expect(focusable.map((b) => b.getAttribute('data-testid'))).toEqual(['summary-close', 'summary-pit-hint'])
    const first = focusable[0]!
    const last = focusable[focusable.length - 1]!
    last.focus()
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    last.dispatchEvent(tab)
    expect(tab.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(first)
    const back = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
    first.dispatchEvent(back)
    expect(document.activeElement).toBe(last)

    const outside = document.createElement('button')
    document.body.append(outside)
    outside.focus()
    expect(document.activeElement?.getAttribute('data-testid')).toBe('summary-close')
  })

  it('un clic fuera de la tarjeta la cierra; dentro, no', async () => {
    const d = await opened()
    d.click()
    await nextTick()
    expect(dialog()).not.toBeNull()
    document.querySelector<HTMLElement>('[data-testid="summary-scrim"]')!.click()
    await nextTick()
    expect(dialog()).toBeNull()
  })

  it('entrada suave escalonada con los tokens; con movimiento reducido, sin animación', async () => {
    const d = await opened()
    expect(d.parentElement!.classList).not.toContain('is-still')
    const steps = [...d.querySelectorAll<HTMLElement>('.tz-summary__step')].map((e) => e.style.getPropertyValue('--i'))
    expect(steps.slice(0, 3)).toEqual(['0', '1', '2'])
    useSessionSummary().close()
    for (const u of unmounts.splice(0)) u()

    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    const again = await opened()
    expect(again.parentElement!.classList).toContain('is-still')
  })
})
