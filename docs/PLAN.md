# Trazada: plan de la Fase 1

> Estado: **aprobado** el 2026-10-10 y en ejecución. Hechos: H0–H7 (ver "Progreso" en §8).
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
  - la distancia a la línea (> 8 m) sirve solo como comprobación.
  - Se guardan `entryS` y `exitS` sobre la línea, que pueden envolver `s = 0`.

**Pipeline**, una vez por **sesión**:
1. Elimina muestras duplicadas (mismo `Date`) y las que tienen XY = 0.
2. Clasifica cada muestra como `path ∈ {0 pista, 1 pit, 2 sin dato}`:
   - pit: dentro de las ventanas de pit;
   - sin dato: XY = 0, hueco > 2 s o coche en garaje.
3. Proyecta sobre la línea con **búsqueda en ventana alrededor de la `s` anterior y distancia 3D**. La Z resuelve cruces como el puente de Suzuka. Tras cada hueco se vuelve a buscar en toda la línea.
4. Para las muestras de pit, guarda la **`s` equivalente en la pista**: un mapeo lineal de `u` sobre `[entryS, exitS]`, teniendo en cuenta el cruce por `s = 0`. Así `s` acumulada sigue siendo monótona y la lógica de vueltas no cambia. El Web Worker deshace el mapeo `s → u` para dibujar.
5. Desenrolla las vueltas en una distancia acumulada `s` y fuerza la **monotonía con regresión isotónica (PAVA)**. El máximo acumulado provocaría paradas seguidas de saltos. Hay un 0,06 % de retrocesos.
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
- El GLB del coche (Meshopt, **≤ 150 KB**) se carga solo en `/replay`.
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
  - una sesión e2e recortada de 5 vueltas con todos los coches (~0,3 MB).
- Las sesiones completas **solo se usan en local**, con tests marcados `@local` que leen `data/`.
- Para el resto de tests unitarios hay **generadores sintéticos**: trazados, ruido de muestreo, huecos, pit lane y cruce de `s = 0`.
- En CI se ejecuta todo menos `@local`. El e2e sirve la sesión recortada desde el mismo origen.

## 3. Estructura de carpetas

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
│   │   ├── composables/   stores/
│   │   ├── engine/{clock,interp,track,replay,format}/   # TS puro + tests
│   │   ├── data/          workers/session.worker.ts
│   │   └── design/{tokens.css,motion.ts,typography.css}
│   ├── i18n/locales/{es,en}.json
│   ├── public/{models/car.glb, fonts/, decoders/meshopt_decoder.module.js}
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
  "schema": "trazada.session", "schemaVersion": "1.0.0", "minReader": "1.0.0",
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
  "channels": { "drs": "absent", "overtakeWindows": "raceControl", "elevation": "real" },
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
| Fuentes | @fontsource-variable/inter + jetbrains-mono 5.3.0 | **OFL-1.1** | Autoalojadas con su `OFL.txt`. Descarto Titillium por la asociación visual con la marca. |
| CSS | Nativo: custom properties, SFC scoped, nesting | — | *Propuesta*, ver D11. |
| Web Workers | Módulos de Vite | — | `postMessage` con transferibles, sin Comlink. |
| fzstd | 0.1.1 | MIT | *Opcional* (D4): decoder zstd de 3,9 KB gz. |
| Vitest + @nuxt/test-utils | 5.0.3 + 4.3.3 | MIT | Rango compatible oficial. happy-dom, con WebGL simulado en los tests unitarios. |
| Playwright | 1.64.0 | Apache-2.0 | e2e con WebGL real en Chromium (en CI con SwiftShader), capturas y perfil iPad. |
| **@playwright/cli** | 0.1.22 | Apache-2.0 | Es el "playwright-cli" del brief (la herramienta oficial para agentes). `playwright-cli` está deprecado. |
| @axe-core/playwright | 4.13 | MPL-2.0 | *Propuesta*: auditoría de accesibilidad en e2e. |
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
| D21 | **Circuito canónico por trazado**, compartido entre sesiones | `s` es comparable entre sesiones y temporadas, como necesita el heatmap. Hay menos ficheros. | Línea central por sesión: los orígenes y longitudes difieren entre sesiones. |
| D22 | **Etiquetas (curvas y siglas) en DOM proyectado** en cada render, en lugar de troika-three-text | Texto nítido con las fuentes de la app (woff2, sin convertir a woff/ttf para troika), accesible, i18n directo, 0 draw calls. Coste: escribir `transform` en ~45 nodos por frame (solo capa de composición). | troika `BatchedText`: necesita fuentes woff/ttf autoalojadas y el `unicodeFontsURL`, y no aporta nada para ~45 etiquetas. |

## 7. Riesgos

| # | Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|---|
| R1 | **F1 devuelve 403 a IPs de nube**, y FastF1 no lanza error: devuelve tablas vacías. **Confirmado el 2026-10-10 desde GitHub Actions**: F1 403, espejo de FastF1 404; OpenF1, MultiViewer y Jolpica 200. | Cierta | Alto | Ingesta en tu PC. `probe` que falla en ruidoso. Validación de "no vacío". Archivo privado para no tener que volver a descargar. Adaptador OpenF1 (accesible desde la nube) para automatizar 2023+. |
| R2 | F1 pone autenticación también al archivo estático (el directo ya la tiene desde 2025) | Media | Alto | Archivar cada sesión procesada (bundles y caché). La app nunca vuelve a descargar. Adaptadores de fuente intercambiables. |
| R3 | **Derechos sobre los datos**: términos de F1 (timing, TDM/IA), MultiViewer sin licencia, Jolpica CC BY-NC-SA, marcas | Media | Alto | §5 Legal: no comercial; datos mínimos y cuantizados; sin licencia abierta; separados del código y retirables; sin campos de Jolpica ni fotos; disclaimer; permiso de MultiViewer; posible consulta a brandprotection@f1.com. |
| R4 | Semántica de 2026 incompleta: sin DRS, aero ni overtake por coche; puede haber canales nuevos que FastF1 ignora | Cierta | Medio | UI honesta ("No disponible en 2026"). Ventanas globales de overtake. En H0 se vuelca el `CarData.z` crudo. |
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

### Progreso

| Hito | Estado | Notas |
|---|---|---|
| H0 | ✅ | CI en verde; probe desde Actions: F1 responde 403 (R1 confirmado). |
| H1 | ✅ | Medida de peso y formato hecha en H2 con el layout final: gzip + *byte shuffle*; zstd solo ahorra 5–11 % y Arrow pesa el doble (`research/h2-pipeline.md`). |
| H2 | ✅ (con matices) | Criterios cumplidos, salvo la cobertura de un coche que abandona en la fuente dev (97,5 %, sin muestras tras pararse). Sesiones de referencia: Bélgica FP1 2026 (caché saneada) y Japón 2026 carrera (fuente dev, no publicable). Pendiente: verificar las longitudes oficiales y probar los sectores de comisarios con MultiViewer en el primer build desde IP residencial. |
| H3 | ✅ (con matices) | Selector, carga en Web Worker (descarga con progreso, sha256, gunzip, TRZB, transferencia sin copias) y todos los estados con e2e. De clic a "listo" con CPU ×4: 180–400 ms y 0 *long tasks* (fixture y sesión completa de Bélgica), medido hasta la marca `trazada:ready`. **Para H11**: el montaje de la escena justo después (evaluación de three.js e inicio del renderer) es una *long task* de 260–390 ms con CPU ×4 (~65–100 ms reales). El e2e del recorrido usa **2026 → Bélgica → Libres 1** en vez de Japón → Carrera: es la única sesión real publicable disponible aquí, y el fixture se genera sin datos de MultiViewer (pendiente de permiso, §9). D4: gzip (H2). Pendiente tuyo: tiempo hasta "listo" en el portátil de referencia (lo muestra la propia página). |
| H4 | ✅ | `SessionClock` con tests (velocidades, pausa, seek, límites, tope de delta). Un bucle `rAF` es el dueño del tiempo: la escena va en modo on-demand con `invalidate`, el cabezal del timeline se mueve por `transform` y Pinia recibe el estado a 10 Hz. e2e de atajos (también con foco en input y slider), arrastre con ratón y táctil (CDP), marcadores frente a recuentos, `prefers-reduced-motion` y render tras un seek en pausa. En local, Japón da 53 marcas de vuelta para 53 vueltas. |
| H5 | ✅ (con matices) | Cinta con altura real y color por cota, bordes, línea de meta, pit lane y curvas; rotación oficial; exageración ×1–×3 con etiqueta "Estimado"; sesiones `flat` planas. Medido: curvas a < 30 m del XY de MultiViewer (Spa y Suzuka, local), pit lane a ±10 % de las muestras (e2e) y puente de Suzuka con Δz −5,84 m frente a −6,10 m en crudo (local; para lograrlo, z se suaviza con σ = 1 m en vez de 3). Captura con cámara fija y DPR 1 **solo de Spa**: Suzuka no puede entrar en un fixture publicable (fuente dev). Las referencias las genera el workflow `Snapshots` en el entorno del CI. Las etiquetas son DOM proyectado (D22). |
| H6 | ✅ | Hermite monótona por segmentos (Fritsch–Carlson) con la velocidad medida como tangente, calculada en el Web Worker. Se corta en huecos > 2 s o al cambiar de camino; las transiciones pista↔pit van en línea recta y sin dato el coche se oculta. Tests: s(t) no decrece, < 1 cm en las muestras, C1 en los nodos, cortes. Hold-out real (local, mitad de muestras): Spa p50 1,02 m / p95 7,71 m; Suzuka 1,11 / 8,31. Orden por s = `Laps.Position` en el 98,7 % de los pares (Japón, local). InstancedMesh (1 draw call) con el color del equipo y siglas en DOM que se pueden pulsar; e2e de instancias, colores y siglas frente al manifest. Los coches tienen un tamaño mínimo en pantalla (solo visual). El montaje tras "listo" va en frames posteriores; **para H11**: con CPU ×4, runtime y dock 55–82 ms, escena 320–465 ms y primeros renders 100–200 ms. |
| H7 | ✅ (con matices) | Datos solo de cronometraje real. Con torre oficial, su posición y sus gaps. Sin ella: en carrera, orden en la línea (vueltas completadas y, a igualdad, el cruce anterior) con gaps de los tiempos de paso; en libres, la mejor vuelta. Al final de cada vuelta, la posición = `Laps.Position` en 1105/1106 (Japón, local). Las "vueltas" de menos de la mitad de la mediana no cuentan como paso por meta (registros residuales de coches retirados). Neumático de la tabla de vueltas, bandera azul durante 8 s con filtro, PIT y "sin señal". Tests: motor (sintético y fixture), componente en entorno Nuxt (bandera azul, filtro, gaps) y e2e. El fixture e2e pasa a los minutos 70,5–79,5 de Bélgica FP1, que tienen amarillas por sector y la bandera a cuadros. Rendimiento: < 1 ms por actualización; ≥ 4 Hz a 20 fps o más (en CI, con WebGL por software, va a ~6 fps). **Pendiente tuyo**: medida en la máquina de referencia. |

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
- **Datos publicados**: al menos **una carrera por temporada de 2023 a 2026**. El backfill completo queda fuera de la Fase 1. El selector muestra todas las temporadas, con estado vacío donde aún no hay datos.
- **Despliegue**: CI despliega el Worker de la app y `pnpm data:deploy` el de datos.
- Un smoke post-deploy con curl comprueba `Content-Type`, `immutable` y `Access-Control-Allow-Origin` en los datos, y que un deep link `/replay?s=…` devuelve 200 y se pinta.
- Coste: 0 €.

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

- **Cloudflare**: `CLOUDFLARE_ACCOUNT_ID` y `CLOUDFLARE_API_TOKEN` (plantilla "Edit Cloudflare Workers") como secretos del repo, para la app. En tu PC, `wrangler login`, para los datos.
- **Hugging Face**: un dataset privado y un `HF_TOKEN` en tu PC.

### 9.4 Postura legal

- ¿Aceptas publicar bundles por sesión como assets, sin licencia abierta y retirables? ¿O prefieres empezar con unas pocas sesiones de demo?
- ¿Escribimos a MultiViewer para pedir permiso? ¿Apruebas el plan B si dicen que no?
- ¿Quieres leer tú las *Guidelines* y las *Legal Notices* de formula1.com, o escribir a brandprotection@f1.com?

### 9.5 Referencias de rendimiento

Tu resolución de trabajo, y qué portátil o GPU integrada usamos como referencia de "degradación digna".

### 9.6 GSAP

Lo mantengo, como pide el brief: es gratis aunque su licencia es propietaria.

### Tras tu aprobación

- Creo `CLAUDE.md` (convenciones, comandos, cómo verificar) y actualizo `BRIEF.md` con las decisiones que cambien.
- Arranco por H0.
- Cada hito termina con su verificación y un commit en la rama de trabajo.
