# Formato de datos de Trazada (esquema v1)

La fuente normativa está en `packages/schema/`:
- `version.json`: `schemaVersion`, `minReader`, `containerVersion`
- `trzb/*.layout.json`: layouts binarios
- `trzb/enums.json`: enumeraciones
- `*.schema.json`: JSON Schemas de manifest, catálogo y eventos

Este documento los explica. Si discrepa de ellos, mandan los ficheros.

## Rutas

Se sirven en local desde `data/` (D25: no hay despliegue), montado en `/data` (`${dataBaseUrl}`), tanto con `pnpm local` como con `pnpm dev`.

```
/v1/catalog.json
/v1/circuits/{circuitKey}-{layoutId}/circuit.{hash8}.trzb.gz
/v1/sessions/{season}/{round:02d}-{slug}/{session}/manifest.json
/v1/sessions/{season}/{round:02d}-{slug}/{session}/{motion|car|timing}.{hash8}.trzb.gz
/v1/sessions/{season}/{round:02d}-{slug}/{session}/events.{hash8}.json.gz
```

- `session ∈ {fp1, fp2, fp3, sq, sprint, q, race}`.
- Las rutas de `files` en el manifest son relativas al propio manifest.
- Los ficheros con hash son inmutables: si el contenido cambia, cambia el nombre. El servidor local los sirve, como todo lo demás, sin caché (`Cache-Control: no-store`), así que una sesión que se vuelve a descargar se ve al recargar.

## Versionado

| Eje | Regla |
|---|---|
| `schemaVersion` | **Major**: el cambio es incompatible y el major forma parte de la ruta (`/v1/`). **Minor**: solo se añaden tablas o columnas, y los lectores ignoran lo que no conocen. **Patch**: corrige datos sin cambiar la estructura. |
| `revision` de cada layout | Sube con cualquier cambio. `layouts.lock.json` guarda el hash de cada layout: si un layout cambia sin subir `revision` y `schemaVersion`, el test falla. Se regenera con `pnpm --filter @trazada/schema lock:update`. |
| `containerVersion` | Solo cambia junto a un major. |
| `minReader` | Versión mínima del lector capaz de leer la sesión. Si el lector es más antiguo, la app muestra "versión no soportada". |

## Contenedor TRZB

Formato binario, little-endian:

```
offset 0   "TRZB"                 (4 bytes)
offset 4   u16 containerVersion   (= 1)
offset 6   u16 flags              (= 0)
offset 8   u32 headerLen
offset 12  header JSON UTF-8      (headerLen bytes)
           relleno con ceros hasta múltiplo de 8 → inicio de la sección de datos
           columnas: cada una empieza en un múltiplo de 8 (byteOffset relativo a la sección de datos)
```

Cabecera:

```json
{ "layout": "motion", "revision": 1, "schemaVersion": "1.0.0",
  "tables": [ { "name": "pos", "rows": 123,
                "columns": [ { "name": "t", "type": "i32", "encoding": "delta", "shuffle": true,
                               "unit": "ms", "decode": "f64", "byteOffset": 0, "byteLength": 492 } ] } ],
  "meta": { } }
```

- **Tipos**: `u8 i8 u16 i16 u32 i32 f32 f64`.
- **`encoding: delta`**: se guarda `v[i] − v[i−1]`, con `v[−1] = 0`, a lo largo de toda la columna, aunque cruce coches. El lector reconstruye la serie con una suma acumulada.
- **`shuffle: true`**: los bytes de la columna (ya en el tipo del disco y tras el delta) se guardan agrupados por posición: primero el byte 0 de todos los valores, luego el byte 1, etc. Así, gzip comprime mucho mejor los enteros pequeños de los deltas. Medido en Bélgica FP1 2026: `t` de `car` pasa de 231 KB a 19 KB. El lector reordena los bytes antes de decodificar, así que la columna deja de ser una vista sin copia.
- **Cuantización**: el valor físico es `raw × scale + offset`. Por ejemplo, `s` se guarda en dm y se lee en m.
- **`s` (distancia a lo largo de la pista)** es siempre longitud de arco **en planta (2D)** sobre la línea central canónica, en el pipeline y en el front. La altitud se interpola, pero no suma distancia.
- **`decode`**: tipo de destino en memoria (`f64` para tiempos y distancias, porque Float32 perdería precisión con s > 167 km o t > 4,6 h).
- Las columnas sin `delta`, `scale` ni `shuffle` se exponen como **vistas sin copia** sobre el buffer.
- **Compresión externa**: la indica el manifest (`gzip` por defecto, determinista con `mtime = 0`; `zstd` es opcional). En el navegador se descomprime con `DecompressionStream`.

## Layouts v1

| Layout | Tabla | Columnas |
|---|---|---|
| `motion` | `cars` | car, start, count |
| | `pos` | t (i32 ms, delta+shuffle → f64) · path (0 pista, 1 pit, 2 sin dato) · s (i32 dm, delta+shuffle → f64 m) · projErr (u8 dm) |
| `car` | `cars` | car, start, count |
| | `tel` | t (i32 ms, delta+shuffle → f64) · speed (i16 km/h, delta+shuffle → f32) · rpm (ídem) · gear · throttle (255 = sin dato) · brake (0/1) · drs (255 = canal ausente) |
| `circuit` | `centerline` | x, y, z (i32 cm, delta+shuffle → f32 m; paso fijo de 1 m; orientación del mapa oficial, centrado) |
| | `pitlane` | x, y, z (ídem) |
| | `corners` | number, letter (ASCII), s, x, y, angle |
| | `marshalSectors` | number, sStart, sEnd. Sector n = [s(marcador n), s(marcador n+1)), con envoltura en s = 0 |
| `timing` | `laps` | car, lap, startMs, endMs, lapMs, s1/s2/s3Ms (−1 = sin dato), compound (enum), tyreLife, fresh, stint, pitInMs, pitOutMs, position, trackStatusMask, deleted |
| | `stream` | t, car, position, gapToLeaderMs, intervalMs (−1 = líder o sin dato), lapsBehind |
| | `trackStatus` | t, code (1, 2, 4, 5, 6, 7) |
| | `sessionStatus` | t, status (enum) |

**Valores centinela**:
- −1 en columnas `i32` de tiempo;
- 255 en `u8` para "sin dato";
- 0 en `position` cuando no aplica.

**Circuito y movimiento**:
- `motion.pos.path = 2` (sin dato) marca también las posiciones que el feed da mal: las que la monotonía tendría que mover más de 5 m y las paradas que la telemetría desmiente (posición congelada o corregida hacia atrás con el coche a más de 30 km/h). Su `s` vale 0 y no se usa.
- `circuit.pitlane.z` es la altura de la pista más cercana, no la del feed (que da la misma a todo el pit lane).
- El `meta` del circuito lleva `geometryVersion`, la versión de su construcción. Un circuito sin el campo es de la versión 1.
- Un trazado puede tener variantes `{circuitKey}-{layoutId}-v2`, `-v3`…: se crean cuando una sesión no encaja en el circuito guardado (D21).

## Eventos (JSON, `events.schema.json`)

- `raceControl[]`: todos los mensajes, con `t` en tiempo de sesión (ms) y el **texto original sin modificar**. `parsed` añade `kind`, `cars`, `turn`, `lap`, `outcome`, `s` y `marshalSector`.
- `sectorFlags[]`: estado ya resuelto de las banderas por sector de pista, listo para pintar el mapa.
- `windows[]`: intervalos de SC, VSC, roja, amarilla, overtake (2026) y DRS (2023–25).
- `weather` (desde 1.1.0, opcional; D36): meteorología del live timing (stream `WeatherData`, una muestra por minuto de la estación del circuito), en columnas del mismo largo:

  | Columna | Qué es | Tipo |
  |---|---|---|
  | `t` | instante de la muestra (ms de sesión), creciente | entero |
  | `airC`, `trackC` | temperatura del aire y de la pista (°C) | número o `null` |
  | `humidity` | humedad relativa (%, 0–100) | número o `null` |
  | `pressureHpa` | presión (hPa = mbar, > 0) | número o `null` |
  | `rain` | lluvia sí/no (`Rainfall`): **nunca intensidad ni mm** | booleano o `null` |
  | `windMs` | velocidad del viento (m/s, ≥ 0) | número o `null` |
  | `windDeg` | dirección del viento: grados desde el norte (0–359), como la da el feed | entero o `null` |

  - `null` es **sin dato**: la clave faltaba o no se podía leer. FastF1 (`fastf1.api.weather_data`) rellena esos huecos con 0 (y la lluvia con `false`), así que el pipeline no usa su parseo: online lee el stream crudo (`fastf1.api.fetch_page`), y un 0 que manda el feed es un 0 real. Offline, con una caché ya parseada por FastF1, un 0 exacto se trata como sin dato (es el relleno) y una fila toda a 0 queda entera sin dato, también la lluvia.
  - Cada mensaje del stream es una muestra completa: lo que no trae no se arrastra de la anterior.
  - Solo las muestras del intervalo de reproducción y, delante, la última anterior a su inicio (la vigente al empezar).
  - El lector **no interpola**: muestra el último valor con `t ≤ reloj` y, si tiene más de 150 s (o no hay ninguno), «sin dato».
  - La dirección del viento es respecto al norte: el mapa 3D usa la orientación del mapa oficial, no el norte, así que nunca se dibuja sobre él (solo junto a una referencia orientada al norte).

## Manifest y catálogo

Ver `manifest.schema.json` y `catalog.schema.json`, y los ejemplos de `packages/schema/examples/`.

- Una sesión `no-position` aparece en el catálogo como no disponible.
- `channels.weather` (desde 1.1.0): `present` si `events.weather` trae alguna muestra, `absent` si la fuente no la da (p. ej. TracingInsights o un fallo de descarga). Un manifest sin el campo es de un pipeline anterior: no se sabe si había meteorología, y la app propone volver a descargar la sesión.
- `quality.estimated`: lo que la fuente no da y se ha derivado. El front lo pinta con la etiqueta "Estimado". Vocabulario: `positions` (posiciones reconstruidas), `telemetry` (telemetría reconstruida) y `trackStatus` (estado de pista deducido de race control). Un lector más antiguo muestra un valor desconocido con su nombre, también como Estimado.
- Una sesión con `dev: true` es de desarrollo (fuente secundaria) y **no se publica**.
- `quality.notes`: avisos del pipeline al procesar la sesión. El front los muestra en la cabecera del replay (`apps/web/app/data/quality-notes.ts`) y nunca los esconde. El pipeline escribe objetos `{code, text, params?}`: `code` es estable y la UI lo traduce con `params`; `text` es el mismo aviso en español, para el log y para quien lea el JSON, y la UI solo lo enseña si no conoce el código (ver abajo). Un manifest anterior puede traer cadenas sueltas (texto libre, sin código): la UI traduce las que reconoce por patrón (textos antiguos, congelados) y de las demás enseña el texto original. Códigos:

  | `code` | Qué significa | `params` |
  |---|---|---|
  | `finish-line-fallback` | Línea de meta aproximada: menos de 3 inicios de vuelta servían para situarla y se usa la primera muestra de la vuelta de referencia. Va con el circuito: la llevan todas las sesiones que lo reutilizan (en el circuito, `quality.finishLineLaps`). | `laps` |
  | `no-corners` | Circuito sin curvas ni rotación oficial (MultiViewer no estaba accesible). | — |
  | `centerline-not-closed` | La línea central no cierra (> 2 m). | `closureM` |
  | `length-vs-official` | Longitud a más de un 3 % de la oficial. | `lengthM`, `officialM` |
  | `position-coverage-low` | Cobertura de posición < 99 % en algún piloto. | `cars`, `minPos` |
  | `lights-out-unknown` | Carrera o sprint sin hora de salida (ni inicio de la vuelta 1 ni de la sesión): `playback.lightsOutMs` es `null` y no se estima la vuelta 1. | — |
  | `dev-circuit` | El circuito usa fuentes de desarrollo: la sesión queda como dev. | `circuit` |
  | `dev-source`, `merged-telemetry`, `track-status-from-race-control` | Fuente de desarrollo (TracingInsights) y sus limitaciones. | — |
  | `dev-corners` | Curvas y rotación de una copia de desarrollo de MultiViewer. | — |
  | `e2e-extract` | Extracto recortado del fixture e2e (`trazada e2e-fixture`). | — |
  | `e2e-variant` | Variante del fixture e2e inventada para probar un estado (no disponible, versión, fichero corrupto): no es una sesión real. | — |
  | `circuit-fit-unchecked` | No se pudo comprobar que la sesión encaja en el circuito guardado (pocas vueltas limpias): se reutiliza sin comprobar. | `circuit`, `laps` |
  | `circuit-variant-used` | La sesión no encaja en el circuito base del trazado y se usa una variante suya ya guardada. | `circuit`, `base` |
  | `circuit-layout-changed` | La sesión no encaja en ningún circuito guardado del trazado: se construye una variante nueva (¿cambió el trazado?). | `circuit`, `base` |
  | `circuit-rebuilt` | El circuito se reconstruyó en su sitio con esta sesión (`reason`: `outdated`, versión anterior de la geometría; `gains-corners`, no tenía curvas). | `circuit`, `reason` |
  | `circuit-outdated-kept` | El circuito está anticuado pero se reutiliza tal cual (`reason`: `no-corners`, `build-failed`, `would-lose`). | `circuit`, `reason` |
  | `position-glitches` | Más del 1 % de las posiciones de algún coche son «sin dato» por fallos del feed (retrocesos o posición congelada con el coche en marcha). | `cars` |

  Un lector debe tolerar códigos que no conoce (datos de un pipeline más nuevo): enseña su `text` tal cual, marcado como texto original sin traducir («Aviso sin traducir (texto original):»), y nunca lo esconde. En v1, un código nuevo se añade en el sitio, en el `enum` de `manifest.schema.json` y en `QUALITY_NOTE_CODES` de `@trazada/schema` (lo comprueba un test).

## Estado de la versión 1

La versión 1 del esquema **no se publica** (D25: no hay despliegue; los datos se quedan en `data/` del PC). Mientras no haya datos de usuarios que conservar, los cambios en v1 se pueden hacer en el sitio: se regenera `layouts.lock.json` y queda una nota en el registro de decisiones de `docs/BRIEF.md`. En cuanto los haya, rige la política de versiones de arriba. La 1.1.0 (meteorología) ya siguió esa política, como un minor aditivo: los datos 1.0.0 siguen siendo válidos y un lector 1.0.0 lee los 1.1.0.

Historial de versiones:

| Versión | `minReader` | Cambio |
|---|---|---|
| 1.0.0 | 1.0.0 | Esquema v1. |
| 1.1.0 | 1.0.0 | Meteorología (D36): `events.weather` y `manifest.channels.weather`, opcionales. Aditivo: un lector 1.0.0 lo ignora y los datos 1.0.0 siguen siendo válidos (sin meteorología). Los layouts TRZB no cambian (solo la `schemaVersion` de su cabecera). |
