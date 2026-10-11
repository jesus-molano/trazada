import { expect, type Page } from '@playwright/test'

/**
 * Pistas de primer uso (ítem 18, `stores/tips.ts`): en `trazada.tips`, `{ "all": true }` las da todas por vistas,
 * también las que añadan versiones futuras. Los e2e que no prueban las pistas las marcan así para que sus burbujas
 * no tapen clics ni cambien capturas.
 */
export const TIPS_KEY = 'trazada.tips'
export const TIPS_ALL_SEEN = JSON.stringify({ all: true })

const tipsMarked = new WeakSet<Page>()

/**
 * Marca las pistas de primer uso como vistas en cada carga de la página, salvo que la página ya tenga su propio
 * valor (el spec de las pistas pone el suyo, o vacía el almacenamiento antes de navegar sin pasar por aquí).
 */
export async function markTipsSeen(page: Page): Promise<void> {
  if (tipsMarked.has(page)) return
  tipsMarked.add(page)
  await page.addInitScript(
    ([key, value]) => {
      try {
        if (localStorage.getItem(key!) === null) localStorage.setItem(key!, value!)
      } catch {
        // sin almacenamiento: no hay pistas que recordar
      }
    },
    [TIPS_KEY, TIPS_ALL_SEEN],
  )
}

/**
 * Almacenamiento vacío en cada carga de la página (también al recargar), salvo las pistas de primer uso, que
 * quedan vistas. Sustituye a `addInitScript(() => localStorage.clear())`.
 */
export async function resetStorage(page: Page): Promise<void> {
  tipsMarked.add(page)
  await page.addInitScript(
    ([key, value]) => {
      localStorage.clear()
      localStorage.setItem(key!, value!)
    },
    [TIPS_KEY, TIPS_ALL_SEEN],
  )
}

/**
 * Navega y espera a que la app esté hidratada (interactiva), no solo pintada por SSR. Con las pistas de primer uso
 * vistas, salvo `{ tips: true }` (el spec que las prueba).
 */
export async function gotoApp(page: Page, path: string, options: { tips?: boolean } = {}): Promise<void> {
  if (!options.tips) await markTipsSeen(page)
  await page.goto(path)
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true')
}

/**
 * Espera a que la interfaz quede quieta antes de auditarla con axe. axe mide los colores tal como están pintados en
 * ese instante y, a mitad de una transición, mediría un estado intermedio que nunca se queda en pantalla: un botón que
 * pasa de la placa de pintura a transparente (el «×1» que deja de estar pulsado, «Descargar» que pasa a «Cancelar»)
 * cambia el fondo en 120 ms (`--tz-dur-fast`) con el texto ya claro, y a mitad es claro sobre claro (con SwiftShader,
 * más rato si el hilo principal está ocupado). Se esperan las transiciones y animaciones finitas en marcha, con un tope
 * de 2 s (las infinitas no acaban nunca).
 */
export async function settled(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const running = document
      .getAnimations()
      .filter((a) => a.playState === 'running' && a.effect?.getComputedTiming().endTime !== Infinity)
      .map((a) => a.finished.catch(() => undefined))
    await Promise.race([Promise.all(running), new Promise((r) => setTimeout(r, 2000))])
  })
}
