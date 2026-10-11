/**
 * Meteorología (ítem 6, D36) sobre el fixture de Spa 2026 libres 1, regenerado con la meteorología de la caché de
 * FastF1 (una muestra por minuto; ninguna con lluvia). El chip de la cabecera da el aire, la pista, la lluvia y el viento
 * de la última medida (sin interpolar); su panel, el detalle y la dirección del viento en una brújula con el norte
 * arriba, junto al trazado (nunca sobre el mapa 3D, que no está orientado al norte). El carril del timeline pinta la
 * temperatura de pista en escalones y los tramos con lluvia. Una sesión de antes de 1.1.0 (sin meteorología) dice «sin
 * dato» y que hay que volver a descargarla, sin carril. Accesible (axe) en español y en inglés.
 */
import { createHash } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { gotoApp, resetStorage, settled } from './helpers'

const SESSION = '2026/10-spa-francorchamps/fp1'
const FP1 = `/replay?s=${SESSION}`

async function openReplay(page: Page, baseURL: string | undefined, lang: 'es' | 'en' = 'es') {
  await page.context().addCookies([{ name: 'trazada_lang', value: lang, url: baseURL ?? 'http://127.0.0.1' }])
  await resetStorage(page)
  await gotoApp(page, FP1)
  await expect.poll(async () => (await page.evaluate(() => window.__trazada?.scene.ready)) ?? false, { timeout: 15_000 }).toBe(true)
}

/** Seek con precisión de ms y dos frames para que la interfaz lo refleje. */
async function seek(page: Page, ms: number) {
  await page.evaluate((t) => window.__trazada!.seek(t), ms)
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
}

const chip = (page: Page) => page.getByTestId('weather')
const root = (page: Page) => page.locator('.tz-weather')

async function serious(page: Page, selector: string) {
  await settled(page)
  const results = await new AxeBuilder({ page }).include(selector).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  return results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)
}

/**
 * Sirve la sesión como la habría generado un pipeline anterior a 1.1.0: sin `channels.weather` en el manifest y sin
 * `weather` en los eventos (el fichero se vuelve a comprimir y su sha256 se reescribe en el manifest, que no va firmado).
 */
async function serveWithoutWeather(page: Page): Promise<void> {
  let patched: Promise<Buffer> | null = null
  const events = (url: string) =>
    (patched ??= page.request.get(url).then(async (r) => {
      const doc = JSON.parse(gunzipSync(await r.body()).toString('utf8'))
      delete doc.weather
      doc.schemaVersion = '1.0.0'
      return gzipSync(Buffer.from(JSON.stringify(doc), 'utf8'))
    }))
  await page.route(`**/sessions/${SESSION}/manifest.json`, async (route) => {
    const res = await route.fetch()
    const manifest = await res.json()
    const body = await events(new URL(manifest.files.events.path, route.request().url()).href)
    delete manifest.channels.weather
    manifest.schemaVersion = '1.0.0'
    manifest.files.events.bytes = body.byteLength
    manifest.files.events.sha256 = createHash('sha256').update(body).digest('hex')
    await route.fulfill({ response: res, json: manifest })
  })
  await page.route(`**/sessions/${SESSION}/events.*.json.gz`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/gzip', body: await events(route.request().url()) })
  })
}

test('a 1440 px, solo el icono (la cabecera cabe en una fila); el nombre y el título lo dicen todo', async ({ page, baseURL }) => {
  await openReplay(page, baseURL)
  await expect(root(page)).toHaveAttribute('data-state', 'reading')
  await expect(chip(page)).toBeVisible()
  await expect(chip(page).locator('[data-icon="temperature"]')).toBeVisible()
  for (const piece of ['air', 'track', 'rain', 'wind']) await expect(chip(page).locator(`[data-piece="${piece}"]`)).toBeHidden()
  const name = (await chip(page).getAttribute('aria-label'))!
  expect(name).toMatch(/^Aire 23,7 °C · Pista \d+,\d °C · Sin lluvia · Viento \d+,\d m\/s \(meteorología: detalles\)$/)
  await expect(chip(page)).toHaveAttribute('title', name)
  // La cabecera sigue en una fila: todo lo que lleva a la misma altura que el título.
  const tops = await page.evaluate(() =>
    [...document.querySelector('.tz-replay__bar')!.children]
      .map((c) => c.getBoundingClientRect())
      .filter((r) => r.height > 0)
      .map((r) => Math.round(r.top + r.height / 2)),
  )
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(4)
  // Ni el chip ni el carril dibujan nada en el mapa 3D.
  const layers = await page.evaluate(() => window.__trazada!.scene.layers.map((l) => l.name))
  expect(layers.filter((n) => /weather|wind|viento|meteo/i.test(n))).toEqual([])
})

/**
 * La cabecera: su nivel de compactación (`data-fit`, useHeaderFit) y si el título se ve entero, tras un frame. Con la
 * escena en pausa nada pide frames, y sin frames el navegador sin pantalla no entrega el ResizeObserver de un cambio de
 * tamaño de la ventana (una ventana de verdad se repinta al cambiar de tamaño).
 */
function header(page: Page): Promise<{ level: string; titleWhole: boolean }> {
  return page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const title = document.querySelector<HTMLElement>('[data-testid="replay-title"]')!
    return {
      level: title.parentElement!.getAttribute('data-fit') ?? '',
      titleWhole: title.scrollWidth <= title.clientWidth + 1,
    }
  })
}

test('a 1680 px, el aire y la pista; desde 1920 px, también la lluvia y el viento si caben (siempre el principio del nombre)', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1680, height: 900 })
  await openReplay(page, baseURL)
  await expect(chip(page).locator('[data-piece="air"]')).toHaveText(/^Aire 23,7 °C$/)
  await expect(chip(page).locator('[data-piece="track"]')).toHaveText(/^Pista \d+,\d °C$/)
  await expect(chip(page).locator('[data-piece="rain"]')).toBeHidden()
  await expect(chip(page).locator('[data-piece="wind"]')).toBeHidden()
  // Lo que se ve es el principio del nombre accesible (WCAG 2.5.3). El separador «·» es contenido CSS (innerText no
  // lo trae).
  const name = (await chip(page).getAttribute('aria-label'))!
  const visible = (await chip(page).innerText()).replace(/\s+/g, ' ').trim()
  const [air, track] = visible.split(/ ?·? ?(?=Pista)/)
  expect(name.startsWith(`${air} · ${track}`)).toBe(true)

  // A 1920 px, la lluvia y el viento solo si caben: el título manda (D44). Si no caben, la cabecera pasa a su nivel 1, el
  // que los esconde, y el título se ve entero. useHeaderFit mide en el frame siguiente al cambio de tamaño: hasta
  // entonces el título puede salir acortado.
  await page.setViewportSize({ width: 1920, height: 1080 })
  await expect.poll(async () => (await header(page)).titleWhole).toBe(true)
  const wideShown = !(await header(page)).level.split(' ').includes('1')
  for (const piece of ['rain', 'wind']) {
    const loc = chip(page).locator(`[data-piece="${piece}"]`)
    await (wideShown ? expect(loc).toBeVisible() : expect(loc).toBeHidden())
  }

  // Con sitio de sobra, las cuatro.
  await page.setViewportSize({ width: 2560, height: 1080 })
  await expect.poll(() => header(page)).toEqual({ level: '', titleWhole: true })
  for (const piece of ['air', 'track', 'rain', 'wind']) await expect(chip(page).locator(`[data-piece="${piece}"]`)).toBeVisible()
  await expect(chip(page).locator('[data-piece="rain"]')).toHaveText('Sin lluvia')
  await expect(chip(page).locator('[data-piece="wind"]')).toHaveText(/^Viento \d+,\d m\/s$/)
})

test('escalonado: a mitad de minuto, la medida de antes; el panel dice su antigüedad', async ({ page, baseURL }) => {
  await openReplay(page, baseURL)
  const startMs = await page.evaluate(() => window.__trazada!.startMs)
  const first = Number(await root(page).getAttribute('data-sample-t'))
  expect(first).toBeLessThan(startMs) // la vigente al empezar es anterior a la reproducción
  // 90 s después de esa medida ya hay otra (una por minuto): el chip cambia de muestra, sin valores intermedios.
  await seek(page, first + 90_000)
  const second = Number(await root(page).getAttribute('data-sample-t'))
  expect(second).toBeGreaterThan(first)
  expect(second).toBeLessThanOrEqual(first + 90_000)
  await seek(page, second + 30_000)
  await expect(root(page)).toHaveAttribute('data-sample-t', String(second))
  await chip(page).click()
  await expect(page.getByTestId('weather-age')).toHaveText(/^Medida de hace 30 s/)
})

test('el panel: detalle, brújula con el norte arriba junto al trazado; Esc lo cierra; accesible', async ({ page, baseURL }) => {
  await openReplay(page, baseURL)
  await chip(page).click()
  const panel = page.getByTestId('weather-panel')
  await expect(panel).toBeVisible()
  await expect(chip(page)).toHaveAttribute('aria-expanded', 'true')
  for (const field of ['air', 'track', 'humidity', 'pressure', 'rain', 'wind', 'direction']) {
    await expect(panel.locator(`[data-field="${field}"]`)).toBeVisible()
  }
  await expect(panel.locator('[data-field="pressure"]')).toHaveText(/^\d+,\d hPa$/)
  await expect(panel.locator('[data-field="direction"]')).toHaveText(/^\d+° \((N|NE|E|SE|S|SO|O|NO)\)$/)
  const compass = page.getByTestId('weather-compass')
  await expect(compass).toHaveAttribute('role', 'img')
  await expect(compass).toHaveAttribute('aria-label', /norte/)
  await expect(compass.getByTestId('track-outline')).toBeVisible()
  await expect(panel).toContainText('El mapa 3D no está orientado al norte')
  await expect(page.getByTestId('weather-session-rain')).toHaveText('Ninguna medida con lluvia en la sesión.')
  expect(await serious(page, '.tz-weather')).toEqual([])

  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await expect(chip(page)).toBeFocused()
})

test('en inglés, el chip y el panel también', async ({ page, baseURL }) => {
  await openReplay(page, baseURL, 'en')
  await expect(chip(page)).toHaveAttribute('aria-label', /^Air 23\.7 °C · Track \d+\.\d °C · No rain · Wind \d+\.\d m\/s/)
  await chip(page).click()
  await expect(page.getByTestId('weather-session-rain')).toHaveText('No reading with rain in the session.')
  expect(await serious(page, '[data-testid="weather-panel"]')).toEqual([])
})

test('franja del timeline: un tramo de temperatura de pista por medida, sin lluvia; no añade alto; un clic en ella mueve el reloj', async ({ page, baseURL }) => {
  await openReplay(page, baseURL)
  const lane = page.getByTestId('weather-lane')
  await expect(lane).toBeVisible()
  // Va al pie de la fila de marcas, dentro de la pista del timeline, que sigue midiendo 36 px.
  const track = (await page.getByTestId('timeline').boundingBox())!
  const strip = (await lane.boundingBox())!
  expect(Math.round(track.height)).toBe(36)
  expect(Math.round(strip.y + strip.height)).toBe(Math.round(track.y + track.height))
  // No pisa las marcas (vueltas, banderas y paradas acaban antes).
  const marksBottom = await page.evaluate(() =>
    Math.max(...[...document.querySelectorAll('.tz-timeline__ticks > span')].map((e) => e.getBoundingClientRect().bottom)),
  )
  expect(marksBottom).toBeLessThanOrEqual(strip.y + 0.5)
  await expect(lane).toHaveAttribute('data-rain-spans', '0')
  const steps = Number(await lane.getAttribute('data-steps'))
  expect(steps).toBeGreaterThanOrEqual(9) // 9 min de extracto, una medida por minuto
  await expect(lane.locator('[data-marker="track-temp"]')).toHaveCount(steps)
  await expect(lane.locator('[data-marker="rain"]')).toHaveCount(0)
  await expect(lane).toHaveAttribute('title', /^Meteorología: temperatura de pista de \d+,\d °C a \d+,\d °C\. Ninguna medida con lluvia\.$/)
  // Está dentro de la pista del timeline: un clic sobre él es un seek, como en el resto.
  const box = (await lane.boundingBox())!
  const { startMs, endMs } = await page.evaluate(() => ({ startMs: window.__trazada!.startMs, endMs: window.__trazada!.endMs }))
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2)
  await expect.poll(() => page.evaluate(() => window.__trazada!.timeMs)).toBeGreaterThan(startMs + (endMs - startMs) * 0.7)
})

test('sesión de antes de 1.1.0 (sin meteorología): «sin dato», volver a descargarla, sin carril', async ({ page, baseURL }) => {
  await serveWithoutWeather(page)
  await openReplay(page, baseURL)
  await expect(root(page)).toHaveAttribute('data-state', 'outdated')
  // A 1440 px, el texto corto; nunca solo el icono.
  await expect(chip(page).locator('.tz-weather__nodata-short')).toBeVisible()
  await expect(chip(page).locator('.tz-weather__nodata-short')).toHaveText('sin dato')
  await expect(chip(page).locator('.tz-weather__nodata-long')).toBeHidden()
  await expect(chip(page)).toHaveAttribute('aria-label', /^Meteo: sin dato\. .*vuelve a descargarla/)
  await chip(page).click()
  await expect(page.getByTestId('weather-reason')).toContainText('vuelve a descargarla')
  await expect(page.getByTestId('weather-compass')).toHaveCount(0)
  await expect(page.getByTestId('weather-lane')).toHaveCount(0)
  expect(await serious(page, '[data-testid="weather-panel"]')).toEqual([])
})
