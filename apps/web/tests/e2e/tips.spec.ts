/**
 * Guía de primer uso (ítem 18) con el fixture (Spa, libres 1), sin marcarla como vista (`gotoApp(…, { tips: true })` y
 * un contexto nuevo por test: almacenamiento vacío). Sale sola tras «listo», sin robar el foco ni el espacio; la 1 de 6
 * junto a la clasificación; «Siguiente» recorre los pasos y cada uno se ancla a lo que existe (centrada si no hay ancla:
 * «Seguir» sin coche elegido); al cambiar al diseño «Análisis» (ítem 15) se recoloca junto a la clasificación; el
 * ejemplo de «Estimado» va rotulado como ejemplo; «Saltar» se recuerda al recargar; el botón «?», la tecla «?» y la
 * paleta («guía») la reabren con el foco dentro y Esc la cierra devolviéndolo; axe sin infracciones serias ni críticas
 * con la burbuja abierta; la cabecera sigue en una fila a 1440 y a 1280 px; en iPad vertical, nada se desborda y la
 * burbuja cabe en la ventana; con movimiento reducido, sin animación.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { gotoApp, settled, TIPS_KEY } from './helpers'

const FP1 = '/replay?s=2026/10-spa-francorchamps/fp1'
const STEPS = 6

const tip = (page: Page) => page.getByTestId('tip')
const count = (page: Page) => page.getByTestId('tip-count')
const stored = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null') as unknown, TIPS_KEY)
const playing = (page: Page) => page.evaluate(() => window.__trazada!.playing)

/** Abre el replay sin marcar la guía como vista (almacenamiento vacío: contexto nuevo). */
async function openFresh(page: Page) {
  await gotoApp(page, FP1, { tips: true })
  await expect(page.getByTestId('replay-dock')).toBeVisible({ timeout: 15_000 })
}

/** Abre el replay con la guía vista (como el resto de e2e). */
async function openSeen(page: Page) {
  await gotoApp(page, FP1)
  await expect(page.getByTestId('replay-dock')).toBeVisible({ timeout: 15_000 })
}

/** ¿Se solapan dos cajas? */
const overlap = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

async function serious(page: Page) {
  await settled(page)
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .exclude('[data-testid="scene"] canvas')
    .analyze()
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)
}

test('sale sola tras «listo», sin robar el foco; la 1 de 6 junto a la clasificación; «Saltar» se recuerda', async ({ page }) => {
  await openFresh(page)
  await expect(tip(page)).toBeVisible({ timeout: 5000 })
  await expect(count(page)).toHaveText(new RegExp(`^1 (de|of) ${STEPS}$`))
  await expect(tip(page)).toHaveAttribute('data-step', 'leaderboard')
  await expect(tip(page)).toHaveAttribute('data-anchored', 'true')
  // Al lado de la clasificación (a la derecha) o, si cabe, debajo: nunca centrada ni encima de ella.
  await expect(tip(page)).toHaveAttribute('data-side', /^(right|bottom)$/)
  await expect(page.getByTestId('tip-ring')).toBeVisible()
  // No tapa su ancla y no se lleva el foco: el espacio sigue siendo reproducir.
  expect(overlap((await tip(page).boundingBox())!, (await page.getByTestId('leaderboard').boundingBox())!)).toBe(false)
  await expect(page.getByTestId('tip-next')).not.toBeFocused()
  await page.getByTestId('replay-title').click()
  await page.keyboard.press('Space')
  await expect.poll(() => playing(page)).toBe(true)
  await page.keyboard.press('Space')
  await expect(tip(page)).toBeVisible()

  await page.getByTestId('tip-skip').click()
  await expect(tip(page)).toBeHidden()
  expect(await stored(page)).toEqual({ seen: ['leaderboard', 'follow', 'timeline', 'estimated', 'analysis', 'palette'] })
  await page.reload()
  await expect(page.getByTestId('replay-dock')).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(2000)
  await expect(tip(page)).toBeHidden()
})

test('«Siguiente» recorre los pasos, cada uno junto a su ancla; «Seguir» se ancla al elegir un coche; el ejemplo de «Estimado»', async ({
  page,
}) => {
  await openFresh(page)
  await expect(tip(page)).toBeVisible({ timeout: 5000 })

  // 2: «Seguir», sin coche elegido: centrada. Al elegir uno, junto a su botón.
  await page.getByTestId('tip-next').click()
  await expect(tip(page)).toHaveAttribute('data-step', 'follow')
  await expect(tip(page)).toHaveAttribute('data-side', 'center')
  await page.locator('[data-testid="leaderboard"] [data-car]').first().getByRole('button').click()
  await expect(page.getByTestId('follow-toggle')).toBeVisible()
  await expect(tip(page)).toHaveAttribute('data-anchored', 'true')
  expect(overlap((await tip(page).boundingBox())!, (await page.getByTestId('follow-toggle').boundingBox())!)).toBe(false)

  // 3: la línea de tiempo, encima.
  await page.getByTestId('tip-next').click()
  await expect(tip(page)).toHaveAttribute('data-step', 'timeline')
  await expect(tip(page)).toHaveAttribute('data-side', 'top')
  await expect(tip(page)).toContainText(/← (y|and) → (mueven|move) 5 s/)

  // 4: «Estimado», con un ejemplo rotulado como ejemplo (no es una etiqueta de verdad).
  await page.getByTestId('tip-next').click()
  await expect(tip(page)).toHaveAttribute('data-step', 'estimated')
  const example = page.getByTestId('tip-example')
  await expect(example).toBeVisible()
  await expect(example.locator('figcaption')).toHaveText(/^(Ejemplo: no es un dato de esta sesión|Example: not data from this session)$/)
  await expect(tip(page).locator('[data-testid="estimated"]')).toHaveCount(0)

  // 5: análisis, debajo de su botón.
  await page.getByTestId('tip-next').click()
  await expect(tip(page)).toHaveAttribute('data-step', 'analysis')
  await expect(tip(page)).toHaveAttribute('data-side', 'bottom')

  // 6: comandos; con ratón, junto al botón «?» (la lupa del dock solo está en táctil).
  await page.getByTestId('tip-next').click()
  await expect(tip(page)).toHaveAttribute('data-step', 'palette')
  await expect(count(page)).toHaveText(new RegExp(`^${STEPS} (de|of) ${STEPS}$`))
  await expect(tip(page)).toHaveAttribute('data-anchored', 'true')
  await expect(page.getByTestId('tip-next')).toHaveText(/Terminar|Done/)
  await page.getByTestId('tip-prev').click()
  await expect(tip(page)).toHaveAttribute('data-step', 'analysis')
  await page.getByTestId('tip-next').click()
  await page.getByTestId('tip-next').click()
  await expect(tip(page)).toBeHidden()
  expect(await stored(page)).toEqual({ seen: ['leaderboard', 'follow', 'timeline', 'estimated', 'analysis', 'palette'] })
})

test('con el diseño «Análisis» (ítem 15: clasificación más ancha), la burbuja se recoloca junto a ella sin taparla', async ({
  page,
}) => {
  await openFresh(page)
  await expect(tip(page)).toBeVisible({ timeout: 5000 })
  await expect(tip(page)).toHaveAttribute('data-step', 'leaderboard')
  const leaderboard = page.getByTestId('leaderboard')
  const before = (await leaderboard.boundingBox())!.width
  // La burbuja no es modal: el cambio de diseño de la cabecera sigue a mano y no la cierra.
  await page.getByTestId('layout-analysis').click()
  await expect(page.locator('.tz-replay')).toHaveAttribute('data-layout', 'analysis')
  await expect.poll(async () => (await leaderboard.boundingBox())!.width).toBeGreaterThan(before)
  await expect(tip(page)).toHaveAttribute('data-step', 'leaderboard')
  await expect(tip(page)).toHaveAttribute('data-anchored', 'true')
  await expect(tip(page)).toHaveAttribute('data-side', /^(right|bottom)$/)
  await expect.poll(async () => overlap((await tip(page).boundingBox())!, (await leaderboard.boundingBox())!)).toBe(false)
  // Los dos atajos conviven: P cambia el diseño con la burbuja abierta y «?» la salta.
  await page.getByTestId('replay-title').click()
  await page.keyboard.press('p')
  await expect(page.locator('.tz-replay')).toHaveAttribute('data-layout', 'spectator')
  await expect(tip(page)).toBeVisible()
  await page.keyboard.press('?')
  await expect(tip(page)).toBeHidden()
})

test('a petición: el botón «?», la tecla «?» y la paleta la abren entera con el foco dentro; Esc la cierra y lo devuelve', async ({
  page,
}) => {
  await openSeen(page)
  await page.waitForTimeout(1500)
  await expect(tip(page)).toBeHidden()

  const help = page.getByTestId('help-button')
  await expect(help).toBeVisible()
  await expect(help).toHaveAccessibleName(/^(Guía de primer uso|First-use guide)$/)
  await help.click()
  await expect(tip(page)).toBeVisible()
  await expect(count(page)).toHaveText(new RegExp(`^1 (de|of) ${STEPS}$`))
  await expect(page.getByTestId('tip-next')).toBeFocused()
  await expect(help).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Escape')
  await expect(tip(page)).toBeHidden()
  await expect(help).toBeFocused()

  // La tecla «?»: la abre y, abierta, la salta.
  await page.getByTestId('replay-title').click()
  await page.keyboard.press('?')
  await expect(tip(page)).toBeVisible()
  await page.keyboard.press('?')
  await expect(tip(page)).toBeHidden()

  // La paleta: «guía».
  await page.keyboard.press('Control+k')
  await page.getByTestId('palette-input').fill('guía')
  await expect(page.locator('[data-testid="palette-option"][data-active="true"]')).toHaveAttribute('data-key', 'help.tips')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('command-palette')).toBeHidden()
  await expect(tip(page)).toBeVisible()
  await expect(page.getByTestId('tip-next')).toBeFocused()
  // Vista ya: sigue como estaba.
  expect(await stored(page)).toEqual({ all: true })
})

test('axe: sin infracciones serias ni críticas con la burbuja abierta', async ({ page }) => {
  await openFresh(page)
  await expect(tip(page)).toBeVisible({ timeout: 5000 })
  await expect(tip(page)).toHaveAttribute('role', 'dialog')
  expect(await serious(page)).toEqual([])
  await page.getByTestId('tip-next').click()
  await page.getByTestId('tip-next').click()
  await page.getByTestId('tip-next').click()
  await expect(page.getByTestId('tip-example')).toBeVisible()
  expect(await serious(page)).toEqual([])
})

test.describe('movimiento reducido', () => {
  test.use({ reducedMotion: 'reduce' })

  test('la burbuja aparece sin animación', async ({ page }) => {
    await openFresh(page)
    await expect(tip(page)).toBeVisible({ timeout: 5000 })
    const duration = await tip(page).evaluate((el) => getComputedStyle(el).animationDuration)
    expect(['0s', '0ms']).toContain(duration)
  })
})

for (const vp of [
  { name: 'escritorio 1440×900', width: 1440, height: 900 },
  { name: 'portátil 1280×800', width: 1280, height: 800 },
]) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } })

    test('la cabecera sigue en una fila con el botón «?» (solo el icono)', async ({ page }) => {
      await openSeen(page)
      await expect(page.getByTestId('help-button')).toBeVisible()
      const box = (await page.getByTestId('help-button').boundingBox())!
      expect(box.width).toBeLessThanOrEqual(40)
      const middles = await page.evaluate(() =>
        [...document.querySelector('.tz-replay__bar')!.children]
          .filter((c) => getComputedStyle(c).position !== 'absolute')
          // Las condiciones, por debajo de 1360 px, van en su propia fila a propósito (D50).
          .filter((c) => getComputedStyle(c).flexBasis !== '100%')
          .map((c) => c.getBoundingClientRect())
          .filter((r) => r.height > 0)
          .map((r) => Math.round(r.top + r.height / 2)),
      )
      expect(Math.max(...middles) - Math.min(...middles)).toBeLessThanOrEqual(4)
    })
  })
}

test.describe('iPad vertical', () => {
  test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true })

  test('nada se desborda y la burbuja cabe en la ventana; en táctil, textos de tocar y sin el botón «?»', async ({ page }) => {
    await openFresh(page)
    await expect(tip(page)).toBeVisible({ timeout: 5000 })
    for (let i = 0; i < STEPS; i++) {
      const b = (await tip(page).boundingBox())!
      expect(b.x).toBeGreaterThanOrEqual(0)
      expect(b.y).toBeGreaterThanOrEqual(0)
      expect(b.x + b.width).toBeLessThanOrEqual(768)
      expect(b.y + b.height).toBeLessThanOrEqual(1024)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      if (i < STEPS - 1) await page.getByTestId('tip-next').tap()
    }
    const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches || matchMedia('(hover: none)').matches)
    test.skip(!coarse, 'esta emulación no informa de puntero grueso ni de hover: none')
    await expect(page.getByTestId('help-button')).toBeHidden()
    // El último paso señala la lupa del dock (la paleta), que es por donde se vuelve a abrir en táctil.
    await expect(tip(page)).toContainText(/lupa del dock|magnifier in the dock/)
    await expect(tip(page)).toHaveAttribute('data-anchored', 'true')
  })
})
