"""Construcción del circuito canónico de un trazado a partir de los datos de una sesión.

Pasos:
1. Vueltas de referencia: las más rápidas, limpias (sin boxes, con tiempo, pista libre), de pilotos distintos.
2. Sus muestras de posición se ordenan sobre la vuelta más rápida, se promedian por tramos de 1 m y se
   suavizan con un filtro gaussiano circular → línea central cerrada a paso fijo de 1 m.
3. s = 0 en la línea de meta: proyección media de las posiciones al inicio de cada vuelta.
4. Orientación del mapa oficial (rotación de MultiViewer si existe) y centrado del bounding box.
5. Pit lane: trayectoria de una de las paradas más cortas, sin maniobras lentas (garaje, box) ni retrocesos
   (fallos de posición), unida a la pista por curvas que salen de ella y vuelven con su dirección. Se
   descarta la de una parada con un hueco sin muestras o que no va por donde van los coches de las demás
   (`LaneFit`); sin ninguna que valga, no hay pit lane. Su altura es la de la pista más cercana, porque el
   feed da una altura fija en todo el pit lane.
6. Curvas y sectores de comisarios (si hay info de circuito) proyectados a s.

Las muestras con XY = 0 o con z = 0 por un fallo del feed no se usan.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass, field, replace

import numpy as np
import pandas as pd
from scipy.spatial import cKDTree

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

#: Versión de la construcción del circuito. Un circuito guardado con una anterior se reconstruye al
#: reutilizarlo (si la sesión encaja en él). 2: pit lane sin maniobras lentas ni retrocesos, con la altura
#: de la pista, y sin las muestras con z = 0 por fallo del feed. 3: pit lane validado con las muestras de las
#: otras paradas, sin cruzar huecos en línea recta y sin gancho hacia atrás en la entrada (en la clasificación
#: de Singapur 2026 era una cuerda a 35 m del pit lane real: los coches desaparecían en él y salían por la
#: pista); el de un circuito guardado que no sigue a los coches de la sesión se descarta al reconstruirlo.
GEOMETRY_VERSION = 3
STEP_M = 1.0
REFERENCE_LAPS = 16
MAX_SAMPLE_GAP_M = 60.0
PIT_DIVERGENCE_M = 4.0
#: Suavizado gaussiano de la línea central (en muestras de 1 m). Medido en Suzuka: con 3 m en z, el
#: desnivel del puente baja de 6,1 a 3,8 m; con 1 m queda a 0,26 m de las muestras crudas.
XY_SIGMA_M = 3.0
Z_SIGMA_M = 1.0
#: z = 0 exacto con las muestras vecinas a más de 5 m del nivel del mar (en dm): fallo del feed, no altitud.
Z_GLITCH_MIN_DM = 50
#: Por debajo de esta velocidad (km/h) el coche maniobra en el garaje, en el box o en una cola: esas
#: muestras no trazan el pit lane (un coche empujado hacia atrás dibujaría un desvío).
PIT_MIN_SPEED_KMH = 30.0
#: Un punto del pit lane debe avanzar en la dirección de la marcha (la de los últimos 10 m conservados):
#: si se desvía más de 75°, es un retroceso o un fallo de posición.
PIT_HEADING_LOOKBACK_M = 10.0
PIT_MAX_STEP_TURN_DEG = 75.0
#: Giro máximo del pit lane ya suavizado en 5 m: más es un desvío que no se pudo limpiar (se prueba con
#: otra parada).
PIT_MAX_TURN_DEG = 90.0
#: Suavizado (m) de la altura del pit lane tomada de la pista.
PIT_Z_SIGMA_M = 10.0
#: Paradas candidatas a dar el pit lane: las más cortas (menos maniobras en el box).
PIT_CANDIDATES = 20
#: Ventana de cada parada: de PitIn a PitOut, ± esto (las horas del cronometraje no son las de la
#: bifurcación).
PIT_STOP_MARGIN_MS = 15000
#: Hueco máximo (m) entre dos muestras seguidas del recorrido limpio de una parada. Más es un tramo sin
#: muestras (un hueco del feed o la cola a menos de 30 km/h, que no se usa) que el remuestreo cruzaría en
#: línea recta: en la clasificación de Singapur 2026, una cuerda de ~600 m a 35 m del pit lane real. En las
#: paradas buenas de Singapur, Japón y Bélgica, el p99,9 de los pasos es de 27 a 39 m. Un hueco mayor solo
#: vale si la recta que lo cruza va por donde van las otras paradas (`gaps_follow_the_cars`): en Singapur,
#: paradas con huecos de 45-71 m en la recta del pit lane que siguen todas las demás.
PIT_MAX_GAP_M = 40.0
#: La bifurcación no tiene muestras (el feed pega el coche a la línea de la pista hasta que ya va por el pit
#: lane): el pit lane sale de la pista con este ángulo hacia su primera muestra, y vuelve igual tras la
#: última.
PIT_FORK_DEG = 30.0
#: En la salida el pit lane se junta poco a poco con la pista (en Suzuka, 40 m a 3,5-4 m de la línea) y ahí el
#: feed no pega el coche a la pista (las posiciones de pista quedan a p90 0,13 m de la línea): el recorrido de
#: la parada sigue mientras sus muestras están a más de esto de la línea, como mucho `PIT_MERGE_MAX_M` más
#: (medido desde la última a más de `PIT_DIVERGENCE_M`). Sin tope, un coche que tras salir sigue por el borde
#: de la pista alargaba el pit lane por encima de ella: en la carrera de Suzuka, paradas con 130-210 m de más
#: (a 3-5 m de la línea, hasta la curva 1) que la validación no ve, porque solo mira lo que está a más de 4 m.
#: En las 29 paradas de esa carrera, la mediana es de 30 m.
PIT_MERGE_M = 2.0
PIT_MERGE_MAX_M = 60.0
#: Validación del pit lane con las muestras de pit lane de las otras paradas (`LaneFit`). Una parada lo
#: sigue si el p90 de la distancia de sus muestras es ≤ `PIT_FIT_MAX_P90_M` (con el bueno, en Singapur, Japón
#: y Bélgica, 0,07-0,13 m en conjunto: el feed las pega a una línea; con la cuerda de Singapur, 14,6 m). Vale
#: si lo siguen al menos `PIT_FIT_MIN_STOP_SHARE` de ellas (una parada con fallos del feed no tumba un pit
#: lane bueno) y no más de `PIT_FIT_MAX_UNCOVERED_SHARE` de él queda a más de `PIT_FIT_FAR_M` de toda
#: muestra (un recorrido por donde solo fue ese coche).
PIT_FIT_MAX_P90_M = 3.0
PIT_FIT_MIN_STOP_SHARE = 0.5
PIT_FIT_FAR_M = 5.0
PIT_FIT_MAX_UNCOVERED_SHARE = 0.10
#: Entre las paradas que valen gana la que deja menos muestras a más de `PIT_FIT_FAR_M`; si la diferencia es
#: menor que esto, la más corta.
PIT_FIT_TIE_SHARE = 0.002
#: Con menos muestras de las otras paradas (una carrera con una sola parada) se comprueba también con las
#: suyas: así solo se valida que no tenga huecos ni giros bruscos.
PIT_FIT_MIN_SAMPLES = 40
#: La cobertura (qué parte del pit lane queda lejos de toda muestra) solo se exige con las muestras de al
#: menos tantas paradas más: con menos, un hueco de las pocas que hay deja sin cubrir un pit lane bueno.
PIT_FIT_MIN_STOPS_COVERAGE = 5


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
    geometry_version: int = 1

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


def z_glitches(t_ms: np.ndarray, z: np.ndarray) -> np.ndarray:
    """Muestras con z = 0 por un fallo del feed: las vecinas (en el tiempo) están lejos del nivel del mar.

    En un circuito a nivel del mar, z = 0 puede ser real y se conserva (el error sería de pocos metros).
    Si todas son 0, el feed no trae altura: no es un fallo puntual.
    """
    t = np.asarray(t_ms, dtype=np.float64)
    z = np.asarray(z, dtype=np.float64)
    zero = z == 0
    out = np.zeros(len(z), dtype=bool)
    if not zero.any() or zero.all():
        return out
    order = np.argsort(t, kind="stable")
    ts, zs, zero_s = t[order], z[order], zero[order]
    ref = np.interp(ts[zero_s], ts[~zero_s], zs[~zero_s])
    out[order[np.flatnonzero(zero_s)]] = np.abs(ref) > Z_GLITCH_MIN_DM
    return out


def _valid_pos(df: pd.DataFrame) -> pd.DataFrame:
    df = df[~((df["x"] == 0) & (df["y"] == 0))]
    return df[~z_glitches(df["t_ms"].to_numpy(), df["z"].to_numpy())]


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


def _speed_kmh(data: SessionData, car: str, t_ms: np.ndarray) -> np.ndarray | None:
    """Velocidad de la telemetría en cada instante (None si no hay telemetría del coche)."""
    tel = data.car.get(car)
    if tel is None or len(tel) < 2:
        return None
    tel = tel.drop_duplicates("t_ms").sort_values("t_ms")
    return np.interp(t_ms, tel["t_ms"].to_numpy(dtype=np.float64), tel["speed"].to_numpy(dtype=np.float64))


def clean_pit_path(
    path: np.ndarray, speed_kmh: np.ndarray | None, heading: np.ndarray | None = None
) -> np.ndarray:
    """Muestras de una parada (m) → recorrido del pit lane, sin desvíos.

    - Fuera las muestras lentas (< 30 km/h): entrada al garaje o al box, coche empujado, cola.
    - Fuera los retrocesos: cada punto debe avanzar en la dirección de la marcha de los últimos metros. Al
      principio, sin metros detrás, la dirección es `heading` (la de la pista donde empieza el recorrido): sin
      ella, un primer punto mal situado (el feed deja el coche en la pista 10 m más allá de la bifurcación,
      Singapur 2026) daba la marcha al revés y se descartaba todo el recorrido salvo los extremos.
    El primer punto se conserva siempre; el último solo si avanza (un fallo ahí dejaría un gancho).
    """
    n = len(path)
    if n < 3:
        return path
    candidate = np.ones(n, dtype=bool) if speed_kmh is None else speed_kmh >= PIT_MIN_SPEED_KMH
    candidate[0] = True
    cos_max = float(np.cos(np.radians(PIT_MAX_STEP_TURN_DEG)))
    kept = [0]
    for i in np.flatnonzero(candidate)[1:]:
        last = path[kept[-1], :2]
        step = path[i, :2] - last
        dist = float(np.hypot(step[0], step[1]))
        if dist < 0.5:
            continue
        j = len(kept) - 1
        while j > 0 and float(np.hypot(*(path[kept[j], :2] - last))) < PIT_HEADING_LOOKBACK_M:
            j -= 1
        ref = last - path[kept[j], :2]
        ref_len = float(np.hypot(ref[0], ref[1]))
        if ref_len <= 1.0 and heading is not None:
            ref, ref_len = np.asarray(heading[:2], dtype=np.float64), float(np.hypot(heading[0], heading[1]))
        if ref_len > 1e-9 and float(np.dot(step, ref)) < cos_max * dist * ref_len:
            continue  # hacia atrás o de lado: retroceso, garaje o fallo de posición
        kept.append(int(i))
    return path[kept]


def max_turn_deg(lane: np.ndarray, window_m: float = 5.0) -> float:
    """Mayor cambio de rumbo (grados) de una polilínea a paso de 1 m en `window_m` metros."""
    d = np.diff(lane[:, :2], axis=0)
    if len(d) < 2:
        return 0.0
    heading = np.unwrap(np.arctan2(d[:, 1], d[:, 0]))
    w = max(1, min(round(window_m / STEP_M), len(heading) - 1))
    return float(np.degrees(np.abs(heading[w:] - heading[:-w]).max()))


def max_gap_m(path: np.ndarray) -> float:
    """Mayor distancia (en planta) entre dos puntos seguidos de un recorrido."""
    if len(path) < 2:
        return 0.0
    return float(np.hypot(*np.diff(path[:, :2], axis=0).T).max())


def gaps_follow_the_cars(path: np.ndarray, runs: list[np.ndarray]) -> bool:
    """¿Las rectas con que el remuestreo cruzaría los huecos de más de `PIT_MAX_GAP_M` de `path` van por donde
    van las otras paradas (`runs`, sus muestras de pit lane)?

    Cada metro de esas rectas tiene que tener una muestra a ≤ `PIT_FIT_MAX_P90_M` (en planta), y hacen falta
    las de al menos `PIT_FIT_MIN_STOPS_COVERAGE` paradas: con menos, un hueco de las pocas que hay no se
    distingue de una curva que nadie vio, y el hueco no vale.
    """
    if len(runs) < PIT_FIT_MIN_STOPS_COVERAGE:
        return False
    steps = np.hypot(*np.diff(path[:, :2], axis=0).T)
    tree = cKDTree(np.vstack(runs)[:, :2])
    for i in np.flatnonzero(steps > PIT_MAX_GAP_M):
        f = np.linspace(0.0, 1.0, int(np.ceil(steps[i] / STEP_M)) + 1)[:, None]
        bridge = path[i, :2] + f * (path[i + 1, :2] - path[i, :2])
        if float(tree.query(bridge)[0].max()) > PIT_FIT_MAX_P90_M:
            return False
    return True


def pit_z_from_track(line: np.ndarray, lane: np.ndarray, entry_u: float, exit_u: float) -> np.ndarray:
    """Altura del pit lane: la del punto más cercano (en planta) del tramo de pista que lo acompaña.

    El feed da la misma altura a todo el pit lane (en Spa, 7 m por debajo de la pista en la salida), así
    que no se usa. Se mira solo el tramo de la entrada a la salida (±50 m) para no tomar la cota de otra
    parte del trazado (un puente), y se suaviza para que no haya escalones.
    """
    index = PolylineIndex(line, closed=True)
    span = float(np.mod(exit_u - entry_u, index.length))
    s = np.arange(entry_u - 50.0, entry_u + span + 50.0, STEP_M)
    stretch = index.point_at(s)
    flat = PolylineIndex(np.column_stack([stretch[:, :2], np.zeros(len(stretch))]), closed=False)
    u, _ = flat.project(np.column_stack([lane[:, :2], np.zeros(len(lane))]))
    z = np.interp(u, flat.u[: len(stretch)], stretch[:, 2])
    return smooth_open(z[:, None], PIT_Z_SIGMA_M / STEP_M)[:, 0]


@dataclass(frozen=True)
class PitStop:
    car: str
    t_in: int  # PitInTime (ms de sesión)
    t_out: int  # el PitOutTime siguiente


def pit_stops(data: SessionData) -> list[PitStop]:
    """Paradas (entrada y la salida siguiente del mismo coche), de la más corta a la más larga."""
    stops: list[tuple[int, PitStop]] = []
    for car, laps in data.laps.groupby("car"):
        laps = laps.sort_values("lap")
        ins = laps[laps["pit_in_ms"] >= 0]["pit_in_ms"].to_numpy()
        outs = laps[laps["pit_out_ms"] >= 0]["pit_out_ms"].to_numpy()
        for t_in in ins:
            later = outs[outs > t_in]
            if len(later):
                stops.append((int(later[0] - t_in), PitStop(str(car), int(t_in), int(later[0]))))
    stops.sort(key=lambda x: (x[0], x[1].car, x[1].t_in))
    return [s for _, s in stops]


def _tangent_at(index: PolylineIndex, s: float) -> np.ndarray:
    """Dirección (unitaria, en planta) de la línea central en s."""
    a, b = index.point_at(np.array([s - 1.0, s + 1.0]))
    d = b[:2] - a[:2]
    return d / max(float(np.hypot(d[0], d[1])), 1e-9)


def _end_direction(path: np.ndarray, at_start: bool) -> np.ndarray:
    """Dirección de la marcha (unitaria) en los primeros (o últimos) 10 m de un recorrido."""
    p = path if at_start else path[::-1]
    far = np.flatnonzero(np.hypot(*(p[:, :2] - p[0, :2]).T) >= PIT_HEADING_LOOKBACK_M)
    q = p[far[0]] if len(far) else p[-1]
    d = (q[:2] - p[0, :2]) * (1.0 if at_start else -1.0)
    return d / max(float(np.hypot(d[0], d[1])), 1e-9)


def _hermite(a: np.ndarray, ta: np.ndarray, b: np.ndarray, tb: np.ndarray) -> np.ndarray:
    """Curva de Hermite cúbica de `a` (dirección `ta`) a `b` (dirección `tb`), en planta, cada ~0,5 m."""
    chord = float(np.hypot(*(b[:2] - a[:2])))
    u = np.linspace(0.0, 1.0, max(2, int(np.ceil(chord / 0.5)) + 1))[:, None]
    h00, h10 = 2 * u**3 - 3 * u**2 + 1, u**3 - 2 * u**2 + u
    h01, h11 = -2 * u**3 + 3 * u**2, u**3 - u**2
    xy = h00 * a[:2] + h10 * chord * ta + h01 * b[:2] + h11 * chord * tb
    return np.column_stack([xy, a[2] + u[:, 0] * (b[2] - a[2])])


def pit_core(pts: np.ndarray, speed_kmh: np.ndarray | None, index: PolylineIndex) -> np.ndarray | None:
    """Recorrido de una parada por el pit lane: sus muestras fuera de la pista, limpias (`clean_pit_path`).

    Las muestras a más de `PIT_DIVERGENCE_M` de la línea central (`index`, en planta), en tramos separados por
    más de `PIT_MAX_GAP_M` de recorrido por la pista o sin muestras; se queda el tramo más largo (el pit lane;
    otro sería una salida de pista en la vuelta de salida) y, tras él, las muestras que siguen a más de
    `PIT_MERGE_M` (la salida se junta poco a poco con la pista), como mucho `PIT_MERGE_MAX_M` de recorrido
    (después ya va por el borde de la pista). Las de pista junto a la entrada no sirven: el
    feed pega el coche a la línea de la pista hasta que ya va por el pit lane (en Singapur 2026 lo deja 10 m
    más allá de la bifurcación; en Spa, hasta que está a 20 m).
    """
    _, dist = index.project(pts)
    off = np.flatnonzero(dist > PIT_DIVERGENCE_M)
    if len(off) < 10:
        return None
    travel = arclength(pts)
    cuts = np.flatnonzero(np.diff(travel[off]) > PIT_MAX_GAP_M) + 1
    groups = np.split(off, cuts)
    group = max(groups, key=len)
    a, b = int(group[0]), int(group[-1])
    while (
        b + 1 < len(pts)
        and dist[b + 1] > PIT_MERGE_M
        and travel[b + 1] - travel[group[-1]] <= PIT_MERGE_MAX_M
    ):
        b += 1
    u0, _ = index.project(pts[a : a + 1])
    speed = None if speed_kmh is None else speed_kmh[a : b + 1]
    return clean_pit_path(pts[a : b + 1], speed, heading=_tangent_at(index, float(u0[0])))


def pit_lane_from_core(core: np.ndarray, index: PolylineIndex) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Recorrido limpio → pit lane a paso de 1 m, recorrido sin suavizar con las uniones y tramo con muestras.

    El recorrido se suaviza y se une a la línea central por los dos lados con una curva de Hermite que sale
    de la pista (y llega a ella) con su dirección: el pit lane empieza donde se separa de la pista, sin gancho
    hacia atrás. La bifurcación no tiene muestras (el feed pega el coche a la pista): se sitúa donde una
    separación de `PIT_FORK_DEG` llevaría a la primera muestra; la vuelta, igual tras la última.
    """
    smooth = resample(smooth_open(resample(core, 1.0, closed=False), 2.0), STEP_M, closed=False)
    tan_fork = float(np.tan(np.radians(PIT_FORK_DEG)))
    (u_in, u_out), (d_in, d_out) = index.project(smooth[[0, -1]])
    s_in = float(u_in) - float(d_in) / tan_fork
    s_out = float(u_out) + float(d_out) / tan_fork
    fork_in, fork_out = index.point_at(np.array([s_in, s_out]))
    bridge_in = _hermite(fork_in, _tangent_at(index, s_in), smooth[0], _end_direction(smooth, at_start=True))
    bridge_out = _hermite(
        smooth[-1], _end_direction(smooth, at_start=False), fork_out, _tangent_at(index, s_out)
    )
    lane = resample(np.vstack([bridge_in[:-1], smooth, bridge_out[1:]]), STEP_M, closed=False)
    raw = np.vstack([bridge_in[:-1], core, bridge_out[1:]])
    return lane, raw, smooth


def _stop_window(data: SessionData, stop: PitStop) -> pd.DataFrame | None:
    df = data.pos.get(stop.car)
    if df is None:
        return None
    v = _valid_pos(df)
    return v[(v["t_ms"] >= stop.t_in - PIT_STOP_MARGIN_MS) & (v["t_ms"] <= stop.t_out + PIT_STOP_MARGIN_MS)]


def pit_fit_samples(
    data: SessionData,
    index: PolylineIndex,
    stops: list[PitStop],
    to_m: Callable[[np.ndarray], np.ndarray] = lambda xyz_dm: xyz_dm / 10.0,
) -> dict[PitStop, np.ndarray]:
    """Muestras (m, en el sistema de `index`) que van claramente por el pit lane, por parada.

    En la ventana de cada parada, a más de `PIT_DIVERGENCE_M` de la línea central (en planta) y a ≥ 30 km/h
    (en el garaje o en el box el coche va despacio y está fuera del pit lane). Son las que el pit lane tiene
    que seguir. `to_m` lleva las posiciones del feed (dm) al sistema de `index`.
    """
    out: dict[PitStop, np.ndarray] = {}
    for stop in stops:
        sel = _stop_window(data, stop)
        if sel is None or sel.empty:
            continue
        pts = to_m(sel[["x", "y", "z"]].to_numpy(dtype=np.float64))
        _, dist = index.project(pts)
        keep = dist > PIT_DIVERGENCE_M
        speed = _speed_kmh(data, stop.car, sel["t_ms"].to_numpy(dtype=np.float64))
        if speed is not None:
            keep &= speed >= PIT_MIN_SPEED_KMH
        if keep.any():
            out[stop] = pts[keep]
    return out


@dataclass(frozen=True)
class LaneFit:
    """Cómo sigue un pit lane a las muestras de pit lane de las paradas (en planta)."""

    stop_share: float  # fracción de las paradas que lo siguen (p90 de sus muestras ≤ PIT_FIT_MAX_P90_M)
    p50_m: float  # distancia al pit lane de las muestras de las paradas que lo siguen
    p90_m: float
    far_share: float  # fracción de todas las muestras a más de PIT_FIT_FAR_M del pit lane
    uncovered_share: float  # fracción del tramo con muestras a más de PIT_FIT_FAR_M de toda muestra
    samples: int
    stops: int

    @property
    def ok(self) -> bool:
        return (
            self.stop_share >= PIT_FIT_MIN_STOP_SHARE and self.uncovered_share <= PIT_FIT_MAX_UNCOVERED_SHARE
        )


def lane_fit(lane: np.ndarray, runs: list[np.ndarray], covered: np.ndarray | None = None) -> LaneFit:
    """Ajuste de `lane` a las muestras de cada parada (`runs`); `covered` es la parte del pit lane que tiene
    que tenerlas cerca (por defecto, todo él)."""
    flat = PolylineIndex(lane, closed=False, z_weight=0.0)
    dists = [flat.project(r)[1] for r in runs if len(r)]
    if not dists:
        raise ValueError("sin muestras con que comprobar el pit lane")
    follow = [d for d in dists if np.percentile(d, 90) <= PIT_FIT_MAX_P90_M]
    every = np.concatenate(dists)
    near = np.concatenate(follow) if follow else None
    part = lane if covered is None else covered
    if len(part):
        gap, _ = cKDTree(np.vstack(runs)[:, :2]).query(part[:, :2])
        uncovered = float(np.mean(gap > PIT_FIT_FAR_M))
    else:
        uncovered = 0.0
    return LaneFit(
        stop_share=len(follow) / len(dists),
        p50_m=float(np.percentile(near, 50)) if near is not None else float("inf"),
        p90_m=float(np.percentile(near, 90)) if near is not None else float("inf"),
        far_share=float(np.mean(every > PIT_FIT_FAR_M)),
        uncovered_share=uncovered,
        samples=len(every),
        stops=len(dists),
    )


@dataclass
class PitLane:
    lane: np.ndarray  # (M, 3) m, sistema de la línea central
    entry_s: float
    exit_s: float
    samples_length_m: float  # longitud del recorrido sin suavizar, para validar el suavizado
    fit: LaneFit  # frente a las muestras de las otras paradas
    car: str


def build_pitlane(
    data: SessionData,
    line: np.ndarray,
    to_m: Callable[[np.ndarray], np.ndarray] = lambda xyz_dm: xyz_dm / 10.0,
) -> PitLane | None:
    """Pit lane (m, en el sistema de `line`) de la parada que mejor sigue a las demás; None si ninguna vale.

    Candidatas: las `PIT_CANDIDATES` paradas más cortas. Se descarta una parada con un hueco de más de
    `PIT_MAX_GAP_M` en su recorrido limpio que no va por donde van las otras (`gaps_follow_the_cars`: el
    remuestreo lo cruzaría en línea recta), con un giro brusco o cuyo pit lane no siguen la mayoría de las
    otras paradas (`LaneFit.ok`). De las que valen, la que deja menos muestras lejos; a igualdad, la más
    corta. Sin ninguna, no hay pit lane: mejor sin dato que un pit lane por donde no van los coches. `to_m`
    lleva las posiciones del feed (dm) al sistema de `line` (por defecto, el del feed en m).
    """
    # En planta: el feed da una altura fija a todo el pit lane, que no es la de la pista.
    index = PolylineIndex(line, closed=True, z_weight=0.0)
    stops = pit_stops(data)
    fit_samples = pit_fit_samples(data, index, stops, to_m=to_m)
    best: PitLane | None = None
    for stop in stops[:PIT_CANDIDATES]:
        sel = _stop_window(data, stop)
        if sel is None or len(sel) < 20:
            continue
        pts = to_m(sel[["x", "y", "z"]].to_numpy(dtype=np.float64))
        core = pit_core(pts, _speed_kmh(data, stop.car, sel["t_ms"].to_numpy(dtype=np.float64)), index)
        if core is None or len(core) < 10:
            continue
        others = [p for s, p in fit_samples.items() if s != stop]
        gap = max_gap_m(core)
        if gap > PIT_MAX_GAP_M and not gaps_follow_the_cars(core, others):
            log.info("pit lane del coche %s descartado: hueco de %.0f m sin muestras", stop.car, gap)
            continue
        lane, raw, smooth = pit_lane_from_core(core, index)
        if max_turn_deg(lane) > PIT_MAX_TURN_DEG:
            log.info("pit lane del coche %s descartado: giro brusco (desvío o fallo de posición)", stop.car)
            continue
        runs = list(others)
        if sum(len(r) for r in runs) < PIT_FIT_MIN_SAMPLES and stop in fit_samples:
            runs.append(fit_samples[stop])
        if not runs:
            continue
        if len(others) >= PIT_FIT_MIN_STOPS_COVERAGE:
            _, d_smooth = index.project(smooth)
            covered = smooth[d_smooth > PIT_DIVERGENCE_M]
        else:
            covered = smooth[:0]
        fit = lane_fit(lane, runs, covered=covered)
        if not fit.ok:
            log.info(
                "pit lane del coche %s descartado: no va por donde van los coches (lo sigue el %.0f %% de "
                "las paradas; %.1f %% del pit lane a más de %.0f m de toda muestra)",
                stop.car,
                100 * fit.stop_share,
                100 * fit.uncovered_share,
                PIT_FIT_FAR_M,
            )
            continue
        if best is not None and fit.far_share >= best.fit.far_share - PIT_FIT_TIE_SHARE:
            continue  # no sigue mejor a los coches que una parada más corta
        entry_u, _ = index.project(lane[:1])
        exit_u, _ = index.project(lane[-1:])
        lane[:, 2] = pit_z_from_track(line, lane, float(entry_u[0]), float(exit_u[0]))
        best = PitLane(lane, float(entry_u[0]), float(exit_u[0]), float(arclength(raw)[-1]), fit, stop.car)
    if best is None:
        log.warning(
            "no se pudo extraer el pit lane: ninguna parada lo da sin huecos y por donde van los coches"
        )
    return best


#: Claves de `Circuit.quality` que describen el pit lane (o su falta): cambian enteras con él.
PIT_QUALITY_KEYS = (
    "pitSamplesLengthM",
    "pitFitStopShare",
    "pitFitP50M",
    "pitFitP90M",
    "pitFitFarShare",
    "pitFitUncoveredShare",
    "pitFitSamples",
    "pitFitStops",
    "pitStops",
    "pitDroppedStopShare",
)


def pit_quality(pit: PitLane | None, stops: int) -> dict[str, float]:
    """Calidad del pit lane para `Circuit.quality`: cómo sigue a las muestras de pit lane de las otras paradas
    (`LaneFit`) o, sin pit lane, cuántas paradas tenía la sesión (`pitStops`: el aviso `pitlane-missing`
    distingue así una sesión sin paradas de una en la que ninguna lo daba bien)."""
    if pit is None:
        return {"pitStops": float(stops)}
    return {
        "pitSamplesLengthM": pit.samples_length_m,
        "pitFitStopShare": pit.fit.stop_share,
        "pitFitP50M": pit.fit.p50_m,
        "pitFitP90M": pit.fit.p90_m,
        "pitFitFarShare": pit.fit.far_share,
        "pitFitUncoveredShare": pit.fit.uncovered_share,
        "pitFitSamples": float(pit.fit.samples),
        "pitFitStops": float(pit.fit.stops),
    }


def add_pitlane(data: SessionData, circuit: Circuit) -> Circuit | None:
    """El circuito (sin pit lane) con el que da esta sesión (`build_pitlane`, en el sistema canónico del
    circuito); lo demás (línea central, meta, curvas, rotación, sectores) no cambia. None si no da ninguno."""
    pit = build_pitlane(data, circuit.centerline, to_m=circuit.to_canonical)
    if pit is None:
        return None
    quality = {k: v for k, v in circuit.quality.items() if k not in PIT_QUALITY_KEYS}
    return replace(
        circuit,
        pitlane=pit.lane,
        pit_entry_s=pit.entry_s,
        pit_exit_s=pit.exit_s,
        quality={**quality, **pit_quality(pit, 0)},
        dev=circuit.dev or data.dev,
    )


def circuit_pit_fit(data: SessionData, circuit: Circuit) -> LaneFit | None:
    """Cómo sigue el pit lane de un circuito (canónico) a las muestras de pit lane de una sesión.

    None si el circuito no tiene pit lane o la sesión no trae muestras suficientes con que comprobarlo (una
    sprint sin paradas). Sirve para no conservar, al reconstruir un circuito anticuado, un pit lane por donde
    no van los coches.
    """
    if circuit.pitlane is None:
        return None
    index = PolylineIndex(circuit.centerline, closed=True, z_weight=0.0)
    runs = list(pit_fit_samples(data, index, pit_stops(data), to_m=circuit.to_canonical).values())
    if sum(len(r) for r in runs) < PIT_FIT_MIN_SAMPLES:
        return None
    return lane_fit(circuit.pitlane, runs, covered=circuit.pitlane[:0])


def build_circuit(data: SessionData, circuit_id: str, name: str) -> Circuit:
    line_raw, quality = build_centerline(data)
    s0, finish_laps = finish_line_s(data, line_raw)
    if finish_laps < MIN_FINISH_LAPS:
        # Solo si se usa la reserva: así los circuitos normales conservan su hash. Va con el circuito
        # porque cada sesión que lo reutilice hereda la meta aproximada (y su nota de calidad).
        quality["finishLineLaps"] = float(finish_laps)
    idx0 = round(s0 / STEP_M) % len(line_raw)
    line_raw = np.roll(line_raw, -idx0, axis=0)
    pit_built = build_pitlane(data, line_raw)

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
    pit = canon(pit_built.lane) if pit_built is not None else None
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
    quality.update(pit_quality(pit_built, 0 if pit_built is not None else len(pit_stops(data))))
    return Circuit(
        circuit_id=circuit_id,
        name=name,
        rotation_deg=rotation,
        center=center,
        z_base=z_base,
        centerline=line,
        pitlane=pit,
        pit_entry_s=pit_built.entry_s if pit_built is not None else None,
        pit_exit_s=pit_built.exit_s if pit_built is not None else None,
        corners=corners,
        marshal_sectors=marshal,
        quality=quality,
        sources=sources,
        dev=dev,
        geometry_version=GEOMETRY_VERSION,
    )
