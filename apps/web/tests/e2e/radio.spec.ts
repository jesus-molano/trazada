/**
 * Radio de los equipos (D51) con el fixture (Spa 2026, libres 1) servido como lo daría un pipeline 1.2.0: tres clips en
 * `events.radio` (el fichero de eventos se vuelve a comprimir y su sha256 se reescribe en el manifest, que no va firmado)
 * y, como clips, WAV sintéticos de unos KB (los datos de verdad nunca van a git). En el panel de dirección de carrera,
 * el filtro y las filas mezcladas por hora, solo hasta el reloj; reproducir, pausa y progreso; «Escuchar en directo» a
 * ×1; los del coche elegido en la telemetría; el carril del timeline. Y una sesión de antes de 1.2.0 pide volver a
 * descargarla.
 */
import { createHash } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import { expect, type Page, test } from '@playwright/test'
import { gotoApp, resetStorage } from './helpers'

const SESSION = '2026/10-spa-francorchamps/fp1'
const FP1 = `/replay?s=${SESSION}`
/** Instantes (ms desde el inicio de la reproducción) y coches de los clips: GAS (10) y ALB (23). */
const CLIPS = [
  { at: 150_000, car: '10' },
  { at: 155_000, car: '23' },
  { at: 300_000, car: '10' },
]
const file = (i: number) => `radio/${String(i + 1).padStart(16, '0')}.mp3`

/** Un WAV de 0,6 s (8 kHz, 8 bits, mono) con un tono: unos 5 KB. */
function wav(): Buffer {
  const rate = 8000
  const n = Math.round(rate * 0.6)
  const buf = Buffer.alloc(44 + n)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + n, 4)
  buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate, 28)
  buf.writeUInt16LE(1, 32)
  buf.writeUInt16LE(8, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(n, 40)
  for (let i = 0; i < n; i++) buf[44 + i] = 128 + Math.round(40 * Math.sin((2 * Math.PI * 440 * i) / rate))
  return buf
}

async function serveWithRadio(page: Page, radio: boolean): Promise<void> {
  let patched: Promise<Buffer> | null = null
  let startMs = 0
  const events = (url: string) =>
    (patched ??= page.request.get(url).then(async (r) => {
      const doc = JSON.parse(gunzipSync(await r.body()).toString('utf8'))
      doc.schemaVersion = radio ? '1.2.0' : '1.1.0'
      if (radio) doc.radio = CLIPS.map((c, i) => ({ t: startMs + c.at, car: c.car, file: file(i), bytes: wav().byteLength }))
      return gzipSync(Buffer.from(JSON.stringify(doc), 'utf8'))
    }))
  await page.route(`**/sessions/${SESSION}/manifest.json`, async (route) => {
    const res = await route.fetch()
    const manifest = await res.json()
    startMs = manifest.session.playback.startMs
    const body = await events(new URL(manifest.files.events.path, route.request().url()).href)
    if (radio) {
      manifest.schemaVersion = '1.2.0'
      manifest.channels.radio = 'present'
    } else delete manifest.channels.radio
    manifest.files.events.bytes = body.byteLength
    manifest.files.events.sha256 = createHash('sha256').update(body).digest('hex')
    await route.fulfill({ response: res, json: manifest })
  })
  await page.route(`**/sessions/${SESSION}/events.*.json.gz`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/gzip', body: await events(route.request().url()) })
  })
  await page.route(`**/sessions/${SESSION}/radio/*.mp3`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'audio/wav', body: wav() })
  })
}

async function open(page: Page, radio = true) {
  await resetStorage(page)
  await serveWithRadio(page, radio)
  await gotoApp(page, FP1)
  await expect(page.getByTestId('replay-dock')).toBeVisible({ timeout: 15_000 })
  if (await page.evaluate(() => window.__trazada!.playing)) {
    await page.getByTestId('replay-title').click()
    await page.keyboard.press('Space')
  }
  const toggle = page.getByTestId('race-control-toggle')
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
}

const seek = (page: Page, at: number) => page.evaluate((ms) => window.__trazada!.seek(window.__trazada!.startMs + ms), at)
const radioRows = (page: Page) => page.getByTestId('rc-radio')

test('en el panel, solo hasta el reloj y con su filtro; reproducir, pausa y progreso', async ({ page }) => {
  await open(page)
  await seek(page, 200_000)
  await expect(radioRows(page)).toHaveCount(2) // el de los 300 s aún no se ha publicado
  await expect(page.getByTestId('radio-lane')).toHaveAttribute('data-count', '2')
  await page.getByTestId('rc-filter-radio').click()
  await expect(page.getByTestId('rc-message')).toHaveCount(0)
  await expect(radioRows(page)).toHaveCount(2)
  await page.getByTestId('rc-filter-rc').click()
  await expect(radioRows(page)).toHaveCount(0)
  await page.getByTestId('rc-filter-all').click()

  const button = page.locator('[data-testid="rc-radio"][data-car="23"] [data-testid="radio-play"]')
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-testid="rc-radio"][data-car="23"] [data-testid="radio-progress"]')).toBeVisible()
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'false')
})

test('«Escuchar en directo»: apagado por defecto; a ×1, el clip suena al llegar el reloj', async ({ page }) => {
  await open(page)
  const live = page.getByTestId('radio-live')
  await expect(live).toHaveAttribute('aria-pressed', 'false')
  await live.click()
  await seek(page, 148_500)
  await page.getByTestId('replay-title').click()
  await page.keyboard.press('Space')
  const button = page.locator('[data-testid="rc-radio"][data-car="10"] [data-testid="radio-play"]')
  await expect(button).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 })
  await page.keyboard.press('Space') // pausar la reproducción para el directo
  await expect(button).toHaveAttribute('aria-pressed', 'false')
})

test('la telemetría del coche elegido lista sus radios hasta el reloj', async ({ page }) => {
  await open(page)
  await seek(page, 200_000)
  await page.locator('[data-testid="leaderboard"] [data-car="10"]').getByRole('button').click()
  await expect(page.getByTestId('car-radio')).toBeVisible()
  await expect(page.getByTestId('car-radio-clip')).toHaveCount(1)
})

test('una sesión de antes de 1.2.0 pide volver a descargarla para tener la radio', async ({ page }) => {
  await open(page, false)
  await expect(page.getByTestId('radio-outdated')).toContainText(/(vuelve a descargarla|download it again)/)
  await expect(page.getByTestId('rc-tools')).toHaveCount(0)
  await expect(page.getByTestId('radio-lane')).toHaveCount(0)
})
