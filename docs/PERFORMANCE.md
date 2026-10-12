# Rendimiento

Objetivos de rendimiento, cómo se miden y las cifras medidas hasta ahora. Las cifras que valen son las de las **máquinas de referencia**. Las de CI y las de este contenedor (sin GPU, WebGL por software con SwiftShader) solo sirven para detectar regresiones grandes y **no son representativas**.

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
| Contenedor de desarrollo (4 vCPU Xeon 2,1 GHz, SwiftShader) | Japón 2026 carrera (dev, local) | 1440×900 | 100 ms | 133 ms | 183 ms | todos | 42 MB | 1 (`governor=off`) | No representativo |
| Ídem | Japón 2026 carrera, con degradación | 1440×900 | 100 ms | 150 ms | 183 ms | todos | 43 MB | 0,75 | No representativo |
| Ídem | Bélgica 2026 Libres 1 (completa) | 1440×900 | 67 ms | 100 ms | 117 ms | todos | 36 MB | 0,75 | No representativo |

En el contenedor todo el render es por software. El hilo principal está ocioso el 93 % del tiempo durante la reproducción (perfil de CPU: el JS por frame es < 5 %), así que el límite es el raster y la composición de SwiftShader, no el código de la app.

**Heap**: 42 MB con la carrera completa de Japón cargada (objetivo ≤ 300 MB). El dato vale fuera del contenedor, porque no depende de la GPU.

### Lo que se midió y se cambió

- **`backdrop-filter: blur()`** en los paneles: con un lienzo animado detrás obliga a desenfocar de nuevo en cada frame. Con SwiftShader, quitarlo bajó el p50 de 133 a 100 ms. Se quitó de todos los paneles sobre la escena y el fondo pasó a ser más opaco (`--tz-overlay` 0,72 → 0,88).
- **Escena**: 8 draw calls y ~15 000 triángulos en la vista general (los coches son cuñas en un único InstancedMesh). Con coches cerca (seguimiento), el modelo detallado (D28) suma 3 draw calls y ~1.500 triángulos por coche cercano: 11 draw calls y ~18 500 triángulos siguiendo a un coche con otro delante (Spa, fixture). Render bajo demanda: en pausa no se dibuja nada.
- **Carga**: de clic a "listo", 180–400 ms con la CPU ×4 y sin *long tasks* (fixture y sesión completa de Bélgica; H3). El montaje de la escena tras "listo" es una *long task* de 260–390 ms con la CPU ×4, unos 65–100 ms reales (H3/H6).

### 2026-10-12: tirones a ×1, apertura y trazado 3D (PC del usuario, RTX 3060 Ti, Chrome con ANGLE sobre Direct3D 11)

- **Tirones a ×1** (el usuario: «va un poco a tirones en x1»): cada material que salía por primera vez a mitad de la reproducción (banderas de sector, tintes, el coche de cerca o de lejos…) compilaba su programa de shader en ese frame, y con ANGLE sobre Direct3D eso son 100–400 ms. Ahora `renderer.compileAsync` compila todo tras el primer render (también lo oculto; con `KHR_parallel_shader_compile`, sin bloquear) y `sceneStats.programs` cuenta los programas. Marina Bay 2026 a ×1, 6 s: **antes** 12 frames de más de 25 ms y tareas de 99, 416, 71 y 103 ms; **después** p50 16,7 ms, p99 16,8 ms, máximo 16,9 ms, ninguna tarea larga.
- **Apertura** (`perf.spec`, «de clic a "listo"», CPU ×4): la medida de la cabecera no se hace mientras la sesión carga y busca desde el nivel actual (antes probaba hasta cinco niveles, cada uno un layout forzado de toda la página), y la carga cede el hilo entre «los datos están» y el montaje del replay. Tres pasadas seguidas: 473–491 ms y ninguna tarea larga (antes, una de 50–51 ms en una de cada dos). El montaje de la escena tras «listo» sigue siendo una tarea de 250–470 ms a CPU ×4 (sin presupuesto).
- **Trazado 3D de D50**: 2 draw calls más (la retícula, 2 triángulos; los faldones, ~6.000 triángulos en Marina Bay y ~9.000 en Barcelona), dentro del tope de la escena (< 30 draw calls, < 150 000 triángulos; `track-detail.spec.ts`). Se apagan en «Capas».

### Por tanda de las 21 funciones

Al cerrar cada tanda, el integrador pasa el bench en Bélgica Libres 1 y Japón carrera (datos completos, locales) a ×1 y ×16, antes y después de fusionar, en las mismas condiciones: contenedor con SwiftShader, 1440×900, `governor=off`, 5 s de calentamiento, 20 s de medida y dos rondas alternas. Los ms de JS por frame son el `ScriptDuration` de CDP durante la medida dividido entre los frames. Sirven solo para detectar regresiones, no como cifras de referencia.

**Tanda 0 (H12, andamiaje sin cambios visibles).** No añade capas: con los huecos vacíos, las draw calls y los triángulos son los mismos (8 draw calls; 15.292 triángulos en Bélgica y 13.254 en Japón, en la vista general). El coste por frame no cambia: las diferencias caben en el ruido de las dos rondas, con los frames cuantizados al vsync en pasos de 16,7 ms. En Bélgica el p95 baja un escalón en las dos rondas y en Japón a ×16 sube uno, con el mismo JS por frame (unos 2 ms de frames de más de 100 ms: manda el raster por software).

| Sesión | Velocidad | p95 antes | p95 después | JS/frame antes | JS/frame después |
|---|---|---:|---:|---:|---:|
| Bélgica 2026 Libres 1 | ×1 | 150 ms | 133 ms | 1,8–2,0 ms | 1,7–1,8 ms |
| Ídem | ×16 | 150 ms | 133 ms | 2,1–2,2 ms | 2,0 ms |
| Japón 2026 carrera (dev) | ×1 | 117–133 ms | 117–150 ms | 1,7–2,0 ms | 1,7–2,1 ms |
| Ídem | ×16 | 150–167 ms | 167–183 ms | 2,0–2,2 ms | 2,0–2,4 ms |

Desde esta tanda, cada capa nueva publica su coste con `registerSceneStat` (`sceneStats.layers`). El tope de draw calls de los e2e pasa a ser el de la escena base (13, siguiendo a un coche con el modelo detallado) más lo de las capas activas, siempre por debajo de 30.

**Tanda 1 (H13: clasificación animada, estelas, tarjeta de fin de sesión y reanudar).** Se mide la base (Tanda 0) contra la Tanda 1 con las estelas apagadas, que es lo de por defecto, y con las estelas «Velocidad», el modo más caro: además de la velocidad, busca una muestra de telemetría por punto.

- **Escena por defecto (estelas apagadas)**: no cambia nada. Mismas draw calls (8) y triángulos, el mismo JS por frame (~2 ms) y el mismo encuadre. La captura del lienzo de la prueba `@screenshot` es idéntica píxel a píxel entre los dos builds (0 píxeles distintos), así que no hace falta regenerar la referencia.
- **Con estelas**: +1 draw call (9) y +1.364 triángulos (22 coches × 31 tramos × 2; Bélgica 16.656 y Japón 14.618), con 704 puntos (22 × 32). El JS por frame sube 0,3–1,0 ms (de ~2 a 2,4–2,9 ms) y el p95 no se mueve fuera del ruido. Al principio la capa costaba 2 draw calls, porque three.js pinta en dos pasadas un material transparente de doble cara; con `forceSinglePass` cuesta 1.
- **Clasificación animada**: el `<TransitionGroup>` mide las filas en cada actualización de la clasificación (6,7 Hz). Lo medido es ~0,02 ms de layout más por frame (0,05 layouts más por frame) y el mismo p95 en tres rondas alternas de Bélgica ×1. En la primera ronda completa, el p95 de Bélgica ×1 salió un escalón peor (200 y 150 ms frente a 133); las rondas aisladas lo dejan en ruido.

| Sesión | Velocidad | p95 base | p95 Tanda 1 | p95 con estelas | JS/frame base | JS/frame Tanda 1 | JS/frame con estelas |
|---|---|---:|---:|---:|---:|---:|---:|
| Bélgica 2026 Libres 1 | ×1 | 133 ms | 150–200 ms¹ | 150 ms | 1,9–2,1 ms | 1,9–2,0 ms | 2,8–2,9 ms |
| Ídem | ×16 | 150 ms | 150–167 ms | 133–150 ms | 2,2–2,3 ms | 2,2–2,3 ms | 2,9 ms |
| Japón 2026 carrera (dev) | ×1 | 117–133 ms | 133 ms | 117–133 ms | 1,8–2,0 ms | 1,9–2,2 ms | 2,4–2,5 ms |
| Ídem | ×16 | 150–183 ms | 133–150 ms | 133–183 ms | 2,3–2,5 ms | 2,1 ms | 2,7–2,9 ms |

¹ En tres rondas aisladas y alternas, base y Tanda 1 dan el mismo p95 (117, 133 y 117 ms) y el mismo JS por frame (1,6–1,8 ms).

El escenario «todas las capas» de `perf.spec.ts` se añadió al cerrar la Tanda 4.

**Tanda 2 (H14: gráficas de carrera, colores de sector, vista previa del timeline y zonas de DRS).** Se mide la base (Tanda 1) contra la Tanda 2 con lo de por defecto, en las mismas condiciones y con dos rondas alternas. Las dos sesiones locales son de 2026, así que las zonas de DRS no se dibujan (en 2026 ni se calculan) y la hoja de análisis está cerrada, como al abrir el replay.

- **Escena**: mismas draw calls (8) y triángulos (Bélgica 15.292; Japón 13.254). Con zonas de DRS (sesiones de 2018–2025), la capa suma 1 draw call: una malla con todas las zonas y `forceSinglePass` (lo vigilan `zones.test.ts` y `drs.spec.ts`; sin zonas o apagada, 0).
- **Encuadre**: la clasificación es 30 px más ancha por las marcas de sector, así que el circuito se encuadra un poco más a la derecha. La captura de la prueba `@screenshot` cambia en un 2,8 % de los píxeles (mismas draw calls y triángulos): hay que regenerar la referencia con el workflow «Snapshots».
- **Por frame**: el JS por frame no se mueve fuera del ruido (1,7–2,4 ms en todos los casos). Las marcas de sector se actualizan con la clasificación (6,7 Hz): en Bélgica a ×16, la tarea por frame pasa de 8,2–9,5 a 9,4–10,8 ms y el layout de 0,62–0,74 a 0,71–0,83 ms; a ×1 y en Japón, lo mismo que la base. El p95 se mueve un escalón de vsync arriba o abajo según la ronda, como en las tandas anteriores.
- **Hoja de análisis abierta**: la escena no se redibuja (`setSceneHidden`; `analysis.spec.ts` comprueba que el contador de renders no sube reproduciendo). Las gráficas solo se recalculan cuando el reloj cruza un instante que cambia lo que muestran.
- **Vista previa**: nada por frame del reloj; como mucho una consulta por frame de pantalla al mover el puntero y ningún render de la escena (`preview.spec.ts`).
- **Precálculos** (hilo principal, perezosos con `rt.ext`; Node, mín.–máx. de 7 repeticiones con los datos completos):

| Sesión | Sectores | Vista previa (primero) | Consulta de la vista previa | Race trace | Ritmo (todos) | Stints (todos) | Zonas de DRS (worker) |
|---|---:|---:|---:|---:|---:|---:|---:|
| Japón 2026 carrera (dev) | 1,7–7,2 ms (mediana 1,9) | 0,8–5,8 ms (mediana 2,2) | 1,4 µs | 0,2–0,9 ms | 0,3–1,8 ms | 0,05–1,0 ms | 0,3 ms (2026: no se calcula) |
| Bélgica 2026 Libres 1 | 0,9–1,7 ms (mediana 1,0) | 1,0–3,3 ms (mediana 1,4) | 1,3 µs | 0,04 ms | 0,6–1,7 ms | 0,03 ms | 0,04 ms (ídem) |

  Las zonas de DRS de una carrera de 2018–2025 se calculan en el Web Worker de carga: 33–70 ms en una carrera sintética de 20 coches × 2 h (533.000 muestras), medido por el worker del ítem 11.
- **Peso del JS**: +19 KB con gzip en total (478 → 497 KB). El chunk del replay crece 14 KB (la hoja de análisis, las pestañas y la vista previa; uPlot ya estaba) y el del Web Worker de carga 3 KB (zonas de DRS).

| Sesión | Velocidad | p95 base | p95 Tanda 2 | JS/frame base | JS/frame Tanda 2 | Tarea/frame base | Tarea/frame Tanda 2 |
|---|---|---:|---:|---:|---:|---:|---:|
| Bélgica 2026 Libres 1 | ×1 | 117–133 ms | 117–133 ms | 1,7–1,9 ms | 1,7–1,8 ms | 6,0–6,3 ms | 6,1–6,7 ms |
| Ídem | ×16 | 133–150 ms | 133–167 ms | 2,1–2,2 ms | 2,1–2,4 ms | 8,2–9,5 ms | 9,4–10,8 ms |
| Japón 2026 carrera (dev) | ×1 | 117–133 ms | 133 ms | 1,9–2,0 ms | 1,9–2,1 ms | 5,6–6,3 ms | 5,8–6,6 ms |
| Ídem | ×16 | 133–167 ms | 133–150 ms | 2,0–2,1 ms | 2,0–2,1 ms | 8,3 ms | 8,5–8,8 ms |

**Tanda 3 (H15: comparar dos pilotos, meteorología, realización automática y ambiente).** *El ambiente se retiró el 2026-10-11 (D37 retirado, BRIEF): sus cifras de aquí son históricas.* Se mide la base (Tanda 2) contra la Tanda 3 con lo de por defecto (el ambiente está activo) y con el ambiente apagado, en las mismas condiciones y con tres rondas alternas. Bélgica es la sesión reconstruida con 1.1.0 (con meteorología); las dos versiones leen los mismos ficheros. La comparación y la realización automática están apagadas al abrir el replay, como en el bench.

- **Escena por defecto**: +1 draw call (9) y +992 triángulos (Bélgica 16.284; Japón 14.294): el cielo del ambiente, una esfera alrededor de la cámara. Con el ambiente apagado, la escena es la de la base (8 draw calls; 15.292 y 13.302 triángulos).
- **Coste del ambiente en el contenedor**: en Bélgica, el p50 sube un escalón de vsync en las tres rondas (83 → 100 ms) y el p95 uno o dos. La tarea del hilo principal por frame sube 0,7–5,8 ms y el JS 0,1–0,8 ms. En Japón queda dentro del ruido. Con el ambiente apagado, la Tanda 3 da lo mismo que la base, salvo en una ronda ruidosa. SwiftShader rasteriza en la CPU, y el cielo es una pasada más a pantalla completa (la niebla añade además cálculo por píxel en la pista). En una GPU de verdad ese coste es mínimo, pero el iPad es el caso que hay que medir.
- **Comparar** (solo mientras se compara): el fantasma suma 1 draw call (cuña, o ~1.500 triángulos con el monoplaza de cerca), sin niebla y sin escribir profundidad (`compare.spec.ts`). El cálculo del frame se comparte entre el panel y el fantasma: 0,002 ms con los datos completos; las trazas de una vuelta, 0,1–0,3 ms (`session.local.test.ts`). Por frame solo se escribe en el DOM lo que cambia, sin pasar por la reactividad de Vue.
- **Meteorología**: nada por frame. El chip solo se repinta al cambiar de muestra (una por minuto) y la franja del timeline no cambia al reproducir. En los datos, `events` de Bélgica pasa de 2 a 3 KB.
- **Realización automática** (solo encendida): la persecución acerca los coches y saca el modelo detallado de los que tiene cerca. `tv.spec.ts` y `local-tv.spec.ts` comprueban que se queda por debajo de 30 draw calls y 150.000 triángulos y que en pausa no hay renders. Las cámaras de curva se calculan una vez, la primera vez que se enciende (`rt.ext`).
- **Carga**: de clic a «listo», lo mismo que la base (255–314 ms frente a 296–310 ms con la CPU ×4, sin *long tasks* en 5 rondas alternas). En las dos versiones sale a veces una tarea de 50–63 ms justo en el clic, en el umbral de la prueba. El montaje de la escena tras «listo» pasa de 1,3–1,5 s a 1,6–2,0 s de *long tasks* con la CPU ×4 (unos 80–120 ms reales): son las capas y los programas de shader nuevos (cielo, fantasma y la variante con niebla de la pista).
- **Peso del JS**: +20 KB con gzip en total (486 → 506 KB, medido igual en los dos builds). El chunk del replay crece 11 KB (comparación, meteorología y realización automática).

| Sesión | Velocidad | p95 base | p95 Tanda 3 | p95 sin ambiente | JS/frame base | JS/frame Tanda 3 | JS/frame sin ambiente | Tarea/frame base | Tarea/frame Tanda 3 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Bélgica 2026 Libres 1 | ×1 | 133 ms | 150–217 ms | 133–150 ms | 1,7–1,9 ms | 1,9–2,6 ms | 1,7–2,0 ms | 6,3–6,7 ms | 7,4–10,0 ms |
| Ídem | ×16 | 133 ms | 150–283 ms | 133–267 ms¹ | 2,0 ms | 2,2–2,8 ms | 2,0–3,0 ms¹ | 8,7–8,9 ms | 11,2–14,7 ms |
| Japón 2026 carrera (dev) | ×1 | 117–233 ms | 150–233 ms | 133–200 ms | 1,9–2,3 ms | 2,0–2,2 ms | 1,8–2,3 ms | 5,7–7,0 ms | 6,1–6,5 ms |
| Ídem | ×16 | 150–217 ms | 167–367 ms¹ | 150–350 ms¹ | 2,0–2,8 ms | 2,3–3,1 ms | 2,2–3,4 ms | 8,5–11,8 ms | 9,6–13,3 ms |

¹ Rondas sueltas con el contenedor cargado. En Japón ×16, una ronda empeoró a la vez la base y las dos variantes de la Tanda 3; sin ella, el ambiente apagado da 150 ms y la base, 150–217 ms. En Bélgica ×16, una ronda del ambiente apagado salió en 267 ms y las otras dos, en 133 y 167 ms.

**Tanda 4 (H16: mapa de calor, momentos, paleta de comandos y gestos en tablet). Sin bench.** Por petición del usuario, esta tanda se integró con la verificación ligera (lint, typecheck, Vitest y build), y los e2e y el bench se dejaron para el cierre de las 21 funciones. En el cierre (2026-10-11) se pasó la suite completa de Playwright, pero el bench antes y después **se saltó a petición del usuario**: no hay cifras de esta tanda, ni del contenedor ni de una máquina de verdad. Lo que se sabe sin bench:

- **Escena por defecto**: no debería cambiar. El mapa de calor está apagado por defecto, la paleta y la pestaña «Momentos» no dibujan en el lienzo y los gestos solo actúan mientras hay dedos. Con el calor encendido, +1 draw call (una copia de la cinta, del orden de 14k triángulos en Spa), y los colores solo se suben al cambiar de modo, de coches o de vuelta.
- **Por frame**: nada nuevo en la reactividad de Vue. Los momentos se precalculan una vez por sesión (`rt.ext`; ~6 ms en Japón en caliente, medido por el worker). La paleta solo trabaja al teclear, y el gesto del reloj hace como mucho un seek por frame.
- **Escenario «todas las capas»** (`perf.spec.ts`, nuevo; sin el cielo desde que se retiró el ambiente): estelas, calor y fantasma a la vez sobre Spa FP1, con el presupuesto de escena (< 30 draw calls, < 150.000 triángulos), sin niebla en las capas y sin renders en pausa. Anota el p50 y el p95 de los frames con la CPU ×4 («iPad aproximado», solo orientativo). Desde el cierre comprueba también que, en pausa o con la hoja de análisis tapando la escena, no se prepara nada (ver «Cierre»).

**Tanda 5 (H17: identidad «Asfalto y pintura», pulido de la portada y del replay y comandos de momentos). Sin bench.** Se integró con la verificación ligera, como la Tanda 4. Los e2e se pasaron en el cierre; el bench se saltó a petición del usuario. Lo que se sabe sin bench:

- **Escena**: las mismas capas, draw calls y triángulos (fuentes y CSS, más el layout propio del replay). Lo que cambia es el tamaño del lienzo: sin la cabecera global, la escena gana alto (a 1440×900 la cabecera del replay mide 48 px), así que el encuadre y la captura `@screenshot` cambian y hay más píxeles que rasterizar por frame. En SwiftShader eso puede subir un poco el p95; en una GPU de verdad, apenas.
- **Página**: el grano del fondo son cuatro degradados estáticos que se pintan una vez (no se animan) y sin `backdrop-filter` en ningún sitio (el panel de carga lo perdió). Las microinteracciones de la portada solo mueven `transform` y opacidad con los tokens, y nada en el replay.
- **Por frame**: nada nuevo en la reactividad de Vue. Los comandos de momentos usan el mismo precálculo que los botones del dock (`rt.ext`) y solo trabajan al teclear.
- **Sin medir**: lo que cuesta el lienzo más alto. El bench de Spa FP1 y Japón a ×1 y ×16 contra la Tanda 4 se iba a pasar en el contenedor al cierre y se saltó.

**Tanda 6 (H18: diseños «Espectador» y «Análisis» con paneles de ancho ajustable, microinteracciones del replay, prioridad del título y guía de primer uso). Sin bench.** Se integró con la verificación ligera, como las Tandas 4 y 5. La suite de Playwright se pasó en el cierre; el bench se saltó a petición del usuario. Lo que se sabe sin bench:

- **Escena**: las mismas capas, draw calls y triángulos. «Espectador» conserva los anchos de siempre, así que el encuadre y la captura `@screenshot` no deberían cambiar. «Análisis» deja al mapa algo menos de ancho (nunca menos de max(320 px, 35 %)), y el número de píxeles que se rasterizan es el mismo.
- **Arrastre de un asa**: durante el arrastre solo se escribe una variable CSS en el DOM, sin reactividad de Vue por movimiento. La escena no reencuadra hasta soltar (`data-resizing`, `tz:layout-settled`) y las gráficas hacen como mucho un `setSize` por frame. El e2e de arrastre (`layout.spec.ts`, que comprueba que la escena reencuadra solo al soltar) pasa en el cierre.
- **Por frame**: nada nuevo en la reactividad de Vue. La compactación de la cabecera (`useHeaderFit`) mide solo cuando cambia el tamaño de la cabecera o de sus piezas, como mucho una vez por frame. La guía coloca sus burbujas al abrir, al cambiar de paso y al redimensionar. Los destellos de dirección de carrera, del estado de pista y de la clasificación solo van a ≤ ×4 y sin salto del reloj; a ×16 la lista cambia al instante.
- **Sin medir**: «Análisis» con un coche elegido (gráficas más altas y una ventana de 40 s). El bench en Spa FP1 y Japón a ×1 y ×16 en los dos diseños se saltó en el cierre.

**Cierre de las 21 funciones (2026-10-11; `docs/BRIEF.md`, «Cierre de las 21 funciones»).** El bench antes y después se saltó a petición del usuario, así que tampoco hay cifras de los cambios de rendimiento del cierre. Lo que cambió, y cómo lo vigilan los tests:

- **La escena solo se prepara antes de cada render** (`useSceneFrame`). En TresJS 5, `onBeforeRender` salta en cada tick del bucle de `requestAnimationFrame` aunque el modo on-demand no dibuje nada: en pausa, o con la hoja de análisis tapando la escena, las estelas se remuestreaban y subían a la GPU, la niebla se recalculaba y pista, banderas, coches, fantasma, calor y DRS hacían su trabajo, con 14 `useLoop()` por tick. Ahora hay un solo gancho por lienzo que llama a cada parte solo con un render pendiente (la cámara, en cada tick solo cuando se anima sola: siguiendo a un coche o en la realización). Las estelas se rehacen solo si cambian el frame del runtime, el modo, el coche elegido o la escala de altura (girar o acercar el mapa en pausa no sube nada), y la niebla solo si se mueve la cámara. Contadores: `sceneStats.loop`, `trails.computes` y `ambience.computes`; `perf.spec` («todas las capas»), `trails.spec` y `analysis.spec` comprueban que no se mueven en pausa ni con la hoja abierta.
- **Sin el muestreo de las devtools de TresJS en producción**: TresCanvas lo registraba siempre, y en cada frame recorría la escena entera para estimar la memoria, también en pausa. `perf.spec` comprueba en el build que no está.
- **Clasificación**: el texto del neumático y la «Última» de «Análisis» solo se recalculan cuando cambian (antes, cuatro `t()` por fila unas 6,7 veces por segundo), y `performance.measure('tz:leaderboard')` se borra del búfer al momento (una carrera a ×1 dejaba decenas de miles de entradas).
- **Cabecera**: `useHeaderFit` ya no vuelve a medir por un texto que cambia dentro de un elemento (a ×16, la edad de la meteorología lo hacía varias veces por segundo): 0 llamadas de los observadores en 2 s de reproducción a ×16. La telemetría del iPad mide su hueco con ResizeObserver, como mucho una vez por frame y nunca por frame de reproducción.
- **Gráficas**: una sola sonda de Canvas 2D por página (antes, un lienzo de prueba cada vez que se rehacía una gráfica; con «Sin spoilers», en cada cruce de línea).
- **Escena con todas las capas** (`perf.spec`, en el contenedor durante el cierre): 12 draw calls y 31.556 triángulos en Spa FP1 (cielo 1/992, mapa de calor por minisectores 1/13.898, estelas con el color de equipo 1/1.364 y fantasma 1/10, en cuña; zonas de DRS 0, porque en 2026 no hay), ninguna capa con niebla y, en pausa o con la hoja de análisis encima, ni un render, ni una preparación, ni un cálculo de estelas o de niebla en 1 s. Con la máquina cargada por otras sesiones (carga 18 en 4 núcleos), la medida de frames con la CPU ×4 agotó el tope de 30 s del test y la de clic a «listo» vio tres tareas largas de 53–80 ms; con carga 7, las dos pasaron, y la de frames anotó 15 frames en 3 s, p50 217 ms y p95 383 ms («iPad aproximado» en SwiftShader: solo orientativo, no comparable con un iPad).

## Peso por sesión

Generado desde los manifests con `pnpm perf:table` (datos locales de `data/`). Las sesiones dev no se publican.

<!-- sizes:start -->
| Sesión | Fuente | motion (KB) | car (KB) | timing (KB) | events (KB) | circuito (KB) | Total (MiB) | Reproducción (min) | KB/min |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 2026 Japanese Grand Prix · Race | tracinginsights-dev (dev, no publicable) | 555 | 1317 | 15 | 2 | 10 | **1.85** | 100 | 19 |
| 2026 Belgian Grand Prix · Practice 1 | fastf1-offline-cache | 331 | 640 | 10 | 3 | 11 | **0.97** | 69 | 14 |
<!-- sizes:end -->

Referencia (H2): una carrera completa ronda los 2–3 MB en gzip. La de Japón de la fuente dev pesa menos porque sus muestras se reconstruyen desde telemetría por vuelta.
