# Comprobación empírica con datos reales de 2026

Fecha: 2026-10-10. Estado: **parcial**, por bloqueo de red (ver "Limitaciones").

## Fuentes de datos usadas

El contenedor de esta sesión no llega a `livetiming.formula1.com` (de donde descarga FastF1) ni a `api.openf1.org`: el proxy de salida los bloquea. Por eso no he podido descargar la sesión directamente con FastF1. He usado dos fuentes reales de 2026, ambas derivadas del archivo oficial de live timing:

| Fuente | Qué es | Para qué sirve |
|---|---|---|
| **A. Caché de FastF1 de 2026 Belgian GP FP1**, publicada en el repo público `TracingInsights/2026` (`cache/2026/2026-07-19_Belgian_Grand_Prix/2026-07-17_Practice_1/*.ff1pkl`, commit `87be221`, 2026-10-09) | Ficheros de caché de FastF1 3.8 (`_API_CORE_VERSION=15`): `car_data` y `position_data` **tal como los parsea FastF1 desde `CarData.z`/`Position.z`, sin remuestrear**. 22 pilotos. | Frecuencia de muestreo, unidades, Z, canal DRS, freno y acelerador en crudo, tamaño. |
| **B. JSON del mismo repo para 2026 Japanese GP (carrera)** y una muestra de las 91 sesiones de 2026 | Telemetría ya fusionada por FastF1 (`get_telemetry()`: coche y posición interpolados juntos), DRS binarizado (10/12/14 → 1) y race control. | Presencia de GPS en todas las sesiones, Z por circuito, DRS en carrera, mensajes de race control reales, pit lane. |

Los ficheros `.ff1pkl` son *pickles* de Python, y un pickle de origen no confiable puede ejecutar código. Los cargué con un `Unpickler` restringido a una lista blanca exacta de clases de pandas/numpy/datetime, tras listar sin ejecutar sus referencias globales con `pickletools`.

## Resultados

### 1. Frecuencia de muestreo (fuente A, 22 coches, FP1 completa)

| Flujo | Muestras/coche | Δt mediana | Δt p5–p95 | Frecuencia media |
|---|---|---|---|---|
| Telemetría (`CarData.z`) | 17 734 | 0,240 s | 0,16–0,44 s | **3,73 Hz** |
| Posición (`Position.z`) | 18 267 | 0,240 s | 0,14–0,42 s | **3,81 Hz** |

- El "~3,7 Hz" del brief es correcto como media. El intervalo nominal es de 240 ms (FastF1 documenta 240 ms para coche y 220 ms para posición), con jitter de hasta ~0,5 s y huecos de hasta ~1,5 s.
- Los dos flujos tienen relojes distintos que no coinciden (eso ya lo dice FastF1), así que hay que tratarlos por separado.
- La columna `Time` del flujo llega agrupada (~3,7 muestras por mensaje). Hay que usar `Date` como marca por muestra; FastF1 también lo advierte.

### 2. Unidades de X/Y/Z

- Longitud recorrida en XY en las 6 vueltas más rápidas: 69 182–69 558 unidades. La distancia integrando la velocidad da 6 933–6 949 m. **Ratio 9,96–10,03, así que X/Y/Z van en decímetros (1/10 m)**, como dice FastF1 ("starting from 2020 the coordinates are given in 1/10 meter").
- Una línea central construida con una sola vuelta mide 6 955 m, frente a los 7 004 m oficiales de Spa (−0,7 %, coherente con trazar la línea de carrera y no el eje de la pista).
- El origen es arbitrario: X ∈ [−4338, 8314], Y ∈ [−15770, 4550] dm.

### 3. ¿Z trae altitud?

**Sí: Z es altitud en decímetros y es fiable.**
- En Spa, Z va de 3 655 a 4 679 dm (365–468 m), un **desnivel de 102,4 m**, que coincide con el desnivel conocido del circuito (~102 m). Es idéntico para todos los pilotos.
- Desnivel por circuito (fuente B, una vuelta por sesión, las 91 sesiones): Red Bull Ring 63,4 m · Monaco 42 m · Suzuka 40,3 m · Hungaroring 34,8 m · Barcelona 30 m · Baku 26,8 m · Madrid 24,6 m · Bahrain 21,7 m · Monza 12,5 m · Silverstone 11,2 m · Zandvoort 9 m · Shanghai 7,1 m · Singapore 5,4 m · Montreal 5,3 m · Miami 3,7 m · Albert Park 2,5 m. Todos son verosímiles y estables entre sesiones del mismo GP.
- Solo el 1 % de las muestras con XY ≠ 0 tienen Z = 0; son glitches que hay que filtrar.
- **Decisión que se deriva: la cinta 3D puede llevar elevación real**, con opción de exagerarla visualmente; si se exagera, la UI lo indica.

### 4. Precisión lateral

- Distancia de las vueltas rápidas de 21 pilotos a la polilínea de la vuelta de referencia: **p50 0,18 m, p90 0,34 m, p99 1,75 m**. En Z, p50 0,03 m.
- Las posiciones están ajustadas a una única línea (*map-matched*), así que no hay información lateral. Se confirma el "sin precisión lateral" del brief.
- **El pit lane sí aparece**: en las vueltas de entrada y salida de boxes (Japón 2026, NOR vueltas 16/17) hay decenas de muestras a 8–15,5 m de la línea, mientras que en una vuelta normal la desviación máxima es de 1,7 m. Se puede extraer una trayectoria propia de pit lane.

### 5. El canal del antiguo DRS en 2026

**No existe.** En el brief se suponía que pasaba a indicar el modo de aero activa, pero no es así.
- Fuente primaria: FastF1 `fastf1/_api.py:1022-1023` lee el canal con `Channels.get("45", 0)` y comenta `# drs is no longer included in 2026`. La 3.8.0 fallaba con KeyError al no encontrarlo y la 3.8.1 lo corrigió.
- Empírico, fuente A: **390 148 de 390 148 muestras con DRS = 0**, también por encima de 300 km/h (17 998 muestras).
- Empírico, fuente B: **0 muestras "abiertas"** (crudo 10/12/14) en toda la carrera de Japón (839 450 muestras) ni en una vuelta de cada una de las 91 sesiones de 2026.
- No hay ningún canal de Overtake Mode ni de aero activa en lo que parsean FastF1 y OpenF1.
- Terceros (consultado el 2026-10-11): nadie ha visto canales nuevos en `CarData.z` (undercut-f1 revisó los de la pretemporada; FastF1 y OpenF1 siguen leyendo solo 0, 2, 3, 4, 5 y 45), y el mantenedor de FastF1 dice que F1 ha decidido no publicar la aero activa ni el estado del ERS (2026-03-14). Tampoco hay modo adelantamiento por coche ni Boost o batería. Son informes de quienes leen el feed crudo, no un volcado propio.
- Race control sí publica el estado global en texto: `OVERTAKE ENABLED` / `OVERTAKE DISABLED` (Japón 2026). Es por pista, no por coche.

### 6. ¿Trae posiciones GPS la sesión?

**Sí, en todas las sesiones de 2026 que he podido comprobar.**
- Las 91 sesiones de 2026 del espejo (test, libres, sprint quali, sprint, quali y carrera hasta Singapur FP1/SQ) tienen telemetría con XY en una vuelta muestreada por sesión.
- En todas las carreras y sprints de 2026, vueltas 3 y 10 de cada piloto (**864 vueltas**): 863 con GPS completo. La que falta es Bahrain/BOT/10, con 3 muestras y 0 m recorridos, que parece un coche ya parado.
- Matiz: el espejo solo contiene sesiones que su pipeline pudo procesar. La afirmación del brief ("algunas sesiones de 2026 no han emitido GPS") encaja con el **feed en directo**, que desde 2025 exige autenticación de F1 TV para las posiciones. No he encontrado evidencia de huecos en el archivo estático posterior a la sesión. El pipeline validará la cobertura por sesión de todos modos.
- Dato menor: en 2026 la columna `Status` de posición vale siempre `OnTrack` (401 874/401 874), así que no sirve para detectar boxes ni garaje. Hay que usar XY = 0 y la geometría.

### 7. Otros canales (fuente A)

- **Freno**: booleano en FastF1 (en crudo 0/100). Se confirma "solo 0/100".
- **Acelerador**: 0–100, más un valor centinela **104** en el 19,5 % de las muestras. De esas, el 96,8 % tienen velocidad 0 y el 92 % rpm 0 (coche parado o motor apagado). Hay que tratar 104 como "sin dato".
- **Velocidad** 0–335 km/h, **RPM** máx. 13 486, **marcha** 0–8.
- **Neumáticos**: `SOFT`/`MEDIUM`/`HARD`/`UNKNOWN` por stint (`TimingAppData`), sin la denominación C1–C6.
- **2026 tiene 22 coches** (11 equipos, entra Cadillac), no 20. Números vistos: NOR lleva el 1, y hay pilotos nuevos como LIN (41).

### 8. Race control real (Japón 2026, carrera, 47 mensajes)

- Categorías: `Flag` 24, `Other` 21, `SafetyCar` 2. Banderas: BLUE, CLEAR, GREEN, YELLOW, DOUBLE YELLOW, BLACK AND WHITE, CHEQUERED.
- `Sector` toma valores 18–24 con textos como "YELLOW IN TRACK SECTOR 21". Son **sectores de pista (de comisarios)**, no los 3 sectores de cronometraje ni mini-sectores. Hay que contrastarlo con `marshal_sectors` de MultiViewer cuando haya red.
- Patrones de texto que necesitan parser (ejemplos literales):
  - `CAR 18 (STR) LAP DELETED - TRACK LIMITS AT TURN 13 LAP 1 14:15:19`
  - `CAR 87 (BEA) TIME 1:37.790 DELETED - TRACK LIMITS AT TURN 13 LAP 11 14:31:24`
  - `TURN 13 INCIDENT INVOLVING CARS 43 (COL) AND 87 (BEA) NOTED`
  - `FIA STEWARDS: TURN 16 INCIDENT INVOLVING CAR 44 (HAM) REVIEWED NO FURTHER INVESTIGATION - LEAVING THE TRACK AND GAINING AN ADVANTAGE`
  - `BLACK AND WHITE FLAG FOR CAR 41 (LIN) - MOVING UNDER BRAKING`
  - `WAVED BLUE FLAG FOR CAR 77 (BOT) TIMED AT 15:29:34`
  - `RECOVERY VEHICLE ON TRACK AT TURN 13`, `SAFETY CAR DEPLOYED`, `SAFETY CAR IN THIS LAP`, `LAPPED CARS MAY NOW OVERTAKE THE SAFETY CAR: 77`, `OVERTAKE ENABLED`
- Las horas que aparecen dentro del texto son **hora local del circuito**. Nunca se deben usar como reloj; FastF1 también las descarta.

### 9. Interpolación (validación del enfoque del brief con datos reales, fuente A)

Proyecté cada muestra sobre una línea central (spline periódica a 1 m), desenrollé las vueltas y obtuve la distancia acumulada `s(t)`.
- **Retrocesos** de `s` mayores de 0,5 m: el 0,06 % de los pasos (p50 3 m, máx. 29 m). Hay que forzar la monotonía en el pipeline.
- **Error a lo largo de la pista** quitando una muestra de cada dos (huecos de ~0,5 s, peor que el caso real de ~0,25 s):
  - lineal: p50 1,18 m, p95 7,6 m;
  - PCHIP: p50 1,16 m, p95 8,0 m;
  - **Hermite monótona con tangentes de la velocidad medida: p50 1,04 m, p95 7,7 m, p99 10,7 m**.
- Conclusión: la precisión la limita el ruido de las marcas de tiempo, no el método. La Hermite monótona con tangentes de velocidad se elige por **suavidad**: velocidad continua, sin "tirones" cada 0,27 s a 60 fps, y nunca retrocede.

### 10. Peso de una sesión preprocesada (datos reales, fuente A)

FP1 de Spa 2026 (80 min de flujo, 22 coches, 792 000 muestras entre coche y posición):

| Codificación | Crudo | gzip -9 | brotli 11 | zstd 19 |
|---|---|---|---|---|
| Columnar cuantizado (t u32, XYZ i16, speed/rpm u16, gear/thr/brk/drs u8) | 8,70 MB | 4,24 MB | 1,70 MB | 1,99 MB |
| **Ídem con deltas en t y XYZ** | 8,70 MB | **2,45 MB** | **1,41 MB** | 1,59 MB |
| Ídem + `s` float32 por muestra de posición | 10,31 MB | 3,33 MB | 1,97 MB | 2,43 MB |
| Arrow IPC sin comprimir (mismas columnas) | 9,51 MB | 4,25 MB | 1,68 MB | 1,97 MB |
| Arrow IPC con compresión interna zstd / lz4 | 4,80 / 5,70 MB | — | — | — |
| JSON columnar | 22,7 MB | 4,76 MB | 1,82 MB | 2,03 MB |

Extrapolación a carrera (**Estimado**). En Japón 2026 el flujo empieza ~64 min antes de la salida y la carrera dura 5 376 s.
- **Recortada** a [salida − 10 min, bandera + 5 min] (~6 300 s, ×1,31): **~11 MB en crudo, ~3,2 MB con gzip y deltas, ~1,9 MB con brotli**.
- Flujo completo (×1,94): ~17 MB en crudo, ~4,8 MB con gzip.
- Vueltas, race control, metadatos y geometría de pista añaden < 0,3 MB.

Dimensionado (**Estimado**):
- 2023–2026 suma ~530 sesiones (~24 GP × ~5,5 sesiones × 4 años), con una media de ~2,5–3,5 MB en gzip. Total: **~1,3–1,9 GB y ~3 000–4 000 ficheros** con unos 6 ficheros por sesión.
- Ningún fichero se acerca a 25 MiB.
- Solo carreras de las 4 temporadas: ~95 sesiones, ~0,3 GB.

## 11. Accesibilidad de las fuentes desde la nube (medido en GitHub Actions)

El 2026-10-10, el job `probe` del CI (runner `ubuntu-latest`, ubuntu-24.04) obtuvo estos códigos HTTP:

| Fuente | HTTP |
|---|---|
| `livetiming.formula1.com/static/2026/Index.json` (F1, la que usa FastF1) | **403** |
| `livetiming-mirror.fastf1.dev/static/2026/Index.json` (espejo de FastF1) | 404 |
| `api.openf1.org/v1/sessions?year=2026&session_type=Race` | **200** |
| `api.multiviewer.app/api/v1/circuits` | **200** |
| `api.jolpi.ca/ergast/f1/2026.json` | 200 |

**Conclusiones:**
- **R1 confirmado de primera mano**: F1 bloquea los runners de GitHub, así que la ingesta con FastF1 no puede ejecutarse en Actions.
- El espejo de FastF1 no sirve de alternativa.
- OpenF1 y MultiViewer sí responden desde la nube. Es el camino viable para automatizar la publicación de 2023 en adelante en una fase posterior (adaptador `OpenF1Source`) y para obtener los marcadores de circuito.
