# Trazada: plan de la Fase 1

> Estado: **aprobado** el 2026-10-10 y en ejecución. Hechos: H0–H10; H11 preparado y pendiente de lo tuyo (ver "Progreso" en §8 y §9.7). Uso personal y privado: D23. Las 21 funciones aprobadas después de la Fase 1 van por tandas (H12–H18); hechas la Tanda 0 (H12, andamiaje sin cambios visibles), la Tanda 1 (H13: clasificación animada, estelas, tarjeta de fin de sesión y reanudar), la Tanda 2 (H14: gráficas de carrera, colores de sector, vista previa del timeline y zonas de DRS) la Tanda 3 (H15: comparar dos pilotos, meteorología, realización automática y ambiente de la escena; esquema 1.1.0) la Tanda 4 (H16: mapa de calor, momentos, paleta de comandos y gestos en tablet) y la Tanda 5 (H17: identidad «Asfalto y pintura», pulido de la portada y del replay con su layout propio, y comandos de momentos), estas dos con la verificación ligera: los e2e y el bench se pasan una sola vez al cierre de la Tanda 6. La Tanda 6 (H18: diseños «Espectador» y «Análisis» con paneles de ancho ajustable, microinteracciones del replay, prioridad del título en la cabecera y guía de primer uso) está integrada con la verificación ligera; falta su cierre (Playwright completo, bench y capturas del README).
> Documentos de apoyo:
> - [`research/validacion-brief.md`](research/validacion-brief.md): cada afirmación del brief contrastada con fuentes primarias y verificación adversarial.
> - [`research/empirico-2026.md`](research/empirico-2026.md): medidas sobre datos reales de 2026.
> - [`research/h2-pipeline.md`](research/h2-pipeline.md): criterios de H2 medidos sobre las sesiones de referencia, peso y formato.
>
> Terminología: **Web Worker** es el hilo del navegador. **Worker de Cloudflare** es el servicio de hosting.

## 0. Resumen: qué cambia respecto al brief

1. **En 2026 corren 22 coches, no 20**: 11 equipos, con la llegada de Cadillac. Todo el código trabaja con N variable (20 en 2023–25, 22 en 2026).
2. **En 2026 el canal del antiguo DRS no existe**, así que tampoco indica la aero activa:
   - El feed ya no lo envía. FastF1 lo rellena con 0, y lo he comprobado en 390 148 muestras.
   - Ningún canal por coche informa de aero activa ni de Overtake Mode.
   - Lo único real es el estado global `OVERTAKE ENABLED/DISABLED` de race control.
   - Tampoco llegan el Boost ni la energía de la batería. La app lo dice en un aviso informativo desde 2026, y `trazada probe-feed` comprueba en una sesión que no haya canales ni temas nuevos (D48).
   - Los alerones animados de fases futuras llevarán la etiqueta **Estimado**.
3. **Z es altitud real** (en decímetros) y es coherente entre pilotos: Spa da 102 m de desnivel y el Red Bull Ring 63 m. La cinta llevará elevación real, con una comprobación por sesión (§2.6).
4. **"Algunas sesiones de 2026 no han emitido GPS" no se confirma en el archivo post-sesión**: las 91 sesiones de 2026 tienen posiciones. Lo más probable es que se refiera al **feed en directo**, que pide F1 TV desde 2025. Aun así, el pipeline comprueba la cobertura y la UI tiene un estado para sesiones sin GPS.
5. **El riesgo nuevo más grave: F1 devuelve 403 a las IPs de nube** (GitHub Actions, VPS, Colab) desde aproximadamente mayo de 2026, y FastF1 se lo traga sin avisar.
   - Lo cuentan issues de terceros, y un pipeline público de datos de 2026 descarga a través de una IP doméstica (un exit node de Tailscale).
   - Consecuencia: **la ingesta con FastF1 se hace desde una IP residencial** (tu PC). Actions solo construye y despliega la app.
6. **Hosting en Cloudflare Workers (static assets) en vez de Pages**:
   - Cloudflare recomienda Workers para proyectos nuevos.
   - Los límites gratuitos son los mismos (20 000 ficheros, 25 MiB por fichero) y las peticiones a estáticos son gratis e ilimitadas.
   - Pages sigue siendo un plan B válido.
7. **Cloudflare no comprime binarios** (`octet-stream`, Arrow, GLB) **ni sirve peticiones Range** (devuelve 200).
   - Por eso los ficheros serán pequeños, irán precomprimidos y se descomprimirán en un Web Worker.
   - Por defecto, gzip nativo con `DecompressionStream`. Como alternativa medible, zstd con un decoder JS de 4 KB (−35 % de tamaño).
8. **Peso estimado: ~3 MB por carrera en gzip** (Estimado). Sale de extrapolar una FP1 real de 2026 que medida pesa 2,45 MB, recortando la carrera a [salida − 10 min, bandera + 5 min]. Se volverá a medir en H1 con el formato final.
   - Las 4 temporadas ocupan ~1,3–1,9 GB y ~4 000 ficheros: caben en el hosting estático.
9. **No propongo publicar un dataset público en Hugging Face**, que es lo que pedía el brief. Los motivos:
   - Los términos de F1 protegen el timing y, según la búsqueda, prohíben la minería de datos (TDM) y el uso para IA sin licencia.
   - HF es una plataforma de ML y una retirada por DMCA es inmediata.
   - El almacenamiento público es "best-effort".

   En su lugar, los datos se sirven **como assets de la app desde un Worker de Cloudflare propio**, sin licencia abierta. El archivo de registro queda en local, con copia en un dataset **privado** de HF (100 GB gratis).
10. **Race control**:
    - El "sector" de los mensajes es un **sector de pista (de comisarios)**, no un mini-sector.
    - Las banderas azules son el mensaje más frecuente.
    - Las horas que aparecen dentro del texto son locales y no se usan como reloj.
    - El parser vive en el pipeline (Python), no en TypeScript.
11. **Licencias y legal**:
    - Resultados de carrera: FastF1 los trae de Jolpica (CC BY-NC-SA). **No los publicamos**; la clasificación se deriva del timing.
    - OpenF1: uso personal y no comercial. Su código es CC BY-NC-SA, así que solo consumimos la API.
    - MultiViewer: sin licencia publicada. Hay que pedir permiso.
    - GSAP: gratis pero no open source.
    - Detalle en §5, apartado legal.
12. **Nuxt 4.6 exige Node ≥ 22.22.3 / 24.15** (este entorno tiene 22.22.0). Usaremos Node 24 LTS y TypeScript 6.0 (la 7 es nativa y `vue-tsc` aún no está verificado con ella).

## 1. Validación del brief (resumen)

| Afirmación del brief | Veredicto | Lo que dicen las fuentes y los datos |
|---|---|---|
| OpenF1: histórico gratis y sin auth desde 2023 | ✅ | Tier "Community" gratis y sin auth: 3 req/s y 30 req/min, solo **uso personal / no comercial**. Los datos cuentan como "en directo" (de pago) hasta 30 min después de la sesión. |
| OpenF1: tiempo real de pago (MQTT/WebSocket) | ✅ (incompleto) | 9,90 €/mes. Además de MQTT/WS ofrece REST autenticado, y necesita un backend para el token. Queda fuera de alcance. |
| FastF1: telemetría desde 2018 | ✅ | XY en 1/10 m también en 2018–19 (las dimensiones de pista coinciden entre años). |
| Posición a ~3,7 Hz, origen arbitrario, sin precisión lateral | ✅ | Medido: 3,81 Hz de media (Δt mediana 240 ms, jitter 0,14–0,52 s). Las posiciones están ajustadas a una única línea (p50 0,18 m de diferencia entre pilotos). El pit lane sí se distingue (hasta 15 m de la línea). |
| Telemetría ~3,7 Hz; freno solo 0/100 | ✅ | 3,73 Hz medidos. Freno booleano. **El valor 104 del acelerador es un centinela de "sin dato"** (coche parado). |
| 2026: el canal DRS pasa a indicar el modo de aero activa | ❌ | En 2026 el canal 45 no llega: FastF1 lo rellena con 0 y OpenF1 con null. Medido: 100 % ceros. |
| Overtake Mode sin canal propio | ✅ (matiz) | No hay canal por coche. Race control publica `OVERTAKE ENABLED/DISABLED` para toda la pista. |
| Race control con vuelta y "mini-sector"; texto libre | ⚠️ | La vuelta sí viene. El sector es **de pista/comisarios** ("TRACK SECTOR 21"). El texto libre se confirma. |
| Neumáticos: compuesto, edad del set, stints | ✅ | SOFT/MEDIUM/HARD/INTER/WET, sin C1–C6. `TyreLife` cuenta también vueltas de otras sesiones. |
| Info de circuito de MultiViewer, aproximada | ✅ | `api.multiviewer.app/api/v1/circuits/{key}/{year}`. La rotación es la del **mapa oficial**, no el norte. Sin licencia de redistribución. |
| No hay desgaste ni ERS públicos | ✅ | Ningún parser los expone. |
| Algunas sesiones de 2026 sin GPS | ❓ | En el archivo: 91/91 sesiones con GPS, 863/864 vueltas de carrera muestreadas con GPS. Encaja con el directo autenticado. |
| Cloudflare Pages: 20 000 ficheros y 25 MiB | ✅ | Además: 500 builds/mes y "sin tarjeta" (búsqueda). Cloudflare dirige los proyectos nuevos a Workers, con los mismos límites. |
| HF: almacenamiento público gratis | ⚠️ | "Best-effort", sin cifra garantizada. **Lo descarto como sitio público por riesgo legal** (§5); lo uso como copia privada (100 GB gratis). |
| GitHub Actions gratis en repos públicos | ✅ | Runners estándar ilimitados, 6 h por job. **Los cron se desactivan tras 60 días sin actividad.** |
| TresJS v5: solo ESM, `useLoader` rehecho, `useTexture` en cientos | ✅ | Confirmado en el código. Ojo: tiene un único hueco de función de render (choca el post-proceso con el multi-viewport), y el Draco de cientos sale del CDN de Google (§5). |
| Nuxt 4 "o la última estable" | ✅ | 4.6.1, que **requiere Node ≥ 22.22.3 / 24.15**. Nuxt 5 aún no es estable. |
| "playwright-cli" | ✅ (nombre) | El paquete oficial es `@playwright/cli`. El paquete `playwright-cli` sin scope está deprecado. |
| GSAP gratis | ✅ (no OSI) | Licencia propietaria "no-charge" que permite nuestro uso. |
| Arrow IPC o binario con typed arrays | ⚠️ | Los dos sirven. El binario propio comprime mejor y no tiene dependencias. Arrow JS solo lee IPC comprimido si le registras tú un códec (ver D3). |

## 2. Arquitectura

### 2.1 Vista general

> **Nota (D23/D25):** el diagrama describe el despliegue original en Cloudflare. Hoy el proyecto es personal y solo local: el pipeline escribe en `data/` del PC y `pnpm local` sirve la app con esos datos. No hay Workers, `wrangler` ni `data:deploy`.

```
 GitHub (repo público, solo código)                         Cloudflare (plan gratis)
┌──────────────────────────────────┐   wrangler deploy   ┌────────────────────────────────────────┐
│ Actions: lint, typecheck, tests, │────────────────────▶│ Worker "trazada" (solo assets)         │
│ nuxt generate                    │                     │  app estática (/, /replay)             │
└──────────────────────────────────┘                     └───────────────────┬────────────────────┘
                                                                             │ HTML/JS/CSS
 Tu PC (IP residencial)                                                      ▼
┌──────────────────────────────────┐   wrangler deploy   ┌────────────────────────────────────────┐
│ pipeline/ (Python + FastF1)      │────────────────────▶│ Worker "trazada-data" (solo assets)    │
│  probe → fetch → modelo →        │ (pnpm data:deploy)  │  /v1/catalog.json, /v1/circuits/...,   │
│  validación → data/v1/...        │                     │  /v1/sessions/...                      │
└──────────┬───────────────────────┘                     │  _headers: Content-Type, immutable,    │
           │ sync (obligatorio antes de automatizar)     │  Access-Control-Allow-Origin: *        │
           ▼                                             └───────────────────┬────────────────────┘
┌──────────────────────────────────┐                                         │ GET simple (sin preflight)
│ Dataset PRIVADO en HF            │                     ┌───────────────────▼────────────────────┐
│  archivo de registro (100 GB)    │                     │ Navegador                              │
└──────────────────────────────────┘                     │  Web Worker: descomprimir + decodificar │
                                                         │  Motor TS · TresJS (1 contexto WebGL)  │
                                                         │  Vue/Pinia (UI a baja frecuencia)      │
                                                         └────────────────────────────────────────┘
```

- **Ingesta**: en la Fase 1 se lanza a mano en tu PC (`uv run trazada build 2026 japan race`), con la caché de FastF1 en local.
  - Así evitamos el bloqueo a IPs de nube.
  - La automatización llegará en una fase posterior. Opciones: una tarea programada en casa, que es la recomendada, o el adaptador OpenF1 (accesible desde la nube; 2023+).
  - Descarto un runner self-hosted: GitHub lo desaconseja en repos públicos porque un PR externo ejecutaría código en tu PC.
- **Registro de datos**:
  - El directorio `data/` de tu PC, sincronizado a un dataset **privado** de HF. La sincronización es opcional en la Fase 1 y **obligatoria antes de automatizar**: un deploy de static assets publica el directorio completo, así que quien publique necesita el árbol entero.
  - El repo de GitHub solo lleva código y **extractos mínimos** de test (ver §2.8). Así una reclamación sobre los datos no puede tumbar el código.
- **Servicio**: dos Workers de Cloudflare solo de assets.
  - `trazada` (la app): lo despliega Actions en cada push a `main`.
  - `trazada-data` (los bundles): se despliega con `pnpm data:deploy` tras ejecutar el pipeline.
  - Ventajas de separarlos: la app se despliega sin datos en CI, cada uno tiene su límite de 20 000 ficheros, y los datos se retiran sin tocar la app.
  - Si algún día se acerca el límite, la vía de escape es un Worker de datos por temporada.
- **Front**: nunca llama a APIs externas.
  - Solo hace `fetch` de `${DATA_BASE_URL}/v1/...`. Es una variable pública; en desarrollo es `/data` en el mismo origen, servida por el dev server desde `data/`.
  - Son GET simples (sin preflight). `Access-Control-Allow-Origin: *`, porque los datos son públicos y CORS no es control de acceso.
  - Un test e2e comprueba que no sale **ninguna** petición a otros orígenes.

### 2.2 Front: capas

| Capa | Qué contiene | Reglas |
|---|---|---|
| **UI (Vue SFC)** | Selector, layout del replay, timeline, leaderboard, panel de telemetría, feed de race control, controles | Lee estado *grueso* de Pinia (4–10 Hz). Animaciones de UI con GSAP y los tokens de movimiento. Los componentes propios llevan el prefijo `Tz` para no chocar con los globales de cientos (`Grid`, `Html`…). |
| **Stores (Pinia)** | `session` (catálogo, sesión, estado de carga), `playback` (playing, rate, `coarseTime`), `selection` (coche, cámara), `settings` (calidad, idioma, exageración de Z, filtros) | Ningún dato por frame. Arrays con `markRaw`/`shallowRef`. |
| **Motor (`engine/`, TS puro)** | `SessionClock`, Hermite monótona, `TrackPath`, `ReplayModel` (estado de cada coche en t), leaderboard, neumáticos, banderas | Sin Vue ni three, 100 % testeable en Vitest. Se muta en sitio. |
| **Escena (TresJS)** | `TresCanvas` único a pantalla completa detrás del DOM, `ViewRegistry`, cinta, pit lane, coches instanciados, etiquetas, cámara | Lee del motor en `onBeforeRender` y escribe matrices y uniforms directamente. |
| **Datos (`data/` + Web Worker)** | Catálogo, manifest, descarga, descompresión, decodificación TRZB, precálculo de tangentes | Devuelve typed arrays **transferibles** (cero copias). |

### 2.3 Reloj maestro

- `SessionClock` guarda:
  - `timeMs` en **tiempo de sesión** (ms desde el `t0` de FastF1);
  - `rate ∈ {1, 2, 4, 8, 16}`;
  - `playing`;
  - `[startMs, endMs]`, tomado de `manifest.session.playback`.
- Avanza con el `delta` del bucle de render, limitado a 100 ms para no dar saltos al volver a la pestaña.
- Todo cuelga de `clock.timeMs`: escena, cabezal del timeline, leaderboard, telemetría y race control.
- `seek()` emite un evento que reubica los cursores por búsqueda binaria. Mientras se reproduce, los cursores avanzan en O(1).
- Pinia recibe `coarseTime` a ~10 Hz. El cabezal del timeline se mueve con `transform` directo.
- **En pausa** se usa `renderMode: 'on-demand'` y se llama a `invalidate()` en cada seek, selección o animación de cámara. Al reproducir se cambia a `'always'`.
- Todas las fuentes se normalizan a tiempo de sesión **en el pipeline**:
  - race control llega en UTC y se convierte con `UTC − t0_date`;
  - las horas que aparecen dentro de los textos se ignoran.

### 2.4 Movimiento fluido (el principio del brief, validado con datos reales)

**Pipeline**, una vez por **trazado de circuito**:
- Construye la **línea central canónica** del trazado (ver §2.7) a partir de las vueltas limpias más rápidas de varios pilotos:
  - spline periódica muestreada a 1 m;
  - `s = 0` en la línea de meta;
  - rotación a la orientación del mapa oficial.
- Construye el **pit lane** como polilínea propia con su longitud de arco `u`:
  - con las muestras de las vueltas de entrada y salida dentro de las ventanas `PitInTime`/`PitOutTime`;
  - sin las muestras lentas (< 30 km/h: garaje, box, colas) ni los retrocesos del feed; si aún gira más de 90° en 5 m, se prueba con otra parada;
  - su altura es la de la pista más cercana: el feed da la misma altura a todo el pit lane (en Spa, 7 m por debajo de la pista en la salida);
  - la distancia a la línea (> 8 m) sirve solo como comprobación.
  - Se guardan `entryS` y `exitS` sobre la línea, que pueden envolver `s = 0`.
- Antes de **reutilizar** el circuito guardado se comprueba que la sesión encaja (D21); si no, se construye una variante.

**Pipeline**, una vez por **sesión**:
1. Elimina muestras duplicadas (mismo `Date`) y las que tienen XY = 0.
2. Clasifica cada muestra como `path ∈ {0 pista, 1 pit, 2 sin dato}`:
   - pit: dentro de las ventanas de pit y, fuera de ellas, más cerca del pit lane que de la pista y a más de 2 m de la línea (las horas de `PitInTime`/`PitOutTime` no coinciden con la bifurcación: en Spa, hasta 60 s en la cola de salida; el feed pega las posiciones de pista a una línea, p90 de 0,13 m fuera de boxes, y la cola del semáforo de salida está a 4-5 m de ella);
   - sin dato: XY = 0, hueco > 2 s, coche en garaje, o junto al pit lane sin estar en ninguno de los dos caminos (nunca se pega a la trazada).
3. Proyecta sobre la línea con **búsqueda en ventana alrededor de la `s` anterior y distancia 3D**. La Z resuelve cruces como el puente de Suzuka. Tras cada hueco se vuelve a buscar en toda la línea.
4. Para las muestras de pit, guarda la **`s` equivalente en la pista**: un mapeo lineal de `u` sobre `[entryS, exitS]`, teniendo en cuenta el cruce por `s = 0`. Así `s` acumulada sigue siendo monótona y la lógica de vueltas no cambia. El Web Worker deshace el mapeo `s → u` para dibujar.
5. Desenrolla las vueltas en una distancia acumulada `s` y fuerza la **monotonía con regresión isotónica (PAVA)**. El máximo acumulado provocaría paradas seguidas de saltos. Hay un 0,06 % de retrocesos.
   - PAVA va por tramos de un mismo camino (nunca mezcla pista y pit) y luego en toda la serie.
   - Una muestra que PAVA tendría que mover más de 5 m es un fallo de posición y queda **sin dato** (en Spa, el 99,5 % se mueve menos de 0,13 m).
   - Una parada que la telemetría desmiente (> 1 s sin avanzar a más de 30 km/h: el feed congela la posición o la corrige hacia atrás) también queda sin dato, en vez de un coche parado que luego salta.
   - Un tramo sin ninguna vuelta del cronometraje (en boxes antes de la primera o tras la última) se ancla por continuidad con el tramo vecino.
6. Parte la serie en **segmentos** cuando hay un hueco > 2 s o un cambio de `path`.

**Web Worker**, al cargar:
- Calcula, por segmento, las tangentes de una **Hermite cúbica monótona** (limitador Fritsch–Carlson).
- La tangente es la velocidad medida, interpolada a los instantes de posición.

**En cada frame**:
- Por coche: `s(t)` con Hermite y después `TrackPath.sample(s mod L)` (o el pit lane), que da posición y tangente, y de ahí la orientación.
- Entre segmentos de `path` distinto se interpola linealmente en XYZ, durante el hueco (< 2 s).
- En "sin dato" el coche se oculta y su fila del leaderboard muestra "sin señal". **Nunca se inventan posiciones.**

Medido con datos reales, quitando la mitad de las muestras: el error a lo largo de la pista es p50 ≈ 1,0 m y p95 ≈ 7,7 m. El método se eligió por suavidad (velocidad continua y sin retrocesos), no porque sea más preciso.

### 2.5 Render, vistas y rendimiento

- **Un solo contexto WebGL**: un `TresCanvas` fijo a pantalla completa, detrás del DOM.
- Un `ViewRegistry` propio es el dueño de `useLoop().render(fn)`. Para cada vista:
  - rectángulo DOM → cámara → `setViewport`/`setScissor`;
  - el aspect se reaplica en cada frame;
  - raycast propio por vista.
- En la Fase 1 hay una sola vista, el mapa. Las vistas futuras de coche y piloto son entradas nuevas del registro, no canvases nuevos.
- Coches en un `InstancedMesh` (22 coches, 1 draw call) con color por instancia.
- Siglas y números de curva con **troika-three-text** (`BatchedText`), con fuentes autoalojadas: se configuran `defaultFontURL` y `unicodeFontsURL` en local. Por defecto troika tira de Google Fonts y de un CDN.
- Cinta de pista en una sola malla. Las banderas por sector se pintan en el shader con una textura 1D (sector → color), que solo se actualiza cuando cambia el estado.
- Presupuesto: < 30 draw calls y < 150 000 triángulos.
- **Sin post-proceso en la Fase 1**. El antialias es MSAA. Ver D10.
- El coche 3D se genera por código (D28): cuña de lejos y monoplaza genérico de ~1.500 triángulos de cerca, todo instanciado. Si algún día hay un GLB (D14), con Meshopt, **≤ 150 KB** y solo en `/replay`.
- **Calidad adaptativa**:
  - Si el p95 del frame supera 18 ms durante 3 s, se baja un escalón: DPR 2 → 1,5 → 1, luego MSAA off, luego etiquetas solo del coche seleccionado y del top 5.
  - Con `?debug=1` aparece un overlay con fps, p95, heap y draw calls.
- **Benchmark** (`?bench=1`): reproduce 60 s a x4 con el panel de telemetría abierto y vuelca p50/p95/p99 del frame, frames > 50 ms, heap (CDP `Performance.getMetrics`) y draw calls.

### 2.6 Pipeline (Python)

Etapas: `probe → fetch (FastF1, caché) → circuito canónico → proyección → timing → race control → codificar → validar → manifest/catálogo → sync al archivo privado`.

- **Probe**: comprueba que `livetiming.formula1.com` (y el espejo `livetiming-mirror.fastf1.dev`) responden 200. Si hay 403, **falla con un mensaje claro**.
- **Ventana de reproducción**, según el tipo de sesión:
  - carrera y sprint: [salida − 10 min, bandera + 5 min];
  - quali y libres: [inicio de sesión − 2 min, fin + 2 min].
  - Se guarda en `manifest.session.playback`.
- **Validación**, que falla en ruidoso. Umbrales únicos:
  - ≥ 90 % de los pilotos con pos/car no vacíos (si no, la sesión es `no-position`);
  - cobertura por piloto ≥ 99 % en los intervalos en pista;
  - cierre de la línea < 2 m (lo típico es < 1 m);
  - `s` monótona;
  - **elevación**: glitches con Z = 0 por debajo del 2 %, dispersión de Z entre pilotos < 1 m por tramo de 10 m de `s`, y desnivel total plausible (< 150 m). Si falla, la sesión se marca `elevation: "flat"` y la cinta se dibuja plana con un aviso.
- **Caché**: la de FastF1 en `.cache/fastf1`, no versionada. Si ya existe un manifest con las mismas versiones de pipeline y de esquema, la sesión se salta.
- **Fuentes**: `FastF1Source` es la principal, con la versión 3.8.3 fijada.
  - `OfflineCacheSource` lee cachés `.ff1pkl` con un *unpickler* restringido a una lista blanca. Sirve para desarrollar sin red con la caché real de Bélgica FP1 2026.
  - `--crosscheck openf1` compara opcionalmente vueltas, posiciones y stints con OpenF1. Es el "contraste" que pide el brief, y se ejecuta desde tu PC.
- **Sin Jolpica en la salida**:
  - Los resultados (`ClassifiedPosition`, `Status`, `Points`, `GridPosition`) y el tiempo de la vuelta 1 en carrera vienen de Jolpica, así que no se serializan.
  - La clasificación final se deriva del timing y de race control.
  - Un test falla si algún campo de origen Jolpica llega a un bundle.
  - Se descarta `HeadshotUrl`.
- **Límites**:
  - FastF1: 4 req/s y 500 req/h, globales por proceso. Son ~13–16 peticiones por sesión, unas ~30 sesiones por hora.
  - Backfill completo de 2023–2026 (~530 sesiones): ~18 h de reloj, a repartir en tandas (**fuera de la Fase 1**).

### 2.7 Lo que deja preparado para las fases siguientes

| Fase futura | Qué lo deja preparado en la Fase 1 |
|---|---|
| Heatmap histórico de incidencias | **Circuito canónico por trazado** (`circuitKey` + `layoutId` en `pipeline/circuits.json`, con su longitud oficial y su fuente), así que `s` es comparable entre sesiones y temporadas. Cada evento de race control guarda `turn`, `s` canónica y `marshalSector`. El parser vive en Python y puede agregar temporadas. |
| Coche 3D detallado (desgaste, energía y aero, todos Estimados) | `ViewRegistry` con scissor ya en marcha. Los manifests listan los canales disponibles (`channels`) y los campos estimados (`quality.estimated`). Componente `Estimado` común. La telemetría cruda (velocidad) está disponible en el motor para estimar energía. |
| Piloto 3D con Mixamo | Un solo contexto y vistas. GLB Meshopt con carga diferida y caché compartida. Aviso legal sobre avatares reconocibles (§5). |
| Publicación automática | El pipeline es idempotente y validado, guarda `pipeline.source` en el manifest, el archivo privado es obligatorio antes de automatizar, el deploy de datos es independiente de la app, el adaptador de fuentes está listo para OpenF1 y hay probe de 403. |

### 2.8 Política de fixtures de test

- El repo solo admite **extractos mínimos de datos reales**, ≤ 1 MB en total, bajo `DATA_NOTICE.md`:
  - un *golden set* de ≥ 300 mensajes de race control etiquetados a mano (2023–2026);
  - 2–3 vueltas de 3 coches de dos sesiones;
  - una sesión e2e recortada de 5 vueltas con todos los coches (~0,3 MB). Lleva, de antes de la ventana, la última fila de la torre de cada coche, las vueltas ya empezadas y los mensajes de dirección de carrera: su clasificación, sus contadores y su feed son los que hubo (lo comprueba `pipeline/tests/test_fixtures.py`). Sus variantes de estado (fp2, fp3, q, race) son inventadas, van marcadas `dev` en el catálogo y con la nota `e2e-variant`, y nunca deben salir en capturas como si fueran sesiones reales. El generador falla si el total pasa de 1 MB.
- Las sesiones completas **solo se usan en local**, con tests marcados `@local` que leen `data/`.
- Para el resto de tests unitarios hay **generadores sintéticos**: trazados, ruido de muestreo, huecos, pit lane y cruce de `s = 0`.
- En CI se ejecuta todo menos `@local`. El e2e sirve la sesión recortada desde el mismo origen.

## 3. Estructura de carpetas

> **Nota (D25):** `deploy/` ya no existe; todo se sirve en local con `pnpm local`.

```
trazada/
├── CLAUDE.md                      # se crea tras la aprobación
├── README.md                      # incluye el disclaimer de marcas (es/en)
├── LICENSE                        # MIT (solo el código)
├── NOTICE                         # terceros: GSAP no-charge, fuentes OFL, MultiViewer…
├── DATA_NOTICE.md                 # los datos no los licencia Trazada; derechos de sus titulares; no IA
├── package.json  pnpm-workspace.yaml  .nvmrc (24)  .editorconfig
├── deploy/
│   ├── app/wrangler.jsonc         # Worker "trazada": assets = apps/web/.output/public
│   └── data/{wrangler.jsonc,_headers}   # Worker "trazada-data": assets = data/
├── apps/web/                      # Nuxt 4 (app/ como srcDir)
│   ├── nuxt.config.ts
│   ├── app/
│   │   ├── pages/index.vue        # selector temporada → GP → sesión
│   │   ├── pages/replay.vue       # replay: /replay?s=2026/03-japan/race
│   │   ├── components/{ui,selector,replay,scene}/   # prefijo Tz
│   │   ├── components/{scene-layers,scene-tools,replay-header,replay-overlays,replay-dock,timeline-lanes,leaderboard-cells,analysis-tabs}/   # huecos por glob (D29; analysis-tabs, H14)
│   │   ├── slots/                 # registro de cada hueco (D29)
│   │   ├── composables/   stores/
│   │   ├── engine/{clock,interp,track,replay,format,leaderboard,compare,analysis,summary,timing,timeline,drs,camera,weather,ambience}/   # TS puro + tests (compare y analysis: motor compartido, H12; summary: tarjeta de fin de sesión, H13; analysis: race trace, ritmo y stints, timing/sectors, timeline/preview y drs/zones, H14; compare: diferencia, trazas y fantasma, camera/Director y cornerCams, weather y ambience/sun, H15)
│   │   ├── replay/                # runtime, teclas y Esc, depuración, reanudar (resume.ts, H13)
│   │   ├── data/          workers/session.worker.ts
│   │   └── design/{tokens.css,motion.ts,typography.css}
│   ├── i18n/locales/{es,en}/<ns>.json   # base.json + un fichero por función (D29); i18n/messages.ts
│   ├── public/{fonts/, decoders/}           # el coche se genera por código (D28)
│   └── tests/{unit,e2e,fixtures}/
├── packages/schema/               # fuente única del esquema
│   ├── manifest.schema.json  catalog.schema.json  events.schema.json  circuit.schema.json
│   ├── trzb/*.layout.json         # columnas, tipos, escalas
│   └── src/index.ts               # tipos TS generados + versiones
├── pipeline/                      # Python 3.13 + uv
│   ├── pyproject.toml  uv.lock  circuits.json
│   ├── src/trazada_pipeline/{cli,sources,circuit,projection,timing,racecontrol,encode,validate}/
│   └── tests/{fixtures/, golden/}
├── data/                          # salida local (gitignored)
├── docs/{BRIEF.md, PLAN.md, DATA_FORMAT.md, PERFORMANCE.md, adr/, research/}
└── .github/workflows/{ci.yml, deploy-app.yml}
```

## 4. Esquema de datos versionado (v1)

### 4.1 Rutas (en el Worker de datos; en desarrollo, bajo `/data`)

```
${DATA_BASE_URL}/v1/catalog.json                                   # temporadas → GP → sesiones (+ estado y tamaño)
${DATA_BASE_URL}/v1/circuits/{circuitKey}-{layoutId}/circuit.{hash8}.trzb.gz   # línea canónica, pit lane, curvas, sectores
${DATA_BASE_URL}/v1/sessions/{season}/{round:02d}-{slug}/{session}/manifest.json
${DATA_BASE_URL}/v1/sessions/{season}/{round:02d}-{slug}/{session}/motion.{hash8}.trzb.gz
${DATA_BASE_URL}/v1/sessions/{season}/{round:02d}-{slug}/{session}/car.{hash8}.trzb.gz
${DATA_BASE_URL}/v1/sessions/{season}/{round:02d}-{slug}/{session}/timing.{hash8}.trzb.gz
${DATA_BASE_URL}/v1/sessions/{season}/{round:02d}-{slug}/{session}/events.{hash8}.json.gz
```

- Identificadores únicos en todo el sistema:
  - `session ∈ {fp1, fp2, fp3, sq, sprint, q, race}`, que la CLI acepta también como `R`, `Q`, `FP1`…;
  - `slug` en minúsculas;
  - la URL de la app es `/replay?s={season}/{round:02d}-{slug}/{session}`.
- Recuento: 5 ficheros por sesión más 1 por trazado, lo que da **~2 700–3 500 ficheros** para 2023–2026. Lejos de los 20 000 y con < 10 000 por carpeta.
- **Caché**:
  - Ficheros con hash: `Cache-Control: public, max-age=31536000, immutable`.
  - `manifest.json` y `catalog.json`: `max-age=300`.
  - Al regenerar una sesión, los ficheros con hash antiguos se conservan **7 días**, para que un manifest cacheado no dé 404.
- **`Content-Type`** explícito en `_headers` (`application/gzip`, `application/json`): Workers no lo deduce de extensiones desconocidas.

### 4.2 Versionado

| Eje | Qué versiona | Regla |
|---|---|---|
| `schemaVersion` (semver) | El contrato completo de datos | **Major** = está en la ruta (`/v1/`) y es incompatible. **Minor** = añade columnas o tablas, que los lectores ignoran si no las conocen. **Patch** = corrige datos. |
| `layout` (`motion@1`…) | La disposición de columnas de cada fichero | Cambiar un layout de forma incompatible exige un major de `schemaVersion`; añadir columnas, un minor. Un test falla si un layout cambia sin subir la versión. |
| `containerVersion` (TRZB) | El enmarcado binario | Solo cambia junto a un major. |
| `minReader` (manifest) | La versión mínima del lector que entiende la sesión | Si la app es más antigua, muestra el estado "versión no soportada, recarga". |

**Orden de despliegue para un major nuevo**:
1. Publicar los datos con los dos majors a la vez (`/v1` y `/v2`).
2. Desplegar la app que lee `/v2`.
3. Retirar `/v1` al cabo de 30 días.

### 4.3 `manifest.json` (abreviado; **valores ilustrativos**, no reales)

```json
{
  "schema": "trazada.session", "schemaVersion": "1.1.0", "minReader": "1.0.0",
  "generatedAt": "2026-10-12T10:00:00Z",
  "pipeline": { "version": "0.1.0", "source": "fastf1", "fastf1": "3.8.3", "apiCoreVersion": 15 },
  "session": {
    "season": 2026, "round": 3, "slug": "japan", "event": "Japanese Grand Prix",
    "type": "race", "circuit": "0-0", "t0Utc": "2026-01-01T00:00:00.000Z", "gmtOffset": "+09:00",
    "playback": { "startMs": 0, "endMs": 0, "lightsOutMs": 0 }, "totalLaps": 0,
    "status": "ok"
  },
  "drivers": [
    { "number": "1", "tla": "NOR", "first": "Lando", "last": "Norris", "team": "McLaren", "color": "#F47600",
      "finish": { "kind": "classified", "position": 1, "lapsDown": 0 } }
  ],
  "channels": { "drs": "absent", "overtakeWindows": "raceControl", "elevation": "real", "weather": "present" },
  "quality": {
    "coverage": { "NOR": { "pos": 0.0, "car": 0.0 } },
    "centerlineClosureM": 0.0, "elevationRangeM": 0.0,
    "estimated": ["lap1Time"]
  },
  "files": { "motion": { "path": "motion.00000000.trzb.gz", "bytes": 0, "sha256": "…", "layout": "motion@1", "compression": "gzip" } },
  "attribution": ["F1 live timing via FastF1", "MultiViewer (circuit info)"]
}
```

`session.status` toma los valores `ok`, `no-position` o `partial`. El selector muestra las sesiones `no-position` como no disponibles, en lugar de ocultarlas.

Desde 1.1.0 (H15, D36), aditiva y con `minReader` 1.0.0: `channels.weather` (`present` o `absent`) y `events.weather`, ambos opcionales. Un manifest sin el canal es de antes de 1.1.0 y la app pide volver a descargar la sesión para tener meteorología. Detalle en `docs/DATA_FORMAT.md`.

### 4.4 Contenedor binario TRZB (sin dependencias, little-endian explícito)

```
"TRZB" | u16 containerVersion | u16 flags | u32 headerLen | header JSON (UTF-8) | padding a 8 | columnas alineadas a 8
```

- La cabecera describe cada tabla: número de filas y, por columna, `type ∈ {u8, i16, u16, i32, u32, f32, f64}`, `encoding ∈ {raw, delta}`, `scale`, `offset`, `unit`, `byteOffset` y `byteLength`.
- Todos los coches van concatenados, ordenados por coche y tiempo.
- La tabla índice `cars` (`start`, `count`, `tBaseMs`, `sBaseCm`) permite usar vistas `subarray` por coche, sin copiar.

| Fichero | Tabla | Columnas: en disco → en memoria |
|---|---|---|
| `circuit` | `centerline` | x, y, z: f32 m (orientación del mapa oficial, centrado), paso de 1 m → Float32Array |
| | `pitlane` | x, y, z: f32, más `entryS`/`exitS` (f32, pueden envolver `s = 0`) y longitud de arco |
| | `corners` | number (u8), letter, s, x, y, angle |
| | `marshalSectors` | number (u8), sStart, sEnd (f32). Definición: sector n = [s(marcador n), s(marcador n+1)), con envoltura en `s = 0` |
| `motion` | `pos` | t: **i32 ms**, delta respecto a `tBaseMs` · path: u8 (0 pista, 1 pit, 2 sin dato) · s: **i32 cm**, delta respecto a `sBaseCm` · projErr: u8 dm. En memoria t y s pasan a **Float64Array** (Float32 perdería precisión con s > 167 km o t > 4,6 h). |
| `car` | `tel` | t: i32 ms delta → Float64Array · speed: u16 km/h · rpm: u16 · gear: u8 · throttle: u8 (255 = sin dato; el 104 crudo se convierte en 255) · brake: u8 0/1 · drs: u8 (código crudo; 255 = canal ausente) |
| `timing` | `laps` | car, lap, startMs, endMs, lapMs, s1/s2/s3Ms, compound (u8 enum), tyreLife, fresh, stint, pitInMs, pitOutMs, position, trackStatusMask, deleted |
| | `stream` | t, car, position, gapToLeaderMs, intervalMs, lapsBehind: la torre de tiempos oficial, un registro por cambio |
| | `trackStatus` | t, code (1, 2, 4, 5, 6, 7) |
| `events` (JSON) | `raceControl[]` | `{t, lap, category, flag, scope, sector, car, text, parsed: {kind, turn, s, marshalSector, cars, outcome}}`. El `text` original se conserva tal cual. |
| | `sectorFlags[]` | `{sector, flag, fromMs, toMs}`: el estado ya resuelto para pintar el mapa |
| | `windows[]` | `{kind: "sc" \| "vsc" \| "red" \| "overtake" \| "drs", fromMs, toMs}` |

- La disposición de cada fichero vive en `packages/schema/trzb/*.layout.json`, compartida por el codificador Python y el decodificador TS.
- En CI hay un test de ida y vuelta: Python codifica, TS decodifica y se compara con un fichero dorado (sintético).
- **Compresión externa**: la indica el manifest (`gzip` por defecto, `zstd` opcional) y es independiente del layout.

## 5. Stack y piezas propuestas (todas gratis)

Versiones verificadas en npm y PyPI el 2026-10-10 y fijadas con lockfile. Lo marcado *propuesta* no estaba en el brief.

| Pieza | Versión | Licencia | Notas verificadas |
|---|---|---|---|
| Node | **24 LTS (≥ 24.15)** | MIT | Nuxt 4.6.1 exige `^22.22.3 \|\| ^24.15 \|\| >=26`. |
| pnpm (workspaces) | 12.x | MIT | *Propuesta*: instalación estricta y rápida. No hace falta orquestador de monorepo. |
| Nuxt | **4.5.2** (actualizado en H0) | MIT | La 4.6.1 se publicó el día anterior y la rechazó la protección de antigüedad mínima de pnpm, así que se usa la 4.5.2, sobre la que se prueba TresJS. Se subirá a la 4.6 cuando madure. No hay Nuxt 5 estable (estimado para el T4 de 2026). `ssr: true` + `nuxt generate`. |
| TypeScript | **6.0.x** (strict) | Apache-2.0 | `latest` es la 7.0.2, con compilador nativo; su compatibilidad con `vue-tsc` está por comprobar (en H0). |
| @tresjs/core / nuxt / cientos | **5.9.3 / 5.7.3 / 5.9.3** | MIT | `@tresjs/nuxt` fija `core` **exactamente** a 5.9.3. |
| @tresjs/post-processing | 3.10.0 | MIT | **No se usa en la Fase 1** (D10). |
| three | **~0.186.1** (fijado) | MIT | `postprocessing` declara `three < 0.187`. Los decoders se autoalojan. |
| Pinia + @pinia/nuxt | 4.0.3 + 1.0.2 | MIT | Compatible con Nuxt `^4`. Necesita `@vue/devtools-api`. |
| @nuxtjs/i18n | 10.6.0 | MIT | `strategy: 'no_prefix'` (no duplica rutas). |
| @intlify/eslint-plugin-vue-i18n | 4.5.1 | MIT | *Propuesta*: reglas `no-raw-text` y `no-missing-keys` en CI, más un script de paridad de claves es↔en. |
| GSAP | 3.15.0 | **"Standard no-charge"** (propietaria y gratuita) | Nuestro uso está permitido; solo prohíbe herramientas no-code que compitan con Webflow. No es OSI, es revocable y modificable. Se lista en `NOTICE`. Solo para transiciones de UI y cámara. |
| uPlot | 1.6.32 | MIT | *Propuesta* para las mini gráficas: Canvas 2D, ~22 KB gz, 60 fps en streaming. Plan B: sparkline propio. |
| troika-three-text | **0.52.5** (fijado; la 0.53.0 no es `latest`) | MIT | *Propuesta* para siglas y curvas. Fuentes y resolvedor de glifos autoalojados; usa .woff/.ttf (el soporte de woff2 se verificará). |
| Fuentes | @fontsource/barlow + barlow-condensed + ibm-plex-mono 5.3.0 | **OFL-1.1** | Autoalojadas con su `LICENSE` (OFL), sin modificar ni renombrar; solo los pesos que usan los tokens y el subconjunto latino por `unicode-range` (D47, antes Inter y JetBrains Mono). Descarto Titillium por la asociación visual con la marca. |
| CSS | Nativo: custom properties, SFC scoped, nesting | — | *Propuesta*, ver D11. |
| Web Workers | Módulos de Vite | — | `postMessage` con transferibles, sin Comlink. |
| fzstd | 0.1.1 | MIT | *Opcional* (D4): decoder zstd de 3,9 KB gz. |
| Vitest + @nuxt/test-utils | 5.0.3 + 4.3.3 | MIT | Rango compatible oficial. happy-dom, con WebGL simulado en los tests unitarios. |
| Playwright | 1.64.0 | Apache-2.0 | e2e con WebGL real en Chromium (en CI con SwiftShader), capturas y perfil iPad. |
| **@playwright/cli** | 0.1.22 | Apache-2.0 | Es el "playwright-cli" del brief (la herramienta oficial para agentes). `playwright-cli` está deprecado. |
| @axe-core/playwright | 4.13.0 | MPL-2.0 | Solo desarrollo: auditoría de accesibilidad WCAG 2.1 A/AA en los e2e (H10). No se distribuye. |
| Python + uv | 3.13 + 0.13 | PSF / MIT-Apache | |
| FastF1 | **3.8.3** (fijado) | MIT | Para 2026 hace falta ≥ 3.8.1. |
| numpy, pandas, scipy | — | BSD | |
| jsonschema, typer, huggingface_hub | 4.26 / 0.27 / 2.2 | MIT / MIT / Apache-2.0 | Validación, CLI y sincronización con el archivo privado. |
| pytest + ruff | 9.1 / 0.17 | MIT | *Propuesta*. |
| gltf-transform CLI | 4.5.1 | MIT | GLB con Meshopt. El decoder se toma de la **misma versión de meshoptimizer** que el encoder; la de three es la 1.1. |
| wrangler / wrangler-action | 4.x / v4 | MIT-Apache | Deploy de los dos Workers. |

**API de TresJS v5 que usaremos**, verificada en el código fuente (la documentación está en parte desactualizada):
- `useLoop()` → `onBeforeRender(fn, priority)`, `onRender` y `render(fn)`. `render(fn)` sustituye la función de render; ahí vive el `ViewRegistry`.
- `useTres()` da acceso al `renderer` crudo, la `scene` y la `camera`.
- `renderMode: 'always' | 'on-demand' | 'manual'`. `invalidate()` no hace nada si ya hay un frame pendiente. `fpsLimit` es reactivo.
- `useLoader(Loader, path, {extensions})` devuelve `{state, isLoading, …}` *shallow* y no cachea entre instancias, así que el GLB se carga una vez y se comparte.
- `useTexture` vive en cientos.
- `useRenderLoop`, `useSeek`, `useRaycaster` y `useCamera` ya no existen.
- Los eventos de puntero son nativos y solo dispara el primer impacto.

Trampas:
- Hay **un único hueco de render**. Los composers de post-proceso lo ocupan, no lo restauran y con `enabled=false` dejan de pintar.
- `useGLTF` de cientos carga Draco desde `gstatic.com` y no soporta Meshopt, así que usamos el `GLTFLoader` de three.
- `<Html>` y los eventos de puntero no tienen en cuenta los viewports.
- `@tresjs/nuxt` registra como globales componentes con nombres genéricos (de ahí el prefijo `Tz`) y tiene una dependencia fantasma de `@nuxt/devtools-kit`, así que mantenemos el hoisting por defecto de pnpm.

### Legal (resumen; detalle en `research/validacion-brief.md` §6)

> No es asesoramiento jurídico. `formula1.com` está bloqueado desde aquí, así que lo que cito de sus términos viene de búsqueda (evidencia secundaria) y conviene leerlo directamente.

**Marcas**
- F1, FORMULA ONE, FORMULA 1, FIA FORMULA ONE WORLD CHAMPIONSHIP, GRAND PRIX y las marcas relacionadas son de Formula One Licensing B.V.
- Según las directrices de F1, fans y medios pueden usar esas palabras y los títulos de evento **para informar, no para marcar**: sin sugerir afiliación ni actuar de forma "materialmente comercial". Los logos no se pueden usar nunca.
- Hay precedente: F1 avisó a una app (Box Box Club) por llevar "F1" en el nombre, usar la tipografía oficial y mostrar fotos de pilotos.
- **Nuestras reglas**:
  - "F1" no aparece en el nombre, el dominio, la organización o el repo, los paquetes npm/PyPI ni las cuentas sociales.
  - Se muestra el `EventName` corto ("Japanese Grand Prix"), **nunca** el `OfficialEventName` con patrocinadores.
  - Ni logos, ni tipografía oficial, ni fotos, ni libreas.
  - Sin anuncios, afiliados ni merchandising.
  - Los enlaces a formula1.com van en texto plano.
  - El **disclaimer oficial** va en el footer de todas las páginas y en el README (es/en).
  - El contacto de F1 para permisos es **brandprotection@f1.com**.

**Datos de timing**
- Según la búsqueda, los términos de F1 los protegen (copyright y base de datos): son para uso personal y no comercial, republicar "partes sustanciales" requiere consentimiento, y **prohíben la minería de datos (TDM) y la IA** sin licencia.
- FastF1 y OpenF1 no conceden derechos sobre los datos, y la etiqueta Apache-2.0 de TracingInsights tampoco puede concederlos.
- No he encontrado retiradas contra repos de timing. Es una **zona gris tolerada, no un derecho**. La solidez del derecho *sui generis* de FOM sobre datos que genera ella misma es discutible, pero esa es una pregunta para un abogado; no es un argumento para usar en público.
- Mitigaciones:
  - publicar solo lo que necesita el visor, por sesión y cuantizado;
  - **sin licencia abierta sobre los datos** (`DATA_NOTICE.md`);
  - nada de plataformas de ML;
  - el código y los datos están separados, y los datos se retiran con un comando;
  - ninguna función de IA sobre datos de F1.

**MultiViewer** (curvas, sectores de comisarios, rotación)
- No publica términos de uso. Sus datos son "hechos a mano" y se los cedió a FastF1.
- Propuesta:
  - **pedirles permiso**;
  - mientras tanto, usarlos solo como entrada del pipeline y publicar únicamente valores derivados (número de curva, `s` proyectada, tramos de sector), con atribución.
- Plan B, que **requiere tu aprobación porque se desvía del brief (punto 8)**: curvas obtenidas de la curvatura y revisadas a mano, y banderas solo en el feed y el timeline, sin pintarlas por sector.

**Otras fuentes y licencias**
- **Jolpica**: CC BY-NC-SA. No se publica ningún campo suyo (§2.6).
- **OpenF1**: solo consumimos su API; no copiamos su código, que es CC BY-NC-SA.
- **Nombres, siglas, números y colores**: como etiquetas factuales el riesgo es bajo. F1 no cede derechos de equipos ni de pilotos.
  - Se descarta `HeadshotUrl`.
  - Los coches son genéricos, con un único acento de color.
  - **Aviso para la Fase 3** (piloto 3D): el Supremo neerlandés (Verstappen/Picnic, 2022) admite que un parecido reconocible por el contexto cuente como retrato. Un mono con los colores del equipo y el número del piloto se acerca a eso, así que propondré un avatar neutro con un solo acento y sin réplica de casco.
- **Fuentes OFL**: autoalojadas con su `OFL.txt` y una página de créditos.
- **GSAP**: va en `NOTICE`.
- **Mixamo** (fases futuras): no se suben ficheros crudos al repo. Por defecto, animaciones CC0; las de Mixamo solo horneadas en GLB propios.

## 6. Decisiones clave y alternativas descartadas

| # | Decisión | Por qué | Alternativas descartadas |
|---|---|---|---|
| D1 | **Cloudflare Workers Static Assets**: dos Workers solo de assets (app y datos), sin script, con `_headers` | Cloudflare los recomienda para proyectos nuevos. Estáticos gratis e ilimitados, mismos límites que Pages, deploy por hash. | **Pages**: válido pero no recomendado para proyectos nuevos; queda de plan B. **GitHub Pages**: 1 GB y 100 GB/mes. **R2**: exige un *checkout*. |
| D2 | **Datos como assets de la app en un Worker propio**, sin licencia abierta. Archivo de registro **privado** (local más HF privado) | Minimiza la exposición legal y se retira con un comando. Sin terceros en caliente. Caché inmutable. | **Dataset público en HF** (lo del brief): máxima visibilidad, choca con la prohibición de TDM/IA y la retirada es inmediata. **git/LFS**: LFS se bloquea pasados 10 GiB/mes y una retirada se llevaría el código. **GitHub Releases**: público y sin CORS verificado. **Mismo Worker que la app**: obligaría a tener los datos en CI. |
| D3 | **Contenedor binario propio, TRZB** (typed arrays alineados) más manifest JSON | Cero dependencias y vistas sin copias. Medido con las mismas columnas: 8,7 MB en crudo frente a 9,5 MB de Arrow. Con deltas y gzip, 2,45 MB. Se vuelve a medir en H1 contra Arrow con los mismos deltas. | **Arrow IPC**: `apache-arrow` 21.2 pesa ~48–51 KB gz, solo lee IPC comprimido si registras un códec síncrono y su *tree-shaking* tiene incidencias. **Parquet** (parquet-wasm): ≥ 456 KB br. **JSON**: 22,7 MB en crudo. **FlatBuffers/MessagePack**: no aportan nada sobre typed arrays. |
| D4 | **Compresión externa declarada en el manifest**. Por defecto **gzip con `DecompressionStream`**, nativo, en el Web Worker. En H3 se mide **zstd con fzstd** y se adopta si descomprimir una carrera tarda < 150 ms en el portátil de referencia | El CDN no comprime binarios. gzip y deflate son los únicos formatos nativos en los tres motores. zstd ahorra un 35 % con un decoder de 4 KB. | **brotli**: Chrome no lo soporta en `DecompressionStream` y el decoder JS ocupa ~67 KB. **`Content-Encoding` vía `_headers`**: sin documentar. **zstd nativo**: solo en Firefox y tras un flag. |
| D5 | **Ingesta local desde IP residencial** en la Fase 1 | F1 devuelve 403 a las IPs de nube. | **Actions**: bloqueado. **Runner self-hosted en un repo público**: inseguro. **OpenF1 como fuente principal**: 30 req/min, sin `Status` ni track status y solo desde 2023; queda como adaptador para automatizar y como contraste. |
| D6 | **Proyección sobre la línea en el pipeline**. El Web Worker solo calcula tangentes | Se hace una vez y se testea, guarda `s` en lugar de XYZ y descarga al navegador. | Proyectar en cada carga en el navegador. |
| D7 | **Hermite cúbica monótona** (Fritsch–Carlson) **con tangentes de la velocidad medida** y monotonía por PAVA | Error p50 de 1,04 m frente a 1,18 m de la lineal. Velocidad continua y sin retrocesos. | **Lineal**: tirones. **PCHIP sin velocidad**: igual de precisa, pero descarta un dato real. **Catmull-Rom 2D**: puede retroceder. **Máximo acumulado**: produce paradas y saltos. |
| D8 | **Gaps del leaderboard tomados de la torre oficial** (`TimingData`) | Es el dato real. | Calcularlos por distancia: serían "Estimado"; quizá como modo opcional más adelante. |
| D9 | **Parser de race control en Python** (pytest), con el texto original conservado | Se ejecuta una vez por sesión y sirve también para el heatmap. **Se desvía del brief**, que pedía Vitest para los parsers; Vitest sigue cubriendo los parsers binarios y de manifest. | Parser en TS: se repite en cada cliente y no permite agregar temporadas. |
| D10 | **Sin post-proceso en la Fase 1**: antialias con MSAA | Un único hueco de render, y los composers chocan con el `ViewRegistry`. Un dashboard de datos no lo necesita. **Se desvía del stack del brief.** | `@tresjs/post-processing` desde el principio: se evaluará con pases por vista en la fase del coche 3D. |
| D11 | **CSS nativo** con custom properties como tokens | Cero dependencias, y GSAP puede leer los tokens. | Tailwind/UnoCSS: añaden otra capa. Nuxt UI/PrimeVue: estética genérica. |
| D12 | **uPlot** para las mini gráficas | 22 KB gz, Canvas 2D y 60 fps. | ECharts (~1,1 MB), Chart.js (~208 KB), webgl-plot (otro contexto GL). |
| D13 | **troika-three-text** (`BatchedText`) para siglas y curvas | SDF nítido y barato. | `Text3D` (geometría pesada), `<Html>` (DOM por frame y sin viewports), atlas propio (más código). |
| D14 | **GLB con Meshopt** y `GLTFLoader` de three, con el decoder autoalojado | Decoder de 7,7 KB gz, un solo loader y sin CDN. | `useGLTF` de cientos: Draco desde gstatic y un segundo loader. |
| D15 | **`ssr: true` + `nuxt generate` prerenderizando solo `/` y el shell de `/replay`**. La sesión se elige con `?s=` y el catálogo se carga en tiempo de ejecución | Desacopla el build de la app de los datos: una sesión nueva no obliga a recompilar. Los deep links funcionan sin reescrituras. | Prerenderizar una ruta por sesión: acopla app y datos y multiplica los ficheros. Rutas con path y fallback SPA: dependen del soporte de reescrituras de Workers (sin verificar). `ssr: false`: peor primer pintado. |
| D16 | **pnpm workspaces + uv** | Simple y estricto. | npm/yarn, Nx/Turborepo, poetry. |
| D17 | **Reloj = tiempo de sesión de FastF1 en ms**, todo normalizado en el pipeline | Una sola fuente de verdad. | UTC o reloj por vueltas. |
| D18 | **Esquema compartido** (JSON Schema + layouts) con el major en la ruta y `minReader` | Python y TS no pueden divergir sin que falle un test. | Tipos duplicados a mano. |
| D19 | **Node 24 + TypeScript 6.0** | Nuxt 4.6 lo exige y `vue-tsc` necesita la API JS de TS. | TS 7 (se reevalúa tras H0); Nuxt 4.5.2 con Node 22 (es el plan B). |
| D20 | **2026 = 22 coches; N variable** | Es el dato real. | — |
| D21 | **Circuito canónico por trazado**, compartido entre sesiones. Se reutiliza solo si las vueltas limpias de la sesión encajan (desvío sostenido ≤ 5 m, mediana ≤ 2 m, longitud ±3 %); si no, se construye una variante `{id}-v2`… con un aviso en `quality.notes`. Un circuito en el que la sesión encaja se reconstruye en su sitio si es de una versión anterior de la construcción (`geometryVersion`) o si no tiene curvas ni rotación oficial y la sesión las trae; nunca si perdería las que ya tiene, el pit lane (una sprint sin paradas) o los sectores de comisarios, ni si la sesión no basta para construirlo (se reutiliza y se avisa) | `s` es comparable entre sesiones y temporadas, como necesita el heatmap. Hay menos ficheros. Sin comprobar, un trazado cambiado (Abu Dabi 2021, Barcelona 2023) se dibujaría sobre la línea antigua | Línea central por sesión: los orígenes y longitudes difieren entre sesiones. |
| D23 | **Uso personal y privado** (2026-10-10): no se publica ningún dato; la app se usa en local (`pnpm local`, con `--lan` para la red de casa) | Lo pidió el usuario: proyecto totalmente personal y «lo que sea legal». Usar los datos para uno mismo es legal; publicarlos sería redistribuirlos sin licencia (F1 y MultiViewer). | Despliegue público en Cloudflare (D1/D2), que queda en pausa; si algún día se despliega, solo con control de acceso. |
| D27 | **Banderas y trazados en el selector** (2026-10-10): bandera SVG de `country-flag-icons` (MIT) y miniatura del trazado de `bacinger/f1-circuits` (MIT, fijado a un commit, simplificado con `trazada outlines` y versionado en el front), con el norte arriba | Lo pide el usuario. Ambas fuentes son gratis, con licencia MIT y sin datos de F1. Funcionan sin red y cubren todos los GP de 2018–2026, también los no descargados. | Emoji (en Windows salen dos letras); trazados propios (solo circuitos descargados); x/y de MultiViewer (sin licencia); OSM (ODbL) y Wikimedia (CC BY-SA). |
| D28 | **Coche 3D genérico hecho por código** (2026-10-10): monoplaza de ~1.500 triángulos en `engine/car/carGeometry.ts`, cuña de lejos y modelo de cerca con histéresis, zoom de la cámara de seguimiento | Sin licencias ni procedencia de terceros, proporciones actuales y halo, colores desde tokens y sin red. Identidad solo por color de equipo, número y siglas. | GLB de Kenney «race» (CC0, solo verificable en un espejo; sin halo, proporciones de juguete); modelos de Sketchfab (réplicas de coches reales o CC-BY dudosos); un LOD intermedio (a 17–28 px se lee peor que la cuña). |
| D26 | **Gestor de datos en la app** (2026-10-10): con `pnpm local`, el selector muestra el calendario de cada temporada y descarga cada sesión con un clic (cola, progreso, errores, en bloque por GP y carreras de la temporada) ejecutando el pipeline en el PC | Lo pide el usuario: rellenar los datos sin usar la terminal. El servidor local ya existía (D25); la API solo atiende al propio PC, del mismo origen y con cabecera propia, y el pipeline se lanza sin shell con argumentos validados. | Seguir con la CLI (incómodo para muchas sesiones). Un script de lote sin interfaz (no muestra qué falta ni el progreso). |
| D25 | **Solo local, sin Cloudflare** (2026-10-10): sin ningún despliegue; la app y los datos viven en el PC (`pnpm local`) | Lo decide el usuario. Es lo más simple y lo más claramente legal (D23). | El despliegue privado con contraseña (D24), que se implementó y se retiró. |
| D24 | *(Retirada por D25.)* **Despliegue privado con contraseña** (2026-10-10): una Worker de Cloudflare (`deploy/private/`) con la app y los datos publicables, accesible solo con contraseña (cookie HMAC, `run_worker_first`) | El usuario quiere verla en una URL sin dejar de ser uso personal (D23). Workers Free: gratis y sin tarjeta, y el límite de 100 000 peticiones al día sobra. | Vercel: la protección con contraseña es de pago (Pro). Cloudflare Access: pide un método de pago incluso en el plan gratis. Público (D1/D2): descartado por D23. |
| D22 | **Etiquetas (curvas y siglas) en DOM proyectado** en cada render, en lugar de troika-three-text | Texto nítido con las fuentes de la app (woff2, sin convertir a woff/ttf para troika), accesible, i18n directo, 0 draw calls. Coste: escribir `transform` en ~45 nodos por frame (solo capa de composición). | troika `BatchedText`: necesita fuentes woff/ttf autoalojadas y el `unicodeFontsURL`, y no aporta nada para ~45 etiquetas. |
| D29 | **Puntos de extensión para trabajar en paralelo** (2026-10-10, H12): textos por namespace (`i18n/locales/<idioma>/<ns>.json`, una raíz por fichero; `i18n/messages.ts` falla con una raíz repetida). Huecos por glob (`components/{scene-layers,scene-tools,replay-header,replay-overlays,replay-dock,timeline-lanes,leaderboard-cells}/*.vue`, registros en `app/slots/`, orden por `order` o `renderOrder`; en H14, `analysis-tabs` para las pestañas de la hoja de análisis). Teclas y Esc con prioridades fijas (`replay/keys.ts`, `ESC_PRIORITY`). `registerSceneStat` y `sceneStats.layers`. `rt.ext`, `initialMs` y `setSceneHidden`. Ficheros comunes con un solo dueño por tanda | Las 21 funciones se reparten entre varios workers por tanda: así cada una añade sus ficheros sin tocar los anfitriones ni pisar a otra. Con los huecos vacíos, la app es la misma. | Un fichero de textos único y anfitriones editados por cada función (conflictos en cada fusión); registro de huecos en un solo módulo (arrastraría la escena al chunk de la página). |
| D30 | **Iconos con `@lucide/vue` 1.48.0** (2026-10-10, H12), dentro del bundle, con registro semántico (`design/icons.ts`, el único que importa Lucide), `TzIcon` y `TzHint`. Un icono nunca sustituye al texto honesto. Desde la Tanda 5 (H17), todo icono de la portada y del replay sale del registro y la lista permitida del test queda vacía | ISC (MIT los derivados de Feather), sin red, solo se empaqueta lo registrado. Pasa la antigüedad mínima de pnpm. | `lucide-vue-next` (congelado), unplugin-icons, Shepherd (AGPL) y driver.js (no hace falta). |
| D31 | **Comparar dos pilotos por distancia** (2026-10-10, H15): el coche elegido (A) contra otro (B, con Mayús+clic o la lista del panel). Diferencia en vivo por distancia desde el GPS, con «Estimado» (`lapDelta`) y en décimas, en la última distancia que ya habían recorrido los dos; diferencia oficial con `lapMs` al cerrar A su vuelta, pendiente hasta que B cierra la de referencia. Referencias: misma vuelta (por defecto en carrera y sprint), mejor vuelta (por defecto en libres y clasificación; nunca la 1 ni una anulada) y última vuelta (nunca la 1), fijadas al empezar A su vuelta; solo cuentan si ya habían empezado (misma) o terminado (mejor, última): nada del futuro. Trazas de velocidad, acelerador y freno por distancia con las muestras crudas. Fantasma = posición real de B desplazada en el tiempo, oculto en huecos > 2 s, `--tz-compare-b`, `renderOrder` 12, 1 draw call, sin niebla ni clics. Conmutador de icono «Comparar» en la cabecera del panel (la vista sustituye a la rejilla y a las mini gráficas); Esc con prioridad 60 | El ruido del GPS (±8 m ≈ ±0,1 s) no da para milésimas; la cifra exacta es la oficial al cerrar la vuelta. Con los datos completos, la diferencia en vivo al cerrar queda a una mediana de 75–83 ms de la oficial. El panel a 1280×800 ya va lleno: una fila de pestañas lo cortaría. | Delta en milésimas (falsa precisión con el ruido del GPS); la vuelta 1 como mejor vuelta (no tiene tiempo oficial); un fantasma que puentee los huecos de posición. |
| D32 | **Mapa de calor de la pista** (2026-10-10, H16): «Velocidad», dato real (muestras crudas a ~4 Hz colocadas con la distancia del replay; interpolación solo entre dos muestras seguidas; con más de 2 s entre ellas o un hueco de posición, sin color) o «Minisectores», con «Estimado» (`minisectors`): 25 tramos iguales desde la meta con `timeAtS`, banda de empate de 50 ms en gris y la pareja A/B de la comparación. Solo vueltas representativas, completas y con su paso por meta hace ≥ 2 s; «Última» por defecto en carrera y sprint, «Mejor» en libres y clasificación; sin coche, la más rápida de la sesión hasta ese momento. 1 draw call sin niebla, `renderOrder` 0,5, siempre bajo las banderas; colores subidos solo al cambiar la vista. Apagado por defecto (`trazada.heat`) | La velocidad es lo que midió el coche y nunca se rellena; el ganador de un minisector depende del GPS (15–30 ms de error por tramo), por eso lleva «Estimado» y empata por debajo de 50 ms. Nada del futuro. | Colorear con la velocidad interpolada en los huecos; minisectores por tiempos de sector (solo hay 3); ganador sin banda de empate. |
| D33 | **Análisis de vueltas** (2026-10-10, H14): hoja «Análisis» entre la cabecera y el dock (diálogo no modal, Esc con prioridad 80, escena tapada con `setSceneHidden`) con pestañas en un hueco nuevo (`analysis-tabs`). Race trace por los pasos por meta oficiales (`crossMs`), sin corrección de combustible ni suavizado: el primero arriba, un doblado puede pasar de una vuelta y una serie sin paso por meta se corta. Ritmo con las vueltas excluidas marcadas, nunca quitadas (vuelta 1, boxes, SC/VSC/roja, anulada desde su mensaje, sin tiempo oficial contada), escala de las representativas con las que quedan fuera contadas y «Ver todas»; por vuelta en carrera y por hora en libres y clasificación. Stints por número de stint y compuesto (sin número, también por salida de boxes), TyreLife con su aviso y «sin dato». «Sin spoilers: hasta ahora» activo por defecto. Race trace solo en carrera y sprint, con estado vacío en el resto. Siglas exactamente a la altura del último dato de su serie o ninguna (la leyenda la nombra; la del coche elegido, siempre), sin guías ni trazos: por vuelta, en columna justo tras el último dato con la marca del trazo de la serie; por hora, el texto junto al último punto. Fuera de la escala, en el borde con un triángulo. En las gráficas de puntos, el segundo piloto de cada equipo con ■ □ + en lugar de ● ○ ✕. Un coche que deja de pasar por meta (el primero da tres vueltas desde su último paso) acaba en una raya, sin sigla, con «hasta Vn» en la leyenda | Todo es cronometraje oficial ya cargado (índice de vueltas de la clasificación) y uPlot ya era dependencia. Lo que no sirve para comparar se ve marcado, sin borrar datos. Con la hoja abierta, la GPU descansa. | Corrección de combustible y ritmo suavizado (serían estimaciones); parrilla o resultados (Jolpica); race trace en libres y clasificación (cada piloto rueda a su aire). |
| D34 | **Colores de sector calculados por Trazada** (2026-10-10, H14) con los tiempos oficiales: morado = estrictamente mejor que el mejor de la sesión hasta ese instante (un empate no), verde = estrictamente mejor que el personal, amarillo = el resto, gris = sin dato (−1). Cada color se fija al completarse el sector (S3 en meta, S2 = meta − S3, S1 = meta − S3 − S2; sin un tiempo posterior, la meta como cota). Solo vueltas con paso por meta real y completadas antes del reloj; una anulada deja de contar desde su mensaje y se muestra anulada. Tres marcas por fila de la clasificación (el panel se ensancha 30 px) y una línea en el panel del coche. El color nunca va solo y nunca se da una «mejor vuelta posible» | FastF1 descarta las banderas morado/verde por sector del feed; los tiempos sí son oficiales y el cálculo es determinista, no una estimación. El tooltip dice que no son las marcas del cronometraje. | Las banderas del feed (no llegan); columnas `Sector*SessionTime` (cambiarían el layout); «mejor vuelta posible» (estimación). |
| D35 | **Momentos** (2026-10-10, H16): adelantamiento = cambio del orden oficial en la línea entre dos vueltas seguidas (mismo número de vuelta), sin boxes de ninguno y a < 30 s en las dos líneas; vuelta 1 nunca; sin paso por meta, nada. Instante = último cruce de las distancias GPS (cada 250 ms) con «Estimado» (`overtakeTime`); si no, «momento exacto: sin dato». Duelo = seguidos en la línea a < 1 s durante ≥ 3 vueltas, sin boxes ni SC/VSC/roja; sin estado de pista por vuelta, ninguno. Saltos (5 s antes) entre adelantamientos, inicio de duelos, neutralizaciones y mensajes destacados, con botones en el dock, coma y punto, pestaña «Momentos» con «Sin spoilers» y marcas en el timeline | Solo el cronometraje confirma un adelantamiento: con GPS solo salen 1858 cruces frente a 50 cambios de orden reales. El GPS solo sitúa el instante, y lo dice. | Adelantamientos por cruces de GPS (ruido); la vuelta 1 contra la parrilla (Jolpica, prohibida); duelos sin descartar neutralizaciones. |
| D36 | **Meteorología** (2026-10-10, H15): `events.weather` (WeatherData, una muestra por minuto, las del intervalo más la vigente al empezar) y `manifest.channels.weather` (`present`/`absent`, como el resto de canales; el plan decía `ok`), opcionales; `schemaVersion` 1.1.0 con `minReader` 1.0.0. Parse crudo en línea (`fastf1.api.fetch_page`: clave ausente o ilegible → null); desde la caché parseada, un 0 exacto o una fila toda a 0 es sin dato. Lluvia sí/no, sin interpolar; valor escalonado que caduca a 150 s; una sesión anterior a 1.1.0 pide volver a descargarla. Chip de la cabecera (solo icono < 1600 px; aire y pista desde 1600; todo desde 1920) con panel, brújula del viento con el norte arriba junto al trazado (D27) y franja de 3 px en el timeline | FastF1 rellena con 0 lo que falta, y un 0 inventado se leería como medida. El mapa 3D no está orientado al norte, así que el viento solo se dibuja junto a un norte real. Cambio aditivo: los lectores y los datos 1.0.0 siguen valiendo. | Flecha de viento sobre el mapa; intensidad de lluvia (el feed es booleano); interpolar entre minutos; el parseo de FastF1 con sus ceros. |
| D37 | **Ambiente de la escena** (2026-10-10, H15), decorativo («posición del sol, no el tiempo»): altura del sol con las fórmulas de la NOAA desde `t0Utc` + el reloj y el centro del circuito (centro de la caja del trazado de bacinger/f1-circuits, MIT, a 0,01°; `centers` en `circuit-outlines.json`), nunca `gmtOffset`. Fases día ≥ 6°, crepúsculo y noche < −6° con mezcla de `--tz-sky-*`; cielo como esfera con degradado por vértice (1 draw call, 992 triángulos, `renderOrder` −10); niebla de three solo en la pista, del 0 al 25 % de la parte cercana a la lejana, con bordes a ≥ 3:1 del fondo en todas las fases; coches, banderas y capas con `fog: false`; tono de focos ≤ 8 % de noche. Sede u hora desconocidas: escena neutra y «sin dato». Activo por defecto en «Capas», por navegador (D41) | `gmtOffset` no es fiable (+00:00 en Japón dev); la hora UTC y la posición sí. Solo se recolorea al cambiar de paso de sol (0,25°): sin renders en pausa. Una bandera es su significado: no se apaga con la distancia. | Hora local con `gmtOffset`; cielo con el tiempo atmosférico (no está en los datos); niebla en toda la escena (taparía coches y banderas). |
| D38 | **Zonas de DRS deducidas de la telemetría** (2026-10-10, H14), solo de 2018 a 2025, con «Estimado» (`drsZones`): abierto = `drsState` 10/12/14; pasadas limpias (en pista, fuera de SC/VSC/roja); celdas de 5 m con cada pasada contada una vez; zona con ≥ 3 pasadas, ≥ 10 % de la celda más usada y ≥ 2 coches; canal atascado (> 50 % abierto) fuera; tramos unidos a < 30 m, fuera los de < 100 m y sin zonas si pasan del 60 % de la vuelta. Se calcula en el Web Worker. Capa de 1 draw call (`renderOrder` 0,7, anchura de mapa), intensa con la ventana de DRS de dirección de carrera (0,42) y tenue sin ella (0,12). En 2026, sin zonas y con la leyenda «En 2026 no hay datos de zonas ni de modo adelantamiento por coche». La etiqueta «Estimado» también en la fila de etiquetas de la escena mientras se pinta | Ninguna fuente da la geometría de las zonas; el canal por coche dice dónde se abrió el DRS de verdad. Es honesto si se marca como deducido. | Dibujar zonas oficiales (no existen en los datos); casar los mensajes «zona n» con tramos (no se puede saber cuál es); zonas en 2026 (no hay canal por coche). |
| D39 | **«Realización automática»** (2026-10-10, H15): en carrera y sprint con torre, el duelo más cerrado entre consecutivos de la torre, a la vista y en pista, < 1 s (intervalo + 0,05 s × posición), con la única cifra que se enseña (la de la torre, 3 decimales). En libres, clasificación o sin torre, por cercanía en pista y sin número (en carrera con la `s` acumulada: un doblado no es duelo). Con SC/VSC en carrera, el líder de la clasificación (nunca el primero en pista); con roja, sin líder o fuera de carrera, la vista general. Histéresis de pared: plano ≥ 7 s, cortes ≥ 6 s, cambio solo si el duelo se rompe (> 1,5 s, pit, sin señal, no consecutivos) o hay otro < 0,7 × el actual. Persecución y cámaras fijas en curvas cerradas (≥ 35°, de MultiViewer o de la curvatura). Cualquier acción manual la apaga (Esc con prioridad 70, tecla T, «Salir»). Con reduced motion, solo cortes. Menú «Cámara» y botón de cabecera solo con puntero grueso | Sin intervalos oficiales, un número sería inventado; la cercanía sirve para elegir, no para mostrarse. La histéresis evita cortes nerviosos. Nombre sin marcas. | Cifra de gap calculada por posición; seguir al primero en pista bajo SC; «F1 TV» como nombre. |
| D40 | **Tarjeta de fin de sesión** (2026-10-10, H13): fin = último «Finished», si no la última bandera a cuadros, si no el fin de los datos (fuera de los datos, `data-end`, y la tarjeta lo dice). Aparece cuando el resultado está asentado: en carrera, con los tres primeros tras la bandera (15 s de margen para el líder); en libres y clasificación, al acabar las vueltas empezadas antes del fin; nunca después del fin de los datos. Se abre sola solo al cruzar ese momento reproduciendo (no con un salto ni en el bench); botón «Resumen» en el dock. Tres primeros de la clasificación del replay, vuelta rápida oficial no anulada, paradas por cambio de stint y tiempo en el pit lane. «Según el cronometraje al terminar; sin sanciones posteriores» | Solo cronometraje real: las sanciones serían resultados de Jolpica y el tiempo de parada en el box no está en los datos. Abrirla en el fin mismo daría gaps no definitivos y, en clasificación, a menudo otra pole. | Abrirla en el instante del fin; parrilla o resultados finales de Jolpica; tiempo de parada estimado. |
| D41 | **Estado por navegador en localStorage** (2026-10-10, H12; reanudar en H13) con el helper `stores/persisted.ts` (lectura que no falla, escritura que no lanza, versión opcional). **Reanudar**: `trazada.resume` (versión 1, LRU de 20) con instante, coche, seguimiento y velocidad, validado campo a campo; se guarda cada 5 s reproduciendo, 1 s tras un cambio y en `pagehide`/`visibilitychange`; a < 30 s del final cuenta como vista y a < 10 s del instante por defecto no hay nada que retomar (se olvida); corrección por cambio de t0 y recorte; un coche que ya no está se ignora. `?t=<ms>` manda sobre lo guardado y `?bench=1` ni retoma ni guarda. Aviso «Retomado en …» y «Seguir viendo» en la portada. Estelas (`trazada.trails`) también por navegador; en H15, el fantasma de la comparación (`trazada.compare`) y el ambiente (`trazada.ambience`). **Diseño de paneles** (H18): `trazada.layout` (versión 1) con el diseño elegido y, de cada uno, los anchos y si la dirección de carrera está abierta, validado campo a campo (lo corrupto vuelve al ancho por defecto). **Guía de primer uso** (H18): `trazada.tips` con lo visto por id de paso (`{ "all": true }` las da todas por vistas, también las futuras); una versión nueva enseña solo sus pasos nuevos | Patrón ya probado en `settings.ts`, que pasa a usarlo con el mismo formato. Cada dispositivo guarda lo suyo. | Sincronizar dispositivos: la API del gestor solo atiende a loopback (D26). |
| D42 | **Movimiento** (2026-10-10, H12; clasificación animada en H13): nunca se anima un valor de datos. Listas animadas solo a ≤ ×4, sin salto de reloj y con pocos cambios (`listMotionAllowed`). Nada infinito. Con reduced motion, duraciones, escalonado y desplazamiento a 0 y escala neutra. **Clasificación**: FLIP con `tz-lb-move` (o `tz-lb-still`, sin transición), `--tz-dur-slow`, solo el orden de los puestos conocidos. Flechas ↑↓ entre dos órdenes calculados seguidos (nunca la parrilla), que se mantienen 2 actualizaciones; 3 s de pared y acumuladas en el mismo sentido; «—», posición 0 y sin señal nunca cuentan; en libres y clasificación, sin mejor vuelta no cuenta; tras un seek, la carga o un paso en pausa, sin flechas. Aviso `aria-live` cada 5 s como mucho. **Portada** (H17): quieta al cargar; tarjetas y sesiones escalonadas (`tz-enter`, `--tz-stagger`) solo tras elegir otra temporada u otro GP; destello único (`tz-flash`) en la fila de una descarga que termina; avisos y panel de carga suben `--tz-shift` sin fundido. **Replay** (H18): clasificación, columna derecha y dock aparecen escalonados con un fundido (solo opacidad: la escena los mide); un mensaje nuevo de dirección de carrera entra y destella una vez, un chip nuevo del estado de pista entra (el de SC o roja pulsa dos veces) y los chips PIT y «sin señal» entran con un fundido, todo solo a ≤ ×4 y sin salto del reloj; destello único en la cabecera de la telemetría al elegir coche; riel y cabezal del timeline al pasar o arrastrar; play ↔ pausa con `tz-swap` | H8 (la muestra cruda vigente) y accesibilidad. Un test revisa todo el CSS. | Animar cifras (contadores, tweens de velocidad o gap): mostrarían valores que nunca existieron. Flechas contra la parrilla (Jolpica) o contra un orden de antes de un salto. |
| D43 | **Interacción** (2026-10-10, H16). **Paleta de comandos** (Ctrl/⌘+K, «/» y botón con puntero grueso): reglas propias, sin IA ni dependencias, en español e inglés a la vez sin tildes ni mayúsculas; alias como datos del motor y textos en `i18n:palette`; lo imposible, deshabilitado con «sin dato»; «vuelta N» es la del líder en carrera y sprint y pide piloto en libres y clasificación; nada irreversible; Esc con prioridad 95; no se abre sobre otro modal; los comandos actúan por servicios registrados (los momentos, con los botones de salto del dock). **Gestos**: dos dedos en paralelo y en horizontal mueven el reloj (todo el ancho = 2 min, lineal, un seek por frame, sin cambiar pausa o reproducción, sin mover la cámara); el pellizco hace zoom (o la distancia de seguimiento) decidido por el clasificador; lo demás con dos dedos sigue en el mapa; doble toque o doble clic (400 ms, 40 px) sigue al coche aunque el segundo toque no lo acierte. **Comandos de momentos** (H17, ítem 14b): siguiente/anterior adelantamiento o duelo, de un piloto o entre dos, con el servicio de los botones del dock y sus reglas; el instante GPS con «Estimado» (`overtakeTime`) en la opción, sin botón; libres y clasificación, deshabilitados; «Sin spoilers» oculta quién. Al comparar, una palabra que encaja con un piloto al menos tan bien como con un verbo es el piloto, y «Comparar con «X»» sin piloto X solo si la consulta empieza por un verbo. **Guía de primer uso** (H18, ítem 18): seis burbujas no modales ancladas a lo que existe por su `data-testid` (centradas sin ancla visible); sale sola una vez, 1 s después de montarse el replay, sin llevarse el foco y nunca en el bench ni sobre un modal o la paleta; se reabre con el botón «?» (solo con ratón), la tecla «?» o la paleta («guía»); Esc la salta (prioridad 90); el ejemplo de «Estimado» va rotulado como ejemplo y no es un chip `TzEstimated`. **Diseño** (H18): tecla L y comandos «diseño análisis», «modo espectador», «cambiar de diseño» y «restablecer anchos» | Atajos para todo sin aprender teclas, y un reloj que se mueve con los dedos en el iPad. Reglas simples y comprobables, sin dependencias ni datos inventados. | fuse.js (no compensa); asistentes con IA (prohibido con datos de F1); anular los gestos del sistema desde el borde (iPadOS no lo permite); girar el mapa con dos dedos en horizontal (ahora mueve el reloj). |
| D44 | **Jerarquía visual** (2026-10-10; base en H12): tokens de densidad (compacta con alto ≤ 860 px, zona táctil de 44 px con puntero grueso), el color de equipo nunca como texto (lo vigila un test), clases comunes en `base.css`. **Tanda 5 (H17)**: layout propio del replay (`layouts/replay.vue`, sin la cabecera global; marca e idioma en `TzBrandBar`) y `100dvh` con `100vh` de respaldo (también en la portada); cabecera del replay en una fila que, para decidir si cabe, cuenta el título por su mínimo (6 em, luego «…») y el estado de pista por su chip más ancho, con formas compactas por debajo de 1600 y 1920 px y sin esconder nunca una bandera ni un «Estimado»; etiquetas «Estimado» de la escena flotando bajo la cabecera, sobre el mapa (y fuera mientras la hoja de análisis la tapa); `TzEstimated` pulsable (`plain` donde no caben controles); tinte del equipo en la telemetría y la fila elegida, cifras grandes, posiciones en la condensada y «sin dato» con su estilo en la portada. **Tanda 6 (H18)**: diseños «Espectador» (el de siempre) y «Análisis» (columnas de mejor vuelta, última vuelta y entradas en el pit lane, y telemetría más grande; la vuelta 1 solo con «Estimar la vuelta 1» y su «Estimado»); asas para el ancho de la clasificación y de la columna derecha (puntero, teclado y doble clic; 280–480 / 260–480 px en escritorio y 256–400 / 240–400 px en tablet en horizontal; el mapa conserva max(320 px, 35 %) salvo con los dos paneles en su mínimo; sin anchos en vertical; la escena reencuadra al soltar); el título de la cabecera tiene prioridad con los niveles `data-fit` (lo secundario se acorta antes que el título); el cambio de diseño, compacto por debajo de 1360 px (con ratón, botones de 24 px; en táctil, un solo botón que alterna) | El color de equipo no llega a 4,5:1 como texto. Densidad adaptada a portátiles de 800 px y al iPad. | Tokens por componente (sin coherencia entre paneles). Un menú de desbordamiento en la cabecera del replay (escondería avisos o «Estimado» tras un clic). |
| D45 | **Estelas** (2026-10-10, H13): los últimos 3 s de tiempo de sesión de cada coche, 32 puntos remuestreados en cada frame del mismo modelo que dibuja el coche (sin historial: correctas tras un seek o una pausa), sobre la línea central o el pit lane y con la pose del coche. Se cortan donde el coche no se dibuja. Color del equipo o de la velocidad (última muestra cruda de ≤ 2 s, sin interpolar, escala fija 80–330 km/h; gris «sin dato»). Una malla, 1 draw call, `fog: false`, sin escribir profundidad, `renderOrder` 4. Apagadas por defecto, en el menú «Capas» | Lo que dibujan es el mismo modelo que el coche, sin inventar recorrido. Una sola draw call y nada en pausa. | Historial de posiciones (se rompe con un seek y puentea huecos); color por velocidad interpolada; una línea por coche (22 draw calls). |
| D46 | **Vista previa del timeline** (2026-10-10, H14): tarjeta al pasar el ratón, al arrastrar con el dedo o con el foco del teclado (Esc la oculta) con la vuelta del líder (o el reloj visible fuera de carrera), el primero, el estado de pista y los marcadores cercanos. El primero: P1 de la torre (si dos lo reclaman, el mensaje más reciente) → orden en la línea en carrera y sprint (`compareAtLine`, compartido con la clasificación) → mejor vuelta válida de la tanda en curso fuera de carrera (`compareByBestLap`); nunca la posición en pista, y un empate exacto o sin datos es «sin dato». «Líder» en carrera y sprint, «Mejor vuelta» en el resto. Estado de pista con un `TrackState` propio; deducido, «Estimado». Precálculo perezoso (`rt.ext`) y una búsqueda binaria por consulta, solo al mover el puntero | Las mismas reglas que la clasificación, así que la tarjeta y la clasificación dicen lo mismo. Nada se recalcula por frame del reloj. | El líder por posición en pista (no es un dato de cronometraje); una segunda copia de las reglas de orden. |
| D47 | **Identidad visual «Asfalto y pintura»** (2026-10-10, Tanda 5, H17): superficies de asfalto (grises carbón neutros y algo cálidos) con grano estático solo en el fondo de la página; texto y acento de pintura de pista (`--tz-paint`, blanco hueso); **placa maciza de pintura = activado** (`--tz-accent` de fondo y `--tz-accent-on` de texto, 14,37:1), relleno suave = desplegado; un único color saturado de interfaz, la señal (`--tz-signal`, amarillo-verde), **solo para el foco, la selección de texto y la traza de velocidad**; el piano rojo/blanco (`--tz-kerb`) **solo bajo la marca (portada y replay) y en la pestaña activa del análisis**, una regla en cada uno de esos tres ficheros; cantos casi vivos (1–3 px) y sombra corta. Barlow para leer, Barlow Condensed para rótulos y titulares en mayúsculas, IBM Plex Mono para siglas y datos (OFL-1.1, autoalojadas). Los colores con significado (banderas, SC/VSC, boxes, cronometraje, comparación, calor, neumáticos) no cambian; «Estimado» pasa a #e07af5 y «sin dato» a #7d7a72. Lo vigila `design/tokens.test.ts` (piano y señal en sus sitios, «Estimado» a ΔE OKLab ≥ 0,08 de la mejor vuelta y de boxes, sin `backdrop-filter`) | El usuario pidió un aspecto más original y de automovilismo que el de un panel genérico, y aprobó la recomendación de la revisión. Con la pintura de acento, ningún color de interfaz compite con los de la carrera; el texto pasa AA en todas las superficies (12,38–16,17:1, el tenue ≥ 4,86:1). Solo fuentes y CSS: la escena y el coste por frame no cambian. | «Muro de boxes» (naranja de pizarra: obligaba a retocar banderas, SC/VSC y boxes para separarlos del acento); «Programa de carrera» (tinta bermellón: un rojo de interfaz se lee como bandera roja); «Cronógrafo» (champán y latón con doble filete: más reloj que circuito); seguir con Inter y el acento cian (el aspecto genérico que se quería dejar). |
| D48 | **Aviso del reglamento de 2026 y sonda del feed** (2026-10-11): en sesiones de 2026 en adelante (por `manifest.session.season`, sin tocar el esquema), los avisos de la sesión llevan, aparte de los del procesado y rotulado como información (icono ⓘ con nombre, grupo titulado «Reglamento de 2026»), que el cronometraje público no incluye por coche la aerodinámica activa (modo recta o curva), el modo adelantamiento ni el Boost, ni la batería o la energía; que no hay DRS; y que solo se publica la ventana global de dirección de carrera («Overtake activado», cabecera y timeline). Cuenta en la cifra del botón; sin avisos del procesado, el botón sale igual con el icono de información. El «¿Por qué?» del DRS usa el mismo texto (`regulation.body`, una sola fuente), en una pista flotante para no empujar las gráficas. `trazada probe-feed` resume los temas del `Index.json` y los canales de `CarData.z` frente a los que lee el pipeline (`resultado: sin canales nuevos` / `canales nuevos: …`) | Datos honestos: lo que no llega se dice, no se inventa ni se estima. Mantenedores de FastF1, OpenF1 y undercut-f1 confirman que F1 no publica esos datos en 2026; la sonda permite comprobarlo en una sesión concreta desde una IP residencial. Contarlo en la cifra hace que lo que dice el botón coincida con lo que hay en el panel, sin ensanchar la cabecera. | Un código nuevo en `quality.notes` (exigiría regenerar los manifests y no depende de la sesión sino de la temporada); un banner fijo en el replay (rompe la cabecera en una fila y tapa la escena); estimar el uso del modo adelantamiento o del Boost por la velocidad a fondo (sería inventar datos); no contarlo en la cifra (una sesión de 2026 sin avisos tendría un botón «0 avisos»). |

## 7. Riesgos

| # | Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|---|
| R1 | **F1 devuelve 403 a IPs de nube**, y FastF1 no lanza error: devuelve tablas vacías. **Confirmado el 2026-10-10 desde GitHub Actions**: F1 403, espejo de FastF1 404; OpenF1, MultiViewer y Jolpica 200. | Cierta | Alto | Ingesta en tu PC. `probe` que falla en ruidoso. Validación de "no vacío". Archivo privado para no tener que volver a descargar. Adaptador OpenF1 (accesible desde la nube) para automatizar 2023+. |
| R2 | F1 pone autenticación también al archivo estático (el directo ya la tiene desde 2025) | Media | Alto | Archivar cada sesión procesada (bundles y caché). La app nunca vuelve a descargar. Adaptadores de fuente intercambiables. |
| R3 | **Derechos sobre los datos**: términos de F1 (timing, TDM/IA), MultiViewer sin licencia, Jolpica CC BY-NC-SA, marcas | Media | Alto | §5 Legal: no comercial; datos mínimos y cuantizados; sin licencia abierta; separados del código y retirables; sin campos de Jolpica ni fotos; disclaimer; permiso de MultiViewer; posible consulta a brandprotection@f1.com. |
| R4 | Semántica de 2026 incompleta: sin DRS, aero ni overtake por coche; puede haber canales nuevos que FastF1 ignora | Cierta | Medio | UI honesta ("No disponible en 2026" y el aviso del reglamento de 2026, D48). Ventanas globales de overtake. `trazada probe-feed` vuelca los temas del `Index.json` y los canales del `CarData.z` crudo (en una IP residencial; pendiente de pasarla con una carrera de 2026). |
| R5 | Sin información lateral: en rueda a rueda los coches se solapan | Cierta | Medio | Separación lateral **solo visual**, opcional y apagada por defecto, con etiqueta "Estimado: separación visual". Etiquetas que evitan solaparse. |
| R6 | Calidad del muestreo: jitter, huecos de hasta 1,5 s, XY = 0, acelerador a 104, retrocesos, banderas rojas (coches parados en el pit lane), formation lap, garaje, drive-through | Cierta | Medio | Segmentos, `path = sin dato`, PAVA. Tests sintéticos de cada caso y sesiones de referencia con roja y SC. |
| R7 | TresJS v5 es joven y Nuxt 4.6 tiene días | Media | Medio | El motor TS no depende de Tres. `ViewRegistry` sobre el renderer crudo. Versiones fijadas. Plan B Nuxt 4.5.2. |
| R8 | Rendimiento en portátiles | Media | Medio | Instancing, < 30 draw calls, calidad adaptativa, umbrales en H11. |
| R9 | Límites de hosting: 20 000 ficheros y 25 MiB por fichero; crecimiento de la Fase 2 | Baja | Medio | 5 ficheros por sesión. CI falla si se superan 15 000 ficheros o 20 MiB. Agregados precalculados. Vía de escape: un Worker de datos por temporada. |
| R10 | Los cron de Actions se desactivan tras 60 días (parón invernal) | Alta (fase posterior) | Bajo | `workflow_dispatch` y una checklist de inicio de temporada. |
| R11 | Node: este entorno tiene 22.22.0 | Cierta | Bajo | `.nvmrc` 24 LTS (disponible); CI con Node 24. |
| R12 | Licencias de terceros: GSAP no es OSI; OpenF1 es NC-SA; MultiViewer sin licencia | Cierta | Bajo/Medio | `NOTICE`, uso no comercial, no copiamos código. |
| R13 | `fastf1.api.timing_data` es semiprivada | Media | Bajo | Versión fijada y test de contrato. |
| R14 | Alineación de relojes: `t0_date` estimado; race control en UTC con resolución de 1 s | Media | Bajo | Normalización en el pipeline; tolerancia de ±1 s en los tests. |
| R15 | Colores de equipo de bajo contraste o confusos para daltónicos | Media | Bajo | Siglas y número siempre visibles; ajuste de luminancia sin cambiar el tono. |
| R16 | **Esta sesión no puede descargar datos** por el proxy, así que de H2 en adelante falta el dato real | Cierta | Alto | §9. Mientras tanto, desarrollo con la caché real de Bélgica FP1 2026 (`OfflineCacheSource`) y datos sintéticos. |
| R17 | Avatares reconocibles y libreas en las fases 3D | Media (futuro) | Medio | Avatar neutro y coche genérico (§5). |
| R18 | Dependencias de troika: Google Fonts y CDN por defecto | Cierta | Bajo | Configurarlas en local; un e2e falla si sale alguna petición a otro origen. |

## 8. Hitos de la Fase 1

**Orden**: H0 → H1 → H2 → H3 → H4 → H5 → H6 → H7 → H8 → H9 → H10 → H11. H10 (UX transversal) se aplica en cada hito y se cierra al final. Cada hito se verifica antes de su commit.

Después de la Fase 1, las 21 funciones aprobadas se implementan por tandas, un hito por tanda: H12 (Tanda 0, andamiaje) → H13 (T1) → H14 (T2) → H15 (T3) → H16 (T4) → H17 (T5) → H18 (T6). Cada tanda la fusiona un integrador, que vuelve a pasar la suite completa y actualiza estos documentos. Desde la Tanda 4, por petición del usuario, el integrador pasa solo lint, typecheck, Vitest y build; la suite de Playwright y el bench se pasan una sola vez al cierre de la Tanda 6.

### Progreso

| Hito | Estado | Notas |
|---|---|---|
| H0 | ✅ | CI en verde; probe desde Actions: F1 responde 403 (R1 confirmado). |
| H1 | ✅ | Medida de peso y formato hecha en H2 con el layout final: gzip + *byte shuffle*; zstd solo ahorra 5–11 % y Arrow pesa el doble (`research/h2-pipeline.md`). |
| H2 | ✅ (con matices) | Criterios cumplidos, salvo la cobertura de un coche que abandona en la fuente dev (97,5 %, sin muestras tras pararse) y la del coche 5 en Bélgica FP1 (97,9 %): su feed se congela 2-3,5 s en cada vuelta en s ≈ 4.670 m con el coche a 130-300 km/h, y desde la auditoría eso es sin dato, no una parada. Sesiones de referencia: Bélgica FP1 2026 (caché saneada) y Japón 2026 carrera (fuente dev, no publicable). Pendiente: verificar las longitudes oficiales y probar los sectores de comisarios con MultiViewer en el primer build desde IP residencial. |
| H3 | ✅ (con matices) | Selector, carga en Web Worker (descarga con progreso, sha256, gunzip, TRZB, transferencia sin copias) y todos los estados con e2e. De clic a "listo" con CPU ×4: 180–400 ms y 0 *long tasks* (fixture y sesión completa de Bélgica), medido hasta la marca `trazada:ready`. **Para H11**: el montaje de la escena justo después (evaluación de three.js e inicio del renderer) es una *long task* de 260–390 ms con CPU ×4 (~65–100 ms reales). El e2e del recorrido usa **2026 → Bélgica → Libres 1** en vez de Japón → Carrera: es la única sesión real publicable disponible aquí, y el fixture se genera sin datos de MultiViewer (pendiente de permiso, §9). D4: gzip (H2). Pendiente tuyo: tiempo hasta "listo" en el portátil de referencia (lo muestra la propia página). |
| H4 | ✅ | `SessionClock` con tests (velocidades, pausa, seek, límites, tope de delta). Un bucle `rAF` es el dueño del tiempo: la escena va en modo on-demand con `invalidate`, el cabezal del timeline se mueve por `transform` y Pinia recibe el estado a 10 Hz. e2e de atajos (también con foco en input y slider), arrastre con ratón y táctil (CDP), marcadores frente a recuentos, `prefers-reduced-motion` y render tras un seek en pausa. En local, Japón da 53 marcas de vuelta para 53 vueltas. |
| H5 | ✅ (con matices) | Cinta con altura real y color por cota, bordes, línea de meta, pit lane y curvas; rotación oficial; exageración ×1–×3 con etiqueta "Estimado"; sesiones `flat` planas. Medido: curvas a < 30 m del XY de MultiViewer (Spa y Suzuka, local), pit lane a ±10 % de las muestras (e2e) y puente de Suzuka con Δz −5,84 m frente a −6,10 m en crudo (local; para lograrlo, z se suaviza con σ = 1 m en vez de 3). Captura con cámara fija y DPR 1 **solo de Spa**: Suzuka no puede entrar en un fixture publicable (fuente dev). Las referencias las genera el workflow `Snapshots` en el entorno del CI. Las etiquetas son DOM proyectado (D22). **Legibilidad del mapa** (petición del usuario): la pista se dibuja de cerca con una anchura genérica de 14 m (la fuente no da la de cada circuito) y con al menos 7 px de lejos (pit lane: 3,5 px), calculado en el shader para cada vértice (también la parte lejana y en escorzo; e2e que mide los bordes en la captura); el pit lane va debajo de la pista; encuadre ajustado al trazado y al hueco libre entre paneles (sin saltos cuando cambia la barra de arriba, y recalculado al dejar de seguir un coche si cambió el tamaño); siglas sin solaparse, con histéresis. |
| H6 | ✅ | Hermite monótona por segmentos (Fritsch–Carlson) con la velocidad medida como tangente, calculada en el Web Worker. Se corta en huecos > 2 s o al cambiar de camino; las transiciones pista↔pit van en línea recta y sin dato el coche se oculta. Tests: s(t) no decrece, < 1 cm en las muestras, C1 en los nodos, cortes. Hold-out real (local, mitad de muestras): Spa p50 1,02 m / p95 7,71 m; Suzuka 1,11 / 8,31. Orden por s = `Laps.Position` en el 98,7 % de los pares (Japón, local). InstancedMesh (1 draw call) con el color del equipo y siglas en DOM que se pueden pulsar; e2e de instancias, colores y siglas frente al manifest. Los coches tienen un tamaño mínimo en pantalla (solo visual). El montaje tras "listo" va en frames posteriores; **para H11**: con CPU ×4, runtime y dock 55–82 ms, escena 320–465 ms y primeros renders 100–200 ms. |
| H7 | ✅ (con matices) | Datos solo de cronometraje real. Con torre oficial, su posición y sus gaps. Sin ella: en carrera, orden en la línea (vueltas completadas y, a igualdad, el cruce anterior) con gaps de los tiempos de paso; en libres, la mejor vuelta. Al final de cada vuelta, la posición = `Laps.Position` en 1105/1106 (Japón, local). Las "vueltas" de menos de la mitad de la mediana no cuentan como paso por meta (registros residuales de coches retirados). Neumático de la tabla de vueltas, bandera azul durante 8 s con filtro, PIT y "sin señal". Revisión de datos honestos: la posición se muestra «—» si no sale de la torre, de un paso por meta ni de una vuelta válida (antes se pintaba el puesto en la lista, p. ej. el orden de dorsales antes de la salida); una vuelta anulada cuenta hasta el mensaje de dirección de carrera que la anula (casado por el tiempo citado; sin mensaje, desde el final de la vuelta); un gap o intervalo negativo nunca se pinta (sin dato); en carrera sin torre, «+N vueltas» solo para un coche doblado (en su último paso por meta el líder ya llevaba más vueltas, o le saca dos líneas o más): antes salía «+1 vuelta» cualquier coche al que el líder solo había sacado la línea recién cruzada (en Suzuka dev, unos 32 800 de 35 400 s·coche con «+N vueltas»), y ahora su gap de esa vuelta es sin dato; en clasificación (Q y SQ), los gaps usan la mejor vuelta de la tanda en curso, con las tandas delimitadas por la bandera a cuadros y la luz verde siguiente (sin esos mensajes, toda la sesión es una tanda; la tanda de una vuelta es la de su inicio). Tests: motor (sintético y fixture), componente en entorno Nuxt (bandera azul, filtro, gaps, posición sin dato) y e2e. El fixture e2e pasa a los minutos 70,5–79,5 de Bélgica FP1, que tienen amarillas por sector y la bandera a cuadros. Rendimiento: < 1 ms por actualización; ≥ 4 Hz a 20 fps o más (en CI, con WebGL por software, va a ~6 fps). **Pendiente tuyo**: medida en la máquina de referencia. |
| H8 | ✅ (con matices) | Selección con clic o toque en el coche (raycast sobre el InstancedMesh, cuya esfera envolvente se recalcula en cada frame porque la cacheada venía de coches ocultos), en su sigla o en el leaderboard. El panel muestra la muestra cruda vigente: la última con t ≤ reloj y menos de 2 s de antigüedad, sin interpolar (Vitest frente a las columnas). Sin muestra vigente del coche seleccionado (también justo al cambiar de coche), «—» en cada celda y gráficas vacías: nunca cifras de otro coche u otro instante. Acelerador sin dato: «—» y sin barra (no un 0 %). El freno es de encendido/apagado: una luz, y en la gráfica un escalón con la leyenda «Freno (sí/no)» (no una escala de 0 a 100). DRS: 0/1 = cerrado, 8 = disponible, 10/12/14 = abierto y cualquier otro código «sin dato»; en 2026 no hay canal, así que aparece "No disponible en 2026" con su explicación. La última vuelta anulada sale tachada y con la insignia «Anulada» desde el mensaje que la anula. Mini gráficas uPlot con una ventana de 20 s. Cámara de seguimiento: muelle de yaw críticamente amortiguado con aceleración y velocidad acotadas y pitch constante (24°). **Umbral calibrado**: \|d²yaw/dt²\| ≤ 6 rad/s² y d²pitch/dt² = 0, con 60 s guionizados de un coche real del fixture: a ×1 el máximo es 1,24 rad/s², a ×16 se queda en el tope (6). `Esc` vuelve a la vista general con GSAP, al instante con reduced motion (e2e de las dos cosas). El espacio reproduce y pausa aunque el foco esté en un botón pulsado con el ratón; si se llegó al botón con el teclado, el espacio lo activa. **Pendiente tuyo**: p95 < 16,7 ms con el panel abierto en la máquina de referencia. |
| H9 | ✅ (con matices) | **Feed** de dirección de carrera: texto original tal cual (marcado `lang="en"`) con el tipo traducido. Tras 20 seeks (17 con semilla fija y 3 justo en el borde de un mensaje), los visibles son exactamente los de t ≤ reloj (e2e). `TrackState` (TS puro) da las banderas por sector, la neutralización vigente (roja > SC > VSC > fin de VSC), la amarilla de TrackStatus y las ventanas de OVERTAKE/DRS. Se expone en `window.__trazada.trackState`; el asa ahora tiene `seek(ms)`, con precisión de ms. Escena: el SC, el VSC y la roja tiñen la cinta, y los sectores con bandera se colorean cuando hay geometría de MultiViewer. Sin ella (todos los datos de aquí), la bandera aparece como texto con su explicación. Hay chips de estado de pista siempre con texto (nunca solo color) y un carril de OVERTAKE/DRS bajo el timeline. Pipeline: una neutralización cierra la ventana de OVERTAKE/DRS hasta un nuevo ENABLED (Japón: había un ENABLED, el SC y otro ENABLED), y la última bandera a cuadros la cierra también (auditoría I). Tests: motor (sintético, fixture y Japón local), componentes en Nuxt y e2e en el fixture (doble amarilla del sector 7 a +1 s y su CLEAR a +1 s). **e2e en Japón 2026 solo en local** (`local-japan.spec.ts`, fuente dev no publicable): sector 21 a +1 s y su CLEAR a +1 s; SC a +100 ms en `trackState` y en el tinte de la escena; dos ventanas de OVERTAKE. **Pendiente**: comprobar sobre el mapa las capas por sector con un circuito que tenga sectores de comisarios (MultiViewer, §9). |
| H10 | ✅ (con matices) | **Tokens**: `tokens.css` es la única fuente. three.js, uPlot y GSAP leen los valores con `token()`, que usa la propia hoja si no hay documento. Un test falla si aparece un color literal o un `--tz-*` fuera de la hoja. **i18n**: `no-raw-text` y `no-missing-keys` limpios, test de paridad es/en (claves y parámetros) y números, porcentajes y tiempos de vuelta con `Intl` (formatos cacheados por idioma). El reloj m:ss no depende del idioma. **Estimado**: registro único (`engine/estimated.ts`) con los campos del manifest (`positions`, `telemetry`, `trackStatus`; el pipeline los declara en las fuentes dev, y un campo desconocido se muestra con su nombre) y las opciones del usuario. Las opciones son la exageración de altura, la separación visual de coches solapados (apagada por defecto; solo visual, a lo ancho de la pista) y la estimación de la vuelta 1 en carrera (paso por meta − salida). Un test de componentes tiene un caso por campo y falla si falta alguno. Hay e2e de cada caso, en es y en; la vuelta 1 y la separación real en la salida se prueban en el e2e local de Japón. **Accesibilidad**: axe-core sin infracciones serias ni críticas en portada, replay (con telemetría y etiquetas) y error, en es y en. Para lograrlo, `--tz-text-faint` pasa a #848e9b (≥ 4,75:1 en todas las superficies). **Disclaimer** en el footer de todas las páginas y en el README (e2e). **Layout**: cabecera, escenario y dock en columna; las herramientas de la escena van a la cabecera. Paneles más estrechos hasta 1100 px. En tablet vertical, los paneles bajan a una franja inferior y el mapa se encuadra por encima. Sin scroll horizontal a 1440×900, 1280×800 y en iPad (táctil) a 1024×768 y 768×1024; en tablet, tocar un coche lo selecciona y arrastrar el timeline mueve el reloj (e2e). Arreglo: el CSS minificado escribe `900ms` como `.9s` y la duración de la cámara se leía como 0. **Pendiente**: revisión en un iPad real. |
| H11 | 🟡 Preparado; faltan tus medidas y tus datos (§9.7). Solo local (D25): `pnpm local` | **Bench** `?bench=1` con 22 coches y la telemetría abierta. Calienta y mide: p50, p95, p99, frames > 50 ms, heap, DPR, draw calls, GPU y *long tasks*, y copia el JSON. En libres empieza en el momento con más coches en pista. **Degradación adaptativa** (`QualityGovernor`): con un p95 de más de 35 ms (dos vsync a 60 Hz con margen), sondea el DPR escalón a escalón hasta volver al presupuesto, o vuelve al del dispositivo si bajar no ayuda. Las subidas se comprueban, con espera creciente. 30 Hz estables no lo disparan. `?governor=off` la desactiva. Se quitó el `backdrop-filter` de los paneles: desenfocaba un lienzo animado en cada frame (−25 % de frame en SwiftShader). **Heap**: 42 MB con la carrera completa de Japón (≤ 300 MB). `docs/PERFORMANCE.md` tiene el método, los resultados (el contenedor está marcado como no representativo) y la tabla de peso por sesión generada desde los manifests (`pnpm perf:table`). **Despliegue** (preparado en H11: datos solo publicables, guarda contra fuentes dev y smoke post-deploy): *retirado por D25*. **Uso personal (D23)**: `pnpm local` sirve la app con los datos de `data/`, y con `--lan` en la red de casa; `noindex` y `robots.txt` por si algún día se despliega. **Banderas y trazados (D27)** en cada tarjeta de Gran Premio, con el país en el idioma de la interfaz. **Gestor de datos (D26)**: con `pnpm local`, el selector muestra el calendario completo y descarga cada sesión con un clic (cola, progreso, errores con «Reintentar», cancelar, en bloque por GP y carreras de la temporada); e2e con el servidor real y un pipeline falso. **Pendiente tuyo**: medidas en la RTX 3070 Ti y en el portátil, y datos reales 2023–2026 en tu PC. |
| H12 | ✅ | **Tanda 0 de las 21 funciones (andamiaje, sin cambios visibles)**, en tres partes fusionadas por un integrador: 0a, puntos de extensión (D29, D41); 0b, motor compartido (base de D31–D35); 0c, base visual (D30, D42, D44). Verificado al integrar: lint, typecheck, Vitest con los `@local` de Spa FP1 y Japón, build, e2e completos y `local-japan` con los datos completos. Bench antes y después en el contenedor (Bélgica Libres 1 y Japón carrera, ×1 y ×16): mismas draw calls (8) y triángulos, y el mismo JS por frame (~2 ms); el p95 se mueve dentro del ruido (`docs/PERFORMANCE.md`). La captura de referencia no cambia. |
| H13 | ✅ | **Tanda 1 de las 21 funciones (victorias rápidas visibles)**: clasificación animada con flechas ↑↓ (ítem 8, D42), estelas (ítem 7, D45), tarjeta de fin de sesión (ítem 12, D40) y reanudar donde lo dejaste con «Seguir viendo» (ítem 13, D41). Se fusionaron sin conflictos de texto. Al integrar se arreglaron tres cosas: las estelas costaban 2 draw calls (material de doble cara en dos pasadas; ahora `forceSinglePass`); la cabecera bajaba las herramientas a una segunda fila y cortaba la telemetría a 1280×800 (ahora cada grupo del hueco de herramientas es un menú, «Capas», y el detalle de carga del chip «Listo» se oculta por debajo de 1360 px); y los dos arreglos duplicados de los tests de huecos se quedaron en uno (`tests/nuxt/slots-collect.test.ts`). Verificado: lint, typecheck, Vitest con los `@local` (73 ficheros, 485 tests), build, Playwright completo (113 pasan, `perf` incluido; 11 omitidos por diseño) y los `local-*` con los datos completos (6/6). Bench antes y después (`docs/PERFORMANCE.md`): estelas apagadas, la misma escena (8 draw calls, captura `@screenshot` idéntica píxel a píxel); con estelas, +1 draw call, +1.364 triángulos y +0,3–1,0 ms de JS por frame. **Pendiente tuyo**: el bench con estelas en el iPad y decidir si las estelas siguen apagadas por defecto. |
| H14 | ✅ | **Tanda 2 de las 21 funciones (análisis base)**: gráficas de carrera en una hoja «Análisis» con race trace, ritmo y stints (ítem 3, D33), colores de sector en la clasificación y en el panel del coche (ítem 4, D34), vista previa al pasar por el timeline (ítem 16, D46) y zonas de DRS deducidas de la telemetría (ítem 11, D38). Se fusionaron sin conflictos de texto. Al integrar se arreglaron cuatro cosas: la línea de sectores cortaba la segunda gráfica de telemetría a 1280×800 (con la densidad compacta, gráficas de 54 px: `--tz-chart-h`); la hoja de análisis tapaba la tarjeta de la vista previa (el dock pasa por encima de la hoja); el foco que da un toque en el timeline contaba como del teclado, así que la tarjeta no se iba al soltar el dedo; y en libres los ejes por hora del análisis rotulaban la hora interna de la sesión en vez del reloj del dock. Además, `local-leaderboard.spec.ts` tiene un tope de 90 s, porque con el de 30 s pasaba por 0,1 s ya en la base. Verificado: lint, typecheck, Vitest con los `@local` (87 ficheros, 607 tests; schema 4 y 20), build, Playwright completo (137 pasan, `perf` incluido; 14 omitidos por diseño) y los `local-*` con los datos completos (9/9). Bench antes y después (`docs/PERFORMANCE.md`): mismas draw calls (8) y triángulos, el mismo JS por frame y +19 KB de JS con gzip; la clasificación más ancha mueve el encuadre, así que la captura `@screenshot` se regenera con el workflow «Snapshots». **Pendiente tuyo**: ver las zonas de DRS con una sesión de 2023–2025 y regenerar la captura de referencia.
| H15 | ✅ | **Tanda 3 de las 21 funciones (comparar y escena)**: comparar dos pilotos con diferencia por distancia, trazas y fantasma (ítem 1, D31), meteorología con esquema 1.1.0, chip y franja del timeline (ítem 6, D36), realización automática (ítem 9, D39) y ambiente de la escena con cielo, niebla en la pista y tono nocturno (ítem 10, D37). Se fusionaron sin conflictos de texto. Al integrar se arreglaron cuatro cosas: juntos, el chip de la meteorología y el menú nuevo «Cámara» partían la cabecera en dos filas a 1280 y 1440 px y cortaban la telemetría (por debajo de 1600 px, los menús «Capas» y «Cámara» van solo con su icono; por debajo de 1360 px, también «Altura» y «Separar coches»); `ambience.spec.ts` vaciaba el almacenamiento al recargar y no podía comprobar que el ambiente apagado se recuerda; «la comparación cabe a lo ancho» contaba el área táctil ampliada del botón ⓘ del borde; y la prueba de la clasificación a ×16 esperaba 2 s fijos, que con el cielo por software y la CPU compartida a veces no llevaban el reloj hasta el adelantamiento (ahora espera al reloj). Verificado: lint, typecheck, Vitest con los `@local` de Bélgica reconstruida con 1.1.0 y de Japón (103 ficheros, 756 tests; schema 4 y 21), build, Playwright completo (163 pasan, `perf` incluido; 16 omitidos por diseño), los `local-*` con los datos completos (11/11), ruff y pytest (602; `-m local`, 9 pasan con Bélgica reconstruida desde la caché saneada, determinista). Bench antes y después (`docs/PERFORMANCE.md`): el cielo suma 1 draw call y 992 triángulos; en el contenedor (SwiftShader) el ambiente sube un escalón de vsync el p50 de Bélgica y, apagado, la escena cuesta lo mismo que la base; +20 KB de JS con gzip. El cielo cambia el fondo de la escena: la captura `@screenshot` se regenera con el workflow «Snapshots». **Pendiente tuyo**: volver a descargar las sesiones para tener meteorología (las de antes de 1.1.0 dicen «sin dato» y lo piden), el bench en el iPad con el ambiente encendido y apagado (y decidir si sigue activo por defecto), ver la realización automática con una carrera con torre y regenerar la captura de referencia. |
| H16 | ✅ (verificación ligera) | **Tanda 4 de las 21 funciones (lo que se apoya en las anteriores)**: mapa de calor de la pista por velocidad o minisectores (ítem 2, D32), momentos con adelantamientos confirmados en la línea, duelos a menos de 1 s y saltos entre ellos (ítem 5, D35), paleta de comandos por reglas (ítem 14, D43) y gestos en tablet: dos dedos para el reloj, pellizco y doble toque para seguir (ítem 17, D43). Un solo conflicto de texto: dos importaciones en `tests/nuxt/estimated.test.ts` (se quedan las dos). Al integrar se arreglaron cinco cosas: el botón de la paleta partía la cabecera táctil en dos filas a 1180 y 1366 px (46 px menos de escena y paneles; ahora va en el dock); un deslizamiento rápido de dos dedos en paralelo salía como pellizco, porque se decidía con el primer dedo al día y el otro aún sin mover (ahora se decide una vez por frame, con un test nuxt que falla con el código anterior); la paleta preveía un servicio de momentos que nadie registraba (ahora lo registran los botones de salto del dock, con los mismos destinos, con su test nuxt y su e2e); el carril de adelantamientos rompía el runtime mínimo de `race-control.test.ts` (sin clasificación ni pistas; ahora lleva un índice de vueltas vacío); y el test del bench de `summary.test.ts` pasaba de 5 s con la suite completa (navega de verdad a /replay y transforma todo el grafo de la página; ahora con 20 s y el motivo escrito). Se añade el escenario «todas las capas» a `perf.spec.ts`. Verificado (ligero, por petición del usuario): lint, typecheck, Vitest (web 108 ficheros y 956 tests, 16 omitidos `@local` sin los datos completos; schema 4 y 21) y build. **Pendiente al cierre de la Tanda 6**: Playwright completo (con `heat`, `moments`, `palette`, `gestures` y `perf` nuevos), `local-moments` con Japón y el bench antes y después. La captura `@screenshot` no debería cambiar. **Pendiente tuyo**: los gestos y el bench con todas las capas en el iPad. |
| H17 | ✅ (verificación ligera) | **Tanda 5 de las 21 funciones (pulido I)**: identidad visual «Asfalto y pintura» (D47: Barlow, Barlow Condensed e IBM Plex Mono autoalojadas; pintura de acento, placa maciza = activado, señal solo para foco, selección y velocidad, y piano bajo la marca y en la pestaña activa), iconos del registro en todas partes (ítem 19b, D30; la lista permitida queda vacía), jerarquía visual (ítem 20b, D44) con el layout propio del replay y su cabecera en una fila, microinteracciones de la portada (ítem 21b, D42) y comandos de momentos en la paleta (ítem 14b, D43). Se fusionaron sin conflictos de texto, primero la identidad y luego portada, replay y comandos. Al integrar se arreglaron dos cosas: el «Estimado» pulsable dentro de cada opción de la paleta (un botón dentro de `role="option"`; ahora sin botón) y las etiquetas «Estimado» de la escena, que flotaban encima de la hoja de análisis (ahora se quitan mientras la hoja tapa la escena). La guarda del piano pasa a exacta y `design-base.spec` comprueba la pintura en los controles nativos y la placa de un control segmentado. Verificado (ligero): lint, typecheck, Vitest (web 110 ficheros y 1025 tests, 16 omitidos `@local`; schema 4 y 21) y build; a ojo, con Japón 2026 (dev), la cabecera del replay va en una fila de 48 px a 1440 y a 1280. **Pendiente al cierre de la Tanda 6**: Playwright completo (con `design-base`, `selector`, `layout`, `smoke`, `telemetry` y `palette-moments` nuevos o ampliados, y `local-palette-moments` con Japón), el bench antes y después y las capturas del README. La captura `@screenshot` cambia (lienzo más alto sin la cabecera global): se regenera con «Snapshots». |
| H18 | 🟡 Integrada (verificación ligera); falta el cierre | **Tanda 6 de las 21 funciones (pulido II)**: diseños «Espectador» y «Análisis» con paneles de ancho ajustable (ítem 15, D41/D44), microinteracciones del replay (ítem 21b, D42), prioridad del título en la cabecera (D44, arreglo de una regresión de la Tanda 5) y guía de primer uso (ítem 18, D41/D43). Se fusionaron sin conflictos de texto, primero diseños y luego la guía. Al integrar se arreglaron cuatro cosas: el botón «?» pasa a ser el último de la cabecera (mismo `order` que el cambio de diseño); con ratón, por debajo de 1360 px o con `data-fit="3"`, el cambio de diseño y «?» llevan botones de 24 px (con Japón 2026 dev a 1280 px el estado de pista se partía y la cabecera medía 74 px; ahora 48); en táctil, en esas mismas condiciones, el cambio de diseño es un solo botón que alterna (a 1024 px el segmentado partía la cabecera en dos filas y el encuadre al girar la tablet no coincidía con el de abrirla en horizontal); y dos e2e de la propia tanda (la medida de desbordes contaba las asas, que van a caballo del borde a propósito, y el destello de dirección de carrera elegía un mensaje anterior al inicio del reloj). Verificado (ligero): lint, typecheck, Vitest (web 119 ficheros y 1124 tests, 16 omitidos `@local`; schema 4 y 21) y build; para diagnosticar, solo los e2e de esta tanda, los de la cabecera y los del giro de la tablet (46, en verde con el fixture). **Pendiente al cierre**: Playwright completo (con `layout`, `tips`, `leaderboard`, `playback` y `race-control` nuevos o ampliados), el bench (también en «Análisis» y arrastrando un asa) y las capturas del README; la captura `@screenshot` no debería cambiar. |

**Correspondencia con el brief**:
- punto 1 → H3; 2 → H2; 3 → H5; 4 → H6; 5 → H4; 6 → H7; 7 → H8; 8 → H9; 10 → H11;
- punto 9 → H2 (pytest del parser), H6 (Vitest de la interpolación) y H3/H4 (e2e).

**Sesiones de referencia** (todas reales):

| Sesión | Por qué |
|---|---|
| 2023 Australian GP, carrera | Tres banderas rojas, SC, DRS, 20 coches |
| 2024 São Paulo GP, carrera | Lluvia (INTER/WET), bandera roja, abandonos |
| 2024 Chinese GP, sprint | Sprint |
| 2025 Italian GP, carrera | DRS, ritmo alto |
| 2026 Japanese GP, carrera y clasificación | 22 coches, SC, amarillas, ventanas de overtake, puente de Suzuka |
| 2026 Belgian GP, FP1 | Libres; caché disponible offline |

Los criterios dependen del tipo de sesión:
- **Carrera y sprint**: vueltas del líder y orden de llegada.
- **Clasificación y libres**: orden de mejores vueltas.

Las longitudes oficiales están en `pipeline/circuits.json`, con su fuente.

### H0: Cimientos y verificación de datos crudos
Alcance:
- monorepo pnpm/uv, Nuxt 4.6 vacío (Node 24, TS 6 strict), ESLint (incluido i18n), Vitest, Playwright, pytest, ruff;
- CI en Actions, `CLAUDE.md`, `NOTICE`, `DATA_NOTICE.md`, disclaimer;
- verificación con red: tu PC o los dominios abiertos.

**Acepto si**:
- `pnpm i && pnpm lint && pnpm typecheck && pnpm test && pnpm --filter web generate` y `uv run ruff check && uv run pytest` pasan en verde en local y en CI.
- `pnpm e2e` sirve el estático y encuentra el título.
- Hay un informe en `docs/research/` con:
  - **claves de `Channels` del `CarData.z` crudo de 2026**;
  - **sectores**: todos los valores `Sector` de race control de las sesiones de referencia existen en `marshal_sectors` de MultiViewer, y los "TURN N" caen en el sector que contiene la curva N en ≥ 90 % de los casos;
  - **probe desde Actions**: si F1 o el espejo de FastF1 devuelven 200 o 403.
- `vue-tsc` funciona con TS 6.

### H1: Esquema v1 y contenedor TRZB
**Acepto si**:
- Un fichero generado por Python se decodifica en Vitest **bit a bit idéntico**, columna a columna.
- Hay tests de propiedades: t y s negativos y grandes, con conservación de Float64.
- Los manifests validan contra JSON Schema en Python y en TS.
- Cambiar un layout sin subir la versión hace fallar un test.
- `minReader` funciona: un manifest con un major no soportado lleva al estado "versión no soportada".
- El peso de la sesión de Bélgica FP1 2026 está medido con el layout final, gzip frente a zstd, y comparado con Arrow con los mismos deltas.

### H2: Pipeline v1 de punta a punta
**Acepto si**, para las sesiones de referencia:
- **Cobertura**: ≥ 99 % de pos/car por piloto en sus intervalos en pista.
- **Carrera y sprint**: vueltas del líder = total oficial, y el orden derivado de la última vuelta = clasificación oficial. Jolpica se usa **solo como referencia local del test**: un test comprueba que ningún campo de Jolpica se serializa.
- **Clasificación y libres**: el orden de mejores vueltas = la referencia.
- **Geometría**: cierre de la línea < 2 m; longitud a ±3 % de `circuits.json`; `s` monótona; el pit lane tiene `entryS` y `exitS`, y su longitud de arco está a ±10 % de la de las muestras de pit.
- **Casos sintéticos con test**: cruce de `s = 0` en el pit lane, cola en el pit lane con bandera roja, drive-through, coche que se para en pista.
- **Parser de race control**: *golden set* de ≥ 300 mensajes etiquetados a mano (2023–2026) que incluyen BLUE, track limits, incidentes y su resolución, sanciones, SC/VSC/roja, OVERTAKE/DRS ENABLED y CHEQUERED.
  - Coincidencia exacta del 100 % en `kind`, `cars`, `turn` y `lap`.
  - `other` ≤ 5 %.
  - Se genera un informe con todos los `other`.
- **Elevación**: la comprobación de §2.6 se ejecuta en cada sesión; las de referencia salen `real`.
- **Peso**: ≤ 5 MB en gzip por carrera, con objetivo ~3 MB.
- **Determinismo**: una segunda ejecución sale de la caché y produce **hashes idénticos**. El tiempo y la RAM del build quedan documentados.

### H3: Carga en el front y selector
**Acepto si**:
- e2e: 2026 → Japón → Carrera pasa por el progreso y llega a "listo".
- Estados probados en e2e:
  - sesión inexistente → error con reintento;
  - temporada sin datos → vacío;
  - sesión `no-position` → no disponible (visible, no oculta);
  - manifest con un major no soportado;
  - fichero corrupto → error de decodificación;
  - **sin WebGL** o **contexto perdido** (`WEBGL_lose_context`) → mensaje y recuperación.
- Desde el clic hasta "listo", sin contar la compilación de shaders y con CPU ×4 (CDP), no hay *long tasks* > 50 ms en el hilo principal.
- `/` no pide ningún GLB, y ninguna petición sale a orígenes distintos del de la app y el de datos.
- Medido en el portátil de referencia: tiempo hasta "listo", y descompresión gzip frente a zstd. Con eso se decide D4.

### H4: Reloj maestro, timeline y controles
**Acepto si**:
- Vitest de `SessionClock`: velocidades, pausa, seek, límites y el tope de delta.
- e2e de atajos:
  - `espacio` alterna reproducir/pausa;
  - `1`–`5` ponen x1, x2, x4, x8 y x16;
  - `←`/`→` saltan ±5 s y `Shift` ±30 s;
  - `↑`/`↓` cambian el coche seleccionado;
  - los atajos **no** se disparan con el foco en un input o un slider.
- Arrastrar el timeline (ratón y táctil) mueve el reloj.
- Los marcadores de vuelta coinciden con el total de vueltas. Los de SC/VSC/roja, banderas y paradas coinciden con los recuentos de `events`/`timing`.
- Con `prefers-reduced-motion` las transiciones son instantáneas (e2e con `emulateMedia`).
- En pausa, al hacer seek el coche se mueve (`invalidate`).

### H5: Circuito 3D
**Acepto si**:
- La cinta tiene elevación real, o es plana si la sesión es `flat`. La exageración x1–x3 muestra la etiqueta "Estimado: exageración visual" cuando es distinta de x1.
- La rotación está aplicada.
- **Curvas**: la distancia 2D entre nuestra etiqueta y el XY de MultiViewer (con la misma transformación) es < 30 m.
- **Pit lane**: la malla existe y su longitud está a ±10 % de la longitud de arco de las muestras de pit.
- **Puente de Suzuka**: la Δz de la cinta en el cruce coincide con la de los datos crudos ±0,5 m.
- **Capturas**: cámara fija, DPR 1, baselines generadas en el contenedor de CI, `maxDiffPixelRatio ≤ 0.01`, en Suzuka y Spa.

### H6: Todos los coches en sincronía
**Acepto si** pasan estos tests en Vitest:
- Datos sintéticos y el extracto real:
  - `s(t)` nunca decrece;
  - reproduce las muestras con < 1 cm de error;
  - la velocidad es continua en los nodos;
  - hay corte de segmento con huecos > 2 s.
- Medido con datos reales (en local): hold-out p50 ≤ 1,5 m y p95 ≤ 10 m (hoy: 1,0 / 7,7).
- Motor: en el instante en que cada piloto termina cada vuelta, el orden por `s` coincide con `Laps.Position` en ≥ 95 % de los pares, sin contar los coches que están en el pit lane.
- e2e: nº de instancias = nº de pilotos, y color y sigla de cada coche = manifest (leído vía `window.__trazada`).

### H7: Leaderboard
**Acepto si**:
- Al final de cada vuelta, la posición coincide con `Laps.Position`.
- Los gaps son los de la torre oficial vigente en ese instante.
- El compuesto y la edad del neumático salen de la tabla de vueltas.
- La bandera azul aparece en la fila del coche afectado, con un filtro para ocultarla.
- Un piloto sin datos muestra "sin señal".
- En la máquina de referencia (no en CI), se actualiza a ≥ 4 Hz con p95 < 2 ms por actualización (`performance.measure`).

### H8: Coche seleccionado: telemetría y cámara
**Acepto si**:
- Se puede seleccionar con clic o toque en el coche, con raycast en la vista, o en el leaderboard.
- Los valores mostrados coinciden con la muestra cruda vigente (Vitest).
- DRS solo aparece si el canal existe. En 2026 se muestra "No disponible en 2026" con su explicación.
- En la máquina de referencia, las mini gráficas (ventana de 20 s) mantienen p95 < 16,7 ms con el panel abierto.
- **Cámara de seguimiento**, en Vitest con 60 s guionizados a x1 y x16: la segunda derivada de yaw y pitch está por debajo de un umbral fijado en el test. Ese umbral se calibra en H8 y queda documentado.
- `Esc` vuelve a la vista general, con transición GSAP (instantánea con reduced motion).

### H9: Race control y banderas en el mapa
**Acepto si**:
- **Feed**: tras 20 seeks aleatorios, los mensajes visibles son exactamente los que cumplen `t ≤ reloj`.
- El texto original se muestra tal cual, con el `kind` localizado.
- e2e en Japón 2026, sobre el estado expuesto en `window.__trazada.trackState`:
  - 1 s después de "YELLOW IN TRACK SECTOR 21", el sector 21 está amarillo;
  - 1 s después del CLEAR, vuelve a neutro.
- Las ventanas de SC, VSC y roja tiñen la pista. Se comprueba sobre `trackState` 100 ms después de que empiece cada ventana.
- El timeline muestra las ventanas de `OVERTAKE` (2026) y de `DRS` (2023–25).

### H10: UX, i18n y legal
**Acepto si**:
- Hay un único fichero de tokens (color, espacio, tipo, radios, z, movimiento).
- **i18n**: `no-raw-text` y `no-missing-keys` sin errores; las claves de es y en tienen paridad; números y tiempos se formatean con `Intl`.
- **Etiqueta "Estimado"**:
  - Se activa desde `manifest.quality.estimated` y desde las opciones del usuario (exageración de Z, separación visual, tiempo de la vuelta 1).
  - En e2e, cada caso muestra un "Estimado" visible y traducido.
  - Un test unitario falla si un campo estimado se pinta sin la etiqueta.
- **Accesibilidad**: axe-core sin violaciones *serious/critical*.
- El **disclaimer** aparece en el footer y en el README.
- **Desktop y tablet**:
  - a 1440×900 y 1280×800, y con el perfil iPad (`hasTouch`) a 1024×768 y 768×1024, `scrollWidth ≤ clientWidth` en la página y en los paneles;
  - en tablet, tocar un coche lo selecciona y arrastrar el timeline mueve el reloj.

### H11: Rendimiento medido y despliegue
**Acepto si**:
- Con `?bench=1`, 22 coches y el panel de telemetría abierto:
  - **en tu RTX 3070 Ti** (1440p, DPR nativo, la medida la haces tú): p95 ≤ 16,7 ms, p99 ≤ 20 ms y 0 frames > 50 ms tras el calentamiento;
  - **en el portátil de referencia** (lo eliges tú; GPU integrada): p95 ≤ 33 ms tras la degradación;
  - heap JS ≤ 300 MB con una carrera cargada.
- `docs/PERFORMANCE.md` recoge esas cifras y el peso por sesión, con una tabla generada desde los manifests.
- **Datos publicados**: al menos **una carrera por temporada de 2023 a 2026**. *(D23: «publicados» pasa a ser «en tu `data/` local».)* El backfill completo queda fuera de la Fase 1. El selector muestra todas las temporadas, con estado vacío donde aún no hay datos.
- **Despliegue**: CI despliega el Worker de la app y `pnpm data:deploy` el de datos. *(D25: sustituido por `pnpm local`; no hay despliegue.)*
- Un smoke post-deploy con curl comprueba `Content-Type`, `immutable` y `Access-Control-Allow-Origin` en los datos, y que un deep link `/replay?s=…` devuelve 200 y se pinta. *(D25: sin despliegue, no aplica.)*
- Coste: 0 €.

### H12: Tanda 0, andamiaje para las 21 funciones
Alcance: lo que permite trabajar en paralelo en las tandas siguientes, sin nada visible. Se hace en tres partes con un solo dueño por fichero común (0a: componentes, stores, runtime, i18n y e2e; 0b: `engine/` y `testing/`; 0c: `design/`, dos componentes nuevos y `package.json`).

**Acepto si**:
- **Nada cambia a la vista**: con los huecos vacíos, cada anfitrión se pinta como antes y sin contenedores vacíos (`tests/nuxt/slots-empty.test.ts`). Pasan todos los tests y e2e que ya existían, y la captura de referencia no cambia.
- **0a, puntos de extensión (D29, D41)**:
  - Textos por namespace: siguen todas las claves; es y en tienen los mismos namespaces y la misma paridad; una sola raíz por namespace; una raíz repetida entre ficheros es un error (`i18n-parity`, `i18n-messages`).
  - Huecos: cada anfitrión monta los componentes de su carpeta en orden (`order` o `renderOrder`) y con sus props (`tests/nuxt/slots.test.ts`; la cabecera y los superpuestos de la página y las capas dentro del grupo de la pista, en `tests/nuxt/replay-slots.test.ts`); un fichero sin su número falla al cargar (`tests/nuxt/slots-collect.test.ts`; desde H13 en el entorno Nuxt, porque en cuanto un hueco tiene un `.vue`, importar su registro necesita el plugin de Vue y los alias de Nuxt).
  - Teclas y Esc: registro con las prioridades de `ESC_PRIORITY`; registrar sin modificador una tecla que ya usa el replay es un error (`replay/keys.test.ts`). `useReplayShortcuts` atiende los atajos registrados antes de cortar por Ctrl/⌘ (Ctrl+K), respeta el foco en un campo de texto y cierra con Esc por prioridades (`tests/nuxt/shortcuts.test.ts`).
  - `registerSceneStat` y `sceneStats.layers` (`replay/debug.test.ts`). El tope de draw calls de `cars.spec.ts` es 13 más lo de las capas activas, siempre < 30 (`extensions.spec.ts`).
  - `rt.ext` perezoso y memoizado, con `dispose`; `initialMs` ajustado al intervalo; con `setSceneHidden` no se piden frames a la escena, pero el reloj y los oyentes siguen (`tests/nuxt/runtime.test.ts`).
  - `stores/persisted.ts` con sus tests; `settings.ts` lo usa con el mismo formato.
  - Estimado: `lapDelta`, `minisectors` y `drsZones` con su caso en `tests/nuxt/estimated.test.ts` y sus textos.
  - e2e: `resetStorage(page)` en los specs que vaciaban el almacenamiento.
- **0b, motor compartido** (TS puro, tests junto al código):
  - ReplayModel usa `place.ts` (`placeOnCircuit` y `placeSample`).
  - `compare/distance.ts`: `timeAtS` da el primer instante en una s acumulada; null en huecos, sin dato o fuera de los datos. `sAt` es lo que dibuja el replay.
  - `compare/laps.ts`: inicio de vuelta en t (oficial, con respaldos) y en s (NaN sin posición).
  - `analysis/lapTable.ts`: bits de clasificación y vuelta anulada desde la hora del mensaje de dirección de carrera (`lapFlagsAt`).
  - La clasificación usa el índice con una salida idéntica a la de antes (hash de `compute`, `compoundAt` y `segmentAt`).
  - Builders `testing/laps.ts` y `testing/motion.ts` (`fakeTrzb` no cambia).
  - `@local` (`compare.local.test.ts`): s no decrece, ida y vuelta distancia↔tiempo exacta, índice de vueltas < 10 ms y barrido de minisectores de toda la sesión < 50 ms.
- **0c, base visual (D30, D42, D44)**:
  - `@lucide/vue` 1.48.0 exacta y anotada en `NOTICE`. `design/icons.ts` es el único que importa Lucide. `TzIcon` y `TzHint` son accesibles; Esc cierra la pista abierta aunque el foco esté fuera, como tras un toque en iPad (`tests/nuxt/icon.test.ts`). Sin `<svg>` en línea ni glifos fuera de la lista permitida (`design/icons.test.ts`).
  - Tokens de los ítems 1–21 (`tokens.test.ts`, que ahora escanea también los `.css` y falla con `var(--team)` en `color:`).
  - `motion.ts`: `useReducedMotion`, `listMotionAllowed` y `stagger` (`motion.test.ts`, que revisa todo el CSS).
  - `design-base.spec.ts`: densidad según el alto, zona táctil según el puntero, reduced motion, clases comunes y hover solo con `(hover: hover)`.

### H13: Tanda 1, victorias rápidas visibles
Alcance: cuatro funciones que entran por los huecos de H12, cada una con su namespace de textos: clasificación animada (ítem 8, D42), estelas (ítem 7, D45), tarjeta de fin de sesión (ítem 12, D40) y reanudar donde lo dejaste (ítem 13, D41).

**Acepto si**:
- **Clasificación animada (D42)**:
  - `engine/leaderboard/changes.test.ts`: las flechas comparan órdenes calculados seguidos; un cambio cuenta tras 2 actualizaciones; «—», posición 0 y sin señal no cuentan y pierden su flecha; en libres y clasificación, sin mejor vuelta no cuenta; `reset` tras un salto; caducidad a 3 s y suma en el mismo sentido. Con el fixture (torre oficial) no hay flechas; servido como carrera sin torre, el 55 pasa al 12.
  - `tests/nuxt/leaderboard.test.ts`: flechas, FLIP, seek, ×16, «—», FP/Q, caducidad en pausa y aviso `aria-live`.
  - `leaderboard.spec.ts`: deslizamiento, flecha con cifra y texto, destello y seek que lo borra; a ×16, sin deslizamiento ni destello pero con flechas; con reduced motion, al instante. `local-leaderboard.spec.ts` (Japón, `@local`): flechas en las primeras vueltas, que un seek borra.
- **Estelas (D45)**:
  - `engine/replay/trail.test.ts`: 32 puntos en 3 s, la punta es el coche, cortes en los huecos (también entre dos puntos), velocidad cruda de ≤ 2 s sin interpolar y «sin dato» sin muestra.
  - `trails.spec.ts`: apagadas por defecto (0 draw calls); con Equipo o Velocidad, **1 draw call** medida por el renderer (el material es de una sola pasada) y dentro del tope 13 + capas; se recuerdan al recargar; la punta es el coche tras un seek en pausa; sin renders en pausa; el menú «Capas» y la leyenda son accesibles y Esc cierra primero la pista ⓘ y luego el menú.
  - `tests/nuxt/trails.test.ts` (herramienta) y `tests/nuxt/slots.test.ts` (cada grupo del hueco es un menú con icono, `aria-expanded` y su grupo con nombre).
- **Tarjeta de fin de sesión (D40)**:
  - `engine/summary/sessionSummary.test.ts` (+ `.local`): fin por «Finished», bandera a cuadros o fin de los datos; momento asentado en carrera y en libres/clasificación; tres primeros con posición conocida; vuelta rápida oficial no anulada; paradas, pasos sin cambio y sin dato; tiempo en el pit lane.
  - `tests/nuxt/summary.test.ts` y `summary.spec.ts`: se abre sola al cruzar el fin reproduciendo, con los mismos tres primeros que la clasificación; Esc, botón del dock y volver atrás; un salto no la abre; cada hueco con dato o «sin dato»; entrada con los tokens y sin animación con reduced motion; axe en es y en.
- **Reanudar (D41)**:
  - `replay/resume.test.ts` y `tests/nuxt/resume.test.ts`: validación campo a campo, LRU, t0 y recorte, «vista» y «no empezada», guardado cada 5 s y tras 1 s de un cambio, coche que ya no está.
  - `resume.spec.ts`: guarda y retoma en pausa con el aviso; «Empezar desde el principio»; `?t=` manda; el bench ni retoma ni guarda; a < 30 s del final se olvida; un coche ausente se ignora; «Seguir viendo» solo con sesiones del catálogo, que lleva a la sesión y × la olvida.
- **Cabecera en una fila a 1440 y 1280 px** (es y en, Bélgica Libres 1): los grupos del hueco de herramientas son menús y, por debajo de 1360 px, el detalle de carga del chip «Listo» queda en su título. La telemetría se ve entera a 1280×800 (`layout.spec.ts`) y la captura de referencia no cambia (estelas apagadas por defecto).

### H14: Tanda 2, análisis base
Alcance: cuatro funciones que entran por los huecos de H12, cada una con su namespace de textos: gráficas de carrera (ítem 3, D33), colores de sector (ítem 4, D34), vista previa del timeline (ítem 16, D46) y zonas de DRS (ítem 11, D38). Sin dependencias nuevas ni cambios de esquema.

**Acepto si**:
- **Gráficas de carrera (D33)**:
  - `engine/analysis/{raceTrace,pace,stints}.test.ts` y `analysis/chart.test.ts`: gap por paso por meta oficial; doblado con más de una vuelta; retirado y registro residual que cortan la serie; vuelta 1 por su paso por meta sin tiempo oficial; exclusiones marcadas (vuelta 1, boxes, SC/VSC/roja, anulada desde su mensaje, sin tiempo) y el corte de «Sin spoilers»; escala de las representativas con las de fuera contadas; stints por número y compuesto, salida de boxes sin número, UNKNOWN, `fresh` y `tyreLife` 255. `stoppedCars` (detenido tras tres vueltas del primero; un doblado de verdad, a tres vueltas, nunca cuenta; corte; parada larga en boxes). `analysis/endLabels.test.ts`: siglas alineadas a la izquierda (uPlot deja la alineación de su eje y), sin pisarse y exactamente a la altura de su dato; las que pisarían, sin sigla, y la del coche elegido siempre; ni trazos ni puntos, y en el área de datos solo la raya del detenido; con «Sin spoilers», la columna tras el último dato; fuera de la escala, triángulo hacia arriba o hacia abajo y sin raya; marca continua o discontinua; por hora, solo el texto. `analysis/chart.test.ts`: `placeLabels` (a su altura o ninguna, solape horizontal, la destacada primero, el borde). `tests/nuxt/analysis.test.ts`: muestra de punto o cuadrado en la leyenda por hora. `analysis.local.test.ts` con la carrera de Japón (`@local`).
  - `tests/nuxt/analysis.test.ts`: abrir y cerrar, escena tapada, Esc antes que el seguimiento, foco, pestañas con flechas, «Sin spoilers», libres sin race trace con su texto, ejes por hora rotulados con el reloj del dock, carrera sintética con la vuelta 1 sin tiempo oficial y stints con su texto y salto.
  - `analysis.spec.ts`: con la hoja abierta y reproduciendo, el reloj sigue y la escena no renderiza; Esc la cierra y la escena vuelve; en libres, «Ritmo» por hora y el estado vacío del race trace; un clic en el ritmo y un stint pulsado saltan en el tiempo; «Sin spoilers» oculta lo que no ha pasado; axe en es y en; cabe en iPad horizontal; la cabecera sigue en una fila a 1440 y 1280 px. `local-analysis.spec.ts` (Japón, `@local`): race trace hasta el reloj con la línea de la vuelta en curso y, sin «Sin spoilers», la carrera entera; las siglas del race trace dentro del lienzo, en el margen y sin pisarse (ANT, el ganador, y ALB, doblado, con la suya; STR y BEA sin ella), y «hasta V30» y «hasta V20» para STR y BEA.
- **Colores de sector (D34)**:
  - `engine/timing/sectors.test.ts` (+ `.local`): morado al completarse que no cambia después, verde, empate que no es morado, sin dato, solo vueltas completadas, registro residual, instante desde la meta hacia atrás y cota superior, anulada con y sin mensaje; precálculo de 1,2–1,8 ms y consulta de ~12 µs en Japón.
  - `tests/nuxt/sector-cells.test.ts` y `sectors.spec.ts`: tres marcas por fila con su estado y su texto para lectores de pantalla, el aviso de que no son las marcas del cronometraje, la vuelta anulada desde su mensaje, el sector sin tiempo en gris «sin dato», el panel del coche con los tiempos oficiales y su pista, las columnas de siempre a 1280 y a 1024 px, y axe en es y en.
- **Vista previa del timeline (D46)**:
  - `engine/timeline/preview.test.ts` (+ `.local`): relevo del primero con torre (y el mensaje más reciente si dos reclaman P1); sin torre, el cambio al cruzar la línea; el registro residual de un retirado no cuenta; fuera de carrera, «Mejor vuelta» de la tanda en curso; antes de la primera vuelta, o con un empate exacto, sin dato; su `TrackState` no altera el del reloj. `leaderboard.test.ts`: la clasificación usa las mismas reglas exportadas.
  - `tests/nuxt/preview.test.ts` y `estimated.test.ts`: tarjeta con ratón, dedo (también cuando el navegador marca `:focus-visible` el foco del toque) y teclado; Esc; el estado de pista deducido lleva «Estimado».
  - `preview.spec.ts`: el mismo primero que la clasificación y «Mejor vuelta» en libres; mirar no mueve el reloj ni pide renders; marcador y chip de una bandera cercana sin tocar la cabecera; con la hoja de análisis abierta, nada tapa la tarjeta; teclado y Esc; dedo (CDP). `local-preview.spec.ts` (Japón, `@local`): SC con su chip, «Estimado» y la vuelta del líder; «Líder» igual al primero de la clasificación.
- **Zonas de DRS (D38)**:
  - `engine/drs/zones.test.ts`: zona a ±10 m, cruce de s = 0, una pasada por celda, unión y separación, aperturas sueltas, un solo coche, pit lane, neutralizaciones, canal atascado, sin aperturas, 255, pocas pasadas, más del 60 %, 2026 sin tocar los datos y el fixture con aperturas sintéticas; la malla. `load-session.test.ts`: las zonas viajan como transferibles.
  - `tests/nuxt/drs.test.ts` y `estimated.test.ts`: la herramienta en sus cuatro estados, la pista, la preferencia y la etiqueta «Estimado» también en la fila de etiquetas de la escena mientras se pinta.
  - `drs.spec.ts`: en 2026, la leyenda de 2026, sin zonas, sin «Estimado» y 0 draw calls; un manifest de 2025 con el canal pero sin aperturas da «sin dato», nunca zonas inventadas; sin renders en pausa; axe. **Pendiente tuyo**: ver las zonas sobre el mapa con una sesión de 2023–2025 en tu PC.
- **Integración**: la telemetría se ve entera a 1280×800 con la línea de sectores (`layout.spec.ts`; gráficas de `--tz-chart-h`, 54 px con la densidad compacta); la tarjeta de la vista previa queda por encima de la hoja de análisis; la clasificación más ancha cambia el encuadre, así que la captura `@screenshot` se regenera con el workflow «Snapshots».


### H15: Tanda 3, comparar y escena
Alcance: cuatro funciones que entran por los huecos de H12, cada una con su namespace de textos: comparar dos pilotos (ítem 1, D31), meteorología (ítem 6, D36), realización automática (ítem 9, D39) y ambiente de la escena (ítem 10, D37). Sin dependencias nuevas. Esquema 1.1.0, aditivo (`minReader` 1.0.0), con el fixture regenerado.

**Acepto si**:
- **Comparar dos pilotos (D31)**:
  - `engine/compare/{reference,delta,ghost,trace,session}.test.ts` (+ `session.local.test.ts`): referencia por defecto según el tipo de sesión; misma vuelta solo si ya había empezado; mejor vuelta con tiempo oficial y nunca la 1 ni una anulada, y última vuelta nunca la 1, fijadas al empezar A; diferencia por distancia en la última distancia común, por tiempo de vuelta y no por reloj, en décimas, «en boxes» y sin dato; fantasma = posición real desplazada, ni futuro ni huecos; trazas crudas con 255 → sin dato, cortes y recorte al instante; diferencia oficial con `lapMs`, pendiente hasta que B cierre; cálculo del frame memoizado y compartido. Con los datos completos, la diferencia en vivo al cerrar la vuelta queda a una mediana de 75–83 ms de la oficial.
  - `tests/nuxt/compare.test.ts` y `estimated.test.ts` (`lapDelta` se pinta con `TzCompare`).
  - `compare.spec.ts`: Mayús+clic compara, diferencia en décimas con «Estimado», trazas y fantasma en 1 draw call dentro del presupuesto y sin niebla; la mejor vuelta de B fuera del extracto da «sin dato» con su motivo y sin fantasma, y con la última vuelta sí; Esc cierra antes la comparación que la selección; el fantasma se recuerda; sin renders en pausa; cabe a lo ancho a 1024×768 y 768×1024; axe.
- **Meteorología (D36)**:
  - Pipeline: `test_weather.py` (clave ausente → null y no 0, lluvia, ilegibles, reglas offline del relleno, recorte, esquema, la fuente con `fetch_page` simulado y un `@local` con la caché de Bélgica: 81 muestras y la fila de viento 0/0 sin dato), `test_build.py`, `test_schema.py` (opcional y aditivo) y `test_fixtures.py`. `packages/schema/test/schemas.test.ts`: ida y vuelta de los ejemplos 1.1.0.
  - `engine/weather/weather.test.ts`: escalonado sin interpolar, caducidad a 150 s, antes de la primera, null, datos mal formados, disponibilidad (`present`, `absent`, `outdated`), franja y rumbo; el fixture con la meteorología de su ventana.
  - `tests/nuxt/weather.test.ts` y `weather.spec.ts`: a 1440 px solo el icono con la cabecera en una fila; las piezas a 1680 y 1920 px, siempre al principio del nombre; la antigüedad de la medida; el panel con la brújula junto al trazado, Esc y axe en es y en; la franja sin alto extra y un clic que mueve el reloj; una sesión de antes de 1.1.0 con «sin dato» y volver a descargarla.
- **Realización automática (D39)**:
  - `engine/camera/Director.test.ts`: duelo por la torre en carrera con ventaja para los de delante; pit, sin señal y no consecutivos fuera; sin torre o fuera de carrera, cercanía sin cifra; un doblado no es duelo; ni parados ni lentos; SC → líder y roja → vista general; histéresis (≥ 7 s por plano, ≥ 6 s entre cortes, 0,7 ×); pausa y seek; cámaras de curva a ×1 y ninguna a ×16; plan determinista. `cornerCams.test.ts`, `FollowCamera.test.ts` (encuadre de la pareja y suavidad ≤ 6 rad/s²) y `leaderboard/tower.test.ts`.
  - `tests/nuxt/tv.test.ts` y `tv.spec.ts`: desde el menú «Cámara», sigue a dos coches cerca en pista sin cifra y dentro del presupuesto de la escena; sin renders en pausa; cortes ≥ 6 s a ×4; arrastrar, Esc, elegir o seguir un coche la apagan; chip y herramienta accesibles; reduced motion sin vuelo; en tablet, el botón de la cabecera. `local-tv.spec.ts` (Japón, `@local`): el líder bajo coche de seguridad y duelos por cercanía sin cifra.
- **Ambiente (D37)**:
  - Pipeline: `test_outlines.py` (cada centro dentro de la caja de su trazado; los versionados, a ±0,05° de las coordenadas públicas de 7 circuitos). `venues.test.ts`: `centerFor` con las mismas excepciones que `outlineFor`.
  - `engine/ambience/{sun,ambience}.test.ts`: altura del sol a ±0,2° de referencias calculadas aparte, el huso horario no interviene y sin hora o posición no hay sol; fases y mezcla continua de los tokens; niebla de 0 al 25 %; bordes de la pista lejana a ≥ 3:1 del fondo en todas las fases; tono nocturno ≤ 8 %; pasos de sol de 0,25°.
  - `tests/nuxt/ambience.test.ts` y `ambience.spec.ts`: Spa de día con cielo y niebla solo en la pista (+1 draw call dentro del presupuesto); apagado, el fondo liso de siempre y se recuerda al recargar; sin renders en pausa; de noche, «Noche» y el tono de focos; sede desconocida, escena neutra y «sin dato de ubicación». `scene.spec.ts` mide la anchura de la pista con el ambiente apagado.
- **Integración**: la cabecera en una fila a 1440 y 1280 px (es y en) con la meteorología y el menú «Cámara»; la telemetría entera a 1280×800 (`layout.spec.ts`); la captura `@screenshot` se regenera con el workflow «Snapshots» (el cielo cambia el fondo).

### H16: Tanda 4, lo que se apoya en las anteriores
Alcance: cuatro funciones que entran por los huecos de H12, cada una con su namespace de textos: mapa de calor (ítem 2, D32), momentos con saltos y duelos (ítem 5, D35), paleta de comandos (ítem 14, D43) y gestos en tablet (ítem 17, D43). Sin dependencias nuevas ni cambios de esquema o de pipeline. Verificación ligera al integrar (lint, typecheck, Vitest y build); los e2e y el bench, una sola vez al cierre de la Tanda 6.

**Acepto si**:
- **Mapa de calor (D32)**:
  - `engine/track/heat.test.ts` (sintéticos y el fixture de Spa): elección de vuelta (representativa, completa y vista hace ≥ 2 s; última o mejor; la más rápida de la sesión sin coche); velocidad por punto con interpolación solo entre muestras seguidas y sin color en huecos de > 2 s o de posición; 25 minisectores con `timeAtS`, empate < 50 ms y sin dato; rampa y cinta; memoizado por clave.
  - `tests/nuxt/heat.test.ts` y `estimated.test.ts` (`minisectors`, caso real): la herramienta en sus estados, la leyenda, la preferencia y el orden de pintado bajo las banderas.
  - `heat.spec.ts`: apagado por defecto sin draw calls; «Velocidad» con la mejor vuelta fuera del extracto da «sin dato» (nunca otra vuelta) y la última, 1 draw call sin niebla ni «Estimado» y con su escala; «Minisectores» sin comparación lo explica y con GAS frente a HAM cuenta los 25 con «Estimado» a la vista; las banderas de sector igual; sin renders en pausa ni subidas de color; se recuerda; axe.
- **Momentos (D35)**:
  - `engine/moments/{overtakes,duels,jumps}.test.ts`: cambio de orden con mismo número de vuelta, sin boxes y < 30 s; vuelta 1 y pasos por meta que faltan, nada; instante GPS o sin dato; duelos de ≥ 3 vueltas a < 1 s sin boxes ni neutralizaciones, ninguno sin estado de pista; saltos 5 s antes con el margen de «anterior» y mensajes juntados. `moments.local.test.ts` (Japón, `@local`): entre 20 y 80 adelantamientos, más del 60 % con instante y en menos de 50 ms (al hacerlo salieron 42, los 42 con instante, y 39 duelos, como en el estudio).
  - `tests/nuxt/moments.test.ts`, `estimated.test.ts` (`overtakeTime`) y `tests/unit/moments-texts.test.ts`: la pestaña con «Sin spoilers», saltos al pulsar, los botones del dock con coma y punto y la clase elegida, el carril del timeline y, al integrar, el servicio de momentos de la paleta con los mismos destinos.
  - `moments.spec.ts` y `local-moments.spec.ts` (Japón, `@local`).
- **Paleta de comandos (D43)**:
  - `engine/commands/{parse,match,registry,builtin}.test.ts`: normalización es/en, horas, velocidades, vueltas y saltos; coincidencia difusa y pilotos; ambigüedad, dorsal frente a vuelta, fuera de rango, libres sin piloto y el fixture. `tests/nuxt/palette.test.ts`: combobox, Enter, Tab, Esc y huecos.
  - `palette.spec.ts`: Ctrl+K y «/»; «seguir NOR»; «x4»; las teclas no llegan al replay; «vuelta 17» pide piloto en libres; lo que no está en los datos, deshabilitado con su motivo; saltos a la bandera a cuadros, a una hora y a una parada; «siguiente momento» va adonde el botón del dock; axe; el botón del dock en tablet y, a 1180×820 táctil, la cabecera en una fila.
- **Gestos en tablet (D43)**:
  - `engine/gestures/{twoFinger,doubleTap}.test.ts`: sin decidir antes de 12 px; deslizar en horizontal, pellizco y mapa; 2 min por ancho; doble toque que vale aunque el segundo no acierte y no deselecciona.
  - `tests/nuxt/gestures.test.ts`: un deslizamiento rápido en paralelo, con cada dedo en su evento, es reloj y no pellizco; sin decidir hasta el frame; pellizco con un dedo quieto; vertical, del mapa.
  - `gestures.spec.ts` (CDP): +60 s ± 2 s con medio ancho sin mover la cámara, −30 s hacia la izquierda, pellizco del mapa y del seguimiento, doble toque en coche y en sigla, dos toques lentos como siempre, doble clic en escritorio y la pista «Gestos». **Pendiente tuyo**: probarlo en el iPad (`pnpm local --lan`).
- **Integración**: `perf.spec.ts` con el escenario «todas las capas» (cielo, estelas, calor y fantasma: < 30 draw calls, < 150.000 triángulos, sin niebla y sin renders en pausa; frames con la CPU ×4 anotados). La captura `@screenshot` no debería cambiar (todo lo nuevo, apagado o fuera del lienzo).

### H17: Tanda 5, pulido I
Alcance: la identidad visual «Asfalto y pintura» (D47) y, sobre ella, iconos (ítem 19b, D30), jerarquía visual (20b, D44) y microinteracciones (21b, D42) en la portada y en el replay, más los comandos de momentos en la paleta (ítem 14b, D43). Dependencias nuevas: solo las fuentes (`@fontsource/barlow`, `barlow-condensed` e `ibm-plex-mono` 5.3.0, OFL-1.1, en `NOTICE`); sin cambios de esquema ni de pipeline. Verificación ligera al integrar (lint, typecheck, Vitest y build); los e2e y el bench, al cierre de la Tanda 6.

**Acepto si**:
- **Identidad (D47)**: `design/tokens.test.ts` con los tokens nuevos, el piano en sus tres ficheros con una regla en cada uno, la señal solo en `base.css`, «Estimado» a ΔE OKLab ≥ 0,08 de la mejor vuelta y de boxes, sin `backdrop-filter` y la placa ≥ 4,5:1. `design-base.spec`: la casilla nativa toma la pintura como `accent-color` y la opción elegida de un control segmentado es una placa que se lee y pasa con la elección. Siguen en verde axe AA, `layout` (1440, 1280, 1024 y 768), densidad, ambiente, escena, «Estimado» y sin peticiones externas.
- **Iconos (D30)**: `design/icons.test.ts` sin lista permitida (ningún `<svg>` en línea ni glifo suelto fuera del registro); `tests/nuxt/icon.test.ts` (TzHint `plain`).
- **Portada (D30, D42, D44)**: `tests/nuxt/portada.test.ts` y `selector.spec.ts` («portada: identidad, iconos y estados» y «microinteracciones»): iconos del registro junto al texto; placa maciza en la temporada elegida (≥ 4,5:1) y el piano bajo la marca; el motivo de «No disponible» a la vista; «sin dato» con su estilo (heap del bench, tarjeta sin país ni fecha); listas quietas al cargar y escalonadas con los tokens tras un cambio; con reduced motion, 0; ninguna cifra se anima; una descarga que termina destella su fila una vez (`data-fresh`); el panel de carga sin `backdrop-filter`.
- **Replay (D44)**: `layout.spec.ts`: la cabecera en una fila a 1440 y a 1280 con lo de una carrera dev (5 avisos, dos «Estimado», bandera, meteorología sin dato), sin desbordar y con las etiquetas «Estimado» a la vista (la de la escena, bajo la cabecera y sin pisar los paneles; fuera mientras la hoja de análisis tapa la escena); el replay a la ventana exacta, sin cabecera global y con el dock en una fila. `smoke.spec.ts`: la marca vuelve al selector y el idioma se cambia desde el replay. `telemetry.spec.ts`: cerrar por su nombre, cifras grandes, tinte sin color de equipo en el texto y placa al seguir. `tests/nuxt/estimated.test.ts`: el chip pulsable, compacto y `plain`.
- **Comandos de momentos (D43)**: `engine/commands/builtin/moments.test.ts` (tabla es/en, destinos, selección, comparación, «Sin spoilers», «Estimado», libres, sin dato, sin servicio y sin cruces con otros comandos) y `builtin.test.ts` («seguir ver» sin «Comparar con «seguir»»); `tests/nuxt/palette.test.ts` (Enter salta y elige, el duelo compara, libres deshabilitado y la opción sin controles dentro); `palette-moments.spec.ts` y `local-palette-moments.spec.ts` (Japón, `@local`).
- **Integración**: la captura `@screenshot` se regenera con «Snapshots» (el lienzo crece sin la cabecera global); las capturas del README, al cierre de la Tanda 6.

### H18: Tanda 6, pulido II
Alcance: diseños «Espectador» y «Análisis» con paneles de ancho ajustable (ítem 15, D41/D44), microinteracciones del replay (ítem 21b, D42), prioridad del título en la cabecera (D44) y guía de primer uso (ítem 18, D41/D43). Sin dependencias nuevas ni cambios de esquema o de pipeline. Verificación ligera al integrar (lint, typecheck, Vitest y build); la suite de Playwright, el bench y las capturas del README, al cierre de la tanda.

**Acepto si**:
- **Diseños y asas (D44, D41)**:
  - `engine/layout/{clamp,state}.test.ts`: límites por panel y por ventana, el mínimo del mapa con recorte proporcional, lo guardado intacto y lo corrupto al ancho por defecto. `engine/commands/builtin/layout.test.ts`: los comandos de diseño, con lo imposible deshabilitado y su motivo.
  - `tests/nuxt/layout.test.ts`: el asa con teclado, puntero y doble clic; el estado guardado; el cambio de diseño (segmentado y, compacto, el botón que alterna), la tecla L y el servicio de la paleta; las columnas con «—» y la vuelta 1 estimada solo con la opción y su «Estimado». `tests/nuxt/race-control.test.ts`: `data-fresh` con reproducción y no tras un seek; plegado por diseño.
  - `layout.spec.ts`: «Análisis» sin scroll horizontal a 1440, 1280, 1024 y 768 y con sitio para el mapa; en táctil, el botón que alterna y la cabecera en una fila en horizontal; se recuerda al recargar; tecla L; axe con las asas; arrastre que reencuadra solo al soltar y se recuerda; teclado sin mover el reloj; sin asas en vertical. `leaderboard.spec.ts`: las columnas de «Análisis» con su texto y la misma «Última» que el panel del coche.
- **Prioridad del título (D44)**: `engine/layout/fit.test.ts`; `layout.spec.ts`: a 1920×1080 con lo de una carrera dev y el nombre largo de Japón, el título entero y la cabecera en una fila con «Estimado» a la vista; a 1440 y 1280, si el título se acorta es que todo lo secundario está en su forma más corta.
- **Microinteracciones (D42)**: `playback.spec.ts` (con reduced motion, 0 s en todo el documento tras elegir coche, plegar, cambiar de diseño y hacer un seek) y `race-control.spec.ts` (sin transiciones tras un seek; `data-fresh` a ×1 con un mensaje dentro del reloj).
- **Guía de primer uso (D43, D41)**: `stores/tips.test.ts`, `engine/tips/place.test.ts`, `engine/commands/builtin/tips.test.ts` y `tests/nuxt/tips.test.ts` (lo visto por paso, `{ all: true }`, almacenamiento roto, colocación, comandos, foco, Esc, ejemplo rotulado y el botón «?» el último de la cabecera). `tips.spec.ts`: sale sola sin robar el foco ni el espacio; la 1 de 6 junto a la clasificación; cada paso junto a su ancla (centrada sin ella) y recolocada al pasar a «Análisis»; el ejemplo de «Estimado» rotulado y sin chip de verdad; «Saltar» se recuerda; el botón «?», la tecla «?» y la paleta la reabren con el foco dentro; axe; la cabecera en una fila a 1440 y 1280; en iPad vertical, nada se desborda; con reduced motion, sin animación.
- **Cierre**: Playwright completo en verde, bench en Spa FP1 y Japón a ×1 y ×16 (también en «Análisis» y arrastrando un asa) anotado en `docs/PERFORMANCE.md`, capturas del README y la captura `@screenshot` (no debería cambiar; si cambia, «Snapshots»). **Pendiente tuyo**: el bench en el iPad (`pnpm local --lan`) y probar a mano las asas y la guía en el iPad.

## 9. Lo que necesito de ti

### 9.1 Aprobación del plan y de las desviaciones del brief

| Decisión | Lo que pedía el brief | Propuesta |
|---|---|---|
| D1 | Cloudflare Pages | Workers |
| D2 | Dataset público en HF | Assets de la app y archivo privado |
| D3 | Arrow IPC | Binario TRZB |
| D5 | — | Ingesta local, no en Actions |
| D9 | Parser de race control en TS (Vitest) | En Python (pytest) |
| D10 | Stack con `@tresjs/post-processing` | Sin post-proceso en la Fase 1 |
| D15 | — | Sesión elegida con `?s=`, sin prerenderizar una ruta por sesión |
| D19 | — | Node 24 y TypeScript 6 |
| D20 | "Los 20 coches" | 22 en 2026 |
| §0.2 | El canal DRS indica la aero activa en 2026 | Ese canal no existe en 2026 |
| §2.6 | — | OpenF1 solo como contraste opcional en la Fase 1 |
| §2.8 | — | Extractos mínimos de datos reales en el repo para los tests |

### 9.2 Acceso a datos reales

Bloquea H2 en adelante. Una de dos opciones:

- **a)** Abrir dominios en el entorno (*Network access → Allowed domains*):
  - `livetiming.formula1.com`, `livetiming-mirror.fastf1.dev`, `api.multiviewer.app`, `api.jolpi.ca` y `api.openf1.org`;
  - `huggingface.co`, `hf.co`, `*.hf.co` y `*.xethub.hf.co`, para la copia privada;
  - opcionales, para documentación: `docs.fastf1.dev`, `developers.cloudflare.com`, `openf1.org`, `formula1.com`, `tresjs.org` y `nuxt.com`.

  **Aviso**: F1 probablemente siga devolviendo 403 a esta IP de nube. OpenF1 y MultiViewer sí deberían responder.
- **b)** Que ejecutes el pipeline en tu PC cuando exista (H2) y me pases los bundles o la caché a través de un dataset privado de HF.

Mientras tanto, desarrollo con la **caché real de Bélgica FP1 2026**, que ya tengo en local y cargo con el *unpickler* restringido, y con datos sintéticos.

### 9.3 Cuentas y secretos (gratis; los creas tú)

- **Cloudflare**: no hace falta (D25: solo local).
- **Hugging Face**: un dataset privado y un `HF_TOKEN` en tu PC.

### 9.4 Postura legal — **respondida (D23)**

Respuesta: «haz lo que sea legal; es un proyecto totalmente personal». Por tanto:
- **No se publican datos**: la app se usa en local (`pnpm local`).
- **MultiViewer**: no hace falta pedir permiso, porque no se redistribuye nada. Sus datos se usan solo como entrada del pipeline en tu PC, así que el plan B no hace falta.
- **Normas de F1**: no aplica la consulta, porque no hay publicación. Se mantienen el disclaimer y la ausencia de logos, fotos y marcas.

### 9.5 Referencias de rendimiento

Tu resolución de trabajo, y qué portátil o GPU integrada usamos como referencia de "degradación digna".

### 9.7 Para cerrar H11 (en tu lado)

Con D23 (uso personal) ya no hacen falta cuentas ni despliegue. Queda esto:

1. **Arrancarla** (con tu conexión de casa, porque F1 devuelve 403 a las IPs de nube):
   - `pnpm install`, `cd pipeline && uv sync` y, desde la raíz, `pnpm local`; abrir http://127.0.0.1:3000.
   - Para el iPad, `pnpm local --lan` y abrir la dirección que muestra (las descargas se lanzan desde el PC).
2. **Datos reales** (D26): en la portada, elegir temporada y pulsar «Descargar» en las sesiones que quieras, o «Descargar las carreras que faltan». Con la CLI también vale: `cd pipeline && uv run trazada build 2023 <ronda> race`.
3. **Medidas** (`docs/PERFORMANCE.md`, "Cómo medir"):
   - RTX 3070 Ti a 1440p: `…&bench=1&governor=off`.
   - Portátil de referencia: `…&bench=1`.
   - Pégame el JSON de "Copiar resultados" y actualizo la tabla.
4. **iPad real**: tocar un coche y arrastrar el timeline (en e2e ya pasa con el perfil táctil).

### 9.6 GSAP

Lo mantengo, como pide el brief: es gratis aunque su licencia es propietaria.

### Tras tu aprobación

- Creo `CLAUDE.md` (convenciones, comandos, cómo verificar) y actualizo `BRIEF.md` con las decisiones que cambien.
- Arranco por H0.
- Cada hito termina con su verificación y un commit en la rama de trabajo.
