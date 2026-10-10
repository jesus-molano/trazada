"""Proyección de las posiciones de cada coche sobre el circuito canónico (layout `motion`).

Por coche:
1. Se descartan muestras con XY = 0 y marcas de tiempo duplicadas.
2. Ventanas de pit (de `PitInTime` a `PitOutTime`, y antes de la primera salida de boxes): las muestras
   cercanas al pit lane van a `path = pit`; las lejanas (garaje), a `nodata`. Fuera de ellas, `track`
   (o `nodata` si están lejos de la pista).
3. Pista: proyección 3D con continuidad (candidatos múltiples, se elige el coherente con el avance
   posible desde la muestra anterior). Pit: proyección sobre el pit lane y conversión a la s equivalente
   en pista entre `entry_s` y `exit_s`.
4. Desenrollado de vueltas por continuidad y anclado de cada segmento al nº de vuelta del cronometraje.
5. Monotonía con regresión isotónica (PAVA) por segmento continuo.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from trazada_pipeline.circuit.build import Circuit
from trazada_pipeline.circuit.geometry import PolylineIndex
from trazada_pipeline.sources.base import SessionData

PATH_TRACK, PATH_PIT, PATH_NODATA = 0, 1, 2
SEGMENT_GAP_MS = 2000
TRACK_MAX_DIST_M = 30.0
PIT_MAX_DIST_M = 12.0
VMAX_MPS = 110.0


@dataclass
class CarMotion:
    t_ms: np.ndarray  # int64
    path: np.ndarray  # uint8
    s_m: np.ndarray  # float64, distancia acumulada (equivalente en pista para el pit)
    proj_err_m: np.ndarray  # float64


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


def project_car(
    pos: pd.DataFrame,
    laps: pd.DataFrame,
    circuit: Circuit,
    track_index: PolylineIndex,
    pit_index: PolylineIndex | None,
) -> CarMotion:
    df = pos[~((pos["x"] == 0) & (pos["y"] == 0))]
    df = df.drop_duplicates(subset="t_ms", keep="last").sort_values("t_ms")
    t = df["t_ms"].to_numpy(dtype=np.int64)
    n = len(t)
    if n == 0:
        empty = np.zeros(0)
        return CarMotion(t, np.zeros(0, dtype=np.uint8), empty, empty)
    pts = circuit.to_canonical(df[["x", "y", "z"]].to_numpy(dtype=np.float64))
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
        use_pit = in_pit & (pd_ < PIT_MAX_DIST_M) & (pd_ + 1.0 < d)
        path[use_pit] = PATH_PIT
        s_raw[use_pit] = np.mod(circuit.pit_entry_s + pu[use_pit] / pit_index.length * span, L)
        err[use_pit] = pd_[use_pit]
        far = in_pit & ~use_pit & (d > 6.0)
        path[far] = PATH_NODATA
    far_track = (path == PATH_TRACK) & (d > TRACK_MAX_DIST_M)
    path[far_track] = PATH_NODATA

    # Segmentos continuos: se cortan en huecos de tiempo y en tramos sin dato.
    valid = path != PATH_NODATA
    seg_id = np.cumsum(np.r_[True, (np.diff(t) > SEGMENT_GAP_MS) | (valid[1:] != valid[:-1])])
    lap_no = _lap_of(t, laps)
    s_cum = np.full(n, np.nan)
    for sid in np.unique(seg_id):
        idx = np.flatnonzero((seg_id == sid) & valid)
        if len(idx) == 0:
            continue
        ds = np.diff(s_raw[idx])
        ds = np.where(ds < -L / 2, ds + L, np.where(ds > L / 2, ds - L, ds))
        local = s_raw[idx[0]] + np.r_[0.0, np.cumsum(ds)]
        # Anclar al nº de vuelta con muestras de mitad de vuelta (lejos de la línea de meta).
        mid = (s_raw[idx] > 0.2 * L) & (s_raw[idx] < 0.8 * L) & (lap_no[idx] > 0)
        if mid.any():
            target = (lap_no[idx][mid] - 1) * L + s_raw[idx][mid]
            k = np.round(np.median(target - local[mid]) / L)
        else:
            k = np.round(np.median((np.maximum(lap_no[idx], 1) - 1) * L + s_raw[idx] - local) / L)
        s_cum[idx] = pava(local + k * L)
    s_cum = np.where(np.isnan(s_cum), 0.0, s_cum)
    return CarMotion(t_ms=t, path=path, s_m=s_cum, proj_err_m=err)


def project_session(data: SessionData, circuit: Circuit) -> dict[str, CarMotion]:
    track_index = PolylineIndex(circuit.centerline, closed=True)
    pit_index = PolylineIndex(circuit.pitlane, closed=False) if circuit.pitlane is not None else None
    out: dict[str, CarMotion] = {}
    for car, pos in data.pos.items():
        laps = data.laps[data.laps["car"] == car]
        out[car] = project_car(pos, laps, circuit, track_index, pit_index)
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
