# Trazada: replay y análisis de carreras de F1

Vamos a construir una web app para revivir y analizar carreras de F1: circuito en 3D con todos los coches en movimiento, timeline de carrera, telemetría, coche y piloto en 3D y un mapa interactivo de incidencias con historial. El listón: animaciones 3D impecables y, a la vez, un dashboard fluido, claro y con una UX exquisita.

Este documento (`docs/BRIEF.md`) es la fuente de verdad del proyecto. Actualízalo cuando cambie una decisión.

## Coste cero (innegociable)
- Todo debe ser gratis: nada de servicios de pago, ni free tiers que pidan tarjeta, ni dependencias con licencia de pago. Si algo cuesta dinero, busca una alternativa gratuita; si no la hay, queda fuera.
- Solo librerías gratuitas (open source o de uso libre, como GSAP) y assets con licencia libre (CC0, o CC-BY con atribución) o hechos por nosotros en Blender. Mixamo vale (gratis con cuenta de Adobe). Tipografías con licencia OFL.
- Despliegue:
  - Web estática (Nuxt en modo generate) en **Cloudflare Workers Static Assets** (solo assets, gratis e ilimitado; Cloudflare lo recomienda frente a Pages para proyectos nuevos), con su subdominio gratuito. Límite free: 20.000 ficheros por Worker y 25 MiB por fichero. *(Decisión D1, 2026-10-10.)*
  - Datos preprocesados servidos **como assets de la app desde un Worker de datos propio** (`trazada-data`), sin licencia abierta y retirables; archivo de registro privado (local + dataset **privado** de Hugging Face, 100 GB gratis). No se publica un dataset público en HF por riesgo legal (términos de F1 sobre TDM/IA). *(Decisión D2, 2026-10-10.)*
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
