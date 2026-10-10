/**
 * Textos que explican qué es dato y qué es modelo (auditoría de honestidad: H, J y K): que no afirmen de más,
 * que se puedan abrir con teclado y lector de pantalla, y que los avisos del pipeline lleguen a la UI.
 */
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it } from 'vitest'
import TzEstimated from '~/components/TzEstimated.vue'
import TzLeaderboard from '~/components/TzLeaderboard.vue'
import TzSceneTools from '~/components/TzSceneTools.vue'
import TzSessionNotes from '~/components/TzSessionNotes.vue'
import { SEGMENT_GAP_MS } from '~/engine/interp/hermite'
import { BLUE_FLAG_MS, type LeaderboardRow } from '~/engine/leaderboard/leaderboard'
import { TRACK_WIDTH_M } from '~/engine/track/ribbon'
import type { ReplayRuntime } from '~/replay/runtime'
import { usePlaybackStore } from '~/stores/playback'
import { useSettingsStore } from '~/stores/settings'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('«Cómo se dibuja» (qué es dato y qué es modelo)', () => {
  it('es un disclosure accesible: cerrado al empezar, se abre con el botón y Esc lo cierra devolviendo el foco', async () => {
    const w = await mountSuspended(TzSceneTools, { props: { flat: false, estimated: [] }, attachTo: document.body })
    const button = w.find('[data-testid="how-drawn"]')
    const panel = w.find('[data-testid="how-drawn-panel"]')
    expect(button.element.tagName).toBe('BUTTON')
    expect(button.text()).toMatch(/(Cómo se dibuja|How it is drawn)/)
    expect(button.attributes('aria-expanded')).toBe('false')
    expect(button.attributes('aria-controls')).toBe(panel.attributes('id'))
    expect(panel.attributes('role')).toBe('region')
    expect((panel.element as HTMLElement).style.display).toBe('none')

    await button.trigger('click')
    expect(button.attributes('aria-expanded')).toBe('true')
    expect((panel.element as HTMLElement).style.display).toBe('')

    // Esc: se cierra, el foco vuelve al botón y el evento queda atendido (no saca de la cámara de seguimiento).
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    panel.element.querySelector('li')!.dispatchEvent(esc)
    await nextTick()
    expect(esc.defaultPrevented).toBe(true)
    expect(button.attributes('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(button.element)

    // Un clic fuera también lo cierra.
    await button.trigger('click')
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await nextTick()
    expect(button.attributes('aria-expanded')).toBe('false')
  })

  it('explica lo que pone el modelo sin afirmar de más', async () => {
    const w = await mountSuspended(TzSceneTools, { props: { flat: false, estimated: [] } })
    const items = Object.fromEntries(
      w.findAll('[data-testid="how-drawn-panel"] li').map((li) => [li.attributes('data-item'), li.text()]),
    )
    expect(Object.keys(items).sort()).toEqual(
      ['car', 'centreLine', 'estimated', 'forward', 'interpolation', 'pit', 'positions', 'timing', 'width'].sort(),
    )
    expect(items.positions).toMatch(/4/)
    expect(items.interpolation).toMatch(/(interpola|interpolated)/)
    // Interpolar no cubre cualquier hueco: con más de SEGMENT_GAP_MS sin posición, el coche se oculta.
    expect(items.interpolation).toContain(`${SEGMENT_GAP_MS / 1000} s`)
    expect(items.centreLine).toMatch(/(línea central|centre line)/)
    // 30 m desde la línea central (no «una salida de pista de 30 m», que sería desde el borde).
    expect(items.centreLine).toMatch(/(30 m de la línea central|30 m from the centre line)/)
    // En boxes se dibuja sobre el pit lane, no sobre la línea central.
    expect(items.pit).toMatch(/pit lane/)
    expect(items.forward).toMatch(/(marcha atrás|backwards)/)
    expect(items.width).toContain(`${TRACK_WIDTH_M} m`)
    expect(items.width).toMatch(/(genérica|generic)/)
    expect(items.car).toMatch(/(genérico|generic)/)
    for (const text of Object.values(items)) expect(text).not.toMatch(/(posición real|real position|anchura real|real width)/)
  })
})

describe('«Cómo se dibuja» en una sesión con datos reconstruidos', () => {
  it('no presenta como dato de la fuente lo que el manifest declara estimado (sesión dev: posiciones reconstruidas)', async () => {
    const plain = await mountSuspended(TzSceneTools, { props: { flat: false, estimated: [] } })
    expect(plain.find('[data-testid="how-drawn-panel"] [data-item="sessionEstimated"]').exists()).toBe(false)

    const w = await mountSuspended(TzSceneTools, {
      props: { flat: false, estimated: ['positions', 'telemetry', 'trackStatus', 'algoNuevo'] },
    })
    const panel = w.find('[data-testid="how-drawn-panel"]')
    expect(panel.find('[data-item="sessionEstimated"]').text()).toMatch(/(no todo lo anterior|not all of the above)/)
    const caveats = Object.fromEntries(panel.findAll('[data-estimated]').map((li) => [li.attributes('data-estimated'), li.text()]))
    expect(Object.keys(caveats)).toEqual(['positions', 'telemetry', 'trackStatus', 'algoNuevo'])
    expect(caveats.positions).toMatch(/^(Estimado|Estimated)/)
    expect(caveats.positions).toMatch(/(reconstruido|reconstructed)/)
    // Un campo que esta versión no conoce también se avisa (con la explicación genérica), nunca se calla.
    expect(caveats.algoNuevo).toMatch(/(derivado|derived)/)
  })
})

describe('avisos de calidad del manifest (quality.notes)', () => {
  it('sin avisos no se pinta nada', async () => {
    for (const notes of [undefined, [], ['  ']]) {
      const w = await mountSuspended(TzSessionNotes, { props: { notes } })
      expect(w.find('[data-testid="session-notes"]').exists()).toBe(false)
    }
  })

  it('traduce los conocidos (con sus cifras en el formato del idioma) y muestra el texto original de los demás', async () => {
    const w = await mountSuspended(TzSessionNotes, {
      props: {
        notes: [
          'circuito sin curvas ni rotación oficial (MultiViewer no estaba accesible al construirlo)',
          'cierre de la línea central 2.35 m > 2 m',
          'meta desde el valor de reserva',
        ],
      },
    })
    const button = w.find('[data-testid="session-notes"]')
    // Texto corto (cabe en la cabecera a 1280 px) y nombre accesible completo que empieza por él.
    expect(button.text()).toMatch(/^3 (avisos|notes)$/)
    expect(button.attributes('aria-label')).toMatch(/^3 (avisos sobre los datos|notes on the data)$/)
    expect(button.attributes('title')).toBe(button.attributes('aria-label'))
    expect(button.attributes('aria-expanded')).toBe('false')
    await button.trigger('click')
    const items = w.findAll('[data-testid="session-notes-panel"] li')
    expect(items.map((li) => li.attributes('data-code'))).toEqual(['noCorners', 'closure', 'unknown'])
    expect(items[0]!.text()).toMatch(/(no numera las curvas|no corner numbers)/)
    expect(items[1]!.text()).toMatch(/2[.,]35 m/)
    expect(items[2]!.text()).toMatch(/(sin traducir|Untranslated)/)
    expect(items[2]!.find('[lang="es"]').text()).toBe('meta desde el valor de reserva')
  })

  it('un solo aviso, en singular', async () => {
    const w = await mountSuspended(TzSessionNotes, { props: { notes: ['Extracto recortado para tests e2e.'] } })
    const button = w.find('[data-testid="session-notes"]')
    expect(button.text()).toMatch(/^1 (aviso|note)$/)
    expect(button.attributes('aria-label')).toMatch(/^1 (aviso sobre los datos|note on the data)$/)
  })
})

describe('textos que no afirman de más', () => {
  it('separación: la fuente no dice en qué parte del ancho va el coche (no «su posición real es la línea central»)', async () => {
    const w = await mountSuspended(TzEstimated, { props: { field: 'separation' } })
    const hint = w.find('[data-testid="estimated"]').attributes('title')!
    expect(hint).toMatch(/(no indica en qué parte del ancho|does not say where across the track)/)
    expect(hint).not.toMatch(/(posición real|real position)/)
  })

  it('bandera azul: dice que se muestra unos segundos tras el mensaje', async () => {
    const driver = { number: '44', tla: 'BBB', first: '', last: '', team: '', color: '#3366FF' }
    const row: LeaderboardRow = {
      car: '44',
      driver,
      position: 1,
      gapMs: 0,
      intervalMs: null,
      lapsBehind: 0,
      lap: 10,
      compound: 'MEDIUM',
      tyreLife: 7,
      bestLapMs: null,
      inPit: false,
      noSignal: false,
      blueFlag: true,
    }
    usePlaybackStore().attach({
      clock: { timeMs: 0, rate: 1, playing: false },
      model: { states: [] },
      leaderboard: { compute: () => [row] },
      drivers: [driver],
      onFrame: () => () => {},
      onCoarse: (cb: (s: { timeMs: number; playing: boolean; rate: 1 }) => void) => {
        cb({ timeMs: 0, playing: false, rate: 1 })
        return () => {}
      },
      requestFrame: () => {},
      dispose: () => {},
    } as unknown as ReplayRuntime)
    useSettingsStore().setShowBlueFlags(true)
    const w = await mountSuspended(TzLeaderboard)
    const flag = w.find('[data-testid="blue-flag"]')
    const seconds = BLUE_FLAG_MS / 1000
    expect(flag.attributes('title')).toMatch(new RegExp(`${seconds} s`))
    expect(flag.attributes('title')).toMatch(/(tras el mensaje|after the race control message)/)
    expect(flag.find('.tz-visually-hidden').text()).toBe(flag.attributes('title'))
    usePlaybackStore().detach()
  })
})
