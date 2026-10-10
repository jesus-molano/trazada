/** Worker del despliegue privado (deploy/private/worker.mjs): nada sin contraseña. */
import { describe, expect, it, vi } from 'vitest'
// @ts-expect-error módulo JS de deploy/ sin tipos
import worker, { makeToken, safeNext, verifyToken } from '../../../../deploy/private/worker.mjs'

const PASSWORD = 'una-contraseña-larga'
const BASE = 'https://trazada-privada.ejemplo.workers.dev'

function env(over: Record<string, unknown> = {}) {
  const assets = vi.fn(
    async (req: Request) =>
      new Response(`asset ${new URL(req.url).pathname}`, {
        headers: { 'content-type': 'text/html', 'cache-control': 'public, max-age=0, must-revalidate' },
      }),
  )
  return { ACCESS_PASSWORD: PASSWORD, LOGIN_DELAY_MS: 0, ASSETS: { fetch: assets }, ...over }
}

const nav = (path: string, headers: Record<string, string> = {}) =>
  new Request(BASE + path, { headers: { 'Sec-Fetch-Mode': 'navigate', Accept: 'text/html', ...headers } })

async function login(e: ReturnType<typeof env>, password: string, next = '/replay?s=2026/10-spa-francorchamps/fp1') {
  const body = new URLSearchParams({ password, next })
  return worker.fetch(new Request(BASE + '/__acceso', { method: 'POST', body }), e) as Promise<Response>
}

const cookieOf = (res: Response) => res.headers.get('set-cookie')!.split(';')[0]!

describe('acceso privado', () => {
  it('sin contraseña configurada (o corta) no sirve nada', async () => {
    for (const ACCESS_PASSWORD of [undefined, 'corta']) {
      const e = env({ ACCESS_PASSWORD })
      const res = await worker.fetch(nav('/'), e)
      expect(res.status).toBe(503)
      expect(e.ASSETS.fetch).not.toHaveBeenCalled()
    }
  })

  it('sin cookie: una navegación va a la página de acceso (conservando la ruta) y el resto recibe 401', async () => {
    const e = env()
    const res = await worker.fetch(nav('/replay?s=2026/10-spa-francorchamps/fp1'), e)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/__acceso?next=%2Freplay%3Fs%3D2026%2F10-spa-francorchamps%2Ffp1')
    const data = await worker.fetch(new Request(BASE + '/data/v1/catalog.json'), e)
    expect(data.status).toBe(401)
    expect(e.ASSETS.fetch).not.toHaveBeenCalled()
  })

  it('página de acceso: formulario, sin indexar ni cachear', async () => {
    const res = await worker.fetch(nav('/__acceso?next=%2Freplay'), env())
    expect(res.status).toBe(200)
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    expect(res.headers.get('cache-control')).toBe('no-store')
    const html = await res.text()
    expect(html).toContain('type="password"')
    expect(html).toContain('name="next" value="/replay"')
  })

  it('contraseña incorrecta: 401 sin cookie; correcta: cookie firmada y vuelta a la ruta pedida', async () => {
    const e = env()
    const bad = await login(e, 'otra-contraseña-cualquiera')
    expect(bad.status).toBe(401)
    expect(bad.headers.get('set-cookie')).toBeNull()
    const ok = await login(e, PASSWORD)
    expect(ok.status).toBe(303)
    expect(ok.headers.get('location')).toBe('/replay?s=2026/10-spa-francorchamps/fp1')
    const cookie = ok.headers.get('set-cookie')!
    expect(cookie).toMatch(/^trazada_acceso=\d+\.[0-9a-f]{64}; Path=\/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax$/)
  })

  it('con la cookie: sirve los assets, privados y sin indexar; los datos con hash, inmutables', async () => {
    const e = env()
    const cookie = cookieOf(await login(e, PASSWORD))
    const page = await worker.fetch(nav('/replay', { Cookie: cookie }), e)
    expect(page.status).toBe(200)
    expect(await page.text()).toBe('asset /replay')
    expect(page.headers.get('cache-control')).toBe('private, max-age=0, must-revalidate')
    expect(page.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    const gz = await worker.fetch(new Request(BASE + '/data/v1/sessions/x/motion.abcd1234.trzb.gz', { headers: { Cookie: cookie } }), e)
    expect(gz.headers.get('cache-control')).toBe('private, max-age=31536000, immutable')
    const json = await worker.fetch(new Request(BASE + '/data/v1/catalog.json', { headers: { Cookie: cookie } }), e)
    expect(json.headers.get('cache-control')).toBe('private, no-cache')
  })

  it('cookie manipulada, caducada o de otra contraseña: no vale', async () => {
    const now = Math.floor(Date.now() / 1000)
    const good = await makeToken(PASSWORD, now)
    expect(await verifyToken(PASSWORD, good, now)).toBe(true)
    const [exp, sig] = good.split('.')
    expect(await verifyToken(PASSWORD, `${Number(exp) + 1}.${sig}`, now)).toBe(false) // otra caducidad
    expect(await verifyToken(PASSWORD, `${exp}.${'0'.repeat(64)}`, now)).toBe(false)
    expect(await verifyToken(PASSWORD, good, Number(exp) + 1)).toBe(false) // caducada
    expect(await verifyToken('otra-contraseña-larga', good, now)).toBe(false) // cambio de contraseña
    expect(await verifyToken(PASSWORD, 'basura', now)).toBe(false)
    const e = env()
    const res = await worker.fetch(nav('/', { Cookie: `trazada_acceso=${exp}.${'f'.repeat(64)}` }), e)
    expect(res.status).toBe(302)
    expect(e.ASSETS.fetch).not.toHaveBeenCalled()
  })

  it('sin redirecciones abiertas', () => {
    for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example', 'javascript:alert(1)', '/__acceso?x', '/a\r\nSet-Cookie: x', null]) {
      expect(safeNext(bad)).toBe('/')
    }
    expect(safeNext('/replay?s=2026/10-spa-francorchamps/fp1')).toBe('/replay?s=2026/10-spa-francorchamps/fp1')
  })

  it('el "next" del formulario se escapa en el HTML', async () => {
    const res = await worker.fetch(nav('/__acceso?next=%2F%22%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E'), env())
    const html = await res.text()
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&#34;&#62;&#60;script&#62;')
  })

  it('salir borra la cookie', async () => {
    const res = await worker.fetch(nav('/__salir'), env())
    expect(res.status).toBe(303)
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0')
  })
})
