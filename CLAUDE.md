# CLAUDE.md — Trazada

Replay 3D y análisis de carreras, web estática y coste cero. **Fuente de verdad: `docs/BRIEF.md`**. Plan, decisiones (D1–D21), riesgos e hitos (H0–H11, con criterios de aceptación): `docs/PLAN.md`. Formato de datos: `docs/DATA_FORMAT.md`.

## Reglas innegociables

- **Coste cero**: nada de pago ni free tiers con tarjeta. Cualquier pieza nueva debe ser gratis; justifícala en el plan.
- **Datos honestos**: lo estimado lleva la etiqueta "Estimado" (componente común) y nunca se presenta como real. No inventes datos: si falta un dato, se muestra "sin dato/sin señal".
- **Un reloj maestro**: todo cuelga del tiempo de sesión en ms (`SessionClock`). Las fuentes se normalizan a ese reloj en el pipeline; las horas dentro de los textos de race control se ignoran.
- **Rendimiento**: un único contexto WebGL (`TresCanvas` + `ViewRegistry` con scissor). Nada de datos por frame en la reactividad de Vue: motor TS puro mutado en sitio, `shallowRef`/`markRaw`, Pinia solo para estado grueso. Parseo y precálculo en Web Workers con transferibles.
- **Legal**: proyecto no oficial. Sin logos, libreas, fotos (se descarta `HeadshotUrl`), tipografía oficial ni "F1"/"Formula 1" en nombres de producto, paquetes, dominios o cuentas. Mostrar `EventName` corto, nunca `OfficialEventName`. Disclaimer en footer y README. Sin campos de Jolpica en los datos publicados. Ninguna función de IA sobre datos de F1. Los datos nunca van en git salvo extractos mínimos de test (`DATA_NOTICE.md`).
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
pnpm e2e                      # Playwright (requiere pnpm build antes)

# Pipeline
cd pipeline && uv sync
uv run trazada --help
uv run ruff check && uv run ruff format --check
uv run pytest                 # excluye @local; uv run pytest -m local para tests con datos completos
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
- **TresJS v5**: usar su API real (verificada en el código fuente): `useLoop().onBeforeRender/render`, `useTres()`, `renderMode`, `useLoader` con `extensions`. No usar `useGLTF` de cientos (Draco desde CDN); GLB con Meshopt y `GLTFLoader` de three con decoder autoalojado. Ninguna petición a orígenes externos (lo comprueba un e2e).
- **Datos**: rutas `${dataBaseUrl}/v1/...`; ficheros con hash e inmutables; layouts en `packages/schema/trzb/*.layout.json` compartidos por Python y TS; cambiar un layout exige subir `schemaVersion`.
- **Python**: ruff (lint + format), tipado con anotaciones, `src/` layout, tests en `pipeline/tests` (marca `local` para los que necesitan datos completos).
- **Fixtures**: solo extractos mínimos reales (≤ 1 MB en total) o sintéticos.
- **Docs**: cuando cambie una decisión, actualizar `docs/BRIEF.md` (registro de decisiones) y `docs/PLAN.md`.
