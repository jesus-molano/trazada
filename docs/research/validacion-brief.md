# Validación del brief contra fuentes primarias

Fecha: 2026-10-10.

**Método**
- La investigación la hicieron subagentes de solo lectura (máximo 2 a la vez).
- Cada tema pasó después por una verificación adversarial: otro agente reabrió las fuentes e intentó refutar cada conclusión.
- Fuentes primarias consultadas:
  - código y documentación de FastF1 (HEAD `227cf30`, 3.9.0-dev; release 3.8.3 en PyPI);
  - código y documentación de OpenF1 (HEAD `87540e3`, 2026-09-18, más la rama `gh-pages`);
  - repos oficiales de documentación de Cloudflare (`0017e51`), Hugging Face (`aab9d7b`) y GitHub (`be38ec5`), todos del 2026-10-09;
  - repos de TresJS;
  - registros de npm y PyPI.
- **Limitación**: el contenedor no llega a las webs (formula1.com, openf1.org, developers.cloudflare.com, huggingface.co…). Lo que no está en GitHub se contrastó con búsqueda web y va marcado **(búsqueda)**, que cuenta como evidencia secundaria.
- La skill `research-primary-sources` que menciona el brief no está disponible en esta sesión; he aplicado el mismo criterio a mano.

Leyenda: ✅ confirmado · ⚠️ parcial / con matices · ❌ refutado · ❓ no verificable desde aquí.

## 1. Datos: FastF1 y archivo de live timing

| # | Afirmación | Veredicto | Hallazgo | Fuente |
|---|---|---|---|---|
| F1 | FastF1 tiene telemetría desde 2018 | ✅ | Timing, telemetría y posición desde 2018. XY en 1/10 m "a partir de 2020" según el código, pero las dimensiones de pista coinciden entre 2018 y 2025, así que la escala es la misma. | `docs/data_reference/index.rst:56-58`, `fastf1/_api.py:1114` |
| F2 | Posición a ~3,7 Hz, origen arbitrario, sin precisión lateral | ✅ | FastF1 documenta 220 ms "usually" (posición) y 240 ms (coche); OpenF1, "about 3.7 Hz". **Medido en 2026: 3,81 / 3,73 Hz**. OpenF1 confirma el origen arbitrario y la falta de detalle lateral. | `_api.py:952,1117`; OpenF1 `_api_endpoints.md:626-629`; empírico |
| F3 | Telemetría: velocidad, rpm, marcha, acelerador, freno (0/100) | ✅ | Canales `0` RPM, `2` velocidad, `3` marcha, `4` acelerador, `5` freno, `45` DRS. Freno 0/100 en crudo (OpenF1) y booleano en FastF1. **Acelerador 104 = sin dato**. | `_api.py:1017-1023`, `930-950` |
| F4 | En 2026 el canal DRS indica la aero activa | ❌ | `drs = Channels.get("45", 0)  # drs is no longer included in 2026`. La 3.8.0 fallaba sin ese canal y la 3.8.1 lo corrigió. Nada en FastF1 ni OpenF1 sobre aero activa. **Medido: 100 % ceros**. | `_api.py:1022-1023`; changelog 3.8.1 |
| F5 | Overtake Mode sin canal propio | ✅ (matiz) | No hay canal por coche en los parsers. Race control sí publica `OVERTAKE ENABLED/DISABLED` (categoría `Other`) en todas las carreras de 2026 revisadas; sustituye a `DRS ENABLED/DISABLED`. | Empírico (Japón 2026); verificación sobre AUS/CHN/MIA/NED/ITA/AZE |
| F6 | Race control: banderas, SC/VSC, incidentes, sanciones, vuelta y "mini-sector"; texto libre | ⚠️ | Campos: Time (**UTC**), Category, Message, Status, Flag, Scope, Sector, RacingNumber, Lap. **El sector es de pista/comisarios** ("TRACK SECTOR 21"); OpenF1 duda y pone "mini-sector?". **BLUE es la bandera más frecuente** (93/167 en AUS 2026) y no figura en las listas documentadas. TrackStatus: 1 libre, 2 amarilla, 4 SC, 5 roja, 6 VSC, 7 fin de VSC. Las horas del texto son locales. | `_api.py:1394-1458`; OpenF1 `_api_endpoints.md:1136-1145` |
| F7 | Neumáticos: compuesto, edad, stints | ✅ | `Compound` (SOFT…WET/UNKNOWN, sin C1–C6), `TyreLife` (cuenta vueltas de otras sesiones), `FreshTyre`, `Stint`. El feed abre un stint nuevo con cada paso por el pit lane aunque no se cambien ruedas. | `docs/api_reference/timing_data.rst:47-97` |
| F8 | Info de circuito de MultiViewer, aproximada, con rotación | ✅ | `GET api.multiviewer.app/api/v1/circuits/{key}/{year}`: corners, marshal_lights y marshal_sectors (X, Y, Number, Letter, Angle, Distance) + rotation. "Not highly accurate but sufficient for visualization". La rotación orienta al **mapa oficial**, no al norte. Sin licencia de reutilización. | `fastf1/mvapi/api.py:7-22`, `data.py:17-62` |
| F9 | Sin desgaste ni ERS públicos | ✅ | Ninguno de los dos parsers lo expone (es evidencia de ausencia, no una declaración de F1). | `_api.py:985-988`; OpenF1 endpoints |
| F10 | Algunas sesiones de 2026 no han emitido GPS | ❓ / poco probable en el archivo | No hay rastro en el changelog de FastF1. La frase coincide con documentación de terceros sobre el **feed en directo**, que exige F1 TV desde el GP de Holanda 2025. **Empírico: 91/91 sesiones de 2026 con GPS**. | (búsqueda) undercut-f1, matteocelani/f1-telemetry; empírico |
| F11 | (implícito) El archivo estático es accesible gratis | ⚠️ | Sin auth según la documentación de FastF1. **Pero F1 devuelve 403 a IPs de centros de datos** (Actions, VPS, Colab), y FastF1 solo avisa y devuelve vacío. Un pipeline público de datos de 2026 enruta su ingesta por una IP doméstica (Tailscale exit node). | `docs/api_reference/accounts_auth.rst:9-11`; (búsqueda) emsqrd/f1fantasyapp#437, Fast-F1 #916/#917; `TracingInsights/2026/.github/workflows/R.yml` |
| F12 | Caché | ✅ | Caché HTTP en SQLite (12 h) más caché de pickles parseados (`_API_CORE_VERSION=15`). Límite de cliente de **4 req/s y 500 req/h, global por proceso**. Los datos están disponibles 30–120 min tras la sesión. | `fastf1/req.py:90-117` |
| F13 | Reloj de sesión | ✅ | `SessionTime` con cero arbitrario unos minutos antes de la sesión. `t0_date` solo existe si se carga telemetría. Race control va en UTC (`Time − t0_date`). Hay que usar `Date`, no `Time`, por muestra. | `docs/data_reference/time_explanation.rst:20-115` |
| F14 | Licencia | ✅ | FastF1 es MIT (cubre el código, no los datos). Python ≥ 3.10. | `LICENSE`; PyPI |
| F15 | Gaps dentro de la vuelta | ✅ | `TimingData.stream_data` (Position, GapToLeader, IntervalToPositionAhead) solo sale por `fastf1.api.timing_data()`, que es semiprivada. | `_api.py:1779-1781` |

## 2. OpenF1

| # | Afirmación | Veredicto | Hallazgo | Fuente |
|---|---|---|---|---|
| O1 | Histórico gratis y sin auth desde 2023 | ✅ | Tier Community: gratis, sin auth, 18 endpoints, JSON/CSV, **3 req/s y 30 req/min**, uso **personal / no comercial**. El dato es "en directo" (de pago) desde 30 min antes hasta 30 min después de la sesión. | `documentation/includes/_introduction.md:5`; `gh-pages/index.html` |
| O2 | Tiempo real de pago (MQTT/WebSocket) | ✅ (incompleto) | 9,90 €/mes. Live también por REST autenticado (OAuth2, token de 1 h). La guía exige un backend. | `documentation/pages/auth.html` |
| O3 | location / car_data ~3,7 Hz | ✅ | x, y, z sin unidades documentadas (son las mismas que en FastF1). Freno 0/100. **No expone `Status` OnTrack/OffTrack**. Hay muestras (0,0,0). | `_api_endpoints.md:88-149,626-710` |
| O4 | Valores de DRS | ✅ / 2026 ❌ | Tabla "supuesta" copiada de FastF1. Sin cambios para 2026. Por el código, en 2026 `drs` = null. | `_api_endpoints.md:101-149` |
| O5 | Campos de race_control | ✅ | Incluye `qualifying_phase`. OpenF1 descarta el atributo `Status` del feed. | `_api_endpoints.md:1136-1145` |
| O6 | Endpoints útiles | ✅ | `drivers.team_colour`, `stints`, `pit` (`stop_duration` solo desde 2024), `intervals` (~4 s, solo carrera), `position` (solo en cambios), `laps` (los segmentos **no** existen en carrera), `overtakes`, `starting_grid` (bajo la clave de la quali), `championship_*`. | `_api_endpoints.md` |
| O7 | Términos y licencia | ⚠️ | "Educational, personal, research, non-commercial fan engagement". El código es **CC BY-NC-SA 4.0** (aunque el pyproject dice MIT). No se copia código, solo se consume la API. | `LICENSE`; `gh-pages/account.html` |
| O8 | Cobertura de 2026 | ❓ | Bloqueado desde aquí. Las 2026 aparecen en el calendario. | — |

## 3. Hosting y automatización (coste cero)

| # | Afirmación | Veredicto | Hallazgo | Fuente |
|---|---|---|---|---|
| H1 | Cloudflare Pages free: 20 000 ficheros, 25 MiB por fichero | ✅ | Además: 500 builds/mes, 1 build a la vez, 100 dominios, 100 proyectos. Las peticiones a estáticos son **gratis e ilimitadas**. Un proyecto de Direct Upload no se puede pasar a Git después. ¿Tarjeta? La documentación técnica no lo dice; la página de planes dice "no credit card required" **(búsqueda)**. | `cloudflare-docs/src/content/docs/pages/platform/limits.mdx:23-46` |
| H2 | (implícito) Pages es la opción recomendada | ⚠️ | Pages no está deprecado, pero la documentación dice: "Start new projects with Workers". Workers Static Assets tiene los mismos límites y estáticos gratis e ilimitados. **Trampas**: `run_worker_first` (429 a partir de 100 000/día) y Workers Caching (se factura). | partial `pages/workers-for-new-projects.mdx`; `workers/static-assets` |
| H3 | (implícito) El CDN comprime los datos | ❌ | Solo comprime una lista de tipos; **ni `application/octet-stream` ni Arrow están en ella**. Las Compression Rules exigen un dominio propio. Los Range devuelven **200**. `_headers` permite fijar `Content-Type` y `Cache-Control`. En Workers Static Assets, una extensión desconocida se sirve **sin Content-Type** y sin `Access-Control-Allow-Origin`; hay que fijarlos en `_headers`. Los deploys suben solo lo cambiado si se subió hace poco (tras un parón largo se resube todo). | `speed/optimization/content/compression.mdx:34-160`; `pages/.../headers` |
| H4 | HF: almacenamiento público gratis | ⚠️ | Público "best-effort" ("beyond the first few gigabytes, use responsibly"), 10 000 ficheros por carpeta, recomendado < 100 000 por repo. **Anónimo: 3 000 resolves cada 5 min por IP** (solo cuentan las URLs `/resolve/`). Pide dataset card y que sea reutilizable. El historial git crece con cada regeneración (`super_squash_history`); las **Storage Buckets** no versionan. CORS y Range por el puente Xet: según `huggingface/datasets#7931` se arreglaron en el backend el 2026-02-24, pero no está documentado y hay que probarlo. ¿Tarjeta? No se pide para la cuenta free (no lo dice explícitamente). | `hub-docs/docs/hub/storage-limits.md`, `storage-buckets.md`, `rate-limits.md`; (búsqueda) issue #7931 |
| H5 | GitHub Actions gratis en repos públicos | ✅ | Runners estándar ilimitados (4 CPU, 16 GB, 6 h por job), 20 jobs concurrentes, caché de 10 GB (desalojo a los 7 días). **El cron se desactiva tras 60 días sin actividad.** | `github/docs/content/billing/...`, `data/reusables/actions/...` |
| H6 | Otras trampas | — | GitHub Pages: 1 GB de sitio y 100 GB/mes. **LFS: 10 GiB/mes de descarga y luego se bloquea.** Workers Paid cuesta 5 $/mes (no hace falta). R2 podría pedir tarjeta. | `github/docs/.../github-pages-limits.md`; `large_files.yml` |

## 4. Stack del front

| # | Afirmación / pregunta | Veredicto | Hallazgo | Fuente |
|---|---|---|---|---|
| S1 | Nuxt 4 (última estable) | ✅ | `latest` = **4.6.1** (2026-10-09); no hay 5.x estable (estimada para el T4 de 2026, y la 4.x tendrá soporte 6 meses más). **Exige Node `^22.22.3 \|\| ^24.15 \|\| >=26`**; el entorno tiene 22.22.0. `nuxt generate` = build + prerender y emite `200.html`/`404.html`. La 4.6 es muy reciente (salió el 2026-10-05) y TresJS la prueba sobre 4.5.2; si la 4.6 diera problemas, la 4.5.2 es el plan B. | npm; `nuxt/nuxt@4.x/docs/1.getting-started/15.prerendering.md`, `18.upgrade.md` |
| S2 | TresJS v5: solo ESM, `useLoader` rehecho, `useTexture` en cientos | ✅ | Las tres cosas, confirmadas en la guía de migración y el CHANGELOG (v5.0.0 salió el 2025-09-20). `useLoader` devuelve `{state, isLoading, isReady, error, execute, load, progress}`, con `state` *shallow* por defecto (la documentación dice lo contrario) y basado en `useAsyncState` de VueUse. `useLoop()` da `onBeforeRender`, `onRender` y `render`. Se eliminaron `useRenderLoop`, `useSeek`, `useRaycaster`, `useCamera` y `useTresReady`. Eventos de puntero nativos, solo el primer impacto. | `tres/apps/docs/content/1.getting-started/4.upgrade-guide.md`; `packages/core/src/composables/*` |
| S3 | Multi-viewport en un solo contexto | ✅ (con trampas) | `useLoop().render(fn)` = `replaceRenderFunction`, así que `setViewport`/`setScissor` sobre el renderer crudo son viables. **Hay un único hueco**: los composers de post-proceso lo pisan y no lo restauran al desmontarse. El aspect de cámara hay que reaplicarlo en cada frame. `<Html>` y el puntero no entienden viewports. | `useLoop/index.ts:27`; `useRendererManager.ts:332-349` |
| S4 | `@tresjs/nuxt` v5 + Nuxt 4 | ✅ | `@tresjs/nuxt` 5.7.3 fija `@tresjs/core` **exactamente** a 5.9.3. TresCanvas es solo de cliente, con un `<span/>` en el servidor. Registra como componentes globales todos los exports en PascalCase (`Grid`, `Image`, `Html`…), lo que puede chocar con componentes propios, así que los nuestros llevarán prefijo. Tiene una dependencia fantasma de `@nuxt/devtools-kit`. | `tres/packages/nuxt/src/module.ts` |
| S5 | cientos v5 | ⚠️ | `useGLTF` carga Draco **desde el CDN gstatic** por defecto y **no soporta Meshopt**; además usa three-stdlib. No hay `<Text>` de troika (solo `Text3D`). Sí hay `<Instances>`, `<Html>`, `CameraControls`, `OrbitControls`, `<Line2>` y `<CatmullRomCurve3>`. | `cientos/src/core/loaders/useGLTF/index.ts` |
| S6 | `@tresjs/post-processing` | ✅ | Dos backends, pmndrs y three, con un `EffectPass` por efecto. `enabled=false` **deja de pintar** en vez de volver al render normal. `postprocessing` declara `three < 0.187`. | `tres/packages/postprocessing/...` |
| S7 | Pinia, i18n | ✅ | `pinia` 4.0.3 + `@pinia/nuxt` 1.0.2 (compatibles con Nuxt `^4`), `@nuxtjs/i18n` 10.6.0. | npm; módulo `pinia/packages/nuxt` |
| S8 | GSAP gratis | ✅ (no OSI) | "Standard no-charge license": gratis incluidos los plugins y para uso comercial. **Prohibido** solo en herramientas no-code que compitan con Webflow. Es propietaria, revocable y modificable, y el tarball no incluye el texto de la licencia. | npm `gsap@3.15.0`; espejo de scancode `gsap-standard-no-charge-2025` |
| S9 | Vitest, Playwright, "playwright-cli" | ✅ | `vitest` 5.0.3 + `@nuxt/test-utils` 4.3.3 en rango oficial. `@playwright/test` 1.64.0. **El "playwright-cli" oficial es `@playwright/cli`** (Microsoft, para agentes); el paquete `playwright-cli` está deprecado. | npm |
| S10 | Gráficas | — | uPlot 1.6.32 (MIT, ~22 KB gz, 60 fps documentados, sin releases desde 2025-03). ECharts ~1,1 MB, Chart.js ~208 KB. | npm; README de uPlot |
| S11 | Web Workers con Vite 8 (rolldown) | ✅ | `new Worker(new URL(...), {type:'module'})` es la forma recomendada. Comlink 4.4.2 está inactivo desde 2024. | `vitejs/vite/docs/guide/features.md` |
| S12 | Tipografías OFL | ✅ | `@fontsource(-variable)/inter`, `jetbrains-mono`, `ibm-plex-*` y `titillium-web`: todas OFL-1.1 y autoalojables. `@nuxt/fonts` descarga del proveedor en el build salvo con los proveedores `npm` o `local`. | npm; `nuxt/fonts` docs |
| — | TypeScript | ⚠️ | `latest` = **7.0.2 (compilador nativo)**; la 6.0.3 es la última en JS. `vue-tsc` pide `>=5.0`, pero no está claro que funcione con la 7. | npm |

## 5. Formatos binarios y navegador

| # | Pregunta | Hallazgo | Fuente |
|---|---|---|---|
| D1 | ¿Lee `apache-arrow` JS IPC comprimido? | **Sí, desde 21.1**, pero con un registro de códecs **síncronos** que no incluye ninguno; sin códec lanza "codec not found". El bundle completo ronda 48–51 KB gz. | `apache/arrow-js/src/ipc/reader.ts`; tarball 21.2.0 |
| D2 | pyarrow | 26.0.0 (Python ≥ 3.11). `write_feather` comprime con **LZ4 por defecto**, cuidado. | `pyarrow/feather.py`, `ipc.pxi` |
| D3 | `DecompressionStream` | gzip/deflate en Chrome/Edge 80, Firefox 113 y Safari 16.4. **brotli**: Firefox 147 y Safari 18.4, no Chrome. **zstd**: solo Firefox 138 tras un flag. | `mdn/browser-compat-data/api/DecompressionStream.json`; `whatwg/compression` |
| D4 | Transferibles / SharedArrayBuffer | Transferir un `ArrayBuffer` no copia memoria. SAB exige COOP/COEP (Safari sin `credentialless`), y no hace falta. | MDN |
| D5 | Streaming y Range | `Response.body` es universal. **Pages devuelve 200 a Range**, y Workers Static Assets no tiene ruta para 206. Las Range sin sufijo no tienen preflight y `Content-Range` necesita `Expose-Headers`. | `cloudflare-docs/.../serving-pages.mdx:47-49`; `whatwg/fetch` |
| D6 | Alternativas | parquet-wasm ~1,67 MB gz (mínimo 456 KB br). hyparquet ~44 KB gz. MessagePack sin typed arrays alineados. FlatBuffers requiere codegen. **Binario propio con typed arrays: 0 KB** (alinear a 8 y little-endian explícito). | tarballs de npm |
| D7 | GLB | three r186 soporta `EXT_`/`KHR_meshopt_compression` y Draco. Decoder Meshopt: **7,7 KB gz**; Draco: ~75 KB gz. gltf-transform es MIT. Cloudflare no comprime `model/gltf-binary`. | `three.js/r186/.../GLTFLoader.js`; tarball de three |
| — | Alternativa de compresión | **fzstd** (MIT, ~3,9 KB gz, JS puro): zstd -19 da 1,59 MB frente a 2,45 MB con gzip (−35 %). Hay que medir el tiempo de descompresión. | npm |

## 6. Legal y licencias

> Las páginas de formula1.com, Adobe y Hugging Face (términos) están bloqueadas desde aquí. Lo marcado **(búsqueda)** es evidencia secundaria y hay que leerlo directamente. Esto no es asesoramiento jurídico.

| # | Pregunta | Hallazgo | Fuente |
|---|---|---|---|
| L1 | Marcas de F1 y uso por fans | F1, FORMULA ONE, FORMULA 1, FIA FORMULA ONE WORLD CHAMPIONSHIP, GRAND PRIX y marcas relacionadas son de Formula One Licensing B.V. Las *Guidelines* permiten a fans y medios usar palabras y títulos de evento para **informar, no para marcar**, sin sugerir afiliación ni actuar de forma "materialmente comercial". Los logos, nunca. Disclaimer recomendado en el footer. Precedente: aviso a la app Box Box Club por "F1" en el nombre, la tipografía oficial y fotos. **Contacto: brandprotection@f1.com.** F1 no cede derechos de equipos ni de pilotos (remite a ellos). La ubicación exacta del disclaimer no está confirmada. | FastF1 `README.md:71-74`; OpenF1 `_introduction.md:10`; (búsqueda) formula1.com Guidelines y corp contact |
| L2 | Derechos sobre el timing | (búsqueda) Las *Legal Notices* protegen el live timing y los datos históricos, para uso personal y no comercial; republicar requiere consentimiento escrito. Las *Guidelines* permiten uso incidental editorial, no reproducir "partes sustanciales", y **prohíben TDM/IA sin licencia**. FastF1 y OpenF1 no conceden derechos sobre los datos. El Apache-2.0 de TracingInsights no puede licenciar datos ajenos. No he encontrado retiradas contra repos de timing (búsqueda no concluyente). | (búsqueda) formula1.com Legal Notices y Guidelines; FastF1 changelog v3.7 |
| L3 | MultiViewer | Sin términos públicos. Los datos están "hechos a mano" y se los "cedieron a FastF1". | `fastf1/mvapi/data.py:36-38`; changelog v3.1 |
| L4 | Mixamo | (búsqueda) Royalty-free en proyectos; **no** se permite distribuir los ficheros crudos (posts del staff de Adobe). Riesgo: un GLB público es descargable. | (búsqueda) helpx.adobe.com Mixamo FAQ |
| L5 | Hugging Face | Cualquier repo se puede denunciar. Hay DMCA a `dmca@huggingface.co` con desactivación del contenido. Se admite `license: other`. | `hub-docs/docs/hub/moderation.md`, `repositories-licenses.md`; (búsqueda) content policy |
| L6 | Nombres, siglas, números, colores | Sin norma primaria. Riesgo bajo si el uso es factual y no comercial. Matices verificados: (1) Haas v. Steiner fue desestimado en 2024 (uso editorial de marcas de equipo); (2) **Verstappen/Picnic, Hoge Raad 2022**: un parecido puede ser retrato si el contexto lo hace reconocible, lo que importa para el piloto 3D de la Fase 3; (3) Milán: la "apariencia de conjunto" de los coches de Ferrari es protegible frente a juguetes, así que nada de libreas; (4) FastF1 trae `HeadshotUrl` y hay que descartarlo. | (búsqueda) Hoge Raad ECLI:NL:HR:2022:621; WTR; `fastf1/_api.py:1537-1540` |
| L7 | Fuentes OFL autoalojadas | ✅ Explícitamente permitido (OFL-FAQ 2.1). Hay que acompañarlas de su `OFL.txt`. Inter no tiene RFN. **No usar la tipografía oficial de F1.** | `google/fonts/ofl/inter/OFL.txt`; OFL-FAQ |
| — | Jolpica | FastF1 trae resultados y el tiempo de la vuelta 1 de carrera desde Jolpica, que es **CC BY-NC-SA 4.0**. | FastF1 `fastf1/ergast/interface.py:35` (`BASE_URL = "https://api.jolpi.ca/ergast/f1"`); licencia de Jolpica (búsqueda) |
| — | OpenF1 | El código es CC BY-NC-SA 4.0 (el pyproject dice MIT, contradictorio). La API es para uso personal y no comercial. | `openf1/LICENSE` |

**Conclusiones:**
- No hay dataset público en HF.
- Los datos se sirven como assets de la app desde un Worker separado, sin licencia abierta y retirables.
- No se publican campos de Jolpica.
- Pedir permiso a MultiViewer.
- Disclaimer oficial en el footer y el README.
- Se muestra el `EventName` corto.
- Ninguna IA sobre datos de F1.
- No se suben ficheros crudos de Mixamo al repo.
