/**
 * Realización automática (ítem 9, D39): el store (cualquier acción manual la apaga, sin tocar el de reproducción; solo
 * con la escena 3D montada), el chip (la única cifra es el intervalo de la torre; por cercanía en pista, ninguna; el
 * líder es el de la clasificación), la tecla T y Esc, la herramienta del menú «Cámara», el botón de la cabecera y los
 * huecos reales donde se montan.
 */
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import TzTvButton from '~/components/replay-header/TzTvButton.vue'
import TzTvChip from '~/components/replay-overlays/TzTvChip.vue'
import TzTvTool from '~/components/scene-tools/TzTvTool.vue'
import { createReplayRuntime } from '~/replay/runtime'
import { ESC_PRIORITY, handleEscape, registerEscape, runShortcut } from '~/replay/keys'
import { REPLAY_HEADER, REPLAY_OVERLAYS } from '~/slots/replay'
import { SCENE_TOOLS } from '~/slots/scene-tools'
import { usePlaybackStore } from '~/stores/playback'
import { type TvShotView, useTvStore } from '~/stores/tv'
import { loadFixture } from '~/testing/fixture'

let releaseRig: (() => void) | null = null

beforeEach(() => {
  setActivePinia(createPinia())
  // La cabecera del replay, adonde el chip se teletransporta.
  const bar = document.createElement('header')
  bar.className = 'tz-replay__bar'
  document.body.append(bar)
})

/**
 * Engancha un runtime del fixture. Después de montar (si se monta algo): `mountSuspended` deja activo el Pinia de la
 * app de Nuxt, el mismo que usan los componentes.
 */
async function attach() {
  usePlaybackStore().attach(createReplayRuntime(await loadFixture()))
}

const mounted: { unmount: () => void }[] = []

/** El chip, como en la página: solo con el runtime enganchado (lo usa al montarse). */
async function mountChip() {
  await attach()
  const w = await mountSuspended(TzTvChip, { attachTo: document.body })
  let done = false
  const handle = {
    unmount: () => {
      if (!done) w.unmount()
      done = true
    },
  }
  mounted.push(handle)
  await attach()
  return handle
}
afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount()
  releaseRig?.()
  releaseRig = null
  usePlaybackStore().detach()
  document.body.innerHTML = ''
})

/** Como el rig de cámara al montarse: la escena 3D está y la realización se puede encender. */
const withRig = () => (releaseRig = useTvStore().attachRig())

const view = (over: Partial<TvShotView>): TvShotView => ({
  id: 1,
  kind: 'duel',
  cars: ['1', '81'],
  basis: 'proximity',
  reason: 'duel',
  neutral: null,
  intervalMs: null,
  positions: null,
  camera: 'chase',
  corner: null,
  ...over,
})

const key = (k: string) => new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })

describe('store de la realización automática', () => {
  it('solo con la escena 3D montada (enganches del rig contados) y con un runtime', async () => {
    const tv = useTvStore()
    const a = tv.attachRig()
    tv.start()
    expect(tv.active).toBe(false) // sin runtime
    a()
    await attach()
    tv.start()
    expect(tv.active).toBe(false) // sin escena
    const a1 = tv.attachRig()
    const b = tv.attachRig() // un rig nuevo (contexto WebGL recuperado) antes de soltar el viejo
    tv.start()
    expect(tv.active).toBe(true)
    a1()
    a1() // soltar dos veces no cuenta dos
    expect(tv.available).toBe(true)
    expect(tv.active).toBe(true)
    b()
    expect(tv.available).toBe(false)
    expect(tv.active).toBe(false)
    expect(tv.lastExit).toBe('scene')
  })

  it('al encenderla se deja de seguir al coche sin apagarla; cualquier acción manual la apaga', async () => {
    await attach()
    const tv = useTvStore()
    const playback = usePlaybackStore()
    withRig()
    playback.selectCar('1')
    playback.setFollowing(true)
    tv.start()
    expect(tv.active).toBe(true)
    expect(playback.following).toBe(false)
    expect(playback.selectedCar).toBe('1') // la selección se queda

    // Seguir al coche.
    playback.setFollowing(true)
    expect(tv.active).toBe(false)
    expect(tv.lastExit).toBe('follow')

    // Elegir otro coche (o ninguno).
    tv.start()
    playback.selectCar('81')
    expect(tv.active).toBe(false)
    expect(tv.lastExit).toBe('selection')
    tv.start()
    playback.selectRelative(1)
    expect(tv.lastExit).toBe('selection')

    // Otra sesión.
    tv.start()
    playback.detach()
    expect(tv.active).toBe(false)
    expect(tv.lastExit).toBe('session')
  })

  it('el plano solo llega a Vue si cambia lo que se enseña, y nunca con la realización apagada', async () => {
    await attach()
    const tv = useTvStore()
    withRig()
    tv.publish(view({}))
    expect(tv.view).toBeNull()
    tv.start()
    const first = view({})
    tv.publish(first)
    expect(tv.view).toBe(first)
    tv.publish(view({}))
    expect(tv.view).toBe(first) // igual: el mismo objeto
    tv.publish(view({ camera: 'corner', corner: '5' }))
    expect(tv.view).not.toBe(first)
    tv.stop('toggle')
    expect(tv.view).toBeNull()
  })
})

describe('chip de la realización automática', () => {
  const text = () => document.querySelector('[data-testid="tv-chip-text"]')?.textContent?.trim() ?? ''

  it('solo con la realización encendida; con la torre, posiciones e intervalo oficiales', async () => {
    const w = await mountChip()
    const tv = useTvStore()
    withRig()
    await nextTick()
    expect(document.querySelector('[data-testid="tv-chip"]')).toBeNull()
    tv.start()
    tv.publish(view({ basis: 'tower', cars: ['81', '1'], positions: [4, 5], intervalMs: 412 }))
    await nextTick()
    const chip = document.querySelector('[data-testid="tv-chip"]')!
    expect(chip.closest('.tz-replay__bar')).not.toBeNull()
    expect(text()).toMatch(/PIA.*NOR.*P4–P5.*0[,.]412/)
    expect(chip.querySelector('[title]')!.getAttribute('title')).toMatch(/(torre|tower)/)
    // Sin cifra de la torre en este momento: sin número (las posiciones sí, son de la torre).
    tv.publish(view({ basis: 'tower', cars: ['81', '1'], positions: [4, 5], intervalMs: null }))
    await nextTick()
    expect(text()).not.toMatch(/0[,.]\d/)
    expect(text()).toMatch(/P4–P5/)
    w.unmount()
  })

  it('por cercanía en pista, ninguna cifra; el líder, con el estado de pista; la vista general, con el motivo', async () => {
    const w = await mountChip()
    const tv = useTvStore()
    withRig()
    tv.start()
    tv.publish(view({ basis: 'proximity' }))
    await nextTick()
    expect(text()).toMatch(/NOR.*PIA/)
    expect(text()).toMatch(/(cerca en pista|close on track)/)
    expect(text()).not.toMatch(/\d/)
    expect(document.querySelector('[data-testid="tv-chip-text"]')!.getAttribute('title')).toMatch(/(no se da cifra|no figure)/)

    tv.publish(view({ id: 2, kind: 'leader', cars: ['1'], basis: null, reason: 'neutral', neutral: 'sc' }))
    await nextTick()
    expect(text()).toMatch(/(líder|leader).*NOR.*(Coche de seguridad|Safety car)/i)

    tv.publish(view({ id: 3, kind: 'overview', cars: [], basis: null, reason: 'neutral', neutral: 'red' }))
    await nextTick()
    expect(text()).toMatch(/(Bandera roja|Red flag)/)
    tv.publish(view({ id: 4, kind: 'overview', cars: [], basis: null, reason: 'noDuel' }))
    await nextTick()
    expect(text()).toMatch(/(ningún duelo|no battle)/)

    tv.publish(view({ id: 5, camera: 'corner', corner: '10' }))
    await nextTick()
    expect(document.querySelector('[data-testid="tv-chip-camera"]')!.textContent).toMatch(/10/)

    // «Salir» la apaga.
    ;(document.querySelector('[data-testid="tv-exit"]') as HTMLButtonElement).click()
    expect(tv.active).toBe(false)
    w.unmount()
  })

  it('aviso para lectores de pantalla solo al cambiar de plano, no con cada cifra', async () => {
    const w = await mountChip()
    const tv = useTvStore()
    withRig()
    tv.start()
    const live = () => document.querySelector('[data-testid="tv-announce"]')!.textContent ?? ''
    tv.publish(view({ basis: 'tower', positions: [1, 2], intervalMs: 500 }))
    await nextTick()
    const first = live()
    expect(first).toMatch(/0[,.]500/)
    tv.publish(view({ basis: 'tower', positions: [1, 2], intervalMs: 450 }))
    await nextTick()
    expect(live()).toBe(first)
    tv.publish(view({ id: 2, basis: 'tower', positions: [1, 2], intervalMs: 450 }))
    await nextTick()
    expect(live()).toMatch(/0[,.]450/)
    w.unmount()
  })

  it('la tecla T la enciende y la apaga (solo con escena); Esc la apaga antes que el seguimiento o la selección', async () => {
    const w = await mountChip()
    const tv = useTvStore()
    const playback = usePlaybackStore()
    // Sin escena 3D, la T no es suya.
    expect(runShortcut(key('t'), false)).toBe(false)
    withRig()
    expect(runShortcut(key('t'), false)).toBe(true)
    expect(tv.active).toBe(true)
    expect(runShortcut(key('T'), false)).toBe(true)
    expect(tv.active).toBe(false)
    expect(tv.lastExit).toBe('toggle')
    // En un campo de texto, no.
    expect(runShortcut(key('t'), true)).toBe(false)

    playback.selectCar('1')
    tv.start()
    const below = registerEscape(ESC_PRIORITY.follow, { active: () => true, run: () => playback.selectCar(null) })
    expect(handleEscape()).toBe(true)
    expect(tv.active).toBe(false)
    expect(tv.lastExit).toBe('escape')
    expect(playback.selectedCar).toBe('1')
    below()
    w.unmount()
    // Sin el chip (otra sesión), la tecla ya no está registrada.
    expect(runShortcut(key('t'), false)).toBe(false)
  })
})

describe('herramienta y botón', () => {
  it('«No / Sí» en el menú «Cámara», con la tecla y la pista de qué hace (la cifra, solo de la torre)', async () => {
    const w = await mountSuspended(TzTvTool)
    await attach()
    const tv = useTvStore()
    expect(w.find('[data-testid="tv-off"]').attributes('aria-pressed')).toBe('true')
    // Sin escena 3D, «Sí» no se puede pulsar.
    expect(w.find('[data-testid="tv-on"]').attributes('disabled')).toBeDefined()
    withRig()
    await nextTick()
    await w.find('[data-testid="tv-on"]').trigger('click')
    expect(tv.active).toBe(true)
    expect(w.find('[data-testid="tv-on"]').attributes('aria-pressed')).toBe('true')
    await w.find('[data-testid="tv-off"]').trigger('click')
    expect(tv.active).toBe(false)
    const hint = w.find('[data-testid="tv-hint-panel"]').text()
    expect(hint).toMatch(/(torre de tiempos oficial|official timing tower)/)
    expect(hint).toMatch(/(no da ninguna|it gives none)/)
    expect(hint).toMatch(/(coche de seguridad|safety car)/)
    expect(hint).toMatch(/6 s/)
    expect(w.find('kbd').text()).toBe('T')
  })

  it('botón de la cabecera: deshabilitado sin escena (y dice por qué); alterna y lo dice con aria-pressed', async () => {
    const w = await mountSuspended(TzTvButton)
    await attach()
    const tv = useTvStore()
    // Ya está (la cabecera no cambia de alto al montarse la escena), pero sin escena no hace nada.
    expect(w.find('[data-testid="tv-button"]').attributes('disabled')).toBeDefined()
    expect(w.find('[data-testid="tv-button"]').attributes('title')).toMatch(/(Sin escena 3D|Without the 3D scene)/)
    withRig()
    await nextTick()
    const button = w.find('[data-testid="tv-button"]')
    expect(button.attributes('aria-pressed')).toBe('false')
    expect(button.attributes('aria-label')).toMatch(/(Realización automática|Auto direction)/)
    await button.trigger('click')
    expect(tv.active).toBe(true)
    expect(w.find('[data-testid="tv-button"]').attributes('aria-pressed')).toBe('true')
    await w.find('[data-testid="tv-button"]').trigger('click')
    expect(tv.active).toBe(false)
  })

  it('huecos reales: herramienta en «Cámara», botón en la cabecera y chip en los superpuestos', () => {
    const camera = SCENE_TOOLS.find((g) => g.group === 'camera')
    expect(camera?.tools.map((t) => t.name)).toContain('TzTvTool')
    expect(REPLAY_HEADER.map((h) => h.name)).toContain('TzTvButton')
    expect(REPLAY_OVERLAYS.map((o) => o.name)).toContain('TzTvChip')
  })
})
