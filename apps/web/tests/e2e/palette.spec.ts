/**
 * Paleta de comandos (ítem 14, D43) con el fixture (Spa, libres 1: extracto de 4 230 000 a 4 770 000 ms, reloj visible
 * desde el «Started» de la sesión, a 816 881 ms). Ctrl+K y «/» la abren; «seguir NOR» deja NOR seleccionado y la cámara
 * siguiéndolo; «x4» pone ×4; Esc la cierra sin deseleccionar; en libres «vuelta 17» pide piloto y «vuelta 17 de NOR»
 * va al inicio de esa vuelta; lo que no está en los datos sale deshabilitado con su motivo; mientras está abierta, las
 * teclas no llegan al replay; «siguiente momento» va adonde el botón de salto del dock (ítem 5); en tablet, el botón
 * del dock la abre; axe sin infracciones serias ni críticas.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { gotoApp, settled } from './helpers'

const FP1 = '/replay?s=2026/10-spa-francorchamps/fp1'
/** Origen del reloj visible (primer «Started» de la sesión) y datos del fixture (tabla de vueltas y marcadores). */
const ORIGIN_MS = 816_881
const NOR_LAP_17_MS = 4_380_686
const VER_PIT_MS = 4_304_043
const CHEQUERED_MS = 4_416_828

/** Evalúa `fn(window.__trazada)` en la página (las funciones no viajan como argumento). */
const handle = <T>(page: Page, fn: (h: NonNullable<Window['__trazada']>) => T) =>
  page.evaluate(`(${fn.toString()})(window.__trazada)`) as Promise<T>
const twoFrames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))

const palette = (page: Page) => page.getByTestId('command-palette')
const input = (page: Page) => page.getByTestId('palette-input')
/** La opción a la que apunta `aria-activedescendant` (la que ejecuta Enter). */
const active = (page: Page) => page.locator('[data-testid="palette-option"][data-active="true"]')

async function openReplay(page: Page) {
  await gotoApp(page, FP1)
  await expect(page.getByTestId('replay-dock')).toBeVisible({ timeout: 15_000 })
  // Foco en la página sin tocar el lienzo (un clic ahí selecciona un coche).
  await page.getByTestId('replay-title').click()
}

async function openPalette(page: Page) {
  await page.keyboard.press('Control+k')
  await expect(palette(page)).toBeVisible()
  await expect(input(page)).toBeFocused()
}

/** Abre la paleta, escribe y espera a que la sugerencia activa sea `key`. */
async function command(page: Page, text: string, key: string) {
  if (!(await palette(page).isVisible())) await openPalette(page)
  await input(page).fill(text)
  await expect(active(page)).toHaveAttribute('data-key', key)
}

test('Ctrl+K la abre; «seguir NOR» lo selecciona y la cámara lo sigue; Esc la cierra sin deseleccionar', async ({ page }) => {
  await openReplay(page)
  await openPalette(page)
  await expect(input(page)).toHaveAttribute('role', 'combobox')
  await expect(input(page)).toHaveAttribute('aria-activedescendant', /.+/)
  // Con la consulta vacía, ya hay sugerencias (reproducir, seguir al primero…).
  expect(await page.getByTestId('palette-option').count()).toBeGreaterThan(1)

  await command(page, 'seguir NOR', 'drivers.follow.1')
  await expect(active(page)).toContainText('Lando Norris')
  await page.keyboard.press('Enter')
  await expect(palette(page)).toBeHidden()
  await expect.poll(() => handle(page, (h) => h.selectedCar)).toBe('1')
  // El replay abre en el inicio del extracto, donde aún ningún coche tiene posición (la primera muestra llega después):
  // la cámara espera a NOR sin moverse y lo sigue en cuanto se ve.
  await twoFrames(page)
  expect(await handle(page, (h) => h.cars().find((c) => c.car === '1')!.visible)).toBe(false)
  expect(await handle(page, (h) => h.scene.cameraMode)).toBe('to-follow')
  await page.evaluate(() => window.__trazada!.seek(window.__trazada!.startMs + 5_000))
  await expect.poll(() => handle(page, (h) => h.scene.cameraMode), { timeout: 5000 }).toBe('follow')

  // Esc con la paleta abierta solo cierra la paleta: el coche sigue seleccionado y seguido.
  await openPalette(page)
  await page.keyboard.press('Escape')
  await expect(palette(page)).toBeHidden()
  expect(await handle(page, (h) => h.selectedCar)).toBe('1')
  expect(await handle(page, (h) => h.scene.cameraMode)).toBe('follow')
})

test('«x4» pone ×4; «/» también la abre; las teclas no llegan al replay mientras está abierta', async ({ page }) => {
  await openReplay(page)
  await page.keyboard.press('/')
  await expect(palette(page)).toBeVisible()
  await expect(input(page)).toHaveValue('')
  // Espacio y flechas se quedan en el campo: ni reproduce ni salta.
  const t0 = await handle(page, (h) => h.timeMs)
  await page.keyboard.press(' ')
  await page.keyboard.press('ArrowLeft')
  expect(await handle(page, (h) => h.playing)).toBe(false)
  expect(await handle(page, (h) => h.timeMs)).toBe(t0)

  await command(page, 'x4', 'playback.rate.4')
  await page.keyboard.press('Enter')
  await expect.poll(() => handle(page, (h) => h.rate)).toBe(4)
  await expect(page.getByTestId('rate-4')).toHaveAttribute('aria-pressed', 'true')
})

test('libres: «vuelta 17» pide piloto (Tab completa) y «vuelta 17 de NOR» va al inicio de su vuelta', async ({ page }) => {
  await openReplay(page)
  await command(page, 'vuelta 17', 'goto.lap.17.needsDriver')
  await expect(active(page)).toHaveAttribute('aria-disabled', 'true')
  await expect(active(page).getByTestId('palette-reason')).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(palette(page)).toBeVisible() // deshabilitada: no hace nada
  await page.keyboard.press('Tab')
  await expect(input(page)).toHaveValue('vuelta 17 ')
  await page.keyboard.type('de NOR')
  await expect(active(page)).toHaveAttribute('data-key', 'goto.lap.17.1')
  await expect(active(page)).toHaveAttribute('data-t', String(NOR_LAP_17_MS))
  // Lo que pasaba entonces (vista previa del timeline).
  await expect(page.getByTestId('palette-preview')).toHaveAttribute('data-t', String(NOR_LAP_17_MS))
  await page.keyboard.press('Enter')
  await expect(palette(page)).toBeHidden()
  await twoFrames(page)
  expect(await handle(page, (h) => h.timeMs)).toBe(NOR_LAP_17_MS)
  expect(await handle(page, (h) => h.selectedCar)).toBe('1')
})

test('lo que no está en los datos sale deshabilitado con su motivo', async ({ page }) => {
  await openReplay(page)
  // La vuelta 15 de NOR empieza antes del extracto; el coche de seguridad no aparece en esta sesión.
  await command(page, 'vuelta 15 de NOR', 'goto.lap.15.1')
  await expect(active(page)).toHaveAttribute('aria-disabled', 'true')
  await expect(active(page).getByTestId('palette-reason')).toContainText(/Sin dato|No data/)
  await command(page, 'siguiente sc', 'goto.sc.next')
  await expect(active(page).getByTestId('palette-reason')).toContainText(/Sin dato|No data/)
  await command(page, 'seguir xyz', 'drivers.follow.unknown')
  await expect(active(page).getByTestId('palette-reason')).toContainText('xyz')
  await page.keyboard.press('Enter')
  expect(await handle(page, (h) => h.selectedCar)).toBeNull()
})

test('saltos: la bandera a cuadros, una hora del reloj y la parada de un piloto', async ({ page }) => {
  await openReplay(page)
  await command(page, 'bandera a cuadros', 'goto.chequered.next')
  await expect(active(page)).toHaveAttribute('data-t', String(CHEQUERED_MS))
  await page.keyboard.press('Enter')
  await twoFrames(page)
  expect(await handle(page, (h) => h.timeMs)).toBe(CHEQUERED_MS)

  await command(page, '1:00:00', `goto.time.${3_600_000}`)
  await page.keyboard.press('Enter')
  await twoFrames(page)
  expect(await handle(page, (h) => h.timeMs)).toBe(ORIGIN_MS + 3_600_000)

  // Desde el principio del extracto, la siguiente parada de VER (y lo selecciona).
  await command(page, 'desde el principio', 'resume.restart')
  await page.keyboard.press('Enter')
  await command(page, 'parada de VER', 'goto.pit.next.3')
  await page.keyboard.press('Enter')
  await twoFrames(page)
  expect(await handle(page, (h) => h.timeMs)).toBe(VER_PIT_MS)
  expect(await handle(page, (h) => h.selectedCar)).toBe('3')
})

test('«siguiente momento» va adonde lleva el botón del dock (servicio de momentos del ítem 5)', async ({ page }) => {
  await openReplay(page)
  // Los destinos de los botones de salto (5 s antes de cada momento); la bandera a cuadros es uno de ellos.
  const targets = await handle(page, (h) => (h.scene.moments as { targets: { seekMs: number }[] }).targets.map((m) => m.seekMs))
  expect(targets).toContain(CHEQUERED_MS - 5000)
  const now = await handle(page, (h) => h.timeMs)
  // La paleta no cuenta lo que está a menos de medio segundo del reloj (NEAR_MS).
  const expected = targets.filter((t) => t > now + 500).sort((a, b) => a - b)[0]!
  await command(page, 'siguiente momento', 'goto.moment.next')
  await expect(active(page)).toHaveAttribute('data-t', String(expected))
  await page.keyboard.press('Enter')
  await twoFrames(page)
  expect(await handle(page, (h) => h.timeMs)).toBe(expected)
  // Y «momento anterior» vuelve al de antes, o sale deshabilitado con su motivo si no lo hay.
  await command(page, 'momento anterior', 'goto.moment.prev')
})

test('accesibilidad: axe sin infracciones serias ni críticas con la paleta abierta', async ({ page }) => {
  await openReplay(page)
  await command(page, 'vuelta 17 de NOR', 'goto.lap.17.1')
  await settled(page)
  const results = await new AxeBuilder({ page })
    .include('[data-testid="command-palette"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)
  expect(serious).toEqual([])
  // Con ratón, el botón del dock no está (Ctrl+K y «/» bastan).
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('palette-button')).toBeHidden()
})

test.describe('tablet', () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true })

  test('el botón del dock la abre y una sugerencia se ejecuta con un toque', async ({ page }) => {
    await gotoApp(page, FP1)
    await expect(page.getByTestId('replay-dock')).toBeVisible({ timeout: 15_000 })
    const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches || matchMedia('(hover: none)').matches)
    test.skip(!coarse, 'esta emulación no informa de puntero grueso ni de hover: none')
    const button = page.getByTestId('palette-button')
    await expect(button).toBeVisible()
    await expect(button).toHaveAccessibleName(/(Comandos|Commands)/)
    await button.tap()
    await expect(palette(page)).toBeVisible()
    await input(page).fill('x2')
    await page.locator('[data-testid="palette-option"][data-key="playback.rate.2"]').tap()
    await expect(palette(page)).toBeHidden()
    await expect.poll(() => handle(page, (h) => h.rate)).toBe(2)
  })
})

test.describe('iPad Air horizontal', () => {
  test.use({ viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true })

  test('el botón va en el dock: la cabecera táctil sigue en una fila', async ({ page }) => {
    await gotoApp(page, FP1)
    await expect(page.getByTestId('replay-dock')).toBeVisible({ timeout: 15_000 })
    const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches || matchMedia('(hover: none)').matches)
    test.skip(!coarse, 'esta emulación no informa de puntero grueso ni de hover: none')
    await expect(page.getByTestId('replay-dock').getByTestId('palette-button')).toBeVisible()
    // En la cabecera, con el botón de la realización automática, la partía en dos filas (46 px menos de escena). Las
    // condiciones, por debajo de 1360 px, van en su propia fila a propósito (D50): no cuentan.
    const tops = await page.evaluate(() =>
      [...document.querySelector('.tz-replay__bar')!.children]
        .filter((c) => getComputedStyle(c).flexBasis !== '100%')
        .map((c) => c.getBoundingClientRect())
        .filter((r) => r.height > 0)
        .map((r) => Math.round(r.top + r.height / 2)),
    )
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(4)
  })
})
