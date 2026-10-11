# Trazada: replay y análisis de carreras de F1

Vamos a construir una web app para revivir y analizar carreras de F1: circuito en 3D con todos los coches en movimiento, timeline de carrera, telemetría, coche y piloto en 3D y un mapa interactivo de incidencias con historial. El listón: animaciones 3D impecables y, a la vez, un dashboard fluido, claro y con una UX exquisita.

Este documento (`docs/BRIEF.md`) es la fuente de verdad del proyecto. Actualízalo cuando cambie una decisión.

## Coste cero (innegociable)
- Todo debe ser gratis: nada de servicios de pago, ni free tiers que pidan tarjeta, ni dependencias con licencia de pago. Si algo cuesta dinero, busca una alternativa gratuita; si no la hay, queda fuera.
- Solo librerías gratuitas (open source o de uso libre, como GSAP) y assets con licencia libre (CC0, o CC-BY con atribución) o hechos por nosotros en Blender. Mixamo vale (gratis con cuenta de Adobe). Tipografías con licencia OFL.
- Despliegue:
  - Web estática (Nuxt en modo generate) en **Cloudflare Workers Static Assets** (solo assets, gratis e ilimitado; Cloudflare lo recomienda frente a Pages para proyectos nuevos), con su subdominio gratuito. Límite free: 20.000 ficheros por Worker y 25 MiB por fichero. *(Decisión D1, 2026-10-10. **En pausa por D23**: uso personal, sin despliegue público.)*
  - Datos preprocesados servidos **como assets de la app desde un Worker de datos propio** (`trazada-data`), sin licencia abierta y retirables; archivo de registro privado (local + dataset **privado** de Hugging Face, 100 GB gratis). No se publica un dataset público en HF por riesgo legal (términos de F1 sobre TDM/IA). *(Decisión D2, 2026-10-10. **En pausa por D23**: los datos no se publican.)*
  - Automatización con GitHub Actions (gratis en repos públicos) para CI y deploy de la app. **La ingesta con FastF1 se ejecuta en una IP residencial**: F1 devuelve 403 a IPs de nube. *(Decisión D5.)*
- Fuera de alcance por coste: el directo (el tiempo real de OpenF1 y el feed oficial de F1 son de pago), mapas fotorrealistas de pago y cualquier cosa que requiera comprar un juego.

## Cómo trabajamos en esta sesión
1. No escribas código todavía: investiga y preséntame un plan.
2. Valida contra fuentes primarias todo lo que digo aquí sobre APIs, datos y límites gratuitos (research-primary-sources). Si algo no cuadra, dímelo. Puedes delegar la investigación en subagentes de solo lectura, máximo 2 a la vez.
3. Descarga una carrera real de 2026 y comprueba empíricamente:
   - la frecuencia de muestreo y las unidades de X/Y/Z;
   - si Z trae altitud o viene a 0;
   - qué valores toma en 2026 el canal del antiguo DRS;
   - si la sesión trae posiciones GPS;
   - cuánto pesa una sesión preprocesada, para dimensionar el hosting gratuito.
4. Entrégame:
   - arquitectura, estructura de carpetas y esquema de datos versionado;
   - decisiones clave con las alternativas descartadas;
   - riesgos;
   - los hitos de la Fase 1, con criterios de aceptación verificables.
5. Cuando lo apruebe: crea el `CLAUDE.md` del proyecto (convenciones, comandos, cómo verificar) y avanza hito a hito, verificando cada uno antes de commitear.

## Stack
- Front: Nuxt 4 (4.5.2; la 4.6 se adoptará cuando madure) + TypeScript strict (6.0) + Node 24 + TresJS v5 (`@tresjs/nuxt`, `@tresjs/cientos`; `@tresjs/post-processing` aplazado: un único hueco de render en Tres v5, ver D10) + Pinia + GSAP.
  - TresJS v5 trae breaking changes: solo ESM, `useLoader` rehecho y `useTexture` movido a cientos. Usa la API de v5, no ejemplos antiguos.
- Datos: pipeline en Python con FastF1, y OpenF1 para metadatos y contraste.
  - Cada sesión se preprocesa a ficheros estáticos compactos (**binario propio TRZB con typed arrays**, gzip; decisión D3) más un `manifest.json` con versión de esquema.
  - Nada de JSON gigante ni de llamar a APIs en caliente desde el front.
- Monorepo simple: web + pipeline. Despliegue según "Coste cero".
- Tests: Vitest para la lógica (interpolación, parsers binarios, loaders), pytest para el pipeline (incluido el parser de race control, D9) y Playwright para smoke e2e y verificación visual (`@playwright/cli`).
- Si propones otra pieza (estilos, gráficas, gestor de paquetes…), justifícala en el plan y confirma que es gratis.

## Realidad de los datos (a validar)
- OpenF1: el histórico es gratis y sin auth desde 2023; el tiempo real es de pago (MQTT/WebSocket). FastF1 tiene telemetría desde 2018.
- Posición de cada coche a ~3,7 Hz, con origen arbitrario y sin precisión lateral dentro de la pista. *(Validado: 3,81 Hz; X/Y/Z en decímetros; Z es altitud real.)*
- Telemetría a ~3,7 Hz: velocidad, rpm, marcha, acelerador y freno (solo 0/100).
- 2026: no hay DRS. **El canal 45 ya no se emite en 2026** (FastF1 lo rellena con 0); no hay ningún canal de aero activa ni de Overtake Mode por coche. Race control publica `OVERTAKE ENABLED/DISABLED` global. *(Validado empíricamente.)*
- Race control: banderas (amarilla, doble amarilla, roja, azul…), SC/VSC, incidentes y sanciones, con vuelta y **sector de pista (comisarios)**. Mucho va en texto libre (p. ej. track limits con número de curva), así que necesita parser. Las horas del texto son locales.
- Neumáticos: compuesto, edad del set y stints.
- Info de circuito (FastF1/MultiViewer): curvas, luces y sectores de comisarios con X/Y, más la rotación del mapa. Es aproximada, pero vale para visualizar.
- No existen públicamente: desgaste de neumáticos ni estado de batería/ERS.
- ~~Algunas sesiones de 2026 no han emitido GPS.~~ No se confirma en el archivo post-sesión (91/91 sesiones de 2026 con GPS); aplica al directo autenticado. Se valida la cobertura por sesión igualmente.

## Principios
- Datos honestos: lo estimado lleva la etiqueta "Estimado" en la UI y jamás se presenta como real. No inventes datos.
- Un reloj maestro (tiempo de sesión) del que cuelga todo: mapa, timeline, leaderboard, telemetría y race control.
- Movimiento fluido a 60 fps con datos a 3,7 Hz:
  1. Proyecta cada muestra sobre la línea central para obtener la distancia recorrida.
  2. Interpola esa distancia en 1D, de forma monótona.
  3. Coloca el coche sobre la curva, orientado por la tangente.
  - El pit lane, con trayectoria propia.
- Rendimiento:
  - Un único contexto WebGL. Las futuras vistas de coche y piloto, con viewports/scissor, no con canvases nuevos.
  - Nada de datos por frame a través de la reactividad de Vue: `shallowRef`/`markRaw` y mutación directa en el loop.
  - Parseo y precálculo en Web Workers. GLB comprimidos y carga diferida.
  - Objetivo: 60 fps estables con 22 coches (2026) en mi PC (RTX 3070 Ti) y degradación digna en portátiles.
- UX:
  - Tema oscuro con design tokens.
  - Sistema de movimiento coherente (duraciones y easings definidos) y respeto a `prefers-reduced-motion`.
  - Atajos de teclado: espacio, flechas y 1–5 para la velocidad.
  - Estados de carga, vacío y error cuidados.
  - Textos vía i18n (es/en).
- Legal: proyecto no oficial.
  - Ni logos de F1 o de equipos, ni libreas, ni fotos de pilotos, ni "F1"/"Formula 1" en el nombre.
  - Identidad por color de equipo, número y siglas.
  - Disclaimer de marcas en README y footer.
- Desktop first, sin romperse en tablet.

## Fase 1: MVP replay (alcance actual)
1. Selector temporada → GP → sesión (2023–2026).
2. Pipeline parametrizable (año, GP, sesión) con caché, que genere los ficheros de una sesión.
3. Circuito 3D generado desde las coordenadas: cinta con elevación si los datos son fiables (si no, plano), curvas numeradas y rotación aplicada.
4. Todos los coches en sincronía (20 en 2023–25, 22 en 2026), con color de equipo y siglas. Coche low-poly provisional: no bloquees en arte 3D.
5. Timeline con vueltas y marcadores (banderas, SC/VSC, paradas), play/pausa, scrub y velocidades x1–x16.
6. Leaderboard sincronizado: posición, gaps, compuesto y edad del neumático.
7. Al seleccionar un coche: panel de telemetría en vivo con mini gráficas y cámara que lo sigue.
8. Race control sincronizado, con las banderas pintadas en el mapa por sector de comisarios.
9. Tests de interpolación y del parser de race control; smoke e2e de carga y reproducción.
10. Rendimiento medido y documentado: fps, memoria y peso de los datos por sesión.

## Fases siguientes (solo para que la arquitectura no las bloquee; no implementar aún)
- Mapa histórico de incidencias: heatmap por zona (salidas de pista, amarillas, track limits) agregando temporadas, más un dataset curado de momentos famosos anclados a número de curva.
- Coche 3D detallado:
  - desgaste estimado por neumático (compuesto, vueltas, degradación de ritmo);
  - energía estimada a partir de la traza de velocidad (p. ej. clipping al final de recta);
  - alerones animados según el modo de aero.
- Piloto 3D junto al coche:
  - genérico, con visera bajada, mono en colores del equipo y su número;
  - varias animaciones idle (Mixamo) con crossfade aleatorio;
  - mirando al coche seleccionado y reaccionando a eventos (vuelta rápida, abandono).
- Publicación automática: cada sesión se procesa y se despliega sola (GitHub Actions) en cuanto sus datos están disponibles gratis.

## Registro de decisiones

- **2026-10-10** — Plan de la Fase 1 aprobado ("ejecuta el plan"). Decisiones D1–D21 en `docs/PLAN.md` §6; validación de este brief en `docs/research/validacion-brief.md`; medidas en `docs/research/empirico-2026.md`. Cambios respecto a la versión original de este brief: hosting en Workers (D1), datos sin dataset público en HF (D2), TRZB (D3), ingesta local (D5), parser de race control en Python (D9), sin post-proceso en Fase 1 (D10), Node 24/TS 6 (D19), 22 coches en 2026 (D20), canal DRS inexistente en 2026.
- **2026-10-10** — Nuxt fijado en 4.5.2 (en lugar de 4.6.1, publicada el día anterior y rechazada por la protección de antigüedad mínima de pnpm; TresJS se prueba sobre 4.5.2). Plan B previsto en D19.
- **2026-10-10** — TRZB v1 (sin publicar) revisado en H2: columnas `shuffle` (bytes agrupados por posición), `s` en dm, speed/rpm en delta y coordenadas del circuito en cm con delta. Bélgica FP1 baja de 1,87 MiB a ~1,1 MiB en gzip. v1 se congela con el primer deploy de datos.
- **2026-10-10** — H3: el fixture e2e es un extracto de 9 min de Bélgica FP1 2026 (FastF1, todos los coches) generado con `trazada e2e-fixture`, sin curvas ni rotación de MultiViewer hasta tener permiso. D4 cerrado: gzip con `DecompressionStream` (zstd solo ahorraría un 5–11 % tras el *byte shuffle*).
- **2026-10-10** — H5: etiquetas en DOM proyectado (D22). `s` es longitud de arco en planta (2D) en todo el sistema. La altura de la línea central se suaviza con σ = 1 m (antes 3 m), para no aplanar puentes ni túneles.
- **2026-10-10** — H8: la telemetría del panel muestra la muestra cruda vigente, sin interpolar: la última con t ≤ reloj y menos de 2 s de antigüedad. La cámara de seguimiento sigue la posición del coche sin suavizar y suaviza solo el yaw: un muelle con aceleración tope de 6 rad/s², que es el umbral del test, y pitch fijo. Así no hay tirones a ×16.
- **2026-10-10** — H9: en `events.json`, una neutralización (SC, VSC o roja) cierra la ventana de OVERTAKE o de DRS, y solo un nuevo ENABLED la reabre. El reglamento los desactiva durante la neutralización, y en Japón 2026 race control no lo anunció. Sin geometría de sectores de comisarios, las banderas por sector se muestran solo como texto. El asa `window.__trazada` incluye `seek(ms)`, que cambia el reloj igual que el timeline pero con precisión de milisegundos.
- **2026-10-10** — H10:
  - **Estimado**: hay un registro único de campos estimados. Los del manifest son `positions`, `telemetry` y `trackStatus`; los declaran las fuentes dev. Las opciones del usuario son la exageración de altura, la separación visual y la vuelta 1, y las dos últimas están apagadas por defecto.
  - **Contraste**: `--tz-text-faint` sube a #848e9b para cumplir WCAG AA.
  - **Tablet en vertical**: los paneles van en una franja inferior y el mapa se encuadra por encima.
  - **Tokens**: tokens.css es la única fuente de colores; three.js y uPlot la leen con `token()`.
- **2026-10-10** — H11:
  - **Datos publicables**: `pnpm data:deploy` publica solo lo publicable, preparado aparte. Una sesión que use un circuito con fuentes de desarrollo queda marcada como dev. La sesión local de Bélgica tenía curvas de TracingInsights y se habría publicado; se reconstruyó sin ellas.
  - **Rendimiento**: degradación adaptativa del DPR (p95 > 33 ms) y paneles sin `backdrop-filter`.
  - **Medidas**: `?bench=1` es el instrumento de las medidas de referencia, y las cifras se recogen en `docs/PERFORMANCE.md`.
- **2026-10-10** — **D23, uso personal y privado** (respuesta a §9.4 del plan: «haz lo que sea legal; es un proyecto totalmente personal»):
  - **No se publica ningún dato.** Los datos de F1 (live timing vía FastF1) y de MultiViewer no tienen licencia de redistribución; usarlos para uno mismo sí es legal, pero publicarlos en internet sería redistribuirlos.
  - **La app se usa en local**: `pnpm local` sirve la app y los datos de `data/` en tu PC, y con `--lan` también en tu red de casa (por ejemplo, para el iPad).
  - **Sin despliegue público.** El despliegue en Cloudflare (D1/D2, `pnpm data:deploy`, workflow "Deploy app") queda en pausa: no hacen falta cuentas, y sin secretos el workflow no hace nada. Si algún día se quisiera desplegar, tendría que ser privado (con control de acceso). Por si acaso, la app ya no se puede indexar: `robots.txt` y `noindex`.
  - **MultiViewer y F1**: no hace falta pedir permiso ni escribir a F1, porque no se redistribuye nada. Las curvas y los sectores de comisarios de MultiViewer se usan como entrada del pipeline en tu PC. Se mantienen el disclaimer, la ausencia de logos y fotos y el resto de reglas.
- **2026-10-10** — **D24, despliegue privado con contraseña** (el usuario quiere verla en una URL):
  - **Dónde**: una sola Worker de Cloudflare (`trazada-privada`, plan Workers Free, sin tarjeta) que sirve la app y las sesiones publicables, y **solo con contraseña**.
  - **Cómo funciona el acceso**: cookie HttpOnly firmada con HMAC y válida 30 días; cambiar la contraseña invalida las sesiones; sin el secreto configurado no sirve nada. Todo pasa por la Worker (`run_worker_first`) y nada es indexable.
  - **Por qué no las alternativas**: Vercel cobra la protección con contraseña (Pro), y Cloudflare Access pide un método de pago incluso en el plan gratis.
  - **Legal**: sigue siendo uso personal (D23), porque no se redistribuye nada.
  - **Cómo se despliega**: desde tu PC con `pnpm deploy:private`.
- **2026-10-10** — **D25, solo local y sin Cloudflare**: el usuario prefiere usarla solo en local («que le den a Cloudflare»). Se eliminan el despliegue público (D1/D2) y el privado (D24): la Worker, los workflows, `data:deploy` y el smoke post-deploy. La app se usa con `pnpm local`. La revisión de seguridad de la Worker privada había encontrado una redirección abierta y la falta de freno a la fuerza bruta; al no desplegarse, desaparecen con el código.
- **2026-10-10** — **D26, gestor de datos en la app** (el usuario pide «botones que hagan los comandos y rellenen los datos», con los circuitos por año):
  - **Qué hace**: con `pnpm local`, la portada muestra todo el calendario de cada temporada (FastF1, `trazada schedule`) junto a lo ya generado. Cada sesión ya disputada tiene un botón «Descargar» que ejecuta `trazada build … --progress` en el PC, con progreso, errores explicados, «Reintentar» y «Cancelar». También hay descargas en bloque: lo que falta de un Gran Premio y las carreras que faltan de la temporada.
  - **Cómo**: el servidor local (`scripts/local-server.mjs`) sirve la app, `data/` y una API (`/api/schedule`, `/api/jobs`). Las descargas van en cola, de una en una. Al terminar, el pipeline actualiza `catalog.json` y la app lo relee.
  - **Seguridad**: la API solo atiende al propio PC (loopback), con el Host del servidor (contra DNS rebinding), del mismo origen y con la cabecera `X-Trazada`, que obliga a un preflight CORS que nunca se concede. Valida temporada, ronda y sesión, y lanza el pipeline sin shell y con argumentos fijos. Con `--lan`, el iPad ve la app pero no puede lanzar descargas.
  - **Calendario**: el de FastF1 y, si falla, el de F1; nunca Ergast/Jolpica. Solo nombres cortos (`EventName`).
  - **Sin el servidor local** (p. ej. `pnpm dev` o los e2e) el selector es el de siempre: solo lo generado.
- **2026-10-10** — **D27, banderas y trazados en el selector** (el usuario: «bandera del país y una imagen del trazado a la izquierda del nombre»):
  - **Banderas**: SVG de `country-flag-icons` (MIT) empaquetados con la app (unos 5 KB con gzip las 27). No se usan emoji porque en Windows (Chrome/Edge) se ven como dos letras. El `Country` de FastF1 pasa a ISO con una tabla propia; si no hay dato, no se pone bandera. El nombre del país se muestra en el idioma de la interfaz (`Intl.DisplayNames`).
  - **Trazados**: de `bacinger/f1-circuits` (GeoJSON, MIT, dibujado a mano sobre satélite), fijado a un commit. `trazada outlines` los simplifica a paths SVG de 64×64 con el norte arriba, y se versionan en `apps/web/app/assets/circuit-outlines.json` (16 KB, 6 KB con gzip) con su licencia al lado. No son datos de F1 ni de MultiViewer. Cubren todos los GP de 2018–2026. Si un evento no tiene trazado conocido, se muestra un hueco neutro, nunca otro trazado.
  - **Descartados**: los trazados de nuestros propios datos (solo existen para circuitos ya descargados), el x/y de MultiViewer (sin licencia), OSM (ODbL) y Wikimedia (CC BY-SA, con logos).
  - **GP de Baréin 2026** (disputado en Sepang): bandera de Baréin, como dice el calendario, y trazado de Sepang.
- **2026-10-10** — **D28, coche 3D genérico hecho por código** (el usuario: «¿no hacemos lo de 3D?»):
  - **Qué**: un monoplaza genérico de ~1.500 triángulos generado en `engine/car/carGeometry.ts` (sin modelos de terceros): batalla de 3,40 m, 1,90 m de ancho, halo, alerones, pontones y ruedas de 18". Carrocería del color del equipo y piezas neutras (tokens); casco gris; sin dorsales, logos, patrocinadores ni rasgos de ningún coche real.
  - **Cuándo se ve**: de lejos sigue la cuña, pulida con un sombreado sutil (techo del color exacto del equipo, laterales y trasera algo más oscuros; a escala de mapa, el detalle no se distingue); de cerca, el modelo detallado, con histéresis para que no parpadee. Siguiendo a un coche, la rueda o el pellizco acercan la cámara (de 14 a 120 m; se recuerda).
  - **Dato honesto**: el hombro del neumático lleva el color del compuesto que dice el timing (en 2018, con los colores y nombres de entonces; también en la clasificación); sin dato, gris, y también durante una parada con cambio de compuesto, desde la entrada al pit hasta la salida (no se sabe qué neumáticos lleva). Ruedas fijas: el giro no se apreciaría y la dirección no es un dato que tengamos. El flap trasero es pieza aparte por si algún día hay dato de DRS.
  - **Por qué por código y no un GLB** (D14 sigue para cualquier modelo futuro): sin licencias ni procedencia de terceros (la CC0 de Kenney solo se pudo comprobar en un espejo), proporciones actuales y halo desde el principio, colores desde tokens y cero peticiones de red.
  - **Coste**: hasta 13 draw calls y ~35.000 triángulos con todos los coches cerca (presupuesto: < 30 y < 150.000). `?car=wedge` fuerza la cuña para comparar en el bench.
- **2026-10-10** — **Auditoría de honestidad de datos, parte del pipeline**:
  - **Vueltas inventadas por FastF1** (A): se descartan las marcadas `FastF1Generated` (y `ff1G` o el patrón de 150 s en la fuente dev). Hay que regenerar los datos de carrera.
  - **OVERTAKE/DRS** (I): la última bandera a cuadros cierra la ventana; los mensajes de una sola zona no la cambian (`docs/RACE_CONTROL.md`).
  - **Avisos de calidad legibles por máquina** (K): `quality.notes` pasa a objetos `{code, text, params}` para que la UI los traduzca (v1 revisado en el sitio; las cadenas de manifests anteriores siguen siendo válidas). La meta de reserva (menos de 3 vueltas para situarla) ya no se queda en el log: se guarda en el circuito (`finishLineLaps`) y llega como `finish-line-fallback` a cada sesión que lo use.
  - **Detalles del pipeline** (N): `build` resuelve el evento solo con el calendario de FastF1 o el de F1, como `schedule` (FastF1 sin `backend` acababa en Ergast/Jolpica para el nombre, el país y la ronda). `fresh` sin compuesto conocido es «sin dato» (FastF1 lo deja en False, «usado», sin saberlo). Sin inicio de la vuelta 1 ni de la sesión, `lightsOutMs` es `null` con la nota `lights-out-unknown` (antes podía valer −1 o 0).
  - **Fixture e2e** (§8 de la auditoría): `trazada e2e-fixture` conserva, de antes de la ventana, la última fila de la torre de cada coche, las vueltas ya empezadas y los mensajes de dirección de carrera, así que la clasificación y el feed del extracto son los reales (Bélgica FP1 a los 70,5 min: VER P1 y NOR P7, no «NOR líder»; 32 mensajes en el feed a los 58:18, no 2). Las variantes fp2, fp3, q y race van marcadas `dev` y con la nota `e2e-variant`. Hay que regenerar el fixture y las capturas del README.
- **2026-10-10** — **Auditoría de honestidad, geometría (D, E, F, G)**:
  - **Pit lane**: sin maniobras lentas ni retrocesos del feed (en Spa, una muestra 15 m hacia atrás lo alargaba de ~590 a 681 m con una Z) y con la altura de la pista más cercana (el feed da la misma a todo el pit lane: escalón de 7 m en la salida). Se descartan los z = 0 por fallo del feed.
  - **Monotonía**: PAVA por tramos de un mismo camino. Lo que tendría que mover más de 5 m y las paradas que la telemetría desmiente son sin dato. En Spa, las congelaciones de más de 1,5 s con el coche a más de 40 km/h bajan de 99 a 0, y los saltos en el pit lane, de 160 a 6.
  - **Cerca del pit lane decide la geometría**: fuera de la ventana de boxes, un coche más cerca del pit lane y a más de 2 m de la línea va al pit lane (en Spa había 517 s de coches dibujados a 12 m o más de su posición, sobre la trazada, y otros 514 s de la cola del semáforo de salida, a 4-5 m, dibujados parados sobre la trazada).
  - **Circuito**: se reutiliza solo si la sesión encaja; si no, variante `-v2` y aviso (D21). Si encaja, se reconstruye en su sitio cuando es de la versión anterior de la geometría o le faltan las curvas y la sesión las trae (Spa 7-a ya no se queda sin curvas para siempre), pero nunca perdiendo las que tiene, el pit lane (una sprint sin paradas no lo trae) ni los sectores de comisarios; si la sesión no basta para construirlo, se reutiliza como antes y se avisa.
- **2026-10-10** — **Tanda 0 de las 21 funciones aprobadas (H12): andamiaje, sin cambios visibles**. Con los huecos vacíos, cada anfitrión se pinta como antes y no añade contenedores vacíos:
  - **D29, puntos de extensión para trabajar en paralelo**:
    - **Textos por namespace**: `i18n/locales/<idioma>/<ns>.json`. `base.json` lleva los textos comunes, con todas las claves de antes. Cada función añade su propio fichero, con una sola raíz que se llama como el fichero. `i18n/messages.ts` da a Nuxt la lista de ficheros y a los tests los mensajes fusionados. Una raíz repetida en dos ficheros es un error, porque @nuxtjs/i18n la fusionaría sin avisar. ESLint lee `./i18n/locales/*/*.json`.
    - **Huecos por glob**: `components/<hueco>/*.vue`, con un registro por hueco en `app/slots/<hueco>.ts`. Van separados para que cada uno viaje en el chunk de su anfitrión; así, las capas de la escena van con three.js. Cada fichero exporta su `order` (en la escena, `renderOrder`) desde un `<script lang="ts">`, y si falta, la carga falla.
    - **Los huecos y sus contratos**:
      - `scene-layers`: TzScene, dentro del grupo de la pista, con las props `model`, `flat` y `yScale`. Materiales con `fog: false` y coste publicado con `registerSceneStat`.
      - `scene-tools`: TzSceneTools, en los grupos «Capas» y «Cámara».
      - `replay-header` y `replay-overlays`: la página del replay, con el runtime ya enganchado.
      - `replay-dock`: la fila de los controles.
      - `timeline-lanes`: carriles bajo las marcas, dentro de la pista del timeline.
      - `leaderboard-cells`: con las props `row` y `preset`, y `width` y `presets` exportados. Sin dato, «—».
    - **Teclas**: `replay/keys.ts` ofrece `registerShortcut({ key, mods })` y `registerEscape(prioridad)`. Las teclas que ya usan el replay o el navegador no se pueden registrar sin modificador. `ESC_PRIORITY` es fijo: resumen 100 > pistas 90 > análisis 80 > realización automática 70 > comparación 60 > seguir 50 > selección 40. Cada Esc cierra solo lo más prioritario que esté abierto. `useReplayShortcuts` consulta el registro, y seguir y selección ya pasan por él.
    - **Escena y runtime**:
      - `registerSceneStat(nombre, getter)` publica estadísticas en `sceneStats` y en `window.__trazada.scene`. Las que traen `drawCalls`, `triangles` y `fogged` cuentan en `sceneStats.layers`. El tope de draw calls de los e2e pasa a ser 13 más lo de las capas activas, siempre por debajo de 30.
      - `rt.ext(clave, factory)` crea precálculos perezosos y memoizados, con `dispose`.
      - La opción `initialMs` fija el instante inicial.
      - `rt.setSceneHidden` deja de pedir frames a la escena mientras está tapada. El reloj y los oyentes siguen, y el gobernador no mide esos frames.
    - **Estimado**: `lapDelta`, `minisectors` y `drsZones` ya están en el registro, con su etiqueta y su explicación, para las funciones que los pintarán.
    - **e2e**: `resetStorage(page)` vacía el almacenamiento en cada carga, salvo las pistas de primer uso, que quedan como vistas.
  - **Motor compartido** (base de D31–D35; TS puro con sus tests):
    - `engine/replay/place.ts`: la colocación de ReplayModel, reutilizable por un fantasma.
    - `engine/compare/distance.ts`: `timeAtS` da el primer instante en que el coche alcanza una distancia. Dentro de un hueco o fuera de los datos da null: nunca interpola donde el replay no lo hace.
    - `engine/compare/laps.ts`: inicio de cada vuelta en tiempo y en distancia. Sin posición, NaN.
    - `engine/analysis/lapTable.ts`: índice de vueltas con su clasificación (boxes, amarilla/SC/VSC/roja, vuelta 1, sin tiempo, anulada desde el mensaje de dirección de carrera). La clasificación lo usa y su salida no cambia (comparada con hash antes y después).
    - Builders de test propios (`testing/laps.ts` y `testing/motion.ts`); `fakeTrzb` no cambia.
    - D31–D35 se registran con sus tandas.
  - **D30, iconos**: `@lucide/vue` 1.48.0 exacta, dentro del bundle y sin peticiones externas.
    - **Licencia y versión**: ISC; los iconos derivados de Feather, MIT. Se publicó el 2026-09-24, así que pasa la antigüedad mínima de pnpm.
    - **Piezas**: `design/icons.ts` es el registro semántico y el único fichero que importa Lucide. `TzIcon` es decorativo (`aria-hidden`), o `role="img"` si lleva etiqueta. `TzHint` es una pista «ⓘ» que se abre al pulsar, también en iPad, con Popover API y un panel fijo de respaldo.
    - **Regla de honestidad**: un icono nunca sustituye al texto honesto («Estimado:», «sin dato»). Nada de iconos de IA, coches, trofeos ni marcas.
    - **Test**: prohíbe el `<svg>` en línea y los glifos sueltos fuera de una lista permitida que solo puede encoger. La lista se vacía en la Tanda 5.
    - **Descartados**: `lucide-vue-next` (congelado), unplugin-icons, Shepherd (AGPL) y driver.js (no hace falta).
  - **D41, estado por navegador**: `stores/persisted.ts` lee sin fallar nunca y escribe sin lanzar nunca, con una versión de formato opcional y el almacenamiento inyectable. `settings.ts` ya lo usa, con el mismo formato de siempre. Reanudar, el diseño de paneles y las pistas vistas lo usarán en sus tandas. Cada dispositivo guarda lo suyo: no se sincroniza (D26).
  - **D42, movimiento**: nunca se anima un valor de datos.
    - **Helpers** (`design/motion.ts`): `useReducedMotion()`, `stagger()` y `listMotionAllowed(prev, next, jumped, rate, reduced)`, que solo deja animar una lista a ×4 o menos, sin salto de reloj y con pocos cambios.
    - **Con reduced motion**: duraciones, escalonado y desplazamiento a 0. La escala al pulsar queda en 1 (neutra), porque a 0 el botón desaparecería.
    - **Test**: revisa todo el CSS. Duraciones y curvas solo de tokens, sin `transition: all`, nada infinito y sin transiciones de `transform` en lo que se mueve en cada frame.
  - **D44, jerarquía visual (base)**:
    - **Tokens de densidad**: paneles, filas, cifras, tracking y una zona táctil de 44 px con puntero grueso. Con un alto de 860 px o menos, la densidad es compacta.
    - **Tokens de las funciones 1–21**: comparación, calor apto para daltónicos, cronometraje, meteorología, estelas sin tonos de bandera, ganar/perder, cielo y niebla, DRS e iconos.
    - **El color de equipo nunca es color de texto**: un test falla si aparece `var(--team)` en `color:`. El test de tokens escanea también los `.css`; el literal de `base.css` pasó a `--tz-accent-soft-hover`.
    - **`base.css`**: clases comunes (`.tz-panel`, `.tz-num`, `.tz-chip`, `.tz-segmented`, `.tz-iconbtn`…), hover solo con `(hover: hover)` y `accent-color` dentro de `.tz-panel`. En `:root` cambiaría las casillas de hoy.
    - El layout propio del replay y `100dvh` llegan en la Tanda 5.
- **2026-10-10** — **Tanda 1 de las 21 funciones aprobadas (H13): cuatro funciones visibles**. Son la clasificación animada (ítem 8), las estelas (ítem 7), la tarjeta de fin de sesión (ítem 12) y reanudar donde lo dejaste (ítem 13). Cada una entra por los huecos de la Tanda 0 (D29) con su propio namespace de textos (`rank`, `trails`, `summary`, `resume`):
  - **D42, clasificación animada (ítem 8)**:
    - **Reordenación (FLIP)**: `<TransitionGroup>` con la clase `tz-lb-move` (solo `transform`, `--tz-dur-slow`). Se usa solo con reproducción a ×4 o menos, sin salto del reloj y sin reduced motion (`listMotionAllowed`). Si no, la clase es `tz-lb-still`, sin transición: a ×8 o ×16, tras un seek o con reduced motion, la lista cambia al instante. Solo cuenta el orden de los puestos conocidos: que los «—» del final se recoloquen no es un suceso. La lista lleva `contain: layout paint`.
    - **Flechas ↑↓**: comparan dos órdenes calculados seguidos (`engine/leaderboard/changes.ts`), nunca la parrilla, que vendría de Jolpica. Un puesto nuevo solo cuenta si se mantiene 2 actualizaciones (~300 ms). La flecha dura 3 s de reloj de pared y se suma si el coche sigue ganando o perdiendo puestos. Lleva icono, cifra y un texto oculto («ganó 2 posiciones»), nunca solo el color. El destello (`--tz-gain`/`--tz-loss`, `--tz-dur-flash`) sale una vez, y solo cuando se puede animar.
    - **Honestidad**: un «—» (posición desconocida o 0) o un coche sin señal nunca gana ni pierde puestos, y pierde la flecha que tuviera. Pasar de «—» a un puesto no es adelantar. En libres y clasificación el orden es por mejor vuelta: un coche sin mejor vuelta (en clasificación, de la tanda en curso) no cuenta, y el título lo aclara («orden por mejor vuelta, no un adelantamiento en pista»).
    - **Saltos**: tras un seek, una carga o un paso en pausa, el orden nuevo es la referencia: ni flechas ni animación. Un frame cuenta como salto si el reloj retrocede o avanza más de `MAX_DELTA_MS` × velocidad.
    - **Lectores de pantalla**: un aviso `aria-live` como mucho cada 5 s, con 3 pilotos y «y N más».
    - **e2e**: en la ventana del fixture (libres con torre) el orden no cambia, así que el e2e sirve el mismo extracto como una carrera sin torre: reescribe, solo en la ruta del test, las posiciones de la torre a 0. Así el orden sale de los pasos por meta reales, que sí cambian.
  - **D45, estelas (ítem 7)**:
    - **Qué son**: los últimos 3 s de tiempo de sesión de cada coche, 32 puntos remuestreados en cada frame. Salen del mismo modelo que dibuja el coche (`sampleCar` + `placeSample`) y sin historial: la punta es el coche y la estela es correcta tras un seek o una pausa. Van sobre la línea central o el pit lane, como el coche, y con su misma pose (incluida la separación visual, si está activa).
    - **Cortes**: solo se dibuja el tramo continuo que acaba en el coche. Donde el coche no se dibuja (hueco de más de 2 s, sin dato, garaje), la estela se corta; nunca se puentea.
    - **Color**: del equipo o de la velocidad. Por velocidad, cada punto usa la última muestra cruda de hace 2 s como mucho, sin interpolar, en una escala fija de 80 a 330 km/h con `--tz-trail-*` (sin tonos de bandera). Sin muestra, gris «sin dato». La herramienta lleva leyenda y una pista ⓘ que explica qué es dato.
    - **Coste**: una sola malla para todos los coches (1 draw call; como mucho 22 × 31 × 2 triángulos), con color y opacidad por vértice que se desvanece hacia la cola. `fog: false`, sin escribir profundidad y `renderOrder` 4. Solo se calcula al renderizar, así que en pausa no hay renders. `sceneStats.trails` publica el modo, los coches, los puntos, los puntos sin muestra, las draw calls y los triángulos.
    - **Por defecto, apagadas**: «No / Equipo / Velocidad» en el menú «Capas», recordado por navegador (`trazada.trails`, D41). La escena de siempre y su captura de referencia no cambian.
  - **D40, tarjeta de fin de sesión (ítem 12)**:
    - **Fin de la sesión**: el último «Finished» del estado de sesión; si no lo hay, la última bandera a cuadros de dirección de carrera; si tampoco, el fin de los datos. Si el fin cae fuera de los datos, cuenta el fin de los datos (fuente `data-end`) y la tarjeta lo dice: «según el cronometraje al final de los datos».
    - **Cuándo aparece**: cuando el resultado está asentado, no en el instante del fin. En carrera y sprint, cuando los tres primeros han tomado la bandera (con 15 s de margen para el líder). En libres y clasificación, cuando acaban las vueltas cronometradas que empezaron antes del fin, que cuentan. Nunca después del fin de los datos. En el fin mismo, los gaps aún no serían definitivos y, en clasificación, la pole a menudo sería otra.
    - **Contenido**:
      - Los tres primeros de la clasificación del replay en ese instante, solo con posición conocida; un puesto sin coche dice «sin dato».
      - La vuelta rápida: tiempo oficial y no anulada a esa hora. La vuelta 1 nunca se estima.
      - En carrera, las paradas. Es parada si cambia el stint (o el compuesto, si no hay stint). Si no cambia, es un «paso por el pit lane sin cambio de neumáticos». Si no se sabe, sin dato. El tiempo es el del pit lane (salida − entrada), nunca el de la parada en el box, que no está en los datos.
      - Siempre «según el cronometraje al terminar; sin sanciones posteriores», porque las sanciones serían resultados de Jolpica.
    - **Comportamiento**: se abre sola solo al cruzar ese momento reproduciendo. No la abre un salto del reloj por encima, cargar la sesión ya pasada ni el bench. Es un diálogo modal con el foco atrapado; se cierra con Esc (prioridad 100, la primera del registro) o con un clic fuera. El botón «Resumen» del dock la reabre desde ese momento; al volver atrás se cierra y el botón desaparece. Entra escalonada con los tokens; con reduced motion, sin animación.
  - **D41, reanudar donde lo dejaste (ítem 13)**:
    - **Qué se guarda**: por sesión, el instante (ms de sesión, reloj maestro), el coche elegido, el seguimiento y la velocidad, en `trazada.resume` (versión 1, LRU de 20 sesiones). También lo que necesita la portada: el nombre corto del evento, la vuelta del líder y el reloj visible. Cada entrada se valida campo a campo: sin id válido, con tiempos rotos o sin reloj, se descarta; cualquier otro campo inválido pasa a un valor neutro. Una sesión repetida cuenta una vez, la más reciente.
    - **Cuándo se guarda**: cada 5 s reproduciendo (desde el estado grueso, nunca por frame), 1 s después de una pausa, un seek o un cambio de velocidad o de coche, en `pagehide` y `visibilitychange`, y al salir de la sesión.
    - **Al abrir la sesión**:
      - Arranca en pausa en lo guardado con `initialMs`, sin pintar antes el instante por defecto, y restaura velocidad, coche y seguimiento.
      - Si la sesión se reconstruyó con otro t0, el instante se corrige (t + t0 viejo − t0 nuevo) y se recorta al intervalo. Un coche que ya no está en la sesión se ignora.
      - A menos de 30 s del final, la sesión cuenta como vista y se olvida. A menos de 10 s del instante por defecto no hay nada que retomar, y lo guardado también se olvida: abrir y cerrar no deja rastro.
      - `?t=<ms de sesión>` manda sobre lo guardado, y `?bench=1` ni retoma ni guarda.
    - **Interfaz**: un aviso «Retomado en Vuelta N/M · h:mm:ss» (fuera de carrera, el reloj visible) se queda 8 s sobre el dock, sin ser modal, con «Empezar desde el principio» (instante por defecto, sin coche, a ×1, y se olvida lo guardado). En la portada, «Seguir viendo» muestra las 3 sesiones más recientes que siguen en el catálogo, con lo visto, dónde se dejó, «hace …» y una × para olvidarla. Nada es estimado: la vuelta y el reloj salen de los marcadores y del cronometraje, como en el dock. No se sincroniza entre dispositivos (D26).
  - **Integración**:
    - Los tests de los huecos por glob pasan a `tests/nuxt/slots-collect.test.ts`, en el entorno Nuxt. Cada registro evalúa su `import.meta.glob` al importarse, y en cuanto un hueco tiene un `.vue`, importarlo necesita el plugin de Vue y los alias de Nuxt.
    - `ReplayModel.tracks` pasa a ser público (solo lectura) para que las estelas muestreen las mismas pistas que los coches.
    - **Cabecera del replay en una fila**: con las estelas en línea, las herramientas de escena pasaban a una segunda fila incluso a 1440 px. La escena y la telemetría perdían 46 px de alto: a 1280×800 la última gráfica se cortaba y el encuadre de la captura de referencia cambiaba. Por eso cada grupo del hueco de herramientas («Capas», más adelante «Cámara») es un menú: un botón con su icono que despliega sus controles (`TzDisclosure` con `icon` y `tools`). Así la cabecera ocupa lo mismo por muchas capas que lleguen en las tandas siguientes. Por debajo de 1360 px, el tamaño y el tiempo de carga del chip «Listo» quedan en su título. Un Esc que ya atendió una pista ⓘ dentro del menú no lo cierra.
    - **Estelas, 1 draw call de verdad**: el material es transparente y de doble cara, y three.js lo pintaba en dos pasadas. Con `forceSinglePass` (una cinta plana no tiene caras que ordenar) el renderer cuenta 1, lo mismo que publica `sceneStats.trails`.
- **2026-10-10** — **Tanda 2 de las 21 funciones aprobadas (H14): análisis base**. Son las gráficas de carrera (ítem 3), los colores de sector (ítem 4), la vista previa del timeline (ítem 16) y las zonas de DRS (ítem 11). Cada una entra por los huecos de la Tanda 0 (D29) con su propio namespace de textos (`analysis`, `sectors`, `preview`, `drs`). No hay dependencias nuevas (uPlot ya lo era) ni cambios de esquema:
  - **D33, análisis de vueltas (ítem 3)**:
    - **Hoja de análisis**: el botón «Análisis» de la cabecera (por debajo de 1600 px, solo el icono, con su nombre accesible) abre una hoja entre la cabecera y el dock; el reproductor y el timeline siguen a mano. Es un diálogo no modal con pestañas (patrón WAI-ARIA) que se cierra con ×, con el botón o con Esc (`ESC_PRIORITY.analysis`, 80). Mientras está abierta, `rt.setSceneHidden(true)`: la escena no se redibuja.
    - **Hueco nuevo `analysis-tabs`** (`slots/analysis-tabs.ts`: `order`, `tab`, `label`, `raceOnly`), que usará el ítem 5. Todo sale del índice de vueltas de la clasificación (`rt.leaderboard.lapTable`), sin rehacerlo.
    - **Race trace** (carrera y sprint): diferencia con el primero en cada paso por meta oficial (`crossMs`, sin los registros residuales), sin corrección de combustible ni suavizado. Arriba, el primero de cada vuelta. La vuelta 1 entra por su paso por meta, aunque no tenga tiempo oficial. Un doblado puede quedar a más de una vuelta. Sin paso por meta (retirado), la serie se corta y nunca se rellena. En libres y clasificación, un estado vacío explica por qué no hay race trace.
    - **Ritmo**: tiempos oficiales por vuelta. Las vueltas que no sirven para comparar se marcan, nunca se quitan: vuelta 1, boxes, SC/VSC/roja, anulada (desde su mensaje de dirección de carrera) y sin tiempo oficial (no se dibuja, pero se cuenta). El eje es la vuelta en carrera y sprint, y la hora de la sesión en libres y clasificación. La escala encuadra las vueltas representativas, dice cuántas quedan fuera y ofrece «Ver todas». Por defecto se ven el coche elegido y los cinco primeros de la clasificación.
    - **Neumáticos**: un stint son vueltas seguidas con el mismo número de stint y el mismo compuesto; sin número de stint, también empieza uno en cada salida de boxes. Barras por compuesto (los colores de la temporada) y rayadas si el juego es usado, con las vueltas del juego (`TyreLife`) de la primera a la última y una pista que avisa de que pueden incluir otras sesiones. Compuesto desconocido, `fresh` o `tyreLife` 255: «sin dato». Pulsar un stint salta a su salida.
    - **«Sin spoilers: hasta ahora»**, activo por defecto: solo los datos hasta el reloj. Cada pestaña recalcula solo cuando el reloj cruza un instante que cambia lo que muestra.
    - **Gráficas** (uPlot): colores de los tokens y de equipo del manifest; la sigla en la leyenda (botones para mostrar u ocultar la serie) y al final de cada línea; el segundo piloto de cada equipo, discontinuo; el coche elegido, destacado. La línea del instante actual va en el DOM (moverla no redibuja la gráfica) y un clic salta al inicio de la vuelta.
  - **D34, colores de sector (ítem 4)**:
    - **Los calcula Trazada** con los tiempos de sector oficiales de la tabla de vueltas. No son las banderas del feed, que FastF1 descarta, y el título y la pista ⓘ lo dicen.
    - **Reglas**: cada tiempo recibe su color al completarse y lo conserva. Morado: estrictamente mejor que el mejor de la sesión hasta ese instante (un empate no es morado). Verde: estrictamente mejor que el mejor personal. Amarillo: el resto. −1: gris «sin dato». Solo cuentan las vueltas con paso por meta real completadas antes del reloj. Una vuelta anulada cuenta hasta el mensaje que la anula; desde entonces deja de contar y se muestra anulada, sin color de mejora. Nunca se da una «mejor vuelta posible», que sería una estimación.
    - **Instante de cada sector**, sin cambiar el esquema: S3 en el paso por meta, S2 en meta − S3 y S1 en meta − S3 − S2. Si falta un tiempo posterior, se usa la meta (cota superior).
    - **Dónde**: tres marcas en cada fila de la clasificación (hueco `leaderboard-cells`, tras el neumático) con la última vuelta completada. El color nunca va solo: el alto cambia según el estado y la marca es hueca sin dato o anulada. En el panel del coche elegido, una línea «S1 · S2 · S3» con los tiempos oficiales. El panel de la clasificación se ensancha lo que ocupan las celdas (290 → 320 px; en iPad, 250 → 278), así que las columnas fijas no ceden sitio.
    - **Coste**: precálculo perezoso (`rt.ext('sectors')`) de 1,2–1,8 ms en Japón; la consulta de los 22 coches tarda ~12 µs y no reserva memoria.
  - **D46, vista previa del timeline (ítem 16)**:
    - **Qué muestra**: al pasar el ratón, al arrastrar con el dedo o con el foco del teclado (sobre el cabezal; Esc la oculta), una tarjeta con lo que pasaba en ese instante. Lleva la vuelta del líder con las totales del manifest (fuera de carrera, el reloj visible), el primero, el estado de pista y los marcadores cercanos: banderas, entradas al pit lane e inicios de SC, VSC y roja.
    - **El primero**, por orden: (a) el P1 de la torre oficial (si dos coches lo reclaman, el mensaje más reciente); (b) sin torre, en carrera y sprint, el orden en la línea con las reglas de la clasificación (`compareAtLine`, que ahora exporta `leaderboard.ts`); (c) sin torre, fuera de carrera, la mejor vuelta válida de la tanda en curso (`compareByBestLap`). Nunca la posición en pista: un empate exacto o la falta de datos es «sin dato». En carrera y sprint se rotula «Líder»; fuera, «Mejor vuelta».
    - **Estado de pista**: un `TrackState` propio, así que el del reloj no cambia. Si es deducido (fuentes dev), lleva «Estimado».
    - **Coste**: el primero se precalcula una vez, de forma perezosa (`rt.ext`), como listas de cambios, y cada consulta es una búsqueda binaria. Como mucho una por frame de pantalla y solo al mover el puntero: nada por frame del reloj. La tarjeta solo cambia de opacidad, con los tokens de movimiento.
    - **Chips de estado de pista**: los comparten la cabecera y la tarjeta (`TzTrackStatusChips`).
  - **D38, zonas de DRS (ítem 11)**:
    - **Deducidas de la telemetría** (2018–2025) y marcadas «Estimado» (`drsZones`), porque ninguna fuente da su geometría. Empiezan algo después de la línea de activación (la reacción del piloto) y acaban donde frenan: no son las líneas oficiales.
    - **Cómo se cuentan**: abierto es `drsState` 10, 12 o 14, lo mismo que en el panel de telemetría (255 = canal ausente). Solo cuentan las pasadas limpias: en pista (sin pit lane, transición ni huecos) y fuera de SC, VSC y roja. La pista se divide en celdas de 5 m y cada pasada (coche y vuelta) cuenta una vez por celda. Una celda es de zona con ≥ 3 pasadas, ≥ 10 % de las de la celda más usada y ≥ 2 coches. Un coche con el canal atascado (abierto en más de la mitad de sus muestras) no cuenta. Los tramos separados por menos de 30 m se unen (también a través de s = 0), los de menos de 100 m se descartan y, si cubren más del 60 % de la vuelta, no hay zonas.
    - **Estados**: deducidas; «sin dato» si no bastan las aperturas o no hay canal; y en 2026 en adelante ni se calcula: «En 2026 no hay datos de zonas ni de modo adelantamiento por coche».
    - **Dónde se calcula**: en el Web Worker de carga, justo después de las tangentes (`timings.drsZonesMs`), y sus arrays se transfieren sin copia. 33–70 ms en una carrera sintética de 20 coches × 2 h; 0,4 ms en una sesión de 2026.
    - **Capa**: una malla (1 draw call, `renderOrder` 0,7, por debajo de las banderas) con el shader de anchura de mapa de la pista, `fog: false` y sin escribir profundidad. Es intensa (0,42) mientras dirección de carrera tiene el DRS activado y tenue (0,12) si no. Sin zonas o apagada, 0 draw calls.
    - **Herramienta**: «Zonas de DRS: No / Sí» en el menú «Capas» (visibles por defecto; `trazada.drs`, D41), con su leyenda, la etiqueta «Estimado» y una pista ⓘ. El menú va plegado, así que mientras se pintan la etiqueta también sale en la fila de etiquetas de la escena (`stores/sceneEstimated.ts`, que puede usar cualquier capa). Si dirección de carrera desactiva una sola zona, solo se ve en el feed: sin geometría no se sabe cuál es.
  - **Integración**:
    - **Telemetría a 1280×800**: la línea de sectores del panel del coche cortaba la segunda gráfica. Con la densidad compacta (alto ≤ 860 px), las gráficas miden 54 px en vez de 64: `--tz-chart-h`, que ahora lee `TzMiniChart`.
    - **Vista previa sobre la hoja de análisis**: la tarjeta sale del dock hacia arriba y la hoja la tapaba. El dock pasa a `--tz-z-panels` + 2, por encima de la hoja; el dock en sí no pisa el escenario.
    - **Un toque en el timeline no es foco de teclado**: Chromium marca `:focus-visible` el `focus()` que da el propio toque, y al soltar el dedo la tarjeta se quedaba sobre el cabezal.
    - **Ejes por hora del análisis con el reloj del dock**: en libres y clasificación, el ritmo y los neumáticos rotulaban la hora interna de la sesión (1:01:30 con el dock en 48:00). Ahora van en el reloj visible (`clockOrigin`), como el dock y la vista previa, con las marcas en minutos redondos del dock.
    - **La pista ⓘ de los sectores** del panel del coche va con la letra de la interfaz, no con la de las cifras.
    - **Encuadre**: la clasificación más ancha mueve el encuadre de la escena (≈ 2,8 % de los píxeles de la captura `@screenshot`, con las mismas draw calls y triángulos). Hay que regenerar la referencia con el workflow «Snapshots».
- **2026-10-10** — **Tanda 3 de las 21 funciones aprobadas (H15): comparar y escena**. Son comparar dos pilotos (ítem 1), la meteorología (ítem 6), la realización automática (ítem 9) y el ambiente de la escena (ítem 10). Cada una entra por los huecos de la Tanda 0 (D29) con su propio namespace de textos (`compare`, `weather`, `tv`, `ambience`). No hay dependencias nuevas. El esquema pasa a 1.1.0 (aditivo, `minReader` 1.0.0):
  - **D31, comparar dos pilotos (ítem 1)**:
    - **Qué se compara**: el coche elegido (A) contra otro (B), a la misma distancia dentro de la vuelta. Se elige B con Mayús+clic en la clasificación (marcas «A» y «B» con texto, nunca solo color) o con la lista del panel.
    - **Vuelta de referencia de B**: misma vuelta (por defecto en carrera y sprint), mejor vuelta (por defecto en libres y clasificación; nunca la 1 ni una anulada) o última vuelta (nunca la 1). La mejor y la última se fijan cuando A empieza su vuelta. Una referencia solo cuenta si ya había empezado (misma vuelta) o terminado (mejor y última) en el instante actual: nada sale del futuro.
    - **Diferencia en vivo**: sale de las posiciones GPS (la `s` del replay) y lleva «Estimado» (`lapDelta`). Se da en décimas, porque el inicio de vuelta cae sobre la línea del GPS con unos ±8 m. Se calcula en la última distancia que ya habían recorrido los dos: si B aún no había llegado a la de A, en la de B. Con A en el pit lane, «en boxes»; en un hueco de posición o sin referencia, «sin dato» con su motivo.
    - **Diferencia oficial**: al cerrar A su vuelta, con los tiempos de vuelta del cronometraje (`lapMs`, en milésimas). Queda pendiente hasta que B cierra su vuelta de referencia. Con los datos completos, la diferencia en vivo al cerrar la vuelta queda a una mediana de 75–83 ms de la oficial (Bélgica Libres 1 y Japón carrera, misma vuelta).
    - **Trazas por distancia**: velocidad, acelerador y freno de las muestras crudas (255 = sin dato), cortadas en los huecos, de la vuelta en curso de A hasta el reloj y de la de referencia de B (uPlot con `--tz-compare-a/b`, leyenda por sigla y el freno en dos carriles).
    - **Fantasma**: la posición real de B en su vuelta de referencia cuando llevaba el mismo tiempo de vuelta que A, colocada con las reglas de los coches (pit lane incluido) y sin separación visual. Oculto en huecos de más de 2 s, si sería el futuro o si B ya cerró la vuelta. Color `--tz-compare-b` (no el del equipo) con `--tz-ghost-opacity`, cuña o monoplaza genérico con el mismo cambio de detalle, 1 draw call, `renderOrder` 12, sin niebla, sin escribir profundidad y sin recibir clics. «Fantasma: No / Sí» se recuerda por navegador (`trazada.compare`, D41).
    - **Interfaz**: un conmutador de solo icono «Comparar» (`aria-pressed`, nombre y título) en la cabecera del panel del coche, no una fila de pestañas: a 1280×800 el panel ya va lleno (398 de 398 px). La vista «Comparar» sustituye a la rejilla en vivo y a las mini gráficas, y puede desplazarse en vertical dentro del panel. Esc con prioridad 60 vuelve a «En vivo» (el coche sigue elegido); la comparación se cierra al deseleccionar o al cambiar de sesión.
    - **Coste**: un cálculo por frame compartido por el panel y el fantasma (`rt.ext`, memoizado por frame), de unos 0,002 ms; las trazas, 0,1–0,3 ms por vuelta. Por frame solo se escribe en el DOM (`textContent`, `data-*`) y cuando cambia.
  - **D36, meteorología (ítem 6)**:
    - **Datos**: `events.weather` opcional, con las muestras del stream WeatherData (una por minuto, de la estación del circuito) del intervalo de reproducción y la vigente al empezar. `manifest.channels.weather` dice si la hay: `present` o `absent`, como el resto de canales (el plan decía `ok`; se usa el valor común). `schemaVersion` 1.1.0 con `minReader` 1.0.0: un lector 1.0.0 lo ignora y los datos 1.0.0 siguen siendo válidos.
    - **Parse crudo, sin el relleno a 0 de FastF1**: en línea, el pipeline lee el stream con `fastf1.api.fetch_page` y una clave ausente o ilegible queda en null («sin dato»); un 0 del feed es un 0 real. Desde la caché ya parseada por FastF1, un 0 exacto es sin dato y una fila toda a 0 queda entera sin dato, también la lluvia: como mucho se pierde una medida real de 0, nunca se presenta un relleno como medida. Fuera de rango, sin dato. Lluvia solo sí/no; la dirección del viento, en grados desde el norte tal cual. Sin meteorología (TracingInsights, fallo de descarga), `absent`, y la sesión se genera igual.
    - **Lectura**: el valor de un instante es la última medida con t ≤ reloj, sin interpolar, y caduca a los 150 s («sin dato»; también antes de la primera). Una sesión de antes de 1.1.0 (manifest sin el canal) dice «sin dato» y que hay que volver a descargarla.
    - **Chip de la cabecera**: por debajo de 1600 px, solo el icono (termómetro, o nube con lluvia, y «Lluvia» si llueve); desde 1600, el aire y la pista; desde 1920, también «Sin lluvia» y el viento. Lo visible está siempre al principio del nombre accesible. «Sin dato» se ve siempre como texto. El panel da aire, pista, humedad, presión, lluvia, viento, dirección con su rumbo, la antigüedad de la medida, si llovió en la sesión y la nota de honestidad. La dirección del viento va en una brújula con el norte arriba junto a la miniatura del trazado (D27, también con el norte arriba), nunca sobre el mapa 3D, que no está orientado al norte.
    - **Franja del timeline**: 3 px con la temperatura de pista (un tramo por medida, más opaco cuanto más caliente) y la lluvia encima, con la misma caducidad. No suma alto al timeline. Sin meteorología, no hay franja.
    - **Fixture**: la caché saneada de Bélgica Libres 1 trae meteorología (81 muestras, sin lluvia): el fixture lleva las 10 de su ventana. Los datos binarios no cambian, salvo la versión de la cabecera de cada TRZB (y con ella los hashes).
  - **D39, «Realización automática» (ítem 9)**:
    - **Qué elige**: en carrera y sprint con torre, el duelo más cerrado entre dos coches consecutivos de la torre, a la vista y en pista, con intervalo < 1 s (puntuación = intervalo + 0,05 s × posición, para que ganen los de delante). Esa es la única cifra que se enseña, con 3 decimales como la clasificación. En libres, clasificación y sesiones sin torre, por cercanía en pista y sin ningún número (en libres y clasificación el intervalo de la torre es de mejor vuelta, no de distancia en pista); en carrera, con la `s` acumulada, así que un doblado no está en duelo con quien lo dobla.
    - **Neutralizaciones**: en carrera, con SC o VSC, el líder de la clasificación (torre o pasos por meta, nunca el primero en pista); con roja, sin líder o fuera de carrera, la vista general. Sin duelo, el líder en carrera y la vista general en el resto.
    - **Histéresis** (reloj de pared): un plano dura ≥ 7 s y entre dos cortes cualesquiera pasan ≥ 6 s. Solo cambia si el duelo se rompe (> 1,5 s, pit, sin señal o ya no consecutivos) o hay otro < 0,7 × el actual. En pausa no corta; tras un seek elige de cero.
    - **Cámaras**: persecución detrás del de atrás mirando a la pareja; cámaras fijas por fuera de las curvas cerradas (≥ 35°, a 45 m de la línea central y 14 m de alto, ≥ 500 m entre ellas), de las curvas de MultiViewer o, sin ellas, de los picos de curvatura. Cortes secos; vuelo solo al entrar y al salir, y ninguno con reduced motion.
    - **Salir**: cualquier acción manual (tocar, arrastrar o la rueda sobre la escena, elegir o seguir un coche, Esc con prioridad 70, la tecla T o «Salir» del chip) la apaga. Arrastrar deja la cámara donde está; el resto vuelve a la vista general.
    - **Interfaz**: «No / Sí» en el menú nuevo «Cámara» de las herramientas de escena (tecla T y pista ⓘ), un botón en la cabecera solo con puntero grueso (iPad) y un chip («Sigue a PIA y NOR (P4–P5), a 0,412 s» solo con la torre; «cerca en pista» por cercanía) con aviso `aria-live` solo al cambiar de plano.
    - **Sin campos nuevos en `LeaderboardRow`**: `LeaderboardEngine.towerAt(t)` y `hasTower` dan solo la torre, sin intervalos calculados.
  - **D37, ambiente (ítem 10)**:
    - **Decorativo**: posición del sol, no el tiempo atmosférico, y la herramienta lo dice.
    - **Sol**: altura con las fórmulas de la NOAA a partir de `t0Utc` + el reloj maestro y del centro del circuito, nunca de `gmtOffset`. Los centros salen del GeoJSON de bacinger/f1-circuits (MIT; el centro de la caja del trazado, a 0,01°), que `trazada outlines` añade a `circuit-outlines.json` (`centers`), con las mismas reglas y excepciones que los trazados (D27).
    - **Fases**: día ≥ 6°, crepúsculo y noche < −6°, con mezcla continua de los tokens `--tz-sky-*`. El cielo es una esfera alrededor de la cámara con degradado por vértice (1 draw call, 992 triángulos, `renderOrder` −10, sin niebla ni tone mapping) que no pide frames: solo se recolorea al cambiar de paso de sol (0,25°).
    - **Niebla solo en la pista**: la de three.js, lineal, del 0 % en la parte más cercana de la pista al 25 % en la más lejana. Solo la usan los materiales de la pista; coches, banderas y capas declaran `fog: false` (una bandera es su significado y no debe apagarse con la distancia). Un test de legibilidad con los tokens comprueba que los bordes de la pista lejana quedan a ≥ 3:1 del fondo en todas las fases.
    - **Noche**: tono de focos en la pista, ≤ 8 %.
    - **Sin dato**: con la sede o la hora desconocidas, escena neutra (`--tz-scene-bg`) y «sin dato de ubicación» o «sin dato de hora», sin botones.
    - **Por defecto, activo**, en el menú «Capas» y recordado por navegador (`trazada.ambience`, D41).
  - **Integración**:
    - **Cabecera en una fila**: juntas, el chip de la meteorología y el menú «Cámara» partían la cabecera en dos filas a 1280 y a 1440 px, y la telemetría perdía 46 px de alto. Por debajo de 1600 px, los menús «Capas» y «Cámara» van solo con su icono, como Análisis y la meteorología; por debajo de 1360 px, «Altura» y «Separar coches» pasan a su icono. Los nombres accesibles y los títulos no cambian.
    - **e2e**: `ambience.spec.ts` ya no vacía el almacenamiento al recargar (así sí comprueba que el ambiente apagado se recuerda); «la comparación cabe a lo ancho» mide cajas y el scroll del panel, no el área táctil ampliada del botón ⓘ del borde, que sobresale a propósito; y la prueba de la clasificación a ×16 espera a que el reloj pase el adelantamiento en vez de 2 s fijos (el reloj avanza como mucho 100 ms × velocidad por frame, y con el cielo rasterizado por software y la CPU compartida los frames iban más lentos).
    - **Capturas**: el cielo cambia el fondo de la escena, así que la captura `@screenshot` se regenera con el workflow «Snapshots».
