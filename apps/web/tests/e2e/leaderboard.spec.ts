import { createHash } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import { expect, type Page, test } from '@playwright/test'
import { gotoApp } from './helpers'

const SESSION = '2026/10-spa-francorchamps/fp1'
const FP1 = `/replay?s=${SESSION}`

async function open(page: Page) {
  await gotoApp(page, FP1)
  await expect(page.getByTestId('leaderboard')).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('replay-title').click()
}

test('una fila por piloto con posiciones 1…N; clic selecciona; ↑/↓ siguen el orden', async ({ page }) => {
  await open(page)
  const drivers = await page.evaluate(() => window.__trazada!.drivers.length)
  const rows = page.locator('[data-testid="leaderboard"] [data-car]')
  await expect(rows).toHaveCount(drivers)
  const positions = await rows.evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-position'))))
  expect(positions).toEqual(Array.from({ length: drivers }, (_, i) => i + 1))

  const third = rows.nth(2)
  const car = await third.getAttribute('data-car')
  await third.getByRole('button').click()
  await expect.poll(() => page.evaluate(() => window.__trazada!.selectedCar)).toBe(car)

  await page.getByTestId('replay-title').click()
  await page.keyboard.press('ArrowDown')
  const fourth = await rows.nth(3).getAttribute('data-car')
  await expect.poll(() => page.evaluate(() => window.__trazada!.selectedCar)).toBe(fourth)
})

test('se actualiza a ≥ 4 Hz durante la reproducción (si la página va fluida)', async ({ page }) => {
  await open(page)
  // Se registran los instantes de cada frame para saber cuántas actualizaciones permitía la cadencia real.
  await page.evaluate(() => {
    const w = window as Window & { __frameTimes?: number[] }
    w.__frameTimes = []
    const tick = (now: number) => {
      w.__frameTimes!.push(now)
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await page.keyboard.press(' ')
  const read = () => page.evaluate(() => window.__trazada!.leaderboard.updates)
  const u0 = await read()
  const t0 = await page.evaluate(() => performance.now())
  await page.waitForTimeout(2000)
  const u1 = await read()
  const times = await page.evaluate((from) => {
    const all = (window as Window & { __frameTimes?: number[] }).__frameTimes ?? []
    return all.filter((t) => t >= from)
  }, t0)
  await page.keyboard.press(' ')
  const updates = u1 - u0
  // Con la misma regla que el leaderboard (≥ 150 ms entre actualizaciones), ¿cuántas cabían en estos frames?
  let last = -Infinity
  let possible = 0
  for (const t of times) {
    if (t - last >= 150) {
      possible++
      last = t
    }
  }
  const gaps = times.slice(1).map((t, i) => t - times[i]!).sort((a, b) => a - b)
  const p95gap = gaps[Math.floor(gaps.length * 0.95)] ?? Infinity
  const durations = await page.evaluate(() => window.__trazada!.leaderboard.durations)
  console.log(
    `leaderboard: ${updates} actualizaciones en 2 s (cabían ${possible}; p95 entre frames ${p95gap.toFixed(0)} ms); máx ${Math.max(...durations).toFixed(2)} ms`,
  )
  expect(updates).toBeGreaterThan(0)
  // Nunca menos de las que permitía la cadencia de frames (margen por el desfase entre bucles).
  expect(updates).toBeGreaterThanOrEqual(possible - 2)
  // El criterio (≥ 4 Hz) es para la máquina de referencia; aquí se exige solo si los frames son regulares
  // (con WebGL por software en CI llegan a ráfagas y el leaderboard no puede ir más rápido que ellos).
  if (p95gap < 50) expect(updates).toBeGreaterThanOrEqual(8)
})

test('un piloto sin datos muestra "sin señal"', async ({ page }) => {
  await open(page)
  const hidden = await page.evaluate(() => window.__trazada!.cars().filter((c) => !c.visible).map((c) => c.car))
  test.skip(hidden.length === 0, 'todos los coches tienen datos en este instante')
  await expect(page.locator(`[data-testid="leaderboard"] [data-car="${hidden[0]}"] [data-testid="no-signal"]`)).toBeVisible()
})

// ── Clasificación animada (ítem 8) ────────────────────────────────────────────────────────────────────────────

/**
 * Datos sintéticos para ver cambios de orden: en la ventana del fixture la torre oficial no cambia (ni las mejores
 * vueltas), así que la sesión se sirve como una carrera sin torre (posiciones de la torre a 0, el resto igual): el
 * orden sale entonces de los pasos por meta, que sí cambian. Se reescribe el byte de cada posición en el TRZB (sin
 * mover nada más) y el sha256/tamaño del manifest. Solo en este spec; nunca llega a la app ni a los datos.
 */
function zeroTowerPositions(gz: Buffer): Buffer {
  const raw = gunzipSync(gz)
  if (raw.toString('latin1', 0, 4) !== 'TRZB') throw new Error('no es un TRZB')
  const headerLen = raw.readUInt32LE(8)
  const header = JSON.parse(raw.toString('utf8', 12, 12 + headerLen)) as {
    tables: { name: string; columns: { name: string; type: string; encoding?: string; byteOffset: number; byteLength: number }[] }[]
  }
  const column = header.tables.find((t) => t.name === 'stream')?.columns.find((c) => c.name === 'position')
  if (!column || column.type !== 'u8' || (column.encoding ?? 'raw') !== 'raw') throw new Error('stream.position no es u8 sin codificar')
  const base = Math.ceil((12 + headerLen) / 8) * 8
  raw.fill(0, base + column.byteOffset, base + column.byteOffset + column.byteLength)
  return gzipSync(raw)
}

async function serveAsRaceWithoutTower(page: Page): Promise<void> {
  let patched: Promise<Buffer> | null = null
  const timing = (url: string) => (patched ??= page.request.get(url).then(async (r) => zeroTowerPositions(await r.body())))
  await page.route(`**/sessions/${SESSION}/manifest.json`, async (route) => {
    const res = await route.fetch()
    const manifest = await res.json()
    const body = await timing(new URL(manifest.files.timing.path, route.request().url()).href)
    manifest.session.type = 'race'
    manifest.files.timing.bytes = body.byteLength
    manifest.files.timing.sha256 = createHash('sha256').update(body).digest('hex')
    await route.fulfill({ response: res, json: manifest })
  })
  await page.route(`**/sessions/${SESSION}/timing.*.trzb.gz`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/gzip', body: await timing(route.request().url()) })
  })
}

/** En esos datos, el 55 pasa al 12 por el primer puesto al cruzar la línea (lo comprueba changes.test.ts). */
const PASS_MS = 4_250_100
const PASSER = '55'
const PASSED = '12'

type RowsWatch = { slid: string[]; flashed: string[]; reorders: number }

/**
 * Registra desde ya qué filas se deslizan (clase move del FLIP), cuáles destellan y cuántas veces cambia el orden de la
 * lista. (Vue mete y saca de la lista un clon oculto de una fila para medir la transición: no cuenta como reordenar.)
 */
async function watchRows(page: Page): Promise<() => Promise<RowsWatch>> {
  await page.evaluate(() => {
    const list = document.querySelector('[data-testid="lb-rows"]')!
    const order = () =>
      [...list.children]
        .filter((c) => (c as HTMLElement).style.display !== 'none')
        .map((c) => c.getAttribute('data-car'))
        .join()
    let last = order()
    const rec = { slid: new Set<string>(), flashed: new Set<string>(), reorders: 0 }
    ;(window as Window & { __lbWatch?: typeof rec }).__lbWatch = rec
    new MutationObserver((records) => {
      for (const r of records) {
        const el = r.target as Element
        if (r.type === 'attributes' && el.matches('li[data-car]') && el.classList.contains('tz-lb-move')) {
          rec.slid.add(el.getAttribute('data-car')!)
        }
        for (const n of r.addedNodes) {
          if (n instanceof Element && n.matches('[data-testid="rank-flash"]')) rec.flashed.add(n.closest('li')!.getAttribute('data-car')!)
        }
      }
      const now = order()
      if (now !== last) {
        rec.reorders++
        last = now
      }
    }).observe(list, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] })
  })
  return () =>
    page.evaluate(() => {
      const rec = (window as Window & { __lbWatch?: { slid: Set<string>; flashed: Set<string>; reorders: number } }).__lbWatch!
      return { slid: [...rec.slid], flashed: [...rec.flashed], reorders: rec.reorders }
    })
}

const lbRow = (page: Page, car: string) => page.locator(`[data-testid="leaderboard"] [data-car="${car}"]`)
const seek = (page: Page, ms: number) => page.evaluate((t) => window.__trazada!.seek(t), ms)

/** transition-duration de una fila con la clase del FLIP puesta (y quitada) a mano. */
const moveDuration = (page: Page) =>
  lbRow(page, PASSER).evaluate((el) => {
    el.classList.add('tz-lb-move')
    const d = getComputedStyle(el).transitionDuration
    el.classList.remove('tz-lb-move')
    return d
  })

test('libres con torre: el orden oficial no cambia en la ventana, así que ni flechas ni avisos', async ({ page }) => {
  await open(page)
  await page.getByTestId('rate-4').click()
  await page.getByTestId('replay-title').click()
  await page.keyboard.press(' ')
  await page.waitForTimeout(1500)
  await page.keyboard.press(' ')
  await expect(page.locator('[data-testid="leaderboard"] [data-change]')).toHaveCount(0)
  await expect(page.getByTestId('rank-live')).toHaveText('')
})

test('al adelantar, las filas se deslizan, llevan ↑/↓ con cifra y texto y destellan; un seek lo borra', async ({ page }) => {
  await serveAsRaceWithoutTower(page)
  await open(page)
  expect(await moveDuration(page)).not.toBe('0s')
  await seek(page, PASS_MS - 2_000)
  await expect(page.locator('[data-testid="leaderboard"] [data-change]')).toHaveCount(0)
  const watch = await watchRows(page)
  await page.keyboard.press(' ')
  await expect(lbRow(page, PASSER)).toHaveAttribute('data-change', 'up', { timeout: 15_000 })
  await page.keyboard.press(' ')
  // Foto de las dos filas en el momento (las flechas caducan a los pocos segundos de pared).
  const rows = await page.evaluate((cars) => {
    return cars.map((car) => {
      const li = document.querySelector(`[data-testid="leaderboard"] [data-car="${car}"]`)!
      const arrow = li.querySelector('[data-testid="rank-change"]')
      return {
        change: li.getAttribute('data-change'),
        position: li.getAttribute('data-position'),
        icon: arrow?.querySelector('[data-icon]')?.getAttribute('data-icon') ?? null,
        digits: arrow?.querySelector('span[aria-hidden="true"]')?.textContent ?? null,
        text: arrow?.querySelector('.tz-visually-hidden')?.textContent ?? null,
      }
    })
  }, [PASSER, PASSED])
  expect(rows[0]).toMatchObject({ change: 'up', position: '1', icon: 'gain', digits: '1' })
  expect(rows[0]!.text).toMatch(/ganó 1 posición|gained 1 place/)
  // Icono, cifra y texto (nunca solo el color).
  expect(rows[1]).toMatchObject({ change: 'down', position: '2', icon: 'loss', digits: '1' })
  expect(rows[1]!.text).toMatch(/perdió 1 posición|lost 1 place/)
  const seen = await watch()
  expect(seen.slid).toEqual(expect.arrayContaining([PASSER, PASSED]))
  expect(seen.flashed).toEqual(expect.arrayContaining([PASSER, PASSED]))
  // Aviso para lectores de pantalla (como mucho uno cada pocos segundos).
  await expect(page.getByTestId('rank-live')).toContainText(/(ganó|gained) 1/)

  // Tras un seek no queda ninguna flecha, ni vuelve a salir sin otro cambio.
  await seek(page, PASS_MS + 30_000)
  await expect(page.locator('[data-testid="leaderboard"] [data-change]')).toHaveCount(0)
  await expect(page.getByTestId('rank-live')).toHaveText('')
  await page.waitForTimeout(500)
  await expect(page.locator('[data-testid="leaderboard"] [data-change]')).toHaveCount(0)
})

test('a ×16 la lista se reordena sin deslizarse ni destellar, pero con flechas', async ({ page }) => {
  await serveAsRaceWithoutTower(page)
  await open(page)
  await seek(page, PASS_MS - 10_000)
  await page.getByTestId('rate-16').click()
  await page.getByTestId('replay-title').click()
  const watch = await watchRows(page)
  await page.keyboard.press(' ')
  // Hasta que el reloj deje atrás el adelantamiento, no un tiempo fijo: el reloj avanza como mucho MAX_DELTA_MS ×
  // velocidad por frame, y con WebGL por software y la CPU compartida con otros tests, 2 s de pared a ×16 a veces no
  // llegaban a los 10 s de sesión que faltan.
  await expect
    .poll(() => page.evaluate(() => window.__trazada!.timeMs), { timeout: 20_000 })
    .toBeGreaterThan(PASS_MS + 6_000)
  await page.keyboard.press(' ')
  const seen = await watch()
  expect(seen.reorders).toBeGreaterThan(0)
  expect(seen.slid).toEqual([])
  expect(seen.flashed).toEqual([])
  // Las flechas sí (son información, no movimiento): la del 55 sale aunque no se deslice.
  await seek(page, PASS_MS - 3_000)
  const afterSeek = await watchRows(page)
  await page.getByTestId('replay-title').click()
  await page.keyboard.press(' ')
  await expect(lbRow(page, PASSER)).toHaveAttribute('data-change', 'up', { timeout: 15_000 })
  await page.keyboard.press(' ')
  expect((await afterSeek()).slid).toEqual([])
})

test('con prefers-reduced-motion: reordenación instantánea, flechas estáticas y sin destello', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await serveAsRaceWithoutTower(page)
  await open(page)
  expect(await moveDuration(page)).toBe('0s')
  await seek(page, PASS_MS - 2_000)
  const watch = await watchRows(page)
  await page.keyboard.press(' ')
  await expect(lbRow(page, PASSER)).toHaveAttribute('data-change', 'up', { timeout: 15_000 })
  await page.keyboard.press(' ')
  const seen = await watch()
  expect(seen.reorders).toBeGreaterThan(0)
  expect(seen.slid).toEqual([])
  expect(seen.flashed).toEqual([])
  await expect(page.locator('[data-testid="rank-flash"]')).toHaveCount(0)
})

// ── Diseño «Análisis» (ítem 15): columnas opcionales ─────────────────────────────────────────────────────────────

test('«Análisis»: mejor vuelta, última vuelta y entradas en el pit lane, con su rótulo, su texto y «—» sin dato', async ({ page }) => {
  await open(page)
  await page.getByTestId('layout-analysis').click()
  await expect(page.getByTestId('lb-columns')).toBeVisible()
  await expect(page.getByTestId('lb-columns')).toContainText(/(Mejor|Best)/)
  await page.evaluate(() => window.__trazada!.seek(window.__trazada!.endMs - 1_000))
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  const cells = await page.locator('[data-testid="leaderboard"] [data-car]').evaluateAll((rows) =>
    rows.map((li) => {
      const read = (id: string) => {
        const el = li.querySelector(`[data-testid="${id}"]`)!
        return {
          shown: el.querySelector('[aria-hidden="true"]')!.textContent!.trim(),
          title: el.getAttribute('title') ?? '',
          text: el.querySelector('.tz-visually-hidden')?.textContent?.trim() ?? '',
        }
      }
      return { car: li.getAttribute('data-car')!, best: read('lb-best'), last: read('lb-last'), pits: read('lb-pits') }
    }),
  )
  const time = /^\d+:\d\d[.,]\d{3}$|^\d+[.,]\d{3}$/
  for (const c of cells) {
    expect(c.best.shown, c.car).toMatch(new RegExp(`${time.source}|^—$`))
    expect(c.last.shown, c.car).toMatch(new RegExp(`${time.source}|^—$`))
    expect(c.pits.shown, c.car).toMatch(/^\d+$|^—$/)
    // El valor nunca va sin contexto: título y el mismo texto para lectores de pantalla en cada celda.
    for (const x of [c.best, c.last, c.pits]) {
      expect(x.title).not.toBe('')
      expect(x.text).toBe(x.title)
    }
  }
  // Al final del extracto, alguien tiene mejor vuelta (dato oficial del fixture).
  expect(cells.some((c) => time.test(c.best.shown))).toBe(true)
  // En libres no se estima nada: sin etiqueta «Estimado» en el pie.
  await expect(page.getByTestId('lb-estimated')).toHaveCount(0)

  // «Última» es la misma vuelta que «Última vuelta» del panel del coche (la misma regla).
  const withLap = cells.find((c) => time.test(c.last.shown))!
  await page.locator(`[data-testid="leaderboard"] [data-car="${withLap.car}"]`).getByRole('button').click()
  await expect(page.getByTestId('lap-last')).toHaveText(withLap.last.shown)
})
