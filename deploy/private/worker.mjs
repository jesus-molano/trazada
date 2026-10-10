// Worker de Cloudflare del despliegue PRIVADO (D24): sirve la app y los datos solo a quien tenga la
// contraseña. Uso personal: los datos no se publican, quedan detrás de este control de acceso.
//
// - La contraseña es un secreto de la Worker (`wrangler secret put ACCESS_PASSWORD`). Sin ella, la Worker
//   no sirve nada (falla cerrada).
// - Al entrar se guarda una cookie HttpOnly firmada con HMAC-SHA256 (clave derivada de la contraseña) que
//   caduca a los 30 días. Cambiar la contraseña invalida todas las sesiones.
// - Todo pasa por aquí (`run_worker_first`): sin cookie válida, una navegación va a la página de acceso y
//   cualquier otra petición recibe 401.
// - Nada es indexable ni cacheable por cachés compartidas.

const COOKIE = 'trazada_acceso'
const MAX_AGE_S = 30 * 24 * 3600
const LOGIN_PATH = '/__acceso'
const LOGOUT_PATH = '/__salir'
const enc = new TextEncoder()

const SECURITY_HEADERS = {
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
}

async function hmacKey(password) {
  return crypto.subtle.importKey('raw', enc.encode(`trazada-acceso:${password}`), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])
}

const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
function fromHex(hex) {
  if (!/^[0-9a-f]{64}$/.test(hex)) return null
  return Uint8Array.from(hex.match(/../g), (h) => Number.parseInt(h, 16))
}

/** Token `exp.firma`: exp en segundos Unix, firma = HMAC(clave, "v1." + exp). */
export async function makeToken(password, nowS) {
  const exp = nowS + MAX_AGE_S
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(password), enc.encode(`v1.${exp}`))
  return `${exp}.${toHex(sig)}`
}

export async function verifyToken(password, token, nowS) {
  const m = /^(\d{1,12})\.([0-9a-f]{64})$/.exec(token ?? '')
  if (!m) return false
  const exp = Number(m[1])
  if (!(exp > nowS)) return false
  const sig = fromHex(m[2])
  return crypto.subtle.verify('HMAC', await hmacKey(password), sig, enc.encode(`v1.${exp}`))
}

/** Comparación de la contraseña en tiempo constante (vía HMAC). */
async function passwordMatches(password, candidate) {
  const key = await hmacKey(password)
  const expected = await crypto.subtle.sign('HMAC', key, enc.encode(`pw.${password}`))
  return crypto.subtle.verify('HMAC', key, expected, enc.encode(`pw.${candidate}`))
}

function readCookie(request, name) {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return null
}

/** Solo rutas locales: evita redirecciones abiertas (`//otro.sitio`, `/\\otro`, esquemas…). */
export function safeNext(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/'
  if (value.startsWith(LOGIN_PATH) || /[\r\n]/.test(value)) return '/'
  return value.slice(0, 2048)
}

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

function loginPage(next, failed) {
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Trazada · acceso</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0a0c0f; color: #e8ebf0;
    font: 16px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif; }
  form { width: min(360px, calc(100% - 32px)); padding: 24px; border: 1px solid #384150; border-radius: 12px; background: #11141a; }
  h1 { margin: 0 0 4px; font-size: 20px; } p { margin: 0 0 16px; color: #9ba4b0; font-size: 14px; }
  label { display: block; margin-bottom: 6px; font-size: 14px; }
  input { box-sizing: border-box; width: 100%; padding: 10px 12px; border: 1px solid #384150; border-radius: 8px; background: #0a0c0f; color: inherit; font: inherit; }
  input:focus-visible, button:focus-visible { outline: 2px solid #8ee3ff; outline-offset: 2px; }
  button { margin-top: 16px; width: 100%; padding: 10px; border: 0; border-radius: 8px; background: #4cc9f0; color: #0a0c0f; font: inherit; font-weight: 600; cursor: pointer; }
  .error { color: #ff6b6b; }
</style></head>
<body><form method="post" action="${LOGIN_PATH}">
  <h1>Trazada</h1>
  <p>Proyecto personal y privado. <span lang="en">Personal, private project.</span></p>
  ${failed ? '<p class="error" role="alert">Contraseña incorrecta. <span lang="en">Wrong password.</span></p>' : ''}
  <label for="password">Contraseña <span lang="en">(password)</span></label>
  <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
  <input type="hidden" name="next" value="${escapeHtml(next)}">
  <button type="submit">Entrar <span lang="en">/ Sign in</span></button>
</form></body></html>`
  return new Response(html, {
    status: failed ? 401 : 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS },
  })
}

/** Cabeceras de la respuesta autenticada: nunca en cachés compartidas; los datos con hash, inmutables. */
function withHeaders(response, pathname) {
  const res = new Response(response.body, response)
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v)
  if (pathname.startsWith('/data/') && pathname.endsWith('.gz')) {
    res.headers.set('Cache-Control', 'private, max-age=31536000, immutable')
  } else if (pathname.startsWith('/data/')) {
    res.headers.set('Cache-Control', 'private, no-cache')
  } else {
    const cc = res.headers.get('Cache-Control')
    res.headers.set('Cache-Control', cc ? cc.replace(/\bpublic\b/, 'private') : 'private, no-cache')
  }
  return res
}

const nowSeconds = () => Math.floor(Date.now() / 1000)

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const password = env.ACCESS_PASSWORD
    if (typeof password !== 'string' || password.length < 12) {
      return new Response('Acceso no configurado: falta el secreto ACCESS_PASSWORD (12 caracteres o más).', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS },
      })
    }

    if (url.pathname === LOGIN_PATH) {
      if (request.method === 'POST') {
        let form
        try {
          form = await request.formData()
        } catch {
          return loginPage('/', true)
        }
        const next = safeNext(form.get('next'))
        const candidate = form.get('password')
        if (typeof candidate === 'string' && candidate.length <= 1024 && (await passwordMatches(password, candidate))) {
          const token = await makeToken(password, nowSeconds())
          return new Response(null, {
            status: 303,
            headers: {
              Location: next,
              'Set-Cookie': `${COOKIE}=${token}; Path=/; Max-Age=${MAX_AGE_S}; HttpOnly; Secure; SameSite=Lax`,
              'Cache-Control': 'no-store',
              ...SECURITY_HEADERS,
            },
          })
        }
        // Freno a los intentos por fuerza bruta (espera, sin gastar CPU).
        await new Promise((r) => setTimeout(r, Number(env.LOGIN_DELAY_MS ?? 1000)))
        return loginPage(next, true)
      }
      return loginPage(safeNext(url.searchParams.get('next')), false)
    }

    if (url.pathname === LOGOUT_PATH) {
      return new Response(null, {
        status: 303,
        headers: {
          Location: LOGIN_PATH,
          'Set-Cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
          'Cache-Control': 'no-store',
          ...SECURITY_HEADERS,
        },
      })
    }

    if (await verifyToken(password, readCookie(request, COOKIE), nowSeconds())) {
      return withHeaders(await env.ASSETS.fetch(request), url.pathname)
    }

    const navigate = request.headers.get('Sec-Fetch-Mode') === 'navigate' || (request.headers.get('Accept') ?? '').includes('text/html')
    if ((request.method === 'GET' || request.method === 'HEAD') && navigate) {
      const next = safeNext(url.pathname + url.search)
      return new Response(null, {
        status: 302,
        headers: { Location: `${LOGIN_PATH}?next=${encodeURIComponent(next)}`, 'Cache-Control': 'no-store', ...SECURITY_HEADERS },
      })
    }
    return new Response('No autorizado', {
      status: 401,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS },
    })
  },
}
