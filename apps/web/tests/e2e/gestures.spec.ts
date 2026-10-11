/**
 * Gestos en tablet (ítem 17, D43) con el fixture (Spa 2026, libres 1) y toques emulados por CDP
 * (`Input.dispatchTouchEvent`, como el arrastre del timeline en playback.spec.ts):
 * - dos dedos en paralelo y en horizontal mueven el reloj (todo el ancho = 2 min; la mitad, +60 s ± 2 s) sin que gire
 *   la cámara, con la tarjeta de la vista previa encima de la escena mientras dura el gesto;
 * - el pellizco sigue siendo el zoom (del mapa; siguiendo a un coche, su distancia) y no mueve el reloj;
 * - doble toque (o doble clic) sobre un coche: lo elige y la cámara lo sigue; dos toques lentos, como siempre
 *   (seleccionar y deseleccionar);
 * - la escena no deja que la página se desplace ni haga zoom (`touch-action: none`) y la pista de los gestos está en
 *   el menú «Cámara».
 */
import { type CDPSession, expect, type Page, test } from '@playwright/test'
import { gotoApp, resetStorage } from './helpers'

const FP1 = '/replay?s=2026/10-spa-francorchamps/fp1'
/** Dos minutos y medio dentro del extracto de 9 min: coches en pista y margen de sobra a los dos lados. */
const T_MS = 150_000

interface Point {
  x: number
  y: number
}
type TouchPoint = Point & { id: number }

const twoFrames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
const timeMs = (page: Page) => page.evaluate(() => window.__trazada!.timeMs)
const camera = (page: Page) => page.evaluate(() => window.__trazada!.scene.camera)
const mode = (page: Page) => page.evaluate(() => window.__trazada!.scene.cameraMode)
const gestures = (page: Page) =>
  page.evaluate(() => window.__trazada!.scene.gestures as { phase: string; last: string | null; offsetMs: number | null })
const dist = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!)
const followDistance = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('trazada.settings') ?? '{}').followDistance as number | undefined)

async function openScene(page: Page) {
  await resetStorage(page)
  await gotoApp(page, FP1)
  await expect.poll(async () => (await page.evaluate(() => window.__trazada?.scene.ready)) ?? false, { timeout: 15_000 }).toBe(true)
  await page.evaluate((t) => window.__trazada!.seek(window.__trazada!.startMs + t), T_MS)
  await expect.poll(() => page.evaluate(() => window.__trazada!.cars().filter((c) => c.visible).length)).toBeGreaterThan(5)
  // En pausa: el reloj solo se mueve con el gesto y los coches se quedan quietos entre dos toques.
  if (await page.evaluate(() => window.__trazada!.playing)) {
    await page.getByTestId('replay-title').click()
    await page.keyboard.press('Space')
  }
  await expect.poll(() => page.evaluate(() => window.__trazada!.playing)).toBe(false)
  await twoFrames(page)
}

async function touch(cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', points: TouchPoint[]) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : points })
}

/**
 * Dos dedos a `gap` px el uno del otro, en horizontal, sobre el lienzo (no sobre una sigla ni un panel), a media altura
 * del hueco libre del encuadre y lo más a un lado posible (`from`), para que quepa un deslizamiento largo hacia el
 * otro. Devuelve el dedo de la izquierda.
 */
async function fingersOnCanvas(page: Page, gap: number, from: 'left' | 'right' = 'left'): Promise<Point> {
  const p = await page.evaluate(([gap, from]) => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="scene"] canvas')!
    const r = canvas.getBoundingClientRect()
    const free = window.__trazada!.scene.framing?.free ?? { x0: -0.5, x1: 0.5, y0: -0.5, y1: 0.5 }
    const left = r.left + ((free.x0 + 1) / 2) * r.width
    const right = r.left + ((free.x1 + 1) / 2) * r.width
    const midY = r.top + ((1 - (free.y0 + free.y1) / 2) / 2) * r.height
    const onCanvas = (x: number, y: number) => document.elementFromPoint(x, y)?.tagName === 'CANVAS'
    const xs: number[] = []
    for (let x = left + 10; x + gap < right - 10; x += 8) xs.push(x)
    if (from === 'right') xs.reverse()
    for (const x of xs) {
      for (const dy of [0, -40, 40, -80, 80]) {
        if (onCanvas(x, midY + dy) && onCanvas(x + gap, midY + dy)) return { x, y: midY + dy }
      }
    }
    return null
  }, [gap, from] as const)
  expect(p).not.toBeNull()
  return p!
}

/** Centro en pantalla de un coche aislado (ninguna otra sigla a menos de 40 px), justo debajo de su sigla. */
async function carOnScreen(page: Page): Promise<{ car: string } & Point> {
  const hit = await page.evaluate(() => {
    const labels = [...document.querySelectorAll<HTMLElement>('[data-testid="car-labels"] [data-car]')]
      .filter((el) => getComputedStyle(el).visibility === 'visible')
      .map((el) => {
        const r = el.getBoundingClientRect()
        return { car: el.dataset.car!, x: r.left + r.width / 2, y: r.bottom + 14 }
      })
    for (const l of labels) {
      const alone = labels.every((o) => o === l || Math.hypot(o.x - l.x, o.y - l.y) > 40)
      if (alone && document.elementFromPoint(l.x, l.y)?.tagName === 'CANVAS') return l
    }
    return null
  })
  expect(hit).not.toBeNull()
  return hit!
}

test.describe('tablet', () => {
  // iPad Pro 12,9" en horizontal: cabe un deslizamiento de medio lienzo empezando en el hueco libre.
  test.use({ viewport: { width: 1366, height: 1024 }, hasTouch: true })

  test('dos dedos en horizontal: la mitad del ancho son +60 s, sin girar la cámara, con la tarjeta encima', async ({ page }) => {
    await openScene(page)
    const width = await page.getByTestId('scene').evaluate((el) => el.clientWidth)
    const gap = 80
    const p = await fingersOnCanvas(page, gap)
    const dx = width * 0.5
    expect(p.x + gap + dx).toBeLessThan(1366)
    const t0 = await timeMs(page)
    const cam0 = await camera(page)
    const cdp = await page.context().newCDPSession(page)
    const at = (f: number): TouchPoint[] => [
      { x: p.x + dx * f, y: p.y + 2 * f, id: 1 },
      { x: p.x + gap + dx * f, y: p.y - 2 * f, id: 2 },
    ]
    await touch(cdp, 'touchStart', at(0))
    for (const f of [0.05, 0.1, 0.2, 0.3, 0.4, 0.5]) {
      await touch(cdp, 'touchMove', at(f))
      await twoFrames(page)
    }
    // A mitad del gesto: el chip con lo movido y la tarjeta de la vista previa (el reloj de ese instante).
    const hud = page.getByTestId('gesture-scrub')
    await expect(hud).toBeVisible()
    await expect(page.getByTestId('gesture-offset')).toHaveText(/^\+0:(2[89]|3[0-1])$/)
    await expect(page.getByTestId('gesture-preview')).toBeVisible()
    await expect(page.getByTestId('gesture-preview')).toHaveAttribute('data-t', String(Math.round(await timeMs(page))))
    expect((await gestures(page)).phase).toBe('scrub')
    for (const f of [0.6, 0.7, 0.8, 0.9, 1]) {
      await touch(cdp, 'touchMove', at(f))
      await twoFrames(page)
    }
    await touch(cdp, 'touchEnd', [])
    await twoFrames(page)
    expect(Math.abs((await timeMs(page)) - t0 - 60_000)).toBeLessThan(2000)
    expect(dist(await camera(page), cam0)).toBeLessThan(1)
    expect(await mode(page)).toBe('overview')
    expect(await page.evaluate(() => window.__trazada!.playing)).toBe(false)
    await expect(hud).toHaveCount(0)
    expect((await gestures(page)).last).toBe('scrub')

    // Hacia la izquierda, hacia atrás: un cuarto del ancho son −30 s.
    const t1 = await timeMs(page)
    const q = await fingersOnCanvas(page, gap, 'right')
    const dxBack = width * 0.25
    expect(q.x - dxBack).toBeGreaterThan(0)
    const left = (f: number): TouchPoint[] => [
      { x: q.x - dxBack * f, y: q.y, id: 1 },
      { x: q.x + gap - dxBack * f, y: q.y, id: 2 },
    ]
    await touch(cdp, 'touchStart', left(0))
    for (const f of [0.1, 0.25, 0.5, 0.75, 1]) {
      await touch(cdp, 'touchMove', left(f))
      await twoFrames(page)
    }
    await expect(page.getByTestId('gesture-offset')).toHaveText(/^−0:(29|30)$/)
    await touch(cdp, 'touchEnd', [])
    await twoFrames(page)
    expect(Math.abs((await timeMs(page)) - t1 + 30_000)).toBeLessThan(2000)
    expect(dist(await camera(page), cam0)).toBeLessThan(1)
  })

  test('pellizco: zoom del mapa, sin mover el reloj', async ({ page }) => {
    await openScene(page)
    const p = await fingersOnCanvas(page, 200)
    const c = { x: p.x + 100, y: p.y }
    const t0 = await timeMs(page)
    const cam0 = await camera(page)
    const cdp = await page.context().newCDPSession(page)
    const spread = (half: number): TouchPoint[] => [
      { x: c.x - half, y: c.y, id: 1 },
      { x: c.x + half, y: c.y, id: 2 },
    ]
    await touch(cdp, 'touchStart', spread(40))
    for (const half of [50, 60, 75, 90, 100]) {
      await touch(cdp, 'touchMove', spread(half))
      await twoFrames(page)
    }
    await touch(cdp, 'touchEnd', [])
    await twoFrames(page)
    expect((await gestures(page)).last).toBe('pinch')
    expect(dist(await camera(page), cam0)).toBeGreaterThan(5)
    expect(await timeMs(page)).toBe(t0)
    await expect(page.getByTestId('gesture-scrub')).toHaveCount(0)
  })

  test('siguiendo a un coche, el pellizco cambia su distancia (y se guarda)', async ({ page }) => {
    await openScene(page)
    await page.locator('[data-testid="leaderboard"] [data-car]').first().getByRole('button').click()
    await page.getByTestId('follow-toggle').click()
    await expect.poll(() => mode(page), { timeout: 5000 }).toBe('follow')
    const p = await fingersOnCanvas(page, 200)
    const c = { x: p.x + 100, y: p.y }
    const cdp = await page.context().newCDPSession(page)
    const pinch = async (halves: number[]) => {
      const at = (half: number): TouchPoint[] => [
        { x: c.x - half, y: c.y, id: 1 },
        { x: c.x + half, y: c.y, id: 2 },
      ]
      await touch(cdp, 'touchStart', at(halves[0]!))
      for (const half of halves.slice(1)) {
        await touch(cdp, 'touchMove', at(half))
        await twoFrames(page)
      }
      await touch(cdp, 'touchEnd', [])
      await twoFrames(page)
    }
    const t0 = await timeMs(page)
    // Separar los dedos acerca la cámara; juntarlos, la aleja (más que al principio).
    await pinch([40, 55, 70, 90, 100])
    const near = await followDistance(page)
    expect(near).toBeLessThan(60) // por defecto, 70 m
    await pinch([100, 85, 70, 55, 40])
    await expect.poll(async () => (await followDistance(page)) ?? 0).toBeGreaterThan(near! * 2)
    expect((await gestures(page)).last).toBe('pinch')
    expect(await mode(page)).toBe('follow')
    expect(await timeMs(page)).toBe(t0)
  })

  test('doble toque sobre un coche: lo elige y la cámara lo sigue', async ({ page }) => {
    await openScene(page)
    const { car, x, y } = await carOnScreen(page)
    await page.touchscreen.tap(x, y)
    await page.touchscreen.tap(x, y)
    await expect.poll(() => page.evaluate(() => window.__trazada!.selectedCar)).toBe(car)
    await expect.poll(() => mode(page), { timeout: 5000 }).toBe('follow')
    await expect(page.getByTestId('follow-toggle')).toHaveAttribute('aria-pressed', 'true')
  })

  test('doble toque sobre la sigla: también lo sigue', async ({ page }) => {
    await openScene(page)
    const car = await page.evaluate(() => {
      for (const el of document.querySelectorAll<HTMLElement>('[data-testid="car-labels"] [data-car]')) {
        if (getComputedStyle(el).visibility !== 'visible') continue
        const r = el.getBoundingClientRect()
        if (document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === el) return el.dataset.car!
      }
      return null
    })
    expect(car).not.toBeNull()
    const box = (await page.locator(`[data-testid="car-labels"] [data-car="${car}"]`).boundingBox())!
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    await expect.poll(() => page.evaluate(() => window.__trazada!.selectedCar)).toBe(car)
    await expect.poll(() => mode(page), { timeout: 5000 }).toBe('follow')
  })

  test('dos toques lentos: selecciona y deselecciona, como siempre', async ({ page }) => {
    await openScene(page)
    const { car, x, y } = await carOnScreen(page)
    await page.touchscreen.tap(x, y)
    await expect.poll(() => page.evaluate(() => window.__trazada!.selectedCar)).toBe(car)
    await page.waitForTimeout(700)
    await page.touchscreen.tap(x, y)
    await expect.poll(() => page.evaluate(() => window.__trazada!.selectedCar)).toBeNull()
    expect(await mode(page)).toBe('overview')
  })

  test('la escena no deja que la página se desplace ni haga zoom; la pista de los gestos, en «Cámara»', async ({ page }) => {
    await openScene(page)
    expect(await page.getByTestId('scene').evaluate((el) => getComputedStyle(el).touchAction)).toBe('none')
    const menu = page.getByTestId('tools-camera')
    if ((await menu.getAttribute('aria-expanded')) !== 'true') await menu.click()
    await expect(page.getByTestId('gestures-tool')).toBeVisible()
    await page.getByTestId('gestures-hint').click()
    await expect(page.getByTestId('gestures-hint-panel')).toBeVisible()
    await expect(page.getByTestId('gestures-hint-panel')).toContainText(/2 min/)
  })
})

test.describe('escritorio', () => {
  test('doble clic sobre un coche: lo sigue; Esc vuelve a la vista general', async ({ page }) => {
    await openScene(page)
    const { car, x, y } = await carOnScreen(page)
    await page.mouse.dblclick(x, y)
    await expect.poll(() => page.evaluate(() => window.__trazada!.selectedCar)).toBe(car)
    await expect.poll(() => mode(page), { timeout: 5000 }).toBe('follow')
    // Esc deja de seguirlo y vuelve a la vista general, como siempre.
    await page.getByTestId('replay-title').click()
    await page.keyboard.press('Escape')
    await expect.poll(() => mode(page), { timeout: 5000 }).toBe('overview')
  })
})
