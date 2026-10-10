# Rendimiento

Objetivos de la Fase 1 (`docs/PLAN.md`, H11), cómo se miden y las cifras medidas hasta ahora. Las cifras que valen para aceptar H11 son las de las **máquinas de referencia**. Las de CI y las de este contenedor (sin GPU, WebGL por software con SwiftShader) solo sirven para detectar regresiones grandes y **no son representativas**.

## Objetivos

Con `?bench=1`, 22 coches y el panel de telemetría abierto:

| Máquina | Condiciones | Objetivo |
|---|---|---|
| Sobremesa con RTX 3070 Ti | 1440p, DPR nativo (`governor=off`) | p95 ≤ 16,7 ms, p99 ≤ 20 ms y 0 frames > 50 ms tras el calentamiento |
| Portátil de referencia (GPU integrada) | Pantalla del portátil, con la degradación activada (por defecto) | p95 ≤ 33 ms tras la degradación (a 60 Hz, dos vsync = 33,3 ms; el gobernador tolera hasta 35 ms por el jitter) |
| Cualquiera | Una carrera completa cargada | Heap JS ≤ 300 MB |

## Cómo medir

1. `pnpm local` (o `pnpm local --lan` para medir desde otro equipo de casa) con al menos una carrera completa en `data/`.
2. Chrome o Edge actualizados, pestaña en primer plano, sin otras pestañas pesadas, enchufado a la corriente en el portátil.
3. Abrir `/replay?s=<temporada>/<ronda>-<slug>/race&bench=1`. El bench hace lo siguiente:
   - salta a 1 min después de la salida; en libres y clasificación, al momento con más coches en pista;
   - abre la telemetría del líder y reproduce a ×1;
   - calienta 10 s y mide 30 s;
   - al terminar, muestra p95, p99, frames > 50 ms, heap, DPR y frames;
   - «Copiar resultados (JSON)» copia todo, incluidos la GPU, el viewport, las draw calls y las *long tasks*.
4. Parámetros opcionales:
   - `benchSeconds` (duración de la medida, por defecto 30);
   - `benchWarmup` (calentamiento, por defecto 10);
   - `benchRate` (velocidad: 1, 2, 4, 8 o 16);
   - `governor=off` (sin degradación, DPR nativo).
5. El heap sale de `performance.memory`, que solo existe en Chromium. Para una cifra precisa, lanzar Chrome con `--enable-precise-memory-info`.

Los frames se miden como el intervalo entre `requestAnimationFrame` consecutivos durante la reproducción: es lo que ve el usuario e incluye el trabajo de JS, la composición y la GPU.

### Degradación adaptativa

`QualityGovernor` (`apps/web/app/engine/perf/`) vigila el p95 de cada ventana de 90 frames con reproducción. Los frames son intervalos de rAF: a 60 Hz van cuantizados al vsync (16,7 / 33,3 / 50 ms) e incluyen el tope de la pantalla o del navegador.

- **presupuesto 35 ms**: dos vsync a 60 Hz con margen para el jitter. Un tope estable de 30 Hz (pantalla, ahorro de energía) no lo supera, así que no se toca la resolución;
- si se pasa, **sondea** escalón a escalón (DPR 2 → 1,5 → 1,25 → 1 → 0,75) hasta volver al presupuesto, porque un paso que no cambia de "cubo" de vsync no significa que el siguiente no ayude. Si llega al mínimo sin lograrlo, se queda con el DPR más alto cuyo p95 esté a menos de un 10 % del mejor medido: si bajar no ayuda (CPU), vuelve al DPR del dispositivo y no reintenta hasta que la carga empeore un 25 %;
- **sube** un escalón tras tres ventanas seguidas con p95 < 20 ms, como mucho hasta el DPR del dispositivo, y **comprueba** la subida: si en la ventana siguiente se pasa, la deshace y la siguiente prueba exige el doble de ventanas (hasta 96), sin oscilar;
- descarta los 10 frames siguientes a cada cambio (el redimensionado del lienzo da un tirón);
- ignora los frames de más de 1 s (pestaña en segundo plano).

`?governor=off` lo desactiva.

## Resultados

| Máquina | Sesión | Viewport | p50 | p95 | p99 | > 50 ms | Heap | DPR final | Estado |
|---|---|---|---:|---:|---:|---:|---:|---:|---|
| RTX 3070 Ti (tuya) | carrera | 2560×1440 | — | — | — | — | — | — | **Pendiente: la medida la haces tú** |
| Portátil de referencia (tuyo) | carrera | — | — | — | — | — | — | — | **Pendiente: eliges la máquina y mides** |
| Contenedor de desarrollo (4 vCPU Xeon 2,1 GHz, SwiftShader) | Japón 2026 carrera (dev, local) | 1440×900 | 100 ms | 133 ms | 183 ms | todos | 42 MB | 1 (`governor=off`) | No representativo |
| Ídem | Japón 2026 carrera, con degradación | 1440×900 | 100 ms | 150 ms | 183 ms | todos | 43 MB | 0,75 | No representativo |
| Ídem | Bélgica 2026 Libres 1 (completa) | 1440×900 | 67 ms | 100 ms | 117 ms | todos | 36 MB | 0,75 | No representativo |

En el contenedor todo el render es por software. El hilo principal está ocioso el 93 % del tiempo durante la reproducción (perfil de CPU: el JS por frame es < 5 %), así que el límite es el raster y la composición de SwiftShader, no el código de la app.

**Heap**: 42 MB con la carrera completa de Japón cargada (objetivo ≤ 300 MB). El dato vale fuera del contenedor, porque no depende de la GPU.

### Lo que se midió y se cambió

- **`backdrop-filter: blur()`** en los paneles: con un lienzo animado detrás obliga a desenfocar de nuevo en cada frame. Con SwiftShader, quitarlo bajó el p50 de 133 a 100 ms. Se quitó de todos los paneles sobre la escena y el fondo pasó a ser más opaco (`--tz-overlay` 0,72 → 0,88).
- **Escena**: 9 draw calls y ~15 000 triángulos (un único InstancedMesh para los 22 coches). Render bajo demanda: en pausa no se dibuja nada.
- **Carga**: de clic a "listo", 180–400 ms con la CPU ×4 y sin *long tasks* (fixture y sesión completa de Bélgica; H3). El montaje de la escena tras "listo" es una *long task* de 260–390 ms con la CPU ×4, unos 65–100 ms reales (H3/H6; pendiente de trocear si molesta en la máquina de referencia).

## Peso por sesión

Generado desde los manifests con `pnpm perf:table` (datos locales de `data/`). Las sesiones dev no se publican.

<!-- sizes:start -->
| Sesión | Fuente | motion (KB) | car (KB) | timing (KB) | events (KB) | circuito (KB) | Total (MiB) | Reproducción (min) | KB/min |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 2026 Japanese Grand Prix · Race | tracinginsights-dev (dev, no publicable) | 542 | 1317 | 15 | 2 | 10 | **1.84** | 100 | 19 |
| 2026 Belgian Grand Prix · Practice 1 | fastf1-offline-cache | 330 | 640 | 10 | 2 | 11 | **0.97** | 69 | 14 |
<!-- sizes:end -->

Referencia (H2): una carrera completa ronda los 2–3 MB en gzip. La de Japón de la fuente dev pesa menos porque sus muestras se reconstruyen desde telemetría por vuelta.
