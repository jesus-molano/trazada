# CLAUDE.md — Trazada

Replay 3D y análisis de carreras, web estática y coste cero. **Fuente de verdad: `docs/BRIEF.md`**. Plan, decisiones (D1–D21), riesgos e hitos (H0–H11, con criterios de aceptación): `docs/PLAN.md`. Formato de datos: `docs/DATA_FORMAT.md`.

## Reglas innegociables

- **Coste cero**: nada de pago ni free tiers con tarjeta. Cualquier pieza nueva debe ser gratis; justifícala en el plan.
- **Datos honestos**: lo estimado lleva la etiqueta "Estimado" (componente común) y nunca se presenta como real. No inventes datos: si falta un dato, se muestra "sin dato/sin señal".
- **Un reloj maestro**: todo cuelga del tiempo de sesión en ms (`SessionClock`). Las fuentes se normalizan a ese reloj en el pipeline; las horas dentro de los textos de race control se ignoran.
- **Rendimiento**: un único contexto WebGL (`TresCanvas` + `ViewRegistry` con scissor). Nada de datos por frame en la reactividad de Vue: motor TS puro mutado en sitio, `shallowRef`/`markRaw`, Pinia solo para estado grueso. Parseo y precálculo en Web Workers con transferibles.
- **Legal**: proyecto no oficial. Sin logos, libreas, fotos (se descarta `HeadshotUrl`), tipografía oficial ni "F1"/"Formula 1" en nombres de producto, paquetes, dominios o cuentas. Mostrar `EventName` corto, nunca `OfficialEventName`. Disclaimer en footer y README. Sin campos de Jolpica en los datos publicados. Ninguna función de IA sobre datos de F1. Los datos nunca van en git salvo extractos mínimos de test (`DATA_NOTICE.md`). **Uso personal y solo local (D23, D25)**: no se publica ningún dato ni hay despliegue. La app se usa con `pnpm local` en el PC del usuario (y, con `--lan`, en su red de casa).
- **UX**: tema oscuro con tokens (`apps/web/app/design/tokens.css`); movimiento solo con los tokens (`design/motion.ts`), respetando `prefers-reduced-motion`; todo texto visible vía i18n (es/en; ESLint `no-raw-text` lo impone); estados de carga, vacío y error cuidados; desktop first sin romperse en tablet.

## Entorno

- Node 24 LTS (`.nvmrc`), pnpm 12 (`packageManager`), Python 3.13 + uv. En el contenedor de Claude: `source /root/.trazada_env` antes de usar node/pnpm/uv.
- Playwright con Chromium preinstalado: `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium`. WebGL por SwiftShader en headless (args en `playwright.config.ts`).
- pnpm protege contra paquetes recién publicados y solo permite scripts de instalación de la lista `allowBuilds` (`pnpm-workspace.yaml`).
- La red del contenedor no llega a livetiming.formula1.com (y F1 da 403 a IPs de nube): la ingesta real se ejecuta en una IP residencial. Para desarrollar sin red: `OfflineCacheSource` (cachés FastF1 validadas con el unpickler restringido) y datos sintéticos.

## Comandos

```bash
# Front (raíz)
pnpm install
pnpm dev                      # http://localhost:3000, datos de data/ en /data
pnpm lint                     # ESLint (+ i18n no-raw-text)
pnpm typecheck                # vue-tsc / tsc
pnpm test                     # Vitest (apps/web: unit + nuxt; packages/schema)
pnpm build                    # nuxt generate
pnpm e2e                      # Playwright (requiere pnpm build antes); el proyecto 'perf' corre solo, al final
pnpm local [--lan] [--build]  # uso personal (D23): app + data/ en http://127.0.0.1:3000 (--lan: red de casa)
#   con el gestor de datos (D26): calendario y «Descargar» por sesión → API /api (solo loopback) → uv run trazada build … --progress
#   servidor: scripts/local-server.mjs (también lo usan los e2e, sin gestor); e2e del gestor con un pipeline falso (tests/fixtures/fake-pipeline.mjs)
# Bench: /replay?s=<sesión>&bench=1 (benchSeconds, benchWarmup, benchRate, governor=off); docs/PERFORMANCE.md
pnpm perf:table               # tabla de peso por sesión en docs/PERFORMANCE.md (desde data/v1)
# e2e con datos completos de data/ (solo local, p. ej. Japón 2026 dev): servidor aparte y E2E_LOCAL_URL
#   E2E_DATA_DIR=../../data node tests/e2e/serve.mjs --port 4199 &
#   E2E_LOCAL_URL=http://127.0.0.1:4199 pnpm e2e local-japan
# Capturas del README (docs/img/*.webp): pnpm build && README_SHOTS=1 pnpm e2e readme-shots (necesita pipeline con uv sync)
# Capturas de referencia (@screenshot): solo se comparan en CI. Se regeneran en el entorno del CI con el
# workflow "Snapshots" (a mano, o con un push cuyo mensaje contenga [snapshots]); luego git pull.

# Pipeline
cd pipeline && uv sync
uv run trazada --help
uv run ruff check && uv run ruff format --check
uv run pytest                 # excluye @local; uv run pytest -m local para tests con datos completos

# Datos (salen en data/v1/, ignorado por git)
uv run trazada probe                                      # ¿esta red puede leer el live timing? (nube: 403)
uv run trazada probe-feed 2026 10 race [--offline]        # R4/D48: temas del feed y canales de CarData.z que el pipeline no lee (IP residencial)
uv run trazada build 2026 "Belgian Grand Prix" fp1        # FastF1 online (solo IP residencial)
uv run trazada schedule 2026                              # calendario (una línea JSON) para el gestor de datos
uv run trazada build 2026 10 fp1 --progress               # líneas ::progress/::result/::error (las lee el gestor)
uv run trazada sanitize-cache <caché-ajena>/<año>/<evento>/<sesión>   # unpickler restringido → .cache/fastf1-sanitized
uv run trazada build 2026 "Belgian Grand Prix" fp1 --offline          # desde la caché saneada
uv run trazada dev-ti "<TI>/2026/Japanese Grand Prix/Race" --season 2026 --round 3 --slug suzuka  # SOLO dev
uv run trazada catalog [--public]                         # --public falla si hay sesiones dev
uv run trazada prune [--apply]                            # borra ficheros huérfanos de > 7 días
uv run trazada e2e-fixture 2026/10-spa-francorchamps/fp1 --data <raíz sin datos de MultiViewer>  # fixture e2e
uv run trazada outlines <checkout de github.com/bacinger/f1-circuits>   # trazados del selector (D27), se versionan
```

## Cómo verificar un cambio (antes de cada commit)

1. `pnpm lint && pnpm typecheck && pnpm test` en verde.
2. Si toca el front: `pnpm build && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm e2e`.
3. Si toca el pipeline o el esquema: `uv run ruff check && uv run ruff format --check && uv run pytest` y el test de ida y vuelta Python→TS.
4. Comprobar los criterios de aceptación del hito en `docs/PLAN.md` §8 y anotar lo verificado en el commit.

## Convenciones

- **Commits**: un hito o sub-hito verificado por commit, mensaje en español con prefijo (`feat:`, `fix:`, `docs:`, `test:`, `chore:`), y referencia al hito (`H3`).
- **TypeScript**: strict, sin `any` implícito; el motor (`apps/web/app/engine`) no importa Vue ni three y tiene tests junto al código (`*.test.ts`).
- **Componentes**: prefijo `Tz` (evita choques con los componentes globales que registra `@tresjs/nuxt` desde cientos: `Grid`, `Html`, `Image`…).
- **Props dentro de `TresCanvas`**: objetos y arrays siempre estables (`computed`/constantes), nunca literales en la plantilla (`:scale="[1, k, 1]"`). TresCanvas vuelve a evaluar su slot por su cuenta, y un literal nuevo invalida la escena en cada evaluación: hay renders en pausa (lo vigila un e2e).
- **TresJS v5**: usar su API real (verificada en el código fuente): `useLoop().onBeforeRender/render`, `useTres()`, `renderMode`, `useLoader` con `extensions`. No usar `useGLTF` de cientos (Draco desde CDN); GLB con Meshopt y `GLTFLoader` de three con decoder autoalojado. Ninguna petición a orígenes externos (lo comprueba un e2e).
- **Banderas y trazados (D27)**: banderas de `country-flag-icons` (importaciones con nombre, como `data:` en un `<img>`) y trazados en `app/assets/circuit-outlines.json` (generado, no se edita a mano). País → ISO en `app/venues/countries.ts`; evento → trazado en `app/venues/outlines.ts` (alias y excepciones en `pipeline/.../outlines.py`). Sin dato, sin bandera y hueco neutro: nunca uno inventado.
- **Gestor de datos (D26)**: la API de `scripts/local-server.mjs` ejecuta el pipeline, así que solo atiende a loopback, con Host del propio servidor, mismo origen y cabecera `X-Trazada`; nada de CORS. Todo parámetro se valida (temporada, ronda, tipo de sesión) y el pipeline se lanza sin shell. Cualquier cambio ahí lleva sus tests en `tests/unit/local-server.test.ts`.
- **Sin despliegue (D25)**: no hay Cloudflare ni ningún otro hosting; los datos se quedan en `data/` del PC. Una sesión cuyo circuito use fuentes dev sigue marcándose como dev.
- **Datos**: rutas `${dataBaseUrl}/v1/...`; ficheros con hash e inmutables; layouts en `packages/schema/trzb/*.layout.json` compartidos por Python y TS; cambiar un layout exige subir `schemaVersion` (excepción: v1 se revisa en el sitio mientras no haya datos de usuarios que conservar, ver `docs/DATA_FORMAT.md`). Las sesiones `dev` (TracingInsights, sintéticas) nunca se publican.
- **Python**: ruff (lint + format), tipado con anotaciones, `src/` layout, tests en `pipeline/tests` (marca `local` para los que necesitan datos completos).
- **Fixtures**: solo extractos mínimos reales (≤ 1 MB en total, sin datos de MultiViewer ni de Jolpica) o sintéticos. El fixture e2e se regenera con `trazada e2e-fixture`.
- **Colores y movimiento**: solo en `design/tokens.css`. En TS (three.js, uPlot, GSAP) se leen con `token()` de `design/tokens.ts` o con `design/motion.ts`. Ningún literal de color en componentes (lo vigila un test).
- **Identidad «Asfalto y pintura» (D47)**: el acento es la pintura (`--tz-accent` = `--tz-paint`) y la placa maciza de pintura (`--tz-accent` de fondo, `--tz-accent-on` de texto) significa «activado»; desplegado (`aria-expanded`) es el relleno suave. El color de señal (`--tz-signal`) solo para el foco, la selección de texto y la traza de velocidad, y el piano (`--tz-kerb`) solo bajo la marca y en la pestaña activa del análisis (los dos los vigila `design/tokens.test.ts`). Sin `backdrop-filter`.
- **Estimado**: todo campo estimado está en `engine/estimated.ts` y se pinta con `<TzEstimated field="…">`. Un campo nuevo necesita su caso en `tests/nuxt/estimated.test.ts` (si no, el test falla) y su texto en `estimated.fields/hints`.
- **e2e**: para dar el foco a la página, clic en el título (`replay-title`), nunca en el lienzo (selecciona coches). Tras un seek, esperar dos `requestAnimationFrame` antes de leer posiciones de pantalla.
- **Docs**: cuando cambie una decisión, actualizar `docs/BRIEF.md` (registro de decisiones) y `docs/PLAN.md`.
