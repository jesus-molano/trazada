"""Proyección de las posiciones de cada coche sobre el circuito canónico (layout `motion`).

Por coche:
1. Se descartan muestras con XY = 0 y marcas de tiempo duplicadas. Una z = 0 por fallo del feed se
   sustituye por la de sus vecinas (solo sirve para elegir el tramo en un cruce a distinta altura).
2. Ventanas de pit (de `PitInTime` a `PitOutTime`, ±3 s, y antes de la primera salida de boxes): las
   muestras cercanas al pit lane van a `path = pit`; las lejanas (garaje), a `nodata`. Fuera de ellas
   decide la geometría, porque esas horas no coinciden con la bifurcación: sobre el pit lane y a más de 2 m
   de la línea (la cola del semáforo de salida), `pit`; junto al pit lane pero en ninguno de los dos
   caminos, `nodata`; si no, `track` (o `nodata` si está lejos de la pista).
3. Pista: proyección 3D con continuidad (candidatos múltiples, se elige el coherente con el avance
   posible desde la muestra anterior). Pit: proyección en planta sobre el pit lane y conversión a la s
   equivalente en pista entre `entry_s` y `exit_s`.
4. Desenrollado de vueltas por continuidad y anclado de cada segmento al nº de vuelta del cronometraje.
5. Monotonía con regresión isotónica (PAVA) por tramo de un mismo camino (nunca mezcla pista y pit) y
   luego en toda la serie. Una muestra que la monotonía tendría que mover más de 5 m es un fallo de
   posición: queda `nodata` en vez de congelar el coche y hacerlo saltar después.
6. Una parada que la telemetría desmiente (posición congelada o corregida hacia atrás en el feed mientras
   el coche va a más de 30 km/h) también queda `nodata`.
7. Al cambiar de camino, el feed deja el coche un poco más en la línea del camino de antes: en la entrada
   del pit lane, en la pista más allá de la bifurcación cuando ya va por el pit lane (clasificación de
   Singapur 2026: hasta 10 m; la primera muestra del pit lane queda por detrás). Las muestras del camino de
   antes que quedan más de 1 m por delante de la primera del nuevo (en s, la equivalente en el pit lane), en
   los 2 s previos al cambio, son una posición que se sabe mal: `nodata` (no se mueven), como los retrocesos
   del punto 5; el coche se oculta lo que tarda en llegar a la primera muestra del nuevo camino (en
   Singapur, menos de 2 s). Igual en la salida (las del pit lane por delante de la primera de pista). Se
   hace antes de la monotonía, que si no las promediaría con las buenas (las movería hasta 5 m) o se
   quedaría con ellas y quitaría las buenas. Así el coche nunca va hacia atrás al entrar o salir.
8. Sin pit lane en el circuito (ninguna parada lo daba bien), las muestras fuera de la pista (a más de 6 m)
   en la ventana de boxes y en el minuto de antes y de después quedan `nodata`: las horas del cronometraje
   no son las de la bifurcación (la cola del semáforo de salida sigue tras `PitOutTime`).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from trazada_pipeline.circuit.build import Circuit, z_glitches
from trazada_pipeline.circuit.geometry import PolylineIndex
from trazada_pipeline.sources.base import SessionData

PATH_TRACK, PATH_PIT, PATH_NODATA = 0, 1, 2
SEGMENT_GAP_MS = 2000
TRACK_MAX_DIST_M = 30.0
PIT_MAX_DIST_M = 12.0
#: A más de esto de la línea central el coche ya no va por la pista (medio ancho + ruido).
OFF_TRACK_M = 6.0
#: Fuera de la ventana de boxes, a más de esto de la línea y más cerca del pit lane, el coche va por el pit
#: lane. El feed pega las posiciones de pista a una línea (Bélgica FP1 2026, fuera de boxes: p90 de 0,13 m),
#: así que 2 m ya es salirse de la trazada. Con 6 m, la cola del semáforo de salida (a 4-5 m de la línea, al
#: final del pit lane) se dibujaba parada sobre la trazada: 514 s de coche en esa sesión.
PIT_OFF_LINE_M = 2.0
#: Fuera de la ventana de boxes, junto al pit lane y a más de esto de la línea, sin estar sobre el pit lane:
#: calle de entrada o de salida que la polilínea no cubre. Sin dato, nunca pegado a la trazada.
NEAR_PIT_OFF_TRACK_M = 12.0
#: Lo más que la monotonía puede mover una muestra; más es un fallo de posición (queda sin dato). Medido en
#: Bélgica FP1 2026: PAVA mueve el 99,5 % de las muestras menos de 0,13 m. Con 20 m, un salto de 40 m hacia
#: atrás a 180 km/h pasaba: PAVA lo reparte entre tres muestras (13 m cada una) y el coche se para.
MAX_MONOTONE_SHIFT_M = 5.0
#: Sin pit lane en el circuito, margen alrededor de la ventana de boxes en el que una muestra fuera de la
#: pista queda sin dato. Con el de 3 s, la cola del semáforo de salida (tras `PitOutTime`) se dibujaba en la
#: pista: en la clasificación de Singapur 2026 sin pit lane, 900 s de coche a más de 8 m, todos sobre el pit
#: lane real. Lo más lejos de la ventana que hay muestras sobre el pit lane: 24 s en Singapur, 12 s en Spa y
#: 7 s en Suzuka.
NO_PIT_MARGIN_MS = 60_000
#: Retroceso admitido (m) al anclar por continuidad un tramo sin nº de vuelta.
ANCHOR_BACK_TOL_M = 50.0
#: Al cambiar entre pista y pit lane, lo que una muestra del camino de antes puede quedar por delante de la
#: primera del nuevo (m de s) sin ser un fallo: el ruido del feed es de décimas (pegado a una línea) y la s
#: equivalente del pit lane avanza más deprisa que la de la pista junto a la bifurcación.
SWITCH_BACK_TOL_M = 1.0
#: Parada desmentida por la telemetría: menos de 1 m de avance en más de 1 s a más de 30 km/h.
FAKE_STOP_MIN_MS = 1000
FAKE_STOP_MAX_M = 1.0
FAKE_STOP_SPEED_KMH = 30.0
VMAX_MPS = 110.0


@dataclass
class CarMotion:
    t_ms: np.ndarray  # int64
    path: np.ndarray  # uint8
    s_m: np.ndarray  # float64, distancia acumulada (equivalente en pista para el pit)
    proj_err_m: np.ndarray  # float64
    # Muestras sin dato por fallos del feed: retrocesos de más de MAX_MONOTONE_SHIFT_M, paradas falsas y el
    # camino de antes por delante del nuevo al entrar o salir del pit lane.
    rejected: int = 0


def pava(y: np.ndarray) -> np.ndarray:
    """Regresión isotónica no decreciente (pool adjacent violators), O(n)."""
    n = len(y)
    if n == 0:
        return y.astype(np.float64)
    values = np.empty(n)
    weights = np.empty(n)
    ends = np.empty(n, dtype=np.int64)
    k = -1
    for i in range(n):
        k += 1
        values[k], weights[k], ends[k] = y[i], 1.0, i
        while k > 0 and values[k - 1] > values[k]:
            w = weights[k - 1] + weights[k]
            values[k - 1] = (values[k - 1] * weights[k - 1] + values[k] * weights[k]) / w
            weights[k - 1] = w
            ends[k - 1] = ends[k]
            k -= 1
    out = np.empty(n)
    start = 0
    for j in range(k + 1):
        out[start : ends[j] + 1] = values[j]
        start = ends[j] + 1
    return out


def monotone_fit(y: np.ndarray, max_shift: float = MAX_MONOTONE_SHIFT_M) -> tuple[np.ndarray, np.ndarray]:
    """PAVA sin arrastrar fallos: (ajuste, muestras conservadas).

    Si el ajuste tendría que mover alguna muestra más de `max_shift`, en cada bloque de PAVA afectado se
    descarta la que más se mueve (un fallo grande arrastra a sus vecinas) y se vuelve a ajustar. Las
    descartadas quedan con NaN en el ajuste.
    """
    y = np.asarray(y, dtype=np.float64)
    keep = np.ones(len(y), dtype=bool)
    fit = np.full(len(y), np.nan)
    for _ in range(200):
        idx = np.flatnonzero(keep)
        f = pava(y[idx])
        shift = np.abs(f - y[idx])
        if len(idx) == 0 or shift.max() <= max_shift:
            fit[idx] = f
            return fit, keep
        starts = np.flatnonzero(np.r_[True, np.diff(f) != 0])
        block_max = np.maximum.reduceat(shift, starts)
        ends = np.r_[starts[1:], len(f)]
        for b in np.flatnonzero(block_max > max_shift):
            keep[idx[starts[b] + int(np.argmax(shift[starts[b] : ends[b]]))]] = False
    # Demasiadas vueltas (no debería pasar): fuera todo lo que aún se mueve demasiado.
    idx = np.flatnonzero(keep)
    f = pava(y[idx])
    keep[idx[np.abs(f - y[idx]) > max_shift]] = False
    idx = np.flatnonzero(keep)
    fit[idx] = pava(y[idx])
    return fit, keep


def fake_stops(t: np.ndarray, s: np.ndarray, valid: np.ndarray, speed_kmh: np.ndarray) -> np.ndarray:
    """Paradas que la telemetría desmiente: la s no avanza en más de 1 s y el coche va a más de 30 km/h.

    Pasa cuando el feed repite la última posición (se congela) o la corrige hacia atrás (en Spa, en la
    línea del pit lane) y la monotonía la deja quieta. Se conserva la primera muestra (la última posición
    buena); el resto queda sin dato en vez de dibujar un coche parado que luego salta.
    """
    out = np.zeros(len(t), dtype=bool)
    idx = np.flatnonzero(valid)
    i = 0
    while i < len(idx):
        j = i
        while (
            j + 1 < len(idx)
            and s[idx[j + 1]] - s[idx[i]] < FAKE_STOP_MAX_M
            and t[idx[j + 1]] - t[idx[j]] <= SEGMENT_GAP_MS
        ):
            j += 1
        block = idx[i : j + 1]
        if (
            t[block[-1]] - t[block[0]] >= FAKE_STOP_MIN_MS
            and np.median(speed_kmh[block]) > FAKE_STOP_SPEED_KMH
        ):
            out[block[1:]] = True
        i = j + 1
    return out


def pit_windows(laps: pd.DataFrame, t_end: int) -> list[tuple[int, int]]:
    """Intervalos [entrada, salida] en el pit lane/garaje de un coche, en ms de sesión."""
    laps = laps.sort_values("lap")
    events: list[tuple[int, str]] = [(int(t), "in") for t in laps["pit_in_ms"] if t >= 0]
    events += [(int(t), "out") for t in laps["pit_out_ms"] if t >= 0]
    events.sort()
    windows: list[tuple[int, int]] = []
    # Antes de la primera salida de boxes (si la primera marca es una salida), el coche está en boxes.
    if events and events[0][1] == "out":
        windows.append((-(10**12), events[0][0]))
    open_in: int | None = None
    for t, kind in events:
        if kind == "in":
            open_in = t
        elif open_in is not None:
            windows.append((open_in, t))
            open_in = None
    if open_in is not None:
        windows.append((open_in, max(t_end, open_in) + 10**9))
    return windows


def _in_windows(t: np.ndarray, windows: list[tuple[int, int]], margin_ms: int = 0) -> np.ndarray:
    mask = np.zeros(len(t), dtype=bool)
    for a, b in windows:
        mask |= (t >= a - margin_ms) & (t <= b + margin_ms)
    return mask


def _track_projection(index: PolylineIndex, pts: np.ndarray, t: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Proyección con continuidad: entre varios candidatos, el coherente con el avance posible."""
    cand_u, cand_d = index.project_candidates(pts, k=6)
    L = index.length
    u = np.empty(len(pts))
    d = np.empty(len(pts))
    prev_u: float | None = None
    prev_t = 0
    for i in range(len(pts)):
        ok = cand_d[i] < TRACK_MAX_DIST_M
        if prev_u is None or not ok.any():
            j = int(np.argmin(cand_d[i]))
        else:
            dt = max((t[i] - prev_t) / 1000.0, 0.05)
            adv = np.mod(cand_u[i] - prev_u, L)  # avance hacia delante en [0, L)
            adv = np.where(adv > L - 50.0, adv - L, adv)  # pequeños retrocesos (ruido)
            plausible = ok & (adv >= -50.0) & (adv <= VMAX_MPS * dt + 50.0)
            if plausible.any():
                score = np.where(plausible, cand_d[i] + 0.01 * np.abs(adv), np.inf)
                j = int(np.argmin(score))
            else:
                j = int(np.argmin(cand_d[i]))
        u[i], d[i] = cand_u[i, j], cand_d[i, j]
        if d[i] < TRACK_MAX_DIST_M:
            prev_u, prev_t = u[i], int(t[i])
    return u, d


def _lap_of(t: np.ndarray, laps: pd.DataFrame) -> np.ndarray:
    """Nº de vuelta del cronometraje vigente en cada instante (0 si ninguna)."""
    out = np.zeros(len(t), dtype=np.int64)
    for lap in laps.itertuples():
        if lap.start_ms < 0 or lap.end_ms <= lap.start_ms:
            continue
        out[(t >= lap.start_ms) & (t < lap.end_ms)] = int(lap.lap)
    return out


def _unwrap_and_anchor(
    t: np.ndarray, s_raw: np.ndarray, valid: np.ndarray, lap_no: np.ndarray, L: float
) -> np.ndarray:
    """s acumulada (sin monotonía) de las muestras válidas, por tramos continuos.

    Los tramos se cortan en huecos de tiempo y en tramos sin dato, y se desenrollan por continuidad. Cada
    uno se ancla al nº de vuelta del cronometraje con sus muestras de mitad de vuelta (lejos de la meta) o,
    si no tiene, con las de cualquier punto. Un tramo sin ninguna vuelta (en boxes antes de la primera o
    tras la última) se ancla por continuidad con el tramo anterior, o con el siguiente si es el primero:
    anclado a la vuelta 1, un pit lane al final de la sesión quedaría vueltas por detrás.
    """
    seg_id = np.cumsum(np.r_[True, (np.diff(t) > SEGMENT_GAP_MS) | (valid[1:] != valid[:-1])])
    runs: list[tuple[np.ndarray, np.ndarray, float | None]] = []
    for sid in np.unique(seg_id[valid]):
        idx = np.flatnonzero((seg_id == sid) & valid)
        ds = np.diff(s_raw[idx])
        ds = np.where(ds < -L / 2, ds + L, np.where(ds > L / 2, ds - L, ds))
        local = s_raw[idx[0]] + np.r_[0.0, np.cumsum(ds)]
        mid = (s_raw[idx] > 0.2 * L) & (s_raw[idx] < 0.8 * L) & (lap_no[idx] > 0)
        if not mid.any():
            mid = lap_no[idx] > 0
        k = None
        if mid.any():
            target = (lap_no[idx][mid] - 1) * L + s_raw[idx][mid]
            k = float(np.round(np.median(target - local[mid]) / L))
        runs.append((idx, local, k))
    ks = [k for _, _, k in runs]
    prev_end: float | None = None
    for i, (_, local, _) in enumerate(runs):
        if ks[i] is None and prev_end is not None:
            ks[i] = float(np.ceil((prev_end - ANCHOR_BACK_TOL_M - local[0]) / L))
        k_i = ks[i]
        if k_i is not None:
            prev_end = float(local[-1] + k_i * L)
    next_start: float | None = None
    for i in range(len(runs) - 1, -1, -1):
        local = runs[i][1]
        if ks[i] is None and next_start is not None:
            ks[i] = float(np.floor((next_start + ANCHOR_BACK_TOL_M - local[-1]) / L))
        k_i = ks[i]
        if k_i is not None:
            next_start = float(local[0] + k_i * L)
    s_lin = np.full(len(t), np.nan)
    for (idx, local, _), k_i in zip(runs, ks, strict=True):
        s_lin[idx] = local + (k_i or 0.0) * L
    return s_lin


def switch_overshoot(t: np.ndarray, path: np.ndarray, s: np.ndarray) -> np.ndarray:
    """Muestras que el feed dejó en el camino de antes tras pasar al otro (pista ↔ pit lane).

    En cada cambio de camino entre dos muestras con dato seguidas (aunque haya muestras sin dato entre ellas)
    a menos de `SEGMENT_GAP_MS`, las del camino de antes de los `SEGMENT_GAP_MS` previos que quedan por
    delante de la primera del camino nuevo (más de `SWITCH_BACK_TOL_M` en `s`): el coche ya había cambiado de
    camino y el feed lo seguía pegando a la otra línea. No se mueven: quedan sin dato.
    """
    out = np.zeros(len(t), dtype=bool)
    idx = np.flatnonzero(path != PATH_NODATA)
    for k in np.flatnonzero(path[idx[:-1]] != path[idx[1:]]):
        nxt = idx[k + 1]
        if t[nxt] - t[idx[k]] > SEGMENT_GAP_MS:
            continue
        j = k
        while (
            j >= 0
            and path[idx[j]] == path[idx[k]]
            and t[nxt] - t[idx[j]] <= SEGMENT_GAP_MS
            and s[idx[j]] > s[nxt] + SWITCH_BACK_TOL_M
        ):
            out[idx[j]] = True
            j -= 1
    return out


def project_car(
    pos: pd.DataFrame,
    laps: pd.DataFrame,
    circuit: Circuit,
    track_index: PolylineIndex,
    pit_index: PolylineIndex | None,
    tel: pd.DataFrame | None = None,
) -> CarMotion:
    df = pos[~((pos["x"] == 0) & (pos["y"] == 0))]
    df = df.drop_duplicates(subset="t_ms", keep="last").sort_values("t_ms")
    t = df["t_ms"].to_numpy(dtype=np.int64)
    n = len(t)
    if n == 0:
        empty = np.zeros(0)
        return CarMotion(t, np.zeros(0, dtype=np.uint8), empty, empty)
    xyz = df[["x", "y", "z"]].to_numpy(dtype=np.float64)
    glitch = z_glitches(t, xyz[:, 2])
    if glitch.any():
        # z = 0 por un fallo del feed: la búsqueda 3D buscaría el tramo más bajo del circuito.
        xyz[glitch, 2] = np.interp(t[glitch], t[~glitch], xyz[~glitch, 2])
    pts = circuit.to_canonical(xyz)
    L = track_index.length
    windows = pit_windows(laps, int(t[-1]))
    in_pit = _in_windows(t, windows, margin_ms=3000)

    path = np.full(n, PATH_TRACK, dtype=np.uint8)
    s_raw = np.zeros(n)
    err = np.zeros(n)

    u, d = _track_projection(track_index, pts, t)
    s_raw[:] = u
    err[:] = d

    if pit_index is not None and circuit.pit_entry_s is not None and circuit.pit_exit_s is not None:
        pu, pd_ = pit_index.project(pts)
        span = np.mod(circuit.pit_exit_s - circuit.pit_entry_s, L)
        on_pit = (pd_ < PIT_MAX_DIST_M) & (pd_ + 1.0 < d)
        # En la ventana de boxes basta con estar más cerca del pit lane. Fuera de ella decide la geometría:
        # las horas de entrada y salida del cronometraje no son las de la bifurcación (en Spa, varios
        # segundos; la salida, hasta 30 s antes de que el coche deje la cola del semáforo), y un coche en el
        # pit lane no se pega a la trazada.
        use_pit = on_pit & (in_pit | (d > PIT_OFF_LINE_M))
        path[use_pit] = PATH_PIT
        s_raw[use_pit] = np.mod(circuit.pit_entry_s + pu[use_pit] / pit_index.length * span, L)
        err[use_pit] = pd_[use_pit]
        garage = in_pit & ~use_pit & (d > OFF_TRACK_M)
        near_pit = ~in_pit & ~use_pit & (pd_ < d) & (d > NEAR_PIT_OFF_TRACK_M)
        path[garage | near_pit] = PATH_NODATA
    else:
        # Sin pit lane (ninguna parada lo daba sin huecos y por donde van los coches): cerca de la ventana de
        # boxes, fuera de la pista, sin dato; nunca pegado a la trazada.
        near_pit_window = _in_windows(t, windows, margin_ms=NO_PIT_MARGIN_MS)
        path[near_pit_window & (d > OFF_TRACK_M)] = PATH_NODATA
    far_track = (path == PATH_TRACK) & (d > TRACK_MAX_DIST_M)
    path[far_track] = PATH_NODATA

    valid = path != PATH_NODATA
    s_lin = _unwrap_and_anchor(t, s_raw, valid, _lap_of(t, laps), L)

    # El feed sigue un poco en el camino de antes al entrar o salir del pit lane: posición que se sabe mal.
    overshoot = switch_overshoot(t, path, s_lin)
    path[overshoot] = PATH_NODATA
    rejected = int(overshoot.sum())
    valid = path != PATH_NODATA

    # Monotonía, primero por tramo de un mismo camino: PAVA no mezcla la pista con el pit lane (su s es un
    # equivalente) ni promedia un fallo de posición con las muestras buenas.
    run_id = np.cumsum(np.r_[True, (np.diff(t) > SEGMENT_GAP_MS) | (path[1:] != path[:-1])])
    s_cum = np.full(n, np.nan)
    for rid in np.unique(run_id[valid]):
        idx = np.flatnonzero((run_id == rid) & valid)
        fit, keep = monotone_fit(s_lin[idx], MAX_MONOTONE_SHIFT_M)
        s_cum[idx] = fit
        path[idx[~keep]] = PATH_NODATA
        rejected += int((~keep).sum())
    # Después la serie entera (cambios de camino y huecos) nunca va hacia atrás.
    idx = np.flatnonzero(path != PATH_NODATA)
    fit, keep = monotone_fit(s_cum[idx], MAX_MONOTONE_SHIFT_M)
    s_cum[idx] = fit
    path[idx[~keep]] = PATH_NODATA
    rejected += int((~keep).sum())
    if tel is not None and len(tel) >= 2:
        tel = tel.drop_duplicates("t_ms").sort_values("t_ms")
        speed = np.interp(t, tel["t_ms"].to_numpy(dtype=np.float64), tel["speed"].to_numpy(dtype=np.float64))
        fake = fake_stops(t, s_cum, path != PATH_NODATA, speed)
        path[fake] = PATH_NODATA
        rejected += int(fake.sum())
    s_cum = np.where(np.isnan(s_cum) | (path == PATH_NODATA), 0.0, s_cum)
    return CarMotion(t_ms=t, path=path, s_m=s_cum, proj_err_m=err, rejected=rejected)


def project_session(data: SessionData, circuit: Circuit) -> dict[str, CarMotion]:
    track_index = PolylineIndex(circuit.centerline, closed=True)
    # El pit lane se proyecta en planta: el feed da una altura fija a todo el pit lane y la polilínea lleva
    # la de la pista (no hay cruces que separar).
    pit_index = (
        PolylineIndex(circuit.pitlane, closed=False, z_weight=0.0) if circuit.pitlane is not None else None
    )
    out: dict[str, CarMotion] = {}
    for car, pos in data.pos.items():
        laps = data.laps[data.laps["car"] == car]
        out[car] = project_car(pos, laps, circuit, track_index, pit_index, data.car.get(car))
    return out


def motion_tables(motion: dict[str, CarMotion]) -> dict[str, dict[str, np.ndarray]]:
    cars = sorted(motion, key=int)
    starts, counts = [], []
    t, path, s, err = [], [], [], []
    offset = 0
    for car in cars:
        m = motion[car]
        starts.append(offset)
        counts.append(len(m.t_ms))
        offset += len(m.t_ms)
        t.append(m.t_ms)
        path.append(m.path)
        s.append(np.round(m.s_m, 2))
        err.append(np.minimum(np.rint(m.proj_err_m * 10), 255))
    cat = (lambda xs: np.concatenate(xs)) if cars else (lambda xs: np.zeros(0))
    return {
        "cars": {
            "car": np.array([int(c) for c in cars]),
            "start": np.array(starts),
            "count": np.array(counts),
        },
        "pos": {"t": cat(t), "path": cat(path), "s": cat(s), "projErr": cat(err)},
    }
