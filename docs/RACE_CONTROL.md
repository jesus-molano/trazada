# Taxonomía de mensajes de dirección de carrera (race control)

Especificación del parser (`pipeline/src/trazada_pipeline/racecontrol/`) y del *golden set* de etiquetas (`pipeline/tests/fixtures/rc_golden.jsonl`). Cada mensaje se conserva con su **texto original** y se le añade `parsed`:

| Campo | Tipo | Regla |
|---|---|---|
| `kind` | cadena | Uno de los tipos de la tabla de abajo. |
| `cars` | lista de cadenas | Números de coche **mencionados en el texto**, en orden de aparición y sin duplicados (`"CAR 18 (STR)"` → `"18"`). Incluye los vehículos de servicio con número de 3 cifras (`"CAR 241 (SC1)"` → `"241"`) y las listas tras dos puntos de los tipos que las usan (`"…: 1, 16, 44"`, `"…: 1 - 44 - 14"`). Lista vacía si no se menciona ninguno. |
| `turn` | entero o null | Número de curva mencionado (`"TURN 13"`, `"AT TURN 13"`). Null si no se menciona. |
| `lap` | entero o null | Vuelta **mencionada en el texto** (`"LAP 11"`). Null si no se menciona. No se usa la columna de vuelta del feed. |
| `outcome` | cadena o null | Según el tipo (ver tabla). |
| `detail` | cadena o null | Motivo o dato adicional en MAYÚSCULAS tal como aparece, sin horas (`"TRACK LIMITS"`, `"CAUSING A COLLISION"`, `"ZONE 2"`). |

Las horas que aparecen en el texto (`14:15:19`, `(15:29:34)`, `TIMED AT 15:29:34`) son **hora local del circuito** y se ignoran. El reloj del mensaje es su `t` en tiempo de sesión.

## Tipos (`kind`)

| kind | Patrones típicos | outcome | detail |
|---|---|---|---|
| `sector_yellow` | `YELLOW IN TRACK SECTOR 21` | null | null |
| `sector_double_yellow` | `DOUBLE YELLOW IN TRACK SECTOR 20` | null | null |
| `sector_clear` | `CLEAR IN TRACK SECTOR 18` | null | null |
| `track_clear` | `TRACK CLEAR` | null | null |
| `green_light` | `GREEN LIGHT - PIT EXIT OPEN` | null | null |
| `red_flag` | `RED FLAG`, `RED FLAG - RACE SUSPENDED` | null | null |
| `chequered_flag` | `CHEQUERED FLAG` | null | null |
| `first_car_flag` | `FIRST CAR TO TAKE THE FLAG - CAR 1 (NOR)`, `UPDATE: FIRST CAR TO TAKE THE FLAG - …` | null | null |
| `blue_flag` | `WAVED BLUE FLAG FOR CAR 77 (BOT) TIMED AT 15:29:34` | null | null |
| `black_and_white_flag` | `BLACK AND WHITE FLAG FOR CAR 41 (LIN) - MOVING UNDER BRAKING` | null | motivo |
| `black_and_orange_flag` | `BLACK AND ORANGE FLAG FOR CAR 44 (HAM)` | null | motivo si lo hay |
| `black_flag` | `BLACK FLAG FOR CAR …` (descalificación en pista) | null | motivo si lo hay |
| `yellow_pit_lane` | `YELLOW IN PIT LANE` | null | null |
| `pit_exit_closed` / `pit_exit_open` | `PIT EXIT CLOSED` / `PIT EXIT OPEN` (si no es `GREEN LIGHT - …`) | null | null |
| `pit_entry_closed` / `pit_entry_open` | `PIT LANE ENTRY CLOSED` / `PIT LANE ENTRY OPEN` | null | null |
| `pit_lane_clear` | `PIT LANE CLEAR` | null | null |
| `slippery_surface` | `TRACK SURFACE SLIPPERY IN TRACK SECTOR 7` | null | null |
| `sc_deployed` | `SAFETY CAR DEPLOYED` | null | null |
| `sc_in_this_lap` | `SAFETY CAR IN THIS LAP` | null | null |
| `sc_ending` | `SAFETY CAR ENDING` (si aparece) | null | null |
| `vsc_deployed` | `VIRTUAL SAFETY CAR DEPLOYED`, `VSC DEPLOYED` | null | null |
| `vsc_ending` | `VIRTUAL SAFETY CAR ENDING`, `VSC ENDING` | null | null |
| `lapped_cars_overtake` | `LAPPED CARS MAY NOW OVERTAKE THE SAFETY CAR[: 5, 31]`, `LAPPED CAR MAY NOW OVERTAKE THE SAFETY CAR: 87`, `LAPPED CARS WILL BE ALLOWED TO OVERTAKE`, `ALL CARS MAY OVERTAKE THE SAFETY CAR` | `allowed` / `not_allowed` | null |
| `medical_car` | `MEDICAL CAR DEPLOYED` | null | null |
| `recovery_vehicle` | `RECOVERY VEHICLE ON TRACK AT TURN 13` | null | null |
| `marshals_on_track` | `MARSHALS ON TRACK AT TURN 7` | null | null |
| `drs_enabled` / `drs_disabled` | `DRS ENABLED`, `DRS DISABLED IN ZONE 2` | null | `ZONE n` si se menciona |
| `overtake_enabled` / `overtake_disabled` | `OVERTAKE ENABLED` (2026) | null | null |
| `straight_mode` | `STRAIGHT MODE - LOW GRIP`, `STRAIGHT MODE - NORMAL GRIP`, `STRAIGHT MODE - DISABLED` (2026, aero activa: estado global del modo recta) | null | lo que sigue a `-` |
| `sc_procedure` | `SAFETY CAR LIGHTS ON/OFF`, `SAFETY CAR THROUGH THE PIT LANE`, `SAFETY CAR WILL USE …`, `SAFETY CAR WILL ENTER PITS…`, `THE SAFETY CAR WILL STAY OUT …`, `ALL CARS THROUGH THE PIT LANE`, `ALL CARS TO FOLLOW THE SAFETY CAR …`, `ALL CARS USE START/FINISH STRAIGHT` | null | null |
| `lap_deleted` | `CAR 18 (STR) LAP DELETED - TRACK LIMITS AT TURN 13 LAP 1 14:15:19`, `CAR 87 (BEA) TIME 1:37.790 DELETED - TRACK LIMITS AT TURN 13 LAP 11 …` | `time_deleted` si cita `TIME m:ss.mmm`; `lap_deleted` si dice `LAP DELETED` | motivo (`TRACK LIMITS`, `DOUBLE YELLOW`…) |
| `lap_reinstated` | `CAR 1 (NOR) TIME 1:20.123 WILL BE REINSTATED`, `… LAP 5 REINSTATED` | null | null |
| `off_track` | `CAR 5 (BOR) OFF TRACK AND CONTINUED AT TURN 4` | null | null |
| `spun` | `CAR 23 (ALB) SPUN AND CONTINUED AT TURN 9` | null | null |
| `missed_apex` | `CAR 10 (GAS) MISSED THE APEX OF TURN 2` | null | null |
| `car_stopped` | `CAR 31 (OCO) STOPPED ON TRACK AT TURN 7` | null | null |
| `track_limits` | Aviso de límites de pista sin anulación: `CAR 18 (STR) TRACK LIMITS TURN 10 LAP 1` | null | null |
| `incident` | `[FIA STEWARDS: ][TURN n \| Qn \| SQn \| PIT LANE \| LAP n ]INCIDENT INVOLVING CAR(S) … <estado>[ - MOTIVO]` | `noted`, `under_investigation`, `investigated_after` (WILL BE INVESTIGATED AFTER …), `no_further_investigation` (REVIEWED NO FURTHER INVESTIGATION), `no_further_action` | motivo |
| `penalty` | `FIA STEWARDS: 5 SECOND TIME PENALTY FOR CAR 18 (STR) - TRACK LIMITS`, `DRIVE THROUGH PENALTY …`, `STOP AND GO …`, `… GRID PENALTY …`, `… REPRIMAND …`, `… DISQUALIFIED …`, `FIA STEWARDS: WARNING FOR CAR …` | `time_penalty`, `drive_through`, `stop_go`, `grid_penalty`, `reprimand`, `disqualified`, `warning`, `other` | motivo |
| `penalty_served` | `FIA STEWARDS: PENALTY SERVED - 5 SECOND TIME PENALTY FOR CAR 27 (HUL) - SPEEDING IN THE PIT LANE` | null | motivo de la sanción (lo que sigue a la sanción); null si no lo hay |
| `session_schedule` | `Q2 WILL START AT 15:30`, `SESSION WILL RESUME AT …`, `RACE WILL RESUME AT … - STANDING START PROCEDURE`, `START OF Q1 WILL BE DELAYED`, `FORMATION LAP WILL START AT …`, `… WILL NOT RESUME`, `… WILL BE EXTENDED BY …`, `SESSION WILL END AT …`, `ESTIMATED TIME OF SESSION START - …` | null | null |
| `start_procedure` | `STANDING START`, `ROLLING START`, `SAFETY CAR WILL ENTER PITS: ROLLING START PROCEDURE`, `DELAYED START`, `EXTRA FORMATION LAP`, `START ABORTED`, `SPRINT START`, `FORMATION LAP(S) BEHIND SAFETY CAR`, `START ORDER: …`, `ORDER FOR RESTART: 1, 16, …` y `PUSH CARS TO FRONT IN ORDER: …` (con `cars` = la lista) | null | null |
| `info` | Avisos generales: `RISK OF RAIN …`, `WET TRACK`, `LOW GRIP CONDITIONS`, `… HEAD PADDING …`, `AWNINGS MAY BE USED`, `ALL PASS HOLDERS …`, `TRACK TEST COMPLETED`, `PIT LANE OPEN`… | null | null |
| `other` | Cualquier mensaje que no encaje con seguridad en lo anterior. | null | null |

## Reglas de desempate

- Un mensaje `FIA STEWARDS:` que anuncia una **sanción** es `penalty`. Si solo menciona un incidente con su estado, es `incident`.
- Si `CAR n` aparece varias veces, se cuenta una sola vez. El orden de `cars` es el de aparición.
- `turn`: si aparece `TURN n`, ese es el valor. `Q2` o `LAP 11` **no** son curvas.
- `lap`: solo un `LAP n` explícito que no forme parte de `LAP DELETED`. En `CAR 1 (VER) LAP 12 DELETED`, `lap` vale 12.
- Un prefijo `CORRECTION:` o `UPDATE:` no cambia el tipo: se clasifica el resto del mensaje.
- `ROLLING START` / `STANDING START` es `start_procedure`, salvo en un horario (`… WILL RESUME AT … - STANDING START PROCEDURE`), que es `session_schedule`.
- `detail` no repite lo que ya va en otros campos: se quitan `AT TURN n …` y un `LAP n` final (la vuelta va en `lap`), y las etiquetas de sesión como `(SQ1)`. Se conserva el lugar cuando no hay campo para él (`TRACK LIMITS AT PIT ENTRY`).
- Los incidentes sin la palabra `INCIDENT` (`LAP 1 TURN 1 NOTED`, `RESTART PROCEDURE UNDER INVESTIGATION`) son `incident`, con su estado como `outcome`.

## Estado derivado (`events.json`)

- **Banderas por sector** (`sectorFlags`): una bandera dura desde su mensaje hasta el `CLEAR` de su sector, o hasta un `TRACK CLEAR`, una luz verde, una roja o la bandera a cuadros. Si cambia (amarilla → doble), se abre un intervalo nuevo.
- **Neutralizaciones** (`windows` de tipo `sc`, `vsc`, `vsc-ending`, `red` y `yellow`): salen del estado de pista oficial (TrackStatus), no del texto.
- **OVERTAKE (2026) y DRS (2023–25)**: una ventana se abre con `…_enabled` y se cierra con `…_disabled`. Una neutralización (SC, VSC o roja) también la cierra, y solo un nuevo `…_enabled` la vuelve a abrir. El reglamento los desactiva durante la neutralización, pero dirección de carrera no siempre lo anuncia. En Japón 2026 hay `OVERTAKE ENABLED`, después el safety car sin ningún `DISABLED`, y otra vez `OVERTAKE ENABLED`. Sin esta regla, la ventana cruzaría el safety car entero.
- Todos los intervalos se recortan al final de la reproducción.

En el front, un intervalo está activo en t si `fromMs ≤ t < toMs` (`TrackState`). La excepción es un intervalo que llega al final de la reproducción (`toMs` nulo o recortado justo en el final): ese sigue activo también en `endMs`, donde se para el reloj, para que una sesión que acaba bajo roja o SC se vea así hasta el final. La escena tiñe la pista con la neutralización vigente (roja > SC > VSC > fin de VSC) y colorea los sectores de comisarios con bandera cuando el circuito tiene su geometría (MultiViewer). Si no la tiene, la bandera se muestra solo como texto, con su explicación.

## Golden set

`pipeline/tests/fixtures/rc_golden.jsonl`: 438 mensajes reales de 2023–2026 (muestra estratificada de un corpus de 23 654 mensajes, 9 635 textos únicos), etiquetados de forma independiente por dos anotadores con esta especificación y comparados con el parser:

- Coincidencia total en 427 de 438. En los 11 restantes, los anotadores tenían razón en 7 casos y se corrigió el parser (prefijo `UPDATE:`, listas de coches tras dos puntos, `DELAYED START`, orden de reinicio, coches de servicio de 3 cifras). Los otros 4 eran tipos añadidos a esta especificación después del etiquetado (`sc_procedure`, `straight_mode`).
- 7 etiquetas adjudicadas a mano, con su motivo en el campo `note` de cada línea.
- El test exige coincidencia exacta en `kind`, `cars`, `turn`, `lap`, `outcome` y `detail` para los 438, y `other` ≤ 5 % (hoy 0 %).
- En el corpus completo quedan 6 textos únicos `other` (0,06 %); la lista está en `docs/research/h2-pipeline.md`.
