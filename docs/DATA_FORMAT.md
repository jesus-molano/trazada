# Formato de datos de Trazada (esquema v1)

La fuente normativa está en `packages/schema/`:
- `version.json`: `schemaVersion`, `minReader`, `containerVersion`
- `trzb/*.layout.json`: layouts binarios
- `trzb/enums.json`: enumeraciones
- `*.schema.json`: JSON Schemas de manifest, catálogo y eventos

Este documento los explica. Si discrepa de ellos, mandan los ficheros.

## Rutas

En producción se sirven desde el Worker de datos (`${dataBaseUrl}`). En desarrollo se sirven desde `data/`, montado en `/data`.

```
/v1/catalog.json
/v1/circuits/{circuitKey}-{layoutId}/circuit.{hash8}.trzb.gz
/v1/sessions/{season}/{round:02d}-{slug}/{session}/manifest.json
/v1/sessions/{season}/{round:02d}-{slug}/{session}/{motion|car|timing}.{hash8}.trzb.gz
/v1/sessions/{season}/{round:02d}-{slug}/{session}/events.{hash8}.json.gz
```

- `session ∈ {fp1, fp2, fp3, sq, sprint, q, race}`.
- Las rutas de `files` en el manifest son relativas al propio manifest.
- Los ficheros con hash son inmutables (`Cache-Control: immutable`).
- `manifest.json` y `catalog.json` llevan una caché corta.

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
                "columns": [ { "name": "t", "type": "i32", "encoding": "delta", "unit": "ms",
                               "decode": "f64", "byteOffset": 0, "byteLength": 492 } ] } ],
  "meta": { } }
```

- **Tipos**: `u8 i8 u16 i16 u32 i32 f32 f64`.
- **`encoding: delta`**: se guarda `v[i] − v[i−1]`, con `v[−1] = 0`, a lo largo de toda la columna, aunque cruce coches. El lector reconstruye la serie con una suma acumulada.
- **Cuantización**: el valor físico es `raw × scale + offset`. Por ejemplo, `s` se guarda en cm y se lee en m.
- **`decode`**: tipo de destino en memoria (`f64` para tiempos y distancias, porque Float32 perdería precisión con s > 167 km o t > 4,6 h).
- Las columnas sin `delta` ni `scale` se exponen como **vistas sin copia** sobre el buffer.
- **Compresión externa**: la indica el manifest (`gzip` por defecto, determinista con `mtime = 0`; `zstd` es opcional). En el navegador se descomprime con `DecompressionStream`.

## Layouts v1

| Layout | Tabla | Columnas |
|---|---|---|
| `motion` | `cars` | car, start, count |
| | `pos` | t (i32 ms, delta → f64) · path (0 pista, 1 pit, 2 sin dato) · s (i32 cm, delta → f64 m) · projErr (u8 dm) |
| `car` | `cars` | car, start, count |
| | `tel` | t (i32 ms, delta → f64) · speed (u16 km/h) · rpm · gear · throttle (255 = sin dato) · brake (0/1) · drs (255 = canal ausente) |
| `circuit` | `centerline` | x, y, z (f32 m, paso fijo de 1 m; orientación del mapa oficial, centrado) |
| | `pitlane` | x, y, z (f32 m) |
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

## Eventos (JSON, `events.schema.json`)

- `raceControl[]`: todos los mensajes, con `t` en tiempo de sesión (ms) y el **texto original sin modificar**. `parsed` añade `kind`, `cars`, `turn`, `lap`, `outcome`, `s` y `marshalSector`.
- `sectorFlags[]`: estado ya resuelto de las banderas por sector de pista, listo para pintar el mapa.
- `windows[]`: intervalos de SC, VSC, roja, amarilla, overtake (2026) y DRS (2023–25).

## Manifest y catálogo

Ver `manifest.schema.json` y `catalog.schema.json`, y los ejemplos de `packages/schema/examples/`.

- Una sesión `no-position` aparece en el catálogo como no disponible.
- Una sesión con `dev: true` es de desarrollo (fuente secundaria) y **no se publica**.
