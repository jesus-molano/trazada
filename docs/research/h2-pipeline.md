# H2: pipeline v1 de punta a punta (informe)

Fecha: 2026-10-10. Datos medidos en el contenedor de desarrollo (sin acceso al archivo de F1 ni a MultiViewer; ver R1 en `docs/PLAN.md`).

## Sesiones de referencia

| Sesión | Fuente | Por qué |
|---|---|---|
| 2026 Bélgica FP1 | FastF1 desde una caché de terceros **saneada** (`trazada sanitize-cache`), offline | Única sesión 2026 con los datos de live timing completos disponible aquí. |
| 2026 Japón carrera | `trazada dev-ti` (JSON de TracingInsights, derivados de FastF1). **Solo desarrollo**: la sesión sale con `dev: true` y no se publica | Carrera completa para el front (H3+) sin acceso al archivo de F1. |

En las dos, las curvas y la rotación de MultiViewer vienen de la copia de TracingInsights (`--dev-corners`), porque MultiViewer no es accesible desde este contenedor. En un build normal desde tu PC, FastF1 las trae de MultiViewer directamente, con los sectores de comisarios.

Comandos:

```bash
uv run trazada build 2026 "Belgian Grand Prix" fp1 --offline --rebuild-circuit \
  --dev-corners "<TI>/2026/Belgian Grand Prix/Practice 1/corners.json"
uv run trazada dev-ti "<TI>/2026/Japanese Grand Prix/Race" --season 2026 --round 3 --slug suzuka
TRAZADA_TI_ROOT=<TI> uv run pytest -m local
```

## Criterios de aceptación

| Criterio | Resultado | Cómo se comprueba |
|---|---|---|
| Cobertura ≥ 99 % pos/car por piloto en pista | ✅ Bélgica: pos ≥ 99,7 %, car 100 % (22 pilotos). ⚠️ Japón (dev): 97,5 % en el coche 87, que abandona en la vuelta 21 y la fuente dev no trae muestras desde que se para. El resto, 100 %. | `test_local_reference.py::test_coverage` (99 % para fuentes reales, 95 % para dev). Un hueco > 2 s cuenta entero como no cubierto. |
| Carrera: vueltas del líder = total oficial | ✅ 53 = 53 | `test_race_laps_and_order` |
| Carrera: orden derivado = clasificación oficial | ✅ Los 20 coches que reciben la bandera, en el mismo orden que la referencia (posición final de TracingInsights, que viene de Jolpica y se usa **solo** en el test local). Los retirados no tienen clasificación final en esa referencia. | `test_race_laps_and_order` |
| Libres/clasificación: orden de mejores vueltas = referencia | ✅ Bélgica FP1: igual a la posición final de la propia torre de tiempos del live timing. | `test_best_lap_order_matches_timing_tower` |
| Ningún campo de Jolpica se serializa | ✅ El adaptador no toca `session.results`, la vuelta 1 de carrera va sin tiempo y no hay claves de resultados ni fotos en manifest y eventos. | `test_sources.py`, `test_build.py::test_no_jolpica_or_photo_fields` |
| Cierre < 2 m | ✅ Spa 1,46 m · Suzuka 1,58 m | `test_geometry` |
| Longitud a ±3 % de la oficial | ✅ Spa 6949 m frente a 7004 (−0,8 %) · Suzuka 5773 m frente a 5807 (−0,6 %). Las longitudes oficiales de `pipeline/circuits.json` están **pendientes de verificar** contra fuente primaria. | `test_geometry` |
| `s` monótona | ✅ En todos los coches de las dos sesiones y en el sintético | `test_geometry`, `test_projection.py` |
| Pit lane con `entryS`/`exitS` y longitud a ±10 % de las muestras | ✅ Spa 681 m frente a 701 m de muestras (−2,8 %) · Suzuka 744 frente a 748 (−0,4 %). En los dos, el pit lane cruza s = 0. | `test_geometry` |
| Casos sintéticos: cruce de s = 0 en el pit lane, cola con bandera roja, drive-through, coche parado en pista | ✅ | `tests/synthetic.py` + `test_projection.py` |
| Parser de race control: golden set ≥ 300, 100 % en kind/cars/turn/lap, `other` ≤ 5 % | ✅ 438 mensajes, 100 % (también en outcome y detail), 0 % `other` | `test_racecontrol.py`; ver `docs/RACE_CONTROL.md` |
| Informe de `other` | ✅ Abajo | — |
| Elevación `real` en las de referencia | ✅ Spa 102 m de desnivel, Suzuka 40 m | `test_geometry` |
| Peso ≤ 5 MB por carrera (objetivo ~3 MB) | ✅ Japón 1,84 MiB · Bélgica FP1 0,97 MiB | `test_weight` |
| Determinismo: segunda ejecución con hashes idénticos | ✅ | `test_rebuild_is_deterministic` (Bélgica desde la caché), `test_build.py::test_build_is_deterministic` |
| Tiempo y RAM documentados | ✅ Abajo | — |

## Tiempo, memoria y peso

| Sesión | Tiempo de build | RSS máx. | motion | car | timing | events | circuito | Total |
|---|---|---|---|---|---|---|---|---|
| Bélgica FP1 (70 min) | 11,5 s | 329 MiB | 330 KiB | 640 KiB | 10 KiB | 2 KiB | 11 KiB | 0,97 MiB |
| Japón carrera (dev, 100 min) | 32 s | 282 MiB | 542 KiB | 1317 KiB | 15 KiB | 2 KiB | 9 KiB | 1,84 MiB |

El circuito se comparte entre todas las sesiones del trazado y se cachea como inmutable.

### Formato: TRZB+gzip frente a zstd y Arrow

Medido sobre los mismos ficheros. "Arrow" es Arrow IPC con las **mismas** columnas, cuantización y deltas, pero sin *byte shuffle*.

| Fichero | TRZB crudo | TRZB + gzip -9 | TRZB + zstd -19 | Arrow + gzip -9 |
|---|---|---|---|---|
| Bélgica motion | 3,34 MB | **338 KB** | 319 KB (−6 %) | 713 KB |
| Bélgica car | 4,10 MB | **655 KB** | 621 KB (−5 %) | 926 KB |
| Japón motion | 4,26 MB | **555 KB** | 529 KB (−5 %) | 1057 KB |
| Japón car | 5,71 MB | **1349 KB** | 1202 KB (−11 %) | 1568 KB |

Conclusiones:

- El *byte shuffle* (agrupar los bytes de cada columna por posición) es lo que más ahorra: por ejemplo, `t` de car pasa de 231 KB a 19 KB.
- Con shuffle, zstd ya solo gana un 5–11 %. **Se mantiene gzip** con `DecompressionStream` nativo, sin decoder JS.
- Arrow pesaría el doble en motion y no aportaría nada en el navegador (D3).

Otros cambios del layout en H2:

- `s` pasa a dm: 1 dm frente a un ruido de posición de ~1 m.
- `speed` y `rpm` se guardan en delta.
- El circuito se guarda en cm con delta: de 79 KiB a 11 KiB.

## Mensajes `other` en el corpus completo

Corpus de 23 654 mensajes, 9 635 textos únicos, 2023–2026. Quedan 6 textos `other` (0,06 %):

- `CAR 21 (EST) CONTINUED`
- `CARS 25 (MIZ) & 8 (JUK) - NO WORKING TRANSPONDER`
- `TRACK LIMIT INFRINGEMENTS ARE STILL UNDER INVESTIGATION`
- `AFTERNOON SESSION WILL BE FROM 14:00 - 19:00`
- `LAP TIME UNDER INVESTIGATION - TRACK LIMITS - CAR 27 (HUL) - 1:31.998`
- `LAP TIME OF CAR 87 (BEA) - UNDER REVIEW`

## Pendiente o con riesgo

- **Longitudes oficiales** de `circuits.json`: hay que verificarlas contra fuente primaria antes de publicar.
- **Sectores de comisarios**: esta sesión no los tiene, porque MultiViewer no es accesible desde aquí. La comprobación "TURN N cae en el sector que contiene la curva N" queda para el primer build en tu PC.
- **Ingesta real** (FastF1 online, MultiViewer): solo desde IP residencial (R1). En la nube, F1 responde 403 y `trazada probe` lo detecta.
