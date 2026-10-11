/**
 * Escritorio y tablet: sin scroll horizontal en la página ni en los paneles; en tablet (táctil), tocar un
 * coche lo selecciona y arrastrar el timeline con el dedo mueve el reloj. La cabecera del replay va en una sola fila
 * también con todo lo que trae una carrera dev (D44), sin esconder ninguna etiqueta «Estimado».
 */
import { createHash } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { gotoApp, resetStorage } from './helpers'

const SESSION = '2026/10-spa-francorchamps/fp1'
const FP1 = `/replay?s=${SESSION}`
const PANELS = [
  '.tz-replay__bar',
  '[data-testid="scene-tools"]',
  '[data-testid="leaderboard"]',
  '.tz-lb__rows',
  '[data-testid="telemetry"]',
  '[data-testid="race-control"]',
  '.tz-rc__list',
  '[data-testid="replay-dock"]',
]

async function open(page: Page) {
  await gotoApp(page, FP1)
  await expect.poll(async () => (await page.evaluate(() => window.__trazada?.scene.ready)) ?? false, { timeout: 15_000 }).toBe(true)
  // Un minuto y medio dentro del extracto: coches en pista y la doble amarilla del sector 7 activa.
  await page.evaluate(() => window.__trazada!.seek(window.__trazada!.startMs + 85_828))
  await expect.poll(() => page.evaluate(() => window.__trazada!.cars().filter((c) => c.visible).length)).toBeGreaterThan(5)
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
}

/**
 * Elementos con contenido más ancho que su caja (scrollWidth > clientWidth), página incluida. La página se mide con todo;
 * los paneles, sin las asas de los anchos (ítem 15): van a caballo del borde que da al mapa a propósito (la mitad sobre
 * el panel; la de la clasificación, dentro de ella), así que su mitad de fuera no es contenido que se desborde.
 */
function overflowing(page: Page) {
  return page.evaluate((selectors) => {
    const out: string[] = []
    const doc = document.documentElement
    if (doc.scrollWidth > doc.clientWidth) out.push(`página ${doc.scrollWidth} > ${doc.clientWidth}`)
    const handles = [...document.querySelectorAll<HTMLElement>('.tz-resize[role="separator"]')]
    for (const h of handles) h.style.setProperty('display', 'none')
    try {
      for (const sel of selectors) {
        for (const el of document.querySelectorAll(sel)) {
          if (el.scrollWidth > el.clientWidth) out.push(`${sel} ${el.scrollWidth} > ${el.clientWidth}`)
        }
      }
    } finally {
      for (const h of handles) h.style.removeProperty('display')
    }
    return out
  }, PANELS)
}

/** Punto en pantalla de un coche aislado, sobre el lienzo (debajo de su sigla). */
async function carOnScreen(page: Page) {
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

const VIEWPORTS = [
  { name: 'escritorio 1440×900', width: 1440, height: 900, touch: false },
  { name: 'escritorio 1280×800', width: 1280, height: 800, touch: false },
  { name: 'iPad horizontal 1024×768', width: 1024, height: 768, touch: true },
  { name: 'iPad vertical 768×1024', width: 768, height: 1024, touch: true },
]

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch })

    test('sin scroll horizontal en la página ni en los paneles (también con telemetría y Estimado)', async ({ page }) => {
      await resetStorage(page)
      await open(page)
      expect(await overflowing(page)).toEqual([])
      await page.locator('[data-testid="leaderboard"] [data-car]').nth(9).getByRole('button').click()
      await expect(page.getByTestId('telemetry')).toBeVisible()
      await page.getByTestId('elevation-3').click()
      await page.getByTestId('toggle-separation').click()
      await expect(page.locator('[data-testid="estimated"]')).toHaveCount(2)
      expect(await overflowing(page)).toEqual([])
    })

    if (!vp.touch) {
      test('con un coche elegido, las gráficas de telemetría se ven sin hacer scroll', async ({ page }) => {
        await open(page)
        await page.locator('[data-testid="leaderboard"] [data-car]').first().getByRole('button').click()
        const panel = page.getByTestId('telemetry')
        await expect(panel).toBeVisible()
        const hidden = await panel.evaluate((el) => {
          const box = el.getBoundingClientRect()
          return [...el.querySelectorAll('.tz-chart, [data-testid^="tel-chart"]')]
            .map((c) => c.getBoundingClientRect())
            .filter((r) => r.height > 0 && (r.bottom > box.bottom + 1 || r.top < box.top - 1)).length
        })
        expect(hidden).toBe(0)
        expect(await panel.locator('.tz-chart, [data-testid^="tel-chart"]').count()).toBeGreaterThan(0)
      })
    }

    if (vp.touch) {
      test('tocar un coche lo selecciona; arrastrar el timeline con el dedo mueve el reloj', async ({ page }) => {
        await open(page)
        const { car, x, y } = await carOnScreen(page)
        await page.touchscreen.tap(x, y)
        await expect.poll(() => page.evaluate(() => window.__trazada!.selectedCar)).toBe(car)

        const box = (await page.getByTestId('timeline').boundingBox())!
        const { startMs, endMs } = await page.evaluate(() => ({ startMs: window.__trazada!.startMs, endMs: window.__trazada!.endMs }))
        const ty = box.y + box.height / 2
        const cdp = await page.context().newCDPSession(page)
        const touch = (type: string, tx: number) =>
          cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: tx, y: ty, id: 1 }] })
        await touch('touchStart', box.x + box.width * 0.2)
        for (const f of [0.35, 0.5, 0.65, 0.8]) await touch('touchMove', box.x + box.width * f)
        await touch('touchEnd', box.x + box.width * 0.8)
        const t = await page.evaluate(() => window.__trazada!.timeMs)
        expect(Math.abs(t - (startMs + 0.8 * (endMs - startMs)))).toBeLessThan((endMs - startMs) * 0.01)
      })
    }
  })
}

/**
 * Sirve el fixture con lo que trae la cabecera de una carrera dev (Japón 2026): cinco avisos del procesado, posiciones,
 * telemetría y estado de pista estimados y sin meteorología (`channels.weather: absent`; los eventos se vuelven a
 * comprimir sin `weather` y su sha256 se reescribe en el manifest, que no va firmado). Con `event`, otro nombre de
 * Gran Premio en el título (p. ej. el de Japón, más largo).
 */
async function serveLikeDevRace(page: Page, options: { event?: string } = {}): Promise<void> {
  let patched: Promise<Buffer> | null = null
  const events = (url: string) =>
    (patched ??= page.request.get(url).then(async (r) => {
      const doc = JSON.parse(gunzipSync(await r.body()).toString('utf8'))
      delete doc.weather
      return gzipSync(Buffer.from(JSON.stringify(doc), 'utf8'))
    }))
  await page.route(`**/sessions/${SESSION}/manifest.json`, async (route) => {
    const res = await route.fetch()
    const manifest = await res.json()
    const body = await events(new URL(manifest.files.events.path, route.request().url()).href)
    manifest.channels.weather = 'absent'
    if (options.event) manifest.session.event = options.event
    manifest.quality.estimated = ['positions', 'telemetry', 'trackStatus']
    manifest.quality.notes = [
      ...manifest.quality.notes,
      { code: 'track-status-from-race-control', text: 'Estado de pista aproximado desde race control; sin torre de tiempos.' },
    ]
    manifest.files.events.bytes = body.byteLength
    manifest.files.events.sha256 = createHash('sha256').update(body).digest('hex')
    await route.fulfill({ response: res, json: manifest })
  })
  await page.route(`**/sessions/${SESSION}/events.*.json.gz`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/gzip', body: await events(route.request().url()) })
  })
}

/** ¿El título de la cabecera se acorta con «…»? Y los niveles de compactación de la cabecera (`data-fit`). */
function titleFit(page: Page) {
  return page.evaluate(() => {
    const title = document.querySelector<HTMLElement>('[data-testid="replay-title"]')!
    const bar = document.querySelector<HTMLElement>('.tz-replay__bar')!
    return { truncated: title.scrollWidth > title.clientWidth + 1, levels: (bar.dataset.fit ?? '').split(' ').filter(Boolean) }
  })
}

/** Centro vertical de cada hijo de la cabecera en el flujo (lo que flota debajo, como el chip de la realización, no). */
function barRowMiddles(page: Page) {
  return page.evaluate(() =>
    [...document.querySelector('.tz-replay__bar')!.children]
      .filter((c) => getComputedStyle(c).position !== 'absolute')
      .map((c) => c.getBoundingClientRect())
      .filter((r) => r.height > 0)
      .map((r) => Math.round(r.top + r.height / 2)),
  )
}

for (const vp of [
  { name: 'escritorio 1440×900', width: 1440, height: 900 },
  { name: 'portátil 1280×800', width: 1280, height: 800 },
]) {
  test.describe(`${vp.name}: cabecera del replay`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } })

    test('con lo de una carrera dev (5 avisos, dos «Estimado», bandera, sin meteorología), sigue en una sola fila', async ({ page }) => {
      await resetStorage(page)
      await serveLikeDevRace(page)
      await open(page)
      const bar = page.locator('.tz-replay__bar')
      // Todo lo que partía la cabecera está ahí: avisos, estado de pista deducido con su bandera, meteorología sin dato,
      // análisis y herramientas de la escena.
      await expect(page.getByTestId('session-notes')).toHaveAccessibleName(/^5 /)
      await expect(page.getByTestId('track-status').getByTestId('track-sector')).toBeVisible()
      await expect(page.getByTestId('weather')).toBeVisible()
      await expect(page.locator('.tz-weather')).toHaveAttribute('data-state', 'absent')
      await expect(page.getByTestId('analysis-button')).toBeVisible()
      await expect(page.getByTestId('scene-tools')).toBeVisible()

      const middles = await barRowMiddles(page)
      expect(middles.length).toBeGreaterThanOrEqual(7)
      expect(Math.max(...middles) - Math.min(...middles)).toBeLessThanOrEqual(4)
      expect((await bar.boundingBox())!.height).toBeLessThanOrEqual(56)
      expect(await overflowing(page)).toEqual([])
      // El título tiene prioridad (D44): si aun así se acorta con «…», es que todo lo secundario ya está en su forma
      // más corta (por la media query de < 1360 px o por `data-fit` con el nivel 3).
      const fit = await titleFit(page)
      if (fit.truncated) expect(vp.width < 1360 || fit.levels.includes('3')).toBe(true)

      // Ninguna etiqueta «Estimado» se esconde: la del estado de pista, en la cabecera (corta, pulsable); la de las
      // posiciones, flotando justo debajo, sobre el mapa, sin tapar la clasificación ni la columna derecha.
      const words = /Estimad[oa]|Estimated/
      const track = page.getByTestId('track-status').locator('[data-testid="estimated"][data-field="trackStatus"]')
      await expect(track).toBeVisible()
      await expect(track).toContainText(words, { useInnerText: true })
      const positions = page.getByTestId('scene-estimated').locator('[data-testid="estimated"][data-field="positions"]')
      await expect(positions).toBeVisible()
      await expect(positions).toContainText(words, { useInnerText: true })
      const p = (await positions.boundingBox())!
      const b = (await bar.boundingBox())!
      const lb = (await page.getByTestId('leaderboard').boundingBox())!
      const side = (await page.locator('.tz-replay__side').boundingBox())!
      expect(p.y).toBeGreaterThanOrEqual(b.y + b.height - 1)
      expect(p.x).toBeGreaterThanOrEqual(lb.x + lb.width)
      expect(p.x + p.width).toBeLessThanOrEqual(side.x)

      // Pulsar «Estimado» explica por qué (en iPad un título no se ve).
      await track.getByRole('button').click()
      await expect(page.getByTestId('estimated-trackStatus-why-panel')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('estimated-trackStatus-why-panel')).toBeHidden()

      // Con la hoja de análisis abierta, la escena está tapada: sus etiquetas no flotan sobre la hoja (la del estado
      // de pista, en la cabecera, sigue). Al cerrarla, vuelven.
      await page.getByTestId('analysis-button').click()
      await expect(page.getByTestId('analysis-sheet')).toBeVisible()
      await expect(positions).toBeHidden()
      await expect(track).toBeVisible()
      await page.getByTestId('analysis-close').click()
      await expect(page.getByTestId('analysis-sheet')).toBeHidden()
      await expect(positions).toBeVisible()
    })

    test('el replay ocupa la ventana exacta: sin cabecera global, con el dock y el disclaimer a la vista', async ({ page }) => {
      await open(page)
      await expect(page.locator('.tz-header')).toHaveCount(0)
      await expect(page.getByTestId('brand-link')).toBeVisible()
      const dock = (await page.getByTestId('replay-dock').boundingBox())!
      const footer = (await page.getByTestId('disclaimer').boundingBox())!
      expect(dock.y + dock.height).toBeLessThanOrEqual(footer.y)
      expect(Math.round(footer.y + footer.height)).toBe(vp.height)
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(vp.height)
      // Desde 1280 px, controles y timeline en una sola fila: el dock no llega a los 80 px de alto.
      expect(dock.height).toBeLessThanOrEqual(80)
      const play = (await page.getByTestId('play-toggle').boundingBox())!
      const timeline = (await page.getByTestId('timeline').boundingBox())!
      expect(timeline.x).toBeGreaterThan(play.x + play.width)
      expect(Math.abs(timeline.y + timeline.height / 2 - (play.y + play.height / 2))).toBeLessThan(dock.height / 2)
    })
  })
}

test.describe('girar la tablet', () => {
  test.use({ hasTouch: true })

  const camera = (page: Page) => page.evaluate(() => window.__trazada!.scene.camera)
  const close = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]!) <= Math.max(1, Math.abs(b[i]!) * 0.01))

  test('vertical → horizontal: la cámara vuelve a encuadrar el circuito como si se abriera en horizontal', async ({ browser }) => {
    const landscape = await browser.newPage({ viewport: { width: 1024, height: 768 }, hasTouch: true })
    await open(landscape)
    const expected = await camera(landscape)
    await landscape.close()

    const page = await browser.newPage({ viewport: { width: 768, height: 1024 }, hasTouch: true })
    await open(page)
    const portrait = await camera(page)
    expect(close(portrait, expected)).toBe(false)
    await page.setViewportSize({ width: 1024, height: 768 })
    await expect.poll(async () => close(await camera(page), expected), { timeout: 5000 }).toBe(true)
    await page.close()
  })

  test('girar mientras se sigue a un coche: al dejar de seguirlo, la vista general es la del tamaño nuevo', async ({ browser }) => {
    const pick = (page: Page) => page.locator('[data-testid="leaderboard"] [data-car]').first().getByRole('button').click()
    const landscape = await browser.newPage({ viewport: { width: 1024, height: 768 }, hasTouch: true })
    await open(landscape)
    await pick(landscape)
    await landscape.waitForTimeout(500)
    const expected = await camera(landscape)
    await landscape.close()

    const page = await browser.newPage({ viewport: { width: 768, height: 1024 }, hasTouch: true })
    await open(page)
    await pick(page)
    await page.getByTestId('follow-toggle').click()
    await expect.poll(() => page.evaluate(() => window.__trazada!.scene.cameraMode), { timeout: 5000 }).toBe('follow')
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.waitForTimeout(300)
    await page.getByTestId('follow-toggle').click()
    await expect.poll(() => page.evaluate(() => window.__trazada!.scene.cameraMode), { timeout: 5000 }).toBe('overview')
    await expect.poll(async () => close(await camera(page), expected), { timeout: 5000 }).toBe(true)
    await page.close()
  })

  test('la barra de arriba cambia de alto (avisos de pista): la cámara no salta', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 })
    await open(page)
    await page.waitForTimeout(500)
    const before = await camera(page)
    await page.addStyleTag({ content: '.tz-replay__bar { padding-bottom: 28px !important; }' })
    await page.waitForTimeout(500)
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    expect(await camera(page)).toEqual(before)
  })

  test('si el usuario ha movido la cámara, girar no se la recoloca', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 })
    await open(page)
    const box = (await page.locator('[data-testid="scene"] canvas').boundingBox())!
    const x = box.x + box.width / 2
    const y = box.y + box.height / 3
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 120, y + 60, { steps: 8 })
    await page.mouse.up()
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    const moved = await camera(page)
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.waitForTimeout(500)
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    expect(close(await camera(page), moved)).toBe(true)
  })
})

/*
 * Prioridad del título (regresión de la Tanda 5): a 1920 px, con lo de una carrera dev y el nombre largo de Japón,
 * las piezas secundarias pasaban a su forma larga y el título se cortaba («JAPANESE GRAND P…»). Ahora lo secundario se
 * acorta antes (data-fit) y el título se ve entero, sin esconder «Estimado».
 */
test.describe('escritorio 1920×1080: el título de la cabecera tiene prioridad (D44)', () => {
  test.use({ viewport: { width: 1920, height: 1080 } })

  test('con una carrera dev y un Gran Premio de nombre largo, el título se ve entero y la cabecera va en una fila', async ({ page }) => {
    await resetStorage(page)
    await serveLikeDevRace(page, { event: 'Japanese Grand Prix' })
    await open(page)
    await expect(page.getByTestId('replay-title')).toContainText('Japanese Grand Prix')
    await expect.poll(async () => (await titleFit(page)).truncated).toBe(false)
    const middles = await barRowMiddles(page)
    expect(Math.max(...middles) - Math.min(...middles)).toBeLessThanOrEqual(4)
    expect(await overflowing(page)).toEqual([])
    // «Estimado» sigue a la vista (en su forma corta si hace falta) y lo acortado sigue en su nombre accesible.
    const track = page.getByTestId('track-status').locator('[data-testid="estimated"][data-field="trackStatus"]')
    await expect(track).toBeVisible()
    await expect(track).toContainText(/Estimad[oa]|Estimated/, { useInnerText: true })
    await expect(page.getByTestId('session-notes')).toHaveAccessibleName(/^5 /)
    await expect(page.getByTestId('analysis-button')).toHaveAccessibleName(/^(Análisis|Analysis)$/)
  })

  test('con los datos del fixture (meteorología completa a 1920 px), el título también se ve entero, en una fila', async ({ page }) => {
    await resetStorage(page)
    await open(page)
    await expect.poll(async () => (await titleFit(page)).truncated).toBe(false)
    const middles = await barRowMiddles(page)
    expect(Math.max(...middles) - Math.min(...middles)).toBeLessThanOrEqual(4)
    // Lo que se acortara sigue en su nombre accesible: la meteorología lo dice todo.
    await expect(page.getByTestId('weather')).toHaveAccessibleName(/.+/)
  })
})

/**
 * Elige un diseño con el control de la cabecera: el segmentado o, en táctil por debajo de 1360 px (o con la cabecera
 * compactada), el botón que alterna (pulsado = «Análisis»). El control queda diciendo el diseño elegido.
 */
async function chooseLayout(page: Page, preset: 'spectator' | 'analysis') {
  const option = page.getByTestId(`layout-${preset}`)
  if (await option.isVisible()) {
    await option.click()
    await expect(option).toHaveAttribute('aria-pressed', 'true')
  } else {
    const toggle = page.getByTestId('layout-toggle')
    const pressed = String(preset === 'analysis')
    await expect(toggle).toBeVisible()
    if ((await toggle.getAttribute('aria-pressed')) !== pressed) await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', pressed)
  }
  await expect(page.locator('.tz-replay')).toHaveAttribute('data-layout', preset)
}

/** Ancho que deja la página al mapa entre la clasificación y la columna derecha (px). */
async function sceneGap(page: Page): Promise<number> {
  const lb = (await page.getByTestId('leaderboard').boundingBox())!
  const side = (await page.locator('.tz-replay__side').boundingBox())!
  return side.x - (lb.x + lb.width)
}

test.describe('diseños «Espectador» y «Análisis» (ítem 15)', () => {
  for (const vp of VIEWPORTS) {
    test.describe(vp.name, () => {
      test.use({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch })

      test('«Análisis»: sus columnas y la telemetría más alta, sin scroll horizontal y con sitio para el mapa', async ({ page }) => {
        await resetStorage(page)
        await open(page)
        await expect(page.getByTestId('lb-columns')).toHaveCount(0)
        // En táctil, por debajo de 1360 px, un solo botón que alterna los dos diseños: así la cabecera de la tablet en
        // horizontal sigue en una fila (con el control segmentado se partía en dos a 1024 px).
        const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches)
        if (vp.touch && coarse) {
          await expect(page.getByTestId('layout-toggle')).toBeVisible()
          await expect(page.getByTestId('layout-toggle')).toHaveAccessibleName(/^(Diseño «Análisis»|“Analysis” layout)$/)
          await expect(page.getByTestId('layout-switch')).toBeHidden()
        } else {
          await expect(page.getByTestId('layout-switch')).toBeVisible()
          await expect(page.getByTestId('layout-toggle')).toBeHidden()
        }
        if (vp.width > vp.height) {
          const middles = await barRowMiddles(page)
          expect(Math.max(...middles) - Math.min(...middles)).toBeLessThanOrEqual(4)
        }
        await chooseLayout(page, 'analysis')
        await expect(page.getByTestId('lb-columns')).toBeVisible()
        const first = page.locator('[data-testid="leaderboard"] [data-car]').first()
        await expect(first.getByTestId('lb-best')).toBeVisible()
        await expect(first.getByTestId('lb-last')).toBeVisible()
        await expect(first.getByTestId('lb-pits')).toBeVisible()
        await page.locator('[data-testid="leaderboard"] [data-car]').nth(3).getByRole('button').click()
        await expect(page.getByTestId('telemetry')).toBeVisible()
        await expect(page.locator('[data-testid="telemetry"] .tz-chart[data-tall]')).toHaveCount(2)
        await expect(page.locator('[data-testid="telemetry"] .tz-chart[data-window-s="40"]')).toHaveCount(2)
        expect(await overflowing(page)).toEqual([])
        // Fuera de la tablet en vertical, el mapa conserva su sitio entre los dos paneles (engine/layout/clamp.ts: en
        // tablet, con los dos paneles en su mínimo, algo menos que su mínimo de 320 px).
        if (!(vp.width <= 900 && vp.height > vp.width)) expect(await sceneGap(page)).toBeGreaterThanOrEqual(300)

        // De vuelta a «Espectador»: la clasificación de siempre.
        await chooseLayout(page, 'spectator')
        await expect(page.getByTestId('lb-columns')).toHaveCount(0)
        await expect(page.locator('[data-testid="telemetry"] .tz-chart[data-tall]')).toHaveCount(0)
        expect(await overflowing(page)).toEqual([])
      })
    })
  }

  test.describe('escritorio 1440×900', () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    test('el diseño se recuerda al recargar (por navegador) y la tecla L lo cambia', async ({ page }) => {
      // Sin resetStorage: este test recarga y lo guardado tiene que seguir ahí (cada test empieza con el suyo vacío).
      await open(page)
      await page.getByTestId('replay-title').click()
      await page.keyboard.press('l')
      await expect(page.locator('.tz-replay')).toHaveAttribute('data-layout', 'analysis')
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('trazada.layout') ?? 'null'))
      expect(saved).toMatchObject({ _v: 1, preset: 'analysis' })
      await page.reload()
      await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true')
      await expect(page.getByTestId('leaderboard')).toBeVisible({ timeout: 15_000 })
      await expect(page.locator('.tz-replay')).toHaveAttribute('data-layout', 'analysis')
      await expect(page.getByTestId('lb-columns')).toBeVisible()
    })

    test('accesible (axe) en «Análisis», con las asas', async ({ page }) => {
      await resetStorage(page)
      await open(page)
      await page.getByTestId('layout-analysis').click()
      await expect(page.getByTestId('lb-columns')).toBeVisible()
      await expect(page.getByTestId('resize-lb')).toHaveAttribute('role', 'separator')
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .exclude('[data-testid="scene"] canvas')
        .analyze()
      const serious = results.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)
      expect(serious).toEqual([])
    })
  })
})

test.describe('asas de los paneles (ítem 15)', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  const framing = (page: Page) => page.evaluate(() => window.__trazada!.scene.framing)
  const lbWidth = async (page: Page) => (await page.getByTestId('leaderboard').boundingBox())!.width

  test('arrastrar el asa cambia el ancho; la escena reencuadra al soltar (no en cada movimiento) y se recuerda al recargar', async ({ page }) => {
    await open(page)
    await page.waitForTimeout(600)
    const before = await lbWidth(page)
    const framed = await framing(page)
    const handle = page.getByTestId('resize-lb')
    await expect(handle).toHaveAttribute('aria-valuenow', '300')
    const hb = (await handle.boundingBox())!
    const x = hb.x + hb.width / 2
    const y = hb.y + hb.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 60, y, { steps: 6 })
    // Durante el arrastre: el panel sigue al puntero, la escena aún no reencuadra.
    await expect(page.locator('.tz-replay')).toHaveAttribute('data-resizing', '')
    await expect.poll(() => lbWidth(page)).toBeCloseTo(before + 60, -1)
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    expect(await framing(page)).toEqual(framed)
    await page.mouse.up()
    await expect(page.locator('.tz-replay')).not.toHaveAttribute('data-resizing')
    await expect(handle).toHaveAttribute('aria-valuenow', '360')
    // Al soltar, un encuadre nuevo: el hueco libre empieza más a la derecha.
    await expect.poll(async () => (await framing(page))!.free.x0).toBeGreaterThan(framed!.free.x0)
    expect(await overflowing(page)).toEqual([])
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('trazada.layout') ?? 'null'))
    expect(saved.presets.spectator.lb).toBe(360)

    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true')
    await expect(page.getByTestId('leaderboard')).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => lbWidth(page)).toBeCloseTo(before + 60, -1)
    await expect(page.getByTestId('resize-lb')).toHaveAttribute('aria-valuenow', '360')
  })

  test('con el teclado: → y ← cambian el ancho sin mover el reloj; Intro y doble clic lo restablecen', async ({ page }) => {
    await resetStorage(page)
    await open(page)
    const t0 = await page.evaluate(() => window.__trazada!.timeMs)
    const handle = page.getByTestId('resize-side')
    await handle.focus()
    await page.keyboard.press('ArrowLeft')
    await expect(handle).toHaveAttribute('aria-valuenow', '316')
    await page.keyboard.press('Shift+ArrowLeft')
    await expect(handle).toHaveAttribute('aria-valuenow', '380')
    await page.keyboard.press('ArrowRight')
    await expect(handle).toHaveAttribute('aria-valuenow', '364')
    expect(await page.evaluate(() => window.__trazada!.timeMs)).toBe(t0)
    expect(Math.round((await page.locator('.tz-replay__side').boundingBox())!.width)).toBe(364)
    await page.keyboard.press('Enter')
    await expect(handle).toHaveAttribute('aria-valuenow', '300')
    await page.keyboard.press('End')
    const max = Number(await handle.getAttribute('aria-valuemax'))
    await expect(handle).toHaveAttribute('aria-valuenow', String(max))
    // El máximo deja al mapa su mínimo (engine/layout/clamp.ts).
    expect(await sceneGap(page)).toBeGreaterThanOrEqual(1440 * 0.3)
    await handle.dblclick()
    await expect(handle).toHaveAttribute('aria-valuenow', '300')
  })

  test.describe('iPad vertical 768×1024', () => {
    test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true })

    test('en vertical no hay asas: los paneles van en la franja de abajo', async ({ page }) => {
      await resetStorage(page)
      await open(page)
      await expect(page.getByTestId('resize-lb')).toHaveCount(0)
      await expect(page.getByTestId('resize-side')).toHaveCount(0)
    })
  })
})
