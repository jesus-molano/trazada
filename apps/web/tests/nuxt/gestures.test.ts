/**
 * Gestos de dos dedos de la escena (ítem 17, D43; `composables/useSceneGestures.ts`) con Pointer Events sintéticos.
 * El navegador entrega el movimiento de cada dedo en su propio `pointermove`, uno detrás de otro: el gesto se decide
 * en el frame, con los dos dedos al día. Decidirlo con el primero (el otro aún en su sitio anterior) convertía en
 * pellizco un deslizamiento rápido de dos dedos en paralelo.
 */
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { useSceneGestures } from '~/composables/useSceneGestures'
import { sceneStats } from '~/replay/debug'
import { createReplayRuntime } from '~/replay/runtime'
import { usePlaybackStore } from '~/stores/playback'
import { loadFixture } from '~/testing/fixture'

let frames: FrameRequestCallback[] = []
const flush = () => {
  const cbs = frames
  frames = []
  for (const cb of cbs) cb(performance.now())
}
const unmounts: (() => void)[] = []

beforeEach(async () => {
  frames = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
  vi.stubGlobal('cancelAnimationFrame', () => {})
  usePlaybackStore().attach(createReplayRuntime(await loadFixture()))
})
afterEach(() => {
  for (const u of unmounts.splice(0)) u()
  usePlaybackStore().detach()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

const Scene = defineComponent({
  setup() {
    const root = ref<HTMLElement | null>(null)
    useSceneGestures({ root, follow: { active: () => false, distance: () => 10, zoom: () => {} } })
    return () => h('div', { ref: root, 'data-testid': 'scene' })
  },
})

async function mountScene(): Promise<HTMLElement> {
  const w = await mountSuspended(Scene, { attachTo: document.body })
  unmounts.push(() => w.unmount())
  return w.element as HTMLElement
}

const gestures = () => (sceneStats as unknown as { gestures: { phase: string; last: string | null } }).gestures

function pointer(el: HTMLElement, type: string, id: number, x: number, y: number) {
  el.dispatchEvent(
    new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: y }),
  )
}

/** Dos dedos a 80 px en horizontal; cada paso mueve los dos (cada uno en su evento, como el navegador). */
async function twoFingers(steps: { a: [number, number]; b: [number, number] }[]) {
  const el = await mountScene()
  pointer(el, 'pointerdown', 1, 100, 200)
  pointer(el, 'pointerdown', 2, 180, 200)
  for (const { a, b } of steps) {
    pointer(el, 'pointermove', 1, ...a)
    pointer(el, 'pointermove', 2, ...b)
    flush()
  }
  return el
}

describe('dos dedos sobre la escena', () => {
  it('un deslizamiento rápido en paralelo y en horizontal mueve el reloj, aunque cada dedo llegue en su evento', async () => {
    await twoFingers([{ a: [130, 200], b: [210, 200] }])
    expect(gestures()).toMatchObject({ phase: 'scrub', last: 'scrub' })
  })

  it('no decide con un solo dedo al día: hasta el frame, el gesto sigue pendiente', async () => {
    const el = await mountScene()
    pointer(el, 'pointerdown', 1, 100, 200)
    pointer(el, 'pointerdown', 2, 180, 200)
    pointer(el, 'pointermove', 1, 130, 200)
    expect(gestures().phase).toBe('pending')
    pointer(el, 'pointermove', 2, 210, 200)
    expect(gestures().phase).toBe('pending')
    flush()
    expect(gestures().phase).toBe('scrub')
  })

  it('un dedo quieto y el otro que se acerca es un pellizco', async () => {
    await twoFingers([{ a: [130, 200], b: [180, 200] }])
    expect(gestures()).toMatchObject({ phase: 'pinch', last: 'pinch' })
  })

  it('en vertical, de los controles del mapa; sin moverse lo bastante, sin decidir', async () => {
    await twoFingers([{ a: [100, 230], b: [180, 230] }])
    expect(gestures().phase).toBe('map')
    for (const u of unmounts.splice(0)) u()
    await twoFingers([{ a: [104, 200], b: [184, 200] }])
    expect(gestures().phase).toBe('pending')
  })
})
