"""Construcción del circuito canónico de un trazado a partir de los datos de una sesión.

Pasos:
1. Vueltas de referencia: las más rápidas, limpias (sin boxes, con tiempo, pista libre), de pilotos distintos.
2. Sus muestras de posición se ordenan sobre la vuelta más rápida, se promedian por tramos de 1 m y se
   suavizan con un filtro gaussiano circular → línea central cerrada a paso fijo de 1 m.
3. s = 0 en la línea de meta: proyección media de las posiciones al inicio de cada vuelta.
4. Orientación del mapa oficial (rotación de MultiViewer si existe) y centrado del bounding box.
5. Pit lane: trayectoria de la parada más corta, entre los puntos donde se separa de la pista.
6. Curvas y sectores de comisarios (si hay info de circuito) proyectados a s.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from trazada_pipeline.circuit.geometry import (
    PolylineIndex,
    arclength,
    resample,
    rotate_xy,
    smooth_closed,
    smooth_open,
)
from trazada_pipeline.sources.base import SessionData

log = logging.getLogger(__name__)

STEP_M = 1.0
REFERENCE_LAPS = 16
MAX_SAMPLE_GAP_M = 60.0
PIT_DIVERGENCE_M = 4.0
#: Suavizado gaussiano de la línea central (en muestras de 1 m). Medido en Suzuka: con 3 m en z, el
#: desnivel del puente baja de 6,1 a 3,8 m; con 1 m queda a 0,26 m de las muestras crudas.
XY_SIGMA_M = 3.0
Z_SIGMA_M = 1.0


class CircuitBuildError(RuntimeError):
    pass


@dataclass
class Circuit:
    circuit_id: str  # "{circuitKey}-{layoutId}"
    name: str
    rotation_deg: float
    center: tuple[float, float]  # en metros, tras rotar (se resta)
    z_base: float  # altitud mínima (m) que se resta a z
    centerline: np.ndarray  # (N, 3) m, canónico, paso fijo, cerrado
    pitlane: np.ndarray | None  # (M, 3) m, canónico
    pit_entry_s: float | None
    pit_exit_s: float | None
    corners: pd.DataFrame  # number, letter, s, x, y, angle
    marshal_sectors: pd.DataFrame | None  # number, s_start, s_end
    quality: dict[str, float] = field(default_factory=dict)
    sources: list[str] = field(default_factory=list)
    # Construido con alguna fuente de desarrollo: las sesiones que lo usen no se publican.
    dev: bool = False

    @property
    def length(self) -> float:
        return float(arclength(self.centerline, closed=True)[-1])

    @property
    def pit_length(self) -> float | None:
        return None if self.pitlane is None else float(arclength(self.pitlane)[-1])

    def to_canonical(self, xyz_dm: np.ndarray) -> np.ndarray:
        """Coordenadas del feed (dm) → canónicas (m, rotadas, centradas, z relativa)."""
        p = np.asarray(xyz_dm, dtype=np.float64) / 10.0
        p = rotate_xy(p, self.rotation_deg)
        p[:, 0] -= self.center[0]
        p[:, 1] -= self.center[1]
        p[:, 2] -= self.z_base
        return p


def _valid_pos(df: pd.DataFrame) -> pd.DataFrame:
    return df[~((df["x"] == 0) & (df["y"] == 0))]


def _samples_between(df: pd.DataFrame, t0: int, t1: int) -> np.ndarray:
    sel = df[(df["t_ms"] >= t0) & (df["t_ms"] <= t1)]
    return sel[["x", "y", "z"]].to_numpy(dtype=np.float64) / 10.0


def reference_laps(data: SessionData, k: int = REFERENCE_LAPS) -> pd.DataFrame:
    laps = data.laps
    clean = laps[
        (laps["lap_ms"] > 0)
        & (laps["pit_in_ms"] < 0)
        & (laps["pit_out_ms"] < 0)
        & (laps["start_ms"] >= 0)
        & (laps["end_ms"] > laps["start_ms"])
        & (~laps["deleted"].astype(bool))
        & (laps["track_status"].isin(["", "1"]))
    ]
    if clean.empty:
        clean = laps[(laps["lap_ms"] > 0) & (laps["pit_in_ms"] < 0) & (laps["pit_out_ms"] < 0)]
    best = clean.sort_values("lap_ms").groupby("car", sort=False).head(1).sort_values("lap_ms")
    return best.head(k)


def _raw_loop(data: SessionData, refs: pd.DataFrame) -> tuple[np.ndarray, list[np.ndarray]]:
    """Muestras (m, sin rotar) de la vuelta más rápida y del resto de referencias."""
    traces = []
    for lap in refs.itertuples():
        df = data.pos.get(lap.car)
        if df is None:
            continue
        pts = _samples_between(_valid_pos(df), int(lap.start_ms), int(lap.end_ms))
        if len(pts) > 50:
            traces.append(pts)
    if not traces:
        raise CircuitBuildError("no hay vueltas de referencia con posiciones")
    ref = traces[0]
    # Cerrar el lazo: cortar donde la traza vuelve más cerca de su primer punto (último 20 %).
    n = len(ref)
    tail = np.arange(int(n * 0.8), n)
    cut = int(tail[np.argmin(np.linalg.norm(ref[tail, :2] - ref[0, :2], axis=1))])
    ref = ref[:cut]
    keep = np.r_[True, np.linalg.norm(np.diff(ref[:, :2], axis=0), axis=1) > 0.2]
    return ref[keep], traces


def build_centerline(data: SessionData) -> tuple[np.ndarray, dict[str, float]]:
    """Línea central cerrada (m, sistema del feed sin rotar) a paso de 1 m, con s=0 sin alinear."""
    refs = reference_laps(data)
    ref, traces = _raw_loop(data, refs)
    ref_dense = resample(ref, 0.5, closed=True)
    index = PolylineIndex(ref_dense, closed=True)
    length = index.length
    nbins = int(np.ceil(length / STEP_M))
    sums = np.zeros((nbins, 3))
    counts = np.zeros(nbins)
    for pts in traces:
        u, dist = index.project(pts)
        ok = dist < 15.0
        b = np.minimum((u[ok] / STEP_M).astype(int), nbins - 1)
        np.add.at(sums, b, pts[ok])
        np.add.at(counts, b, 1)
    filled = counts > 0
    filled_idx = np.flatnonzero(filled)
    if len(filled_idx) < 10:
        raise CircuitBuildError("muestreo insuficiente para la línea central")
    gaps = np.diff(np.r_[filled_idx, filled_idx[0] + nbins]) * STEP_M
    if gaps.max() > MAX_SAMPLE_GAP_M:
        raise CircuitBuildError(f"hueco de {gaps.max():.0f} m sin muestras en la línea central")
    centers = (np.arange(nbins) + 0.5) * STEP_M
    mean = np.zeros((nbins, 3))
    mean[filled] = sums[filled] / counts[filled, None]
    # Rellenar tramos vacíos interpolando circularmente en u.
    fu = centers[filled]
    for k in range(3):
        fv = mean[filled, k]
        mean[:, k] = np.interp(centers, np.r_[fu - length, fu, fu + length], np.r_[fv, fv, fv])
    smooth = smooth_closed(mean, sigma=XY_SIGMA_M)
    # La altura se suaviza menos: puentes y túneles (el cruce de Suzuka) cambian de cota en pocos metros.
    smooth[:, 2] = smooth_closed(mean, sigma=Z_SIGMA_M)[:, 2]
    line = resample(smooth, STEP_M, closed=True)
    # Calidad: residuo de las muestras de referencia sobre la línea final.
    final = PolylineIndex(line, closed=True)
    residuals = np.concatenate([final.project(t)[1] for t in traces])
    closure = float(np.linalg.norm(line[0, :2] - line[-1, :2]))
    quality = {
        "residualP50M": float(np.percentile(residuals, 50)),
        "residualP95M": float(np.percentile(residuals, 95)),
        "closureM": closure,
        "referenceLaps": float(len(traces)),
        "maxSampleGapM": float(gaps.max()),
    }
    return line, quality


#: Inicios de vuelta necesarios para situar la línea de meta; con menos se usa el inicio de la traza.
MIN_FINISH_LAPS = 3


def finish_line_s(data: SessionData, line: np.ndarray) -> tuple[float, int]:
    """s de la línea de meta sobre `line` (feed, m): media circular de los inicios de vuelta.

    Devuelve también cuántos inicios de vuelta la sitúan. Con menos de `MIN_FINISH_LAPS`, la meta queda
    en el inicio de la traza de referencia (la primera muestra de su vuelta, cerca de la línea real).
    """
    index = PolylineIndex(line, closed=True)
    laps = data.laps
    starts = laps[(laps["lap"] >= 2) & (laps["pit_out_ms"] < 0) & (laps["start_ms"] > 0)]
    us = []
    for lap in starts.itertuples():
        df = data.pos.get(lap.car)
        if df is None:
            continue
        v = _valid_pos(df)
        t = v["t_ms"].to_numpy()
        if len(t) < 2 or lap.start_ms < t[0] or lap.start_ms > t[-1]:
            continue
        p = np.array([[np.interp(lap.start_ms, t, v[c].to_numpy()) / 10.0 for c in ("x", "y", "z")]])
        u, d = index.project(p)
        if d[0] < 15:
            us.append(u[0])
    if len(us) < MIN_FINISH_LAPS:
        log.warning("pocas vueltas para situar la línea de meta (%d); se usa el inicio de la traza", len(us))
        return 0.0, len(us)
    ang = np.asarray(us) / index.length * 2 * np.pi
    mean = np.arctan2(np.sin(ang).mean(), np.cos(ang).mean()) % (2 * np.pi)
    return float(mean / (2 * np.pi) * index.length), len(us)


def build_pitlane(
    data: SessionData, line: np.ndarray
) -> tuple[np.ndarray | None, float | None, float | None, float | None]:
    """Pit lane (m, sistema del feed) desde la parada más corta; s de entrada y salida sobre `line`."""
    index = PolylineIndex(line, closed=True)
    stops = []
    for car, laps in data.laps.groupby("car"):
        laps = laps.sort_values("lap")
        ins = laps[laps["pit_in_ms"] >= 0]["pit_in_ms"].to_numpy()
        outs = laps[laps["pit_out_ms"] >= 0]["pit_out_ms"].to_numpy()
        for t_in in ins:
            later = outs[outs > t_in]
            if len(later):
                stops.append((float(later[0] - t_in), str(car), int(t_in), int(later[0])))
    stops.sort()
    for _dur, car, t_in, t_out in stops[:20]:
        df = data.pos.get(car)
        if df is None:
            continue
        pts = _samples_between(_valid_pos(df), t_in - 15000, t_out + 15000)
        if len(pts) < 20:
            continue
        _, dist = index.project(pts)
        off = np.where(dist > PIT_DIVERGENCE_M)[0]
        if len(off) < 10:
            continue
        a, b = max(off[0] - 1, 0), min(off[-1] + 1, len(pts) - 1)
        path = pts[a : b + 1]
        keep = np.r_[True, np.linalg.norm(np.diff(path[:, :2], axis=0), axis=1) > 0.5]
        path = path[keep]
        if len(path) < 10:
            continue
        lane = resample(smooth_open(resample(path, 1.0, closed=False), 2.0), STEP_M, closed=False)
        entry_u, _ = index.project(lane[:1])
        exit_u, _ = index.project(lane[-1:])
        raw_len = float(arclength(path)[-1])  # longitud de las muestras, para validar el suavizado
        return lane, float(entry_u[0]), float(exit_u[0]), raw_len
    log.warning("no se pudo extraer el pit lane")
    return None, None, None, None


def build_circuit(data: SessionData, circuit_id: str, name: str) -> Circuit:
    line_raw, quality = build_centerline(data)
    s0, finish_laps = finish_line_s(data, line_raw)
    if finish_laps < MIN_FINISH_LAPS:
        # Solo si se usa la reserva: así los circuitos normales conservan su hash. Va con el circuito
        # porque cada sesión que lo reutilice hereda la meta aproximada (y su nota de calidad).
        quality["finishLineLaps"] = float(finish_laps)
    idx0 = round(s0 / STEP_M) % len(line_raw)
    line_raw = np.roll(line_raw, -idx0, axis=0)
    pit_raw, entry_s, exit_s, pit_samples_len = build_pitlane(data, line_raw)

    rotation = data.circuit_info.rotation_deg if data.circuit_info else 0.0
    rot_line = rotate_xy(line_raw, rotation)
    center = (
        float((rot_line[:, 0].min() + rot_line[:, 0].max()) / 2),
        float((rot_line[:, 1].min() + rot_line[:, 1].max()) / 2),
    )
    z_base = float(rot_line[:, 2].min())

    def canon(p_m: np.ndarray) -> np.ndarray:
        q = rotate_xy(p_m, rotation)
        q[:, 0] -= center[0]
        q[:, 1] -= center[1]
        q[:, 2] -= z_base
        return q

    line = canon(line_raw)
    pit = canon(pit_raw) if pit_raw is not None else None
    index = PolylineIndex(line, closed=True)

    corners = pd.DataFrame(columns=["number", "letter", "s", "x", "y", "angle"])
    marshal = None
    sources = ["F1 live timing (posiciones)"]
    dev = data.dev
    if data.circuit_info is not None:
        ci = data.circuit_info
        cxy = np.column_stack([ci.corners["x"], ci.corners["y"], np.zeros(len(ci.corners))]) / 10.0
        c = rotate_xy(cxy, rotation)
        c[:, 0] -= center[0]
        c[:, 1] -= center[1]
        # z de la línea para proyectar en 3D sin sesgo: se usa la z del punto 2D más cercano.
        u2, _ = PolylineIndex(np.column_stack([line[:, :2], np.zeros(len(line))]), closed=True).project(c)
        corners = pd.DataFrame(
            {
                "number": ci.corners["number"].astype(int).to_numpy(),
                "letter": [ord(x[0]) if x else 0 for x in ci.corners["letter"]],
                "s": u2,
                "x": c[:, 0],
                "y": c[:, 1],
                "angle": ci.corners["angle"].to_numpy(dtype=np.float64),
            }
        ).sort_values("number")
        if ci.marshal_sectors is not None and len(ci.marshal_sectors):
            ms = ci.marshal_sectors.sort_values("number")
            mxy = np.column_stack([ms["x"], ms["y"], np.zeros(len(ms))]) / 10.0
            m = rotate_xy(mxy, rotation)
            m[:, 0] -= center[0]
            m[:, 1] -= center[1]
            mu, _ = PolylineIndex(np.column_stack([line[:, :2], np.zeros(len(line))]), closed=True).project(m)
            marshal = pd.DataFrame(
                {
                    "number": ms["number"].astype(int).to_numpy(),
                    "s_start": mu,
                    "s_end": np.roll(mu, -1),
                }
            )
        what = "curvas, sectores, rotación" if marshal is not None else "curvas, rotación"
        sources.append(f"{ci.source} ({what})")
        dev = dev or ci.dev

    quality.update(
        {
            "lengthM": float(index.length),
            "elevationRangeM": float(line[:, 2].max() - line[:, 2].min()),
        }
    )
    if pit_samples_len is not None:
        quality["pitSamplesLengthM"] = pit_samples_len
    return Circuit(
        circuit_id=circuit_id,
        name=name,
        rotation_deg=rotation,
        center=center,
        z_base=z_base,
        centerline=line,
        pitlane=pit,
        pit_entry_s=entry_s,
        pit_exit_s=exit_s,
        corners=corners,
        marshal_sectors=marshal,
        quality=quality,
        sources=sources,
        dev=dev,
    )
