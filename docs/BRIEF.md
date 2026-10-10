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
