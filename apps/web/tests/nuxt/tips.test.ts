/**
 * Guía de primer uso (ítem 18) sobre el fixture (Spa 2026, libres 1): sale sola 1 s después de montarse (y no antes,
 * ni vista, ni en el bench, ni sobre un diálogo modal), sin llevarse el foco y anunciándose; «Siguiente», «Anterior» y
 * «Saltar» (se recuerda); Esc la salta; la tecla «?», el botón «?» y la paleta la abren entera y llevan el foco a ella,
 * que vuelve al cerrarla; sin ancla visible sale centrada y con ancla, a su lado; los textos para tablet; el ejemplo de
 * «Estimado» va rotulado como ejemplo y no es una etiqueta de verdad; los huecos.
 */
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import TzHelpButton from '~/components/replay-header/TzHelpButton.vue'
import TzTips, { TIPS_AUTO_DELAY_MS } from '~/components/replay-overlays/TzTips.vue'
import { commandServices } from '~/replay/commands'
import { handleEscape, runShortcut } from '~/replay/keys'
import { createReplayRuntime } from '~/replay/runtime'
import { REPLAY_HEADER, REPLAY_OVERLAYS } from '~/slots/replay'
import { usePlaybackStore } from '~/stores/playback'
import { TIP_IDS, TIPS_KEY, useTipsStore } from '~/stores/tips'
import { loadFixture } from '~/testing/fixture'
import type { LoadedSession } from '~/data/types'

/** La ruta que ve la guía (solo lee `?bench=1`): sin navegar, que con el reloj falso se cuelga. */
const route = vi.hoisted(() => ({ query: {} as Record<string, string> }))
mockNuxtImport('useRoute', () => () => route)

let fixture: LoadedSession
const unmounts: (() => void)[] = []
const cleanups: (() => void)[] = []

beforeEach(async () => {
  fixture ??= await loadFixture()
  route.query = {}
  localStorage.clear()
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  usePlaybackStore().attach(createReplayRuntime(fixture))
})
afterEach(() => {
  for (const u of unmounts.splice(0)) u()
  for (const c of cleanups.splice(0)) c()
  useTipsStore().close()
  usePlaybackStore().detach()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  localStorage.clear()
  document.body.innerHTML = ''
})

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const tip = () => $('[data-testid="tip"]')
const count = () => $('[data-testid="tip-count"]')?.textContent?.trim()
const click = async (testid: string) => {
  $(`[data-testid="${testid}"]`)!.click()
  await settle()
}
const settle = async () => {
  await nextTick()
  await nextTick()
}
const keydown = (key: string, init: KeyboardEventInit = {}) =>
  new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
const stored = () => JSON.parse(localStorage.getItem(TIPS_KEY) ?? 'null') as unknown

/** Monta la guía con el temporizador de «sale sola» en falso (se avanza a mano). */
async function mountTips() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const w = await mountSuspended(TzTips, { attachTo: document.body })
  unmounts.push(() => w.unmount())
  return w
}
async function elapse(ms: number) {
  vi.advanceTimersByTime(ms)
  await settle()
}

/** Un ancla en la página, con su rectángulo (happy-dom no maqueta) y una ventana de 1440×900. */
function anchor(testid: string, rect: { left: number; top: number; width: number; height: number }) {
  const el = document.createElement('div')
  el.dataset.testid = testid
  el.getBoundingClientRect = () => DOMRect.fromRect({ x: rect.left, y: rect.top, width: rect.width, height: rect.height })
  document.body.append(el)
  return el
}
function viewport(width: number, height: number) {
  const html = document.documentElement
  const w = Object.getOwnPropertyDescriptor(html, 'clientWidth')
  const h = Object.getOwnPropertyDescriptor(html, 'clientHeight')
  Object.defineProperty(html, 'clientWidth', { configurable: true, get: () => width })
  Object.defineProperty(html, 'clientHeight', { configurable: true, get: () => height })
  // La burbuja mide 340×200 (happy-dom no maqueta: offsetWidth sería 0).
  const ow = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')!
  const oh = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 340 })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 200 })
  cleanups.push(() => {
    if (w) Object.defineProperty(html, 'clientWidth', w)
    else delete (html as unknown as Record<string, unknown>).clientWidth
    if (h) Object.defineProperty(html, 'clientHeight', h)
    else delete (html as unknown as Record<string, unknown>).clientHeight
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', ow)
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', oh)
  })
}

describe('sale sola la primera vez', () => {
  it('1 s después de montarse, con todos los pasos, sin llevarse el foco y anunciándose', async () => {
    await mountTips()
    await elapse(TIPS_AUTO_DELAY_MS - 1)
    expect(tip()).toBeNull()
    await elapse(1)
    expect(tip()).not.toBeNull()
    expect(count()).toMatch(new RegExp(`^1 (de|of) ${TIP_IDS.length}$`))
    expect(tip()!.getAttribute('data-step')).toBe('leaderboard')
    expect(tip()!.getAttribute('role')).toBe('dialog')
    expect(tip()!.getAttribute('aria-modal')).toBe('false')
    // Nombre (guía + título) y descripción (el texto).
    const name = tip()!.getAttribute('aria-labelledby')!.split(' ').map((id) => document.getElementById(id)!.textContent)
    expect(name.join(' ')).toMatch(/^(Guía de primer uso|First-use guide) (La clasificación|The leaderboard)$/)
    expect(document.getElementById(tip()!.getAttribute('aria-describedby')!)!.textContent).toMatch(/cronometraje oficial|official timing/)
    expect(tip()!.contains(document.activeElement)).toBe(false)
    expect($('[data-testid="tips-announce"]')!.textContent).toMatch(/1 (de|of) 6/)
    // Sin «Anterior» en el primer paso.
    expect($('[data-testid="tip-prev"]')).toBeNull()
  })

  it('ya vista o con un diálogo modal abierto, no sale', async () => {
    localStorage.setItem(TIPS_KEY, JSON.stringify({ all: true }))
    await mountTips()
    await elapse(TIPS_AUTO_DELAY_MS * 2)
    expect(tip()).toBeNull()
    for (const u of unmounts.splice(0)) u()

    localStorage.clear()
    const modal = document.createElement('div')
    modal.setAttribute('aria-modal', 'true')
    document.body.append(modal)
    await mountTips()
    await elapse(TIPS_AUTO_DELAY_MS * 2)
    expect(tip()).toBeNull()
  })

  it('en el bench (`?bench=1`), no sale', async () => {
    route.query = { bench: '1' }
    await mountTips()
    await elapse(TIPS_AUTO_DELAY_MS * 2)
    expect(tip()).toBeNull()
  })
})

describe('secuencia', () => {
  it('«Siguiente» y «Anterior» recorren los pasos; cada paso visto se apunta; «Terminar» cierra', async () => {
    await mountTips()
    await elapse(TIPS_AUTO_DELAY_MS)
    await click('tip-next')
    expect(tip()!.getAttribute('data-step')).toBe('follow')
    expect(stored()).toEqual({ seen: ['leaderboard'] })
    await click('tip-prev')
    expect(tip()!.getAttribute('data-step')).toBe('leaderboard')
    for (let i = 0; i < TIP_IDS.length - 1; i++) await click('tip-next')
    expect(tip()!.getAttribute('data-step')).toBe('palette')
    expect($('[data-testid="tip-next"]')!.textContent).toMatch(/Terminar|Done/)
    await click('tip-next')
    expect(tip()).toBeNull()
    expect(stored()).toEqual({ seen: [...TIP_IDS] })
  })

  it('«Saltar» se recuerda: todos los pasos quedan vistos y no vuelve a salir', async () => {
    await mountTips()
    await elapse(TIPS_AUTO_DELAY_MS)
    await click('tip-skip')
    expect(tip()).toBeNull()
    expect(stored()).toEqual({ seen: [...TIP_IDS] })
    expect(useTipsStore().start('auto')).toBe(false)
  })

  it('Esc la salta (por el registro de Esc, con la prioridad de la guía)', async () => {
    await mountTips()
    await elapse(TIPS_AUTO_DELAY_MS)
    expect(handleEscape()).toBe(true)
    await settle()
    expect(tip()).toBeNull()
    expect(stored()).toEqual({ seen: [...TIP_IDS] })
    expect(handleEscape()).toBe(false)
  })

  it('al salir del replay a mitad, lo no visto vuelve la próxima vez', async () => {
    await mountTips()
    await elapse(TIPS_AUTO_DELAY_MS)
    await click('tip-next')
    for (const u of unmounts.splice(0)) u()
    expect(useTipsStore().open).toBe(false)
    await mountTips()
    await elapse(TIPS_AUTO_DELAY_MS)
    expect(tip()!.getAttribute('data-step')).toBe('follow')
    expect(count()).toMatch(new RegExp(`^1 (de|of) ${TIP_IDS.length - 1}$`))
  })
})

describe('a petición', () => {
  it('la tecla «?» la abre entera (aunque esté vista) con el foco en «Siguiente»; Esc la cierra y el foco vuelve', async () => {
    localStorage.setItem(TIPS_KEY, JSON.stringify({ all: true }))
    await mountTips()
    const before = document.createElement('button')
    document.body.append(before)
    before.focus()
    expect(runShortcut(keydown('?', { shiftKey: true }), false)).toBe(true)
    await settle()
    expect(tip()).not.toBeNull()
    expect(count()).toMatch(new RegExp(`^1 (de|of) ${TIP_IDS.length}$`))
    expect(document.activeElement).toBe($('[data-testid="tip-next"]'))
    // En el segundo paso, el foco sigue en «Siguiente» (el texto nuevo se anuncia).
    await click('tip-next')
    $<HTMLButtonElement>('[data-testid="tip-next"]')!.focus()
    await click('tip-prev')
    expect(document.activeElement).toBe($('[data-testid="tip-next"]'))
    expect($('[data-testid="tips-announce"]')!.textContent).toMatch(/1 (de|of) 6/)
    handleEscape()
    await settle()
    expect(tip()).toBeNull()
    expect(document.activeElement).toBe(before)
    // `{ all: true }` se queda.
    expect(stored()).toEqual({ all: true })
  })

  it('el botón «?» de la cabecera: nombre accesible, desplegado mientras está abierta; la abre y la salta', async () => {
    localStorage.setItem(TIPS_KEY, JSON.stringify({ all: true }))
    await mountTips()
    const b = await mountSuspended(TzHelpButton, { attachTo: document.body })
    unmounts.push(() => b.unmount())
    const button = $<HTMLButtonElement>('[data-testid="help-button"]')!
    expect(button.getAttribute('aria-label')).toMatch(/^(Guía de primer uso|First-use guide)$/)
    expect(button.getAttribute('aria-haspopup')).toBe('dialog')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    button.focus()
    await click('help-button')
    expect(tip()).not.toBeNull()
    expect(button.getAttribute('aria-expanded')).toBe('true')
    // Al terminar con el teclado, el foco vuelve al botón.
    handleEscape()
    await settle()
    expect(document.activeElement).toBe(button)
    expect(button.getAttribute('aria-expanded')).toBe('false')
  })

  it('la paleta: el servicio está registrado mientras la guía está montada', async () => {
    await mountTips()
    const tips = commandServices().tips!
    expect(tips.open).toBe(false)
    tips.start()
    await settle()
    expect(tip()).not.toBeNull()
    expect(useTipsStore().mode).toBe('manual')
    expect(commandServices().tips!.open).toBe(true)
    for (const u of unmounts.splice(0)) u()
    expect(commandServices().tips).toBeUndefined()
  })
})

describe('colocación', () => {
  it('sin ancla visible: centrada, sin flecha ni anillo', async () => {
    viewport(1440, 900)
    await mountTips()
    await elapse(TIPS_AUTO_DELAY_MS)
    expect(tip()!.getAttribute('data-anchored')).toBe('false')
    expect(tip()!.getAttribute('data-side')).toBe('center')
    expect(tip()!.style.left).toBe('550px')
    expect(tip()!.style.top).toBe('350px')
    expect(tip()!.querySelector('.tz-tip__arrow')).toBeNull()
    expect($('[data-testid="tip-ring"]')).toBeNull()
  })

  it('con ancla: a su lado (la clasificación, a la derecha), con flecha y anillo; al cambiar de paso, a la nueva', async () => {
    viewport(1440, 900)
    anchor('leaderboard', { left: 24, top: 60, width: 300, height: 720 })
    anchor('timeline', { left: 300, top: 820, width: 900, height: 40 })
    await mountTips()
    await elapse(TIPS_AUTO_DELAY_MS)
    expect(tip()!.getAttribute('data-anchored')).toBe('true')
    expect(tip()!.getAttribute('data-side')).toBe('right')
    expect(tip()!.querySelector('.tz-tip__arrow')).not.toBeNull()
    expect($('[data-testid="tip-ring"]')!.style.width).toBe('308px')
    // Paso 2 («Seguir»): sin coche elegido no hay botón, centrada.
    await click('tip-next')
    await settle()
    expect(tip()!.getAttribute('data-side')).toBe('center')
    // Al elegir un coche aparece «Seguir»: se recoloca junto a él.
    anchor('follow-toggle', { left: 1200, top: 70, width: 80, height: 28 })
    usePlaybackStore().selectCar(fixture.manifest.drivers[0]!.number)
    await settle()
    await settle()
    expect(tip()!.getAttribute('data-side')).toBe('bottom')
    // Paso 3: el timeline, abajo: encima.
    await click('tip-next')
    await settle()
    expect(tip()!.getAttribute('data-side')).toBe('top')
  })

  it('un ancla oculta (display: none) no cuenta: el paso de comandos usa el botón «?» si la lupa no se ve', async () => {
    viewport(1440, 900)
    const lens = anchor('palette-button', { left: 700, top: 840, width: 32, height: 32 })
    lens.style.display = 'none'
    anchor('help-button', { left: 1100, top: 12, width: 28, height: 28 })
    useTipsStore().start('manual')
    await mountTips()
    await settle()
    for (let i = 0; i < TIP_IDS.length - 1; i++) await click('tip-next')
    await settle()
    expect(tip()!.getAttribute('data-step')).toBe('palette')
    expect(tip()!.getAttribute('data-side')).toBe('bottom')
    expect(tip()!.style.left).toBe(`${1114 - 170}px`)
  })
})

describe('textos', () => {
  it('con ratón: clic, ↑/↓ y el paso del reloj de las flechas', async () => {
    await mountTips()
    await elapse(TIPS_AUTO_DELAY_MS)
    expect(tip()!.textContent).toMatch(/Haz clic|Click a driver/)
    await click('tip-next')
    await click('tip-next')
    expect(tip()!.textContent).toMatch(/← (y|and) → (mueven|move) 5 s/)
  })

  it('en tablet (puntero grueso o sin hover): tocar, doble toque, dos dedos y la lupa', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('coarse'), media: q, addEventListener() {}, removeEventListener() {} }))
    await mountTips()
    await elapse(TIPS_AUTO_DELAY_MS)
    expect(tip()!.textContent).toMatch(/Toca un piloto|Tap a driver/)
    await click('tip-next')
    expect(tip()!.textContent).toMatch(/doble toque|double-tapping/)
    await click('tip-next')
    expect(tip()!.textContent).toMatch(/Dos dedos|Two fingers/)
    for (let i = 0; i < 3; i++) await click('tip-next')
    expect(tip()!.textContent).toMatch(/lupa del dock|magnifier in the dock/)
  })

  it('«Estimado»: un ejemplo rotulado como ejemplo, que no es una etiqueta de verdad', async () => {
    await mountTips()
    await elapse(TIPS_AUTO_DELAY_MS)
    for (let i = 0; i < 3; i++) await click('tip-next')
    expect(tip()!.getAttribute('data-step')).toBe('estimated')
    const example = tip()!.querySelector('[data-testid="tip-example"]')!
    expect(example.tagName).toBe('FIGURE')
    expect(example.querySelector('figcaption')!.textContent).toMatch(/^(Ejemplo: no es un dato de esta sesión|Example: not data from this session)$/)
    expect(example.textContent).toMatch(/Estimado:|Estimated:/)
    // Ni el chip de verdad (no se cuenta ni se pulsa) ni ningún control dentro del ejemplo.
    expect(tip()!.querySelector('[data-testid="estimated"]')).toBeNull()
    expect(example.querySelector('button')).toBeNull()
  })
})

describe('huecos', () => {
  it('el botón «?», el último de la cabecera; la guía, en los superpuestos', () => {
    const header = REPLAY_HEADER.map((h) => h.name)
    expect(header.at(-1)).toBe('TzHelpButton')
    expect(header.indexOf('TzHelpButton')).toBeGreaterThan(header.indexOf('TzAnalysisButton'))
    expect(REPLAY_OVERLAYS.map((o) => o.name)).toContain('TzTips')
  })
})
