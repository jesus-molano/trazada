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
import { TRAIL_SPAN_MS } from '~/engine/replay/trail'
import { MAX_SAMPLE_AGE_MS } from '~/engine/telemetry/telemetry'
import { TRACK_WIDTH_M } from '~/engine/track/ribbon'
import { WEATHER_STALE_MS } from '~/engine/weather/weather'
import type { ReplayRuntime } from '~/replay/runtime'
import { usePlaybackStore } from '~/stores/playback'
import { useSettingsStore } from '~/stores/settings'
import { testLapTable, withExt } from '~/testing/runtime'

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
      [
        'car',
        'centreLine',
        'compare',
        'drs',
        'estimated',
        'forward',
        'interpolation',
        'pit',
        'positions',
        'sectors',
        'timing',
        'trails',
        'weather',
        'width',
      ].sort(),
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
    // Lo de cada capa o herramienta (lo que el README cuenta como modelo), con las cifras del motor.
    expect(items.trails).toContain(`${TRAIL_SPAN_MS / 1000} s`)
    expect(items.trails).toContain(`${MAX_SAMPLE_AGE_MS / 1000} s`)
    expect(items.trails).toMatch(/(línea central|centre line)/)
    expect(items.drs).toMatch(/(Estimado|Estimated)/)
    expect(items.drs).toMatch(/(no son las líneas oficiales|not the official lines)/)
    expect(items.sectors).toMatch(/(tiempos oficiales|official sector times)/)
    expect(items.compare).toMatch(/(Estimado|Estimated)/)
    expect(items.compare).toMatch(/(fantasma|ghost)/)
    expect(items.weather).toContain(`${WEATHER_STALE_MS / 1000} s`)
    expect(items.weather).toMatch(/(sin interpolar|not interpolated)/)
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
          { code: 'no-corners', text: 'circuito sin curvas ni rotación oficial' },
          // Manifest anterior a los códigos: texto libre reconocido por patrón.
          'cierre de la línea central 2.35 m > 2 m',
          { code: 'nuevo-aviso' as never, text: 'meta desde el valor de reserva' },
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
    expect(items.map((li) => li.attributes('data-code'))).toEqual(['no-corners', 'centerline-not-closed', 'unknown'])
    expect(items[0]!.text()).toMatch(/(no numera las curvas|no corner numbers)/)
    expect(items[1]!.text()).toMatch(/2[.,]35 m/)
    expect(items[2]!.text()).toMatch(/(sin traducir|Untranslated)/)
    expect(items[2]!.find('[lang="es"]').text()).toBe('meta desde el valor de reserva')
  })

  it('un solo aviso, en singular', async () => {
    const w = await mountSuspended(TzSessionNotes, { props: { notes: [{ code: 'e2e-extract', text: 'Extracto recortado.' }] } })
    const button = w.find('[data-testid="session-notes"]')
    expect(button.text()).toMatch(/^1 (aviso|note)$/)
    expect(button.attributes('aria-label')).toMatch(/^1 (aviso sobre los datos|note on the data)$/)
  })
})

describe('aviso del reglamento de 2026 (en los avisos de la sesión)', () => {
  const NOTES = [
    { code: 'no-corners', text: 'circuito sin curvas ni rotación oficial' },
    { code: 'e2e-extract', text: 'Extracto recortado.' },
  ] as const

  it('una sesión de 2026 lo muestra aparte, rotulado como información, y cuenta en la cifra del botón', async () => {
    const w = await mountSuspended(TzSessionNotes, { props: { notes: NOTES, season: 2026 }, attachTo: document.body })
    const button = w.find('[data-testid="session-notes"]')
    expect(button.text()).toMatch(/^3 (avisos|notes)$/)
    expect(button.attributes('aria-label')).toMatch(/^3 (avisos sobre los datos|notes on the data)$/)
    expect(button.find('[data-icon]').attributes('data-icon')).toBe('alert')
    await button.trigger('click')
    const panel = w.find('[data-testid="session-notes-panel"]')
    // Los avisos del procesado siguen siendo los del manifest; el del reglamento va aparte, después.
    expect(panel.findAll('li').map((li) => li.attributes('data-code'))).toEqual(['no-corners', 'e2e-extract'])
    const notice = panel.find('[data-testid="regulation-notice"]')
    expect(notice.exists()).toBe(true)
    expect(notice.classes()).toContain('is-after')
    // Grupo con nombre (el título), con el icono de información con nombre propio.
    expect(notice.attributes('role')).toBe('group')
    const title = notice.find(`#${notice.attributes('aria-labelledby')}`)
    expect(title.text()).toMatch(/^(Reglamento de 2026|2026 regulations)$/)
    const icon = title.find('[data-icon="info"]')
    expect(icon.attributes('role')).toBe('img')
    expect(icon.attributes('aria-label')).toMatch(/^(Información|Information)$/)
    // Lo que falta y lo que sí se muestra, sin afirmar de más.
    const body = notice.find('.tz-notes__info-body').text()
    expect(body).toMatch(/(no hay DRS|no DRS)/)
    expect(body).toMatch(/(aerodinámica activa|active aerodynamics)/)
    expect(body).toMatch(/(modo recta o modo curva|straight or corner mode)/)
    expect(body).toMatch(/(modo adelantamiento|overtake mode)/)
    expect(body).toMatch(/Boost/)
    expect(body).toMatch(/(batería|battery)/)
    expect(body).toMatch(/(para toda la pista|track-wide)/)
    expect(body).toMatch(/(«Overtake activado»|“Overtake enabled”)/)
    expect(body).toMatch(/(línea de tiempo|timeline)/)
    // Dirección de carrera también publica el estado global del modo recta: el aviso no puede negarlo.
    expect(body).toMatch(/(«Modo recta»|“Straight mode”)/)
    expect(body).toMatch(/(lista de dirección de carrera|race control list)/)
    expect(body).not.toMatch(/\{chip\}|\{straight\}/)
  })

  it('una sesión de 2025 no lo muestra (y la cifra no cambia)', async () => {
    const w = await mountSuspended(TzSessionNotes, { props: { notes: NOTES, season: 2025 } })
    expect(w.find('[data-testid="session-notes"]').text()).toMatch(/^2 (avisos|notes)$/)
    expect(w.find('[data-testid="regulation-notice"]').exists()).toBe(false)
    // Sin temporada conocida, tampoco.
    const none = await mountSuspended(TzSessionNotes, { props: { notes: NOTES } })
    expect(none.find('[data-testid="regulation-notice"]').exists()).toBe(false)
  })

  it('2026 sin avisos del procesado: el botón sale igual, con el icono de información y solo ese aviso', async () => {
    const w = await mountSuspended(TzSessionNotes, { props: { notes: [], season: 2027 } })
    const button = w.find('[data-testid="session-notes"]')
    expect(button.text()).toMatch(/^1 (aviso|note)$/)
    expect(button.find('[data-icon]').attributes('data-icon')).toBe('info')
    const panel = w.find('[data-testid="session-notes-panel"]')
    expect(panel.find('ul').exists()).toBe(false)
    expect(panel.find('[data-testid="regulation-notice"]').classes()).not.toContain('is-after')
    // 2025 sin avisos: nada que pintar.
    const old = await mountSuspended(TzSessionNotes, { props: { notes: [], season: 2025 } })
    expect(old.find('[data-testid="session-notes"]').exists()).toBe(false)
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
      positionKnown: true,
      blueFlag: true,
    }
    usePlaybackStore().attach(withExt({
      clock: { timeMs: 0, rate: 1, playing: false },
      model: { states: [] },
      leaderboard: { compute: () => [row], lapTable: testLapTable() },
      drivers: [driver],
      onFrame: () => () => {},
      onCoarse: (cb: (s: { timeMs: number; playing: boolean; rate: 1 }) => void) => {
        cb({ timeMs: 0, playing: false, rate: 1 })
        return () => {}
      },
      requestFrame: () => {},
      dispose: () => {},
    }) as unknown as ReplayRuntime)
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
