# Trazada

Replay y análisis de carreras: circuito en 3D con todos los coches en movimiento, timeline, telemetría y dirección de carrera, sincronizados con un único reloj. Web estática, coste cero.

> **Proyecto no oficial.** Trazada es un proyecto no oficial y no está asociado en modo alguno con las compañías de Fórmula 1. F1, FORMULA ONE, FORMULA 1, FIA FORMULA ONE WORLD CHAMPIONSHIP, GRAND PRIX y las marcas relacionadas son marcas registradas de Formula One Licensing B.V.
>
> *Trazada is unofficial and is not associated in any way with the Formula 1 companies. F1, FORMULA ONE, FORMULA 1, FIA FORMULA ONE WORLD CHAMPIONSHIP, GRAND PRIX and related marks are trade marks of Formula One Licensing B.V.*

## Estado

En desarrollo (Fase 1, MVP replay). Plan, decisiones e hitos en [`docs/PLAN.md`](docs/PLAN.md). La fuente de verdad del proyecto es [`docs/BRIEF.md`](docs/BRIEF.md).

## Estructura

| Ruta | Qué es |
|---|---|
| `apps/web` | App Nuxt 4 + TresJS v5 (estática, `nuxt generate`) |
| `packages/schema` | Esquema de datos compartido (JSON Schema, layouts TRZB, tipos TS) |
| `pipeline` | Pipeline Python (FastF1) que genera los ficheros de cada sesión |
| `docs` | Brief, plan, formato de datos, rendimiento e investigación |

## Requisitos

- Node 24 LTS (ver `.nvmrc`) y pnpm 12
- Python 3.13 y [uv](https://docs.astral.sh/uv/)

## Comandos

```bash
pnpm install            # dependencias del front y del esquema
pnpm dev                # servidor de desarrollo (datos locales en /data)
pnpm lint && pnpm typecheck && pnpm test
pnpm build              # nuxt generate → apps/web/.output/public
pnpm e2e                # Playwright sobre el estático generado

cd pipeline
uv sync
uv run trazada --help
uv run ruff check && uv run pytest
```

## Datos

Los datos no forman parte de este repositorio ni de su licencia: ver [`DATA_NOTICE.md`](DATA_NOTICE.md). Es un proyecto **personal**: los datos se generan en tu PC con el pipeline (IP residencial) y **no se publican**. Para usar la app con ellos:

```bash
cd pipeline && uv sync && cd ..   # una vez: entorno del pipeline
pnpm local          # http://127.0.0.1:3000 con los datos de data/
pnpm local --lan    # también en tu red de casa (p. ej. el iPad)
```

En la portada verás el calendario de cada temporada. Cada sesión ya disputada tiene un botón **Descargar**: ejecuta el pipeline en tu PC (FastF1, con tu conexión de casa), muestra el progreso y, al terminar, la sesión se puede abrir. También puedes descargar de una vez lo que falta de un Gran Premio o todas las carreras que faltan de la temporada. Las descargas solo se pueden lanzar desde el propio PC, no desde otros dispositivos de la red. La caché de FastF1 (`.cache/`) ocupa bastante más que los datos generados; se puede borrar sin perder nada.

Todo se usa en local: no hay despliegue (decisiones D25 y D26 en `docs/PLAN.md`).

## Rendimiento

Objetivos, método (`/replay?s=…&bench=1`) y cifras en [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md).

## Licencia

Código bajo licencia MIT ([`LICENSE`](LICENSE)). Terceros en [`NOTICE`](NOTICE).
