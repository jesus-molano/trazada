"""Pit lane y transiciones pista ↔ pit lane frente a lo visto en la clasificación de Singapur 2026.

- El pit lane salía de la parada más corta aunque su recorrido tuviera un hueco (del feed, o la cola a menos
  de 30 km/h, que no se usa): el remuestreo lo cruzaba en línea recta, a 35 m del pit lane real. Los coches
  desaparecían en él y salían por la pista.
- El feed deja el coche en la línea de la pista ~10 m más allá de la bifurcación cuando ya va por el pit lane:
  el pit lane empezaba con un gancho hacia atrás y el coche se dibujaba yendo hacia atrás al entrar.

A la sesión sintética se le inyecta cada caso. Los tests usan la API pública para que se puedan pasar contra
el código anterior y fallen.
"""

from __future__ import annotations

import itertools
import json
from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest
from synthetic import (
    PIT,
    PIT_LEN,
    PIT_SPAN,
    START_MS,
    TRACK_SPEED,
    CarSim,
    add_car,
    synthetic_session,
    track_point,
)

from trazada_pipeline.build import BuildReport, build_session
from trazada_pipeline.circuit.build import (
    GEOMETRY_VERSION,
    PIT_MERGE_MAX_M,
    Circuit,
    PitLane,
    build_centerline,
    build_circuit,
    build_pitlane,
    clean_pit_path,
    gaps_follow_the_cars,
    pit_core,
)
from trazada_pipeline.circuit.geometry import PolylineIndex, resample
from trazada_pipeline.circuit.store import load_circuit, save_circuit
from trazada_pipeline.projection import (
    PATH_NODATA,
    PATH_PIT,
    PATH_TRACK,
    project_session,
    switch_overshoot,
)
from trazada_pipeline.sources.base import SessionData

CIRCUIT_ID = "0-synthetic-dev"


def _flat(points: np.ndarray) -> np.ndarray:
    return np.column_stack([points[:, :2], np.zeros(len(points))])


def _pit_v(sim: CarSim, t: np.ndarray) -> np.ndarray:
    """Metros recorridos por el pit lane en cada instante (NaN fuera de él)."""
    v = np.full(len(t), np.nan)
    for g in sim.segs:
        if g.mode != "pit":
            continue
        sel = (t >= g.t0) & (t <= g.t1)
        f = (t[sel] - g.t0) / max(g.t1 - g.t0, 1e-9)
        v[sel] = g.p0 + f * (g.p1 - g.p0)
    return v


def _pit_base(sim: CarSim, t: float) -> float:
    """s acumulada de la entrada al pit lane de la parada en curso en t."""
    return next(g.base for g in sim.segs if g.mode == "pit" and g.t0 <= t <= g.t1)


def _lane_offset(circuit: Circuit) -> tuple[float, float]:
    """Distancia (en planta) del pit lane construido al verdadero: la mayor en el tramo con muestras (a más
    de 4 m de la pista) y en las uniones con la pista, que son modeladas (la bifurcación no tiene
    muestras)."""
    assert circuit.pitlane is not None
    truth = PolylineIndex(_flat(circuit.to_canonical(resample(PIT, 0.25, closed=False) * 10.0)), closed=False)
    off = truth.project(_flat(circuit.pitlane))[1]
    sampled = PolylineIndex(_flat(circuit.centerline), closed=True).project(_flat(circuit.pitlane))[1] > 4.0
    return float(off[sampled].max()), float(off[~sampled].max())


def _drawn(circuit: Circuit, path: np.ndarray, s: np.ndarray) -> np.ndarray:
    """Dónde dibuja el front cada muestra (como `placeOnCircuit` de `engine/replay/place.ts`)."""
    track = PolylineIndex(circuit.centerline, closed=True)
    out = np.full((len(s), 2), np.nan)
    on_track = path == PATH_TRACK
    out[on_track] = track.point_at(np.mod(s[on_track], track.length))[:, :2]
    on_pit = path == PATH_PIT
    if on_pit.any():
        assert circuit.pitlane is not None
        assert circuit.pit_entry_s is not None and circuit.pit_exit_s is not None
        pit = PolylineIndex(circuit.pitlane, closed=False)
        span = np.mod(circuit.pit_exit_s - circuit.pit_entry_s, track.length)
        f = np.clip(np.mod(s[on_pit] - circuit.pit_entry_s, track.length) / span, 0.0, 1.0)
        out[on_pit] = pit.point_at(f * pit.length)[:, :2]
    return out


def _gap_in_the_lane(
    data: SessionData,
    sims: dict[str, CarSim],
    car: str,
    how: str,
    v0: float = 30.0,
    v1: float = PIT_LEN - 30.0,
) -> None:
    """Sin muestras útiles entre los metros `v0` y `v1` del pit lane de un coche (por defecto, todo salvo los
    primeros y los últimos 30 m): un hueco del feed (`gap`) o la cola de la clasificación a menos de 30 km/h
    (`slow`: la telemetría lo dice y esas muestras no se usan)."""
    sim, pos, tel = sims[car], data.pos[car], data.car[car]
    v = _pit_v(sim, pos["t_ms"].to_numpy(dtype=np.float64))
    if how == "gap":
        data.pos[car] = pos[~((v > v0) & (v < v1))].reset_index(drop=True)
    else:
        tv = _pit_v(sim, tel["t_ms"].to_numpy(dtype=np.float64))
        tel.loc[(tv > v0) & (tv < v1), "speed"] = 25


def _gap_in_every_stop(data: SessionData, sims: dict[str, CarSim], v0: float, v1: float) -> None:
    for car, sim in sims.items():
        if sim.pit_in:
            _gap_in_the_lane(data, sims, car, "gap", v0, v1)


def _pin_to_the_track(data: SessionData, sims: dict[str, CarSim], lead_m: float) -> dict[str, np.ndarray]:
    """Singapur 2026: en los primeros 10 m del pit lane el feed sigue dando el coche en la línea de la pista,
    `lead_m` por delante; la primera muestra del pit lane queda por detrás. Devuelve las filas tocadas."""
    pinned = {}
    for car, sim in sims.items():
        if not sim.pit_in:
            continue
        pos = data.pos[car]
        t = pos["t_ms"].to_numpy(dtype=np.float64)
        rows = np.flatnonzero(_pit_v(sim, t) <= 10.0)
        base = np.array([_pit_base(sim, x) for x in t[rows]])
        xyz = track_point(base + _pit_v(sim, t[rows]) + lead_m)
        pos.loc[pos.index[rows], ["x", "y", "z"]] = np.rint(xyz * 10).astype(np.int64)
        pinned[car] = rows
    return pinned


def _notes(report: BuildReport) -> list[dict]:
    return json.loads(report.manifest_path.read_text(encoding="utf-8"))["quality"]["notes"]


def _more_stops(data: SessionData, sims: dict[str, CarSim], n: int = 5) -> None:
    """Cinco coches más con una parada de 3 a 7 s en el box (más larga que el drive-through del 2 y la
    parada del 1): con 5 paradas o más con que comparar se comprueba también la cobertura."""
    for k in range(n):
        num = str(7 + k)
        c = (
            CarSim(num, START_MS + 9000 + 1500 * k, 1.0)
            .laps(1 + k % 2)
            .to_pit_entry()
            .pit(stop_at_v=150.0 + 10 * k, stop_s=3.0 + k)
            .laps(1)
        )
        add_car(data, c, seed=100 + k)
        sims[num] = c


def _pit_lane_of(data: SessionData) -> PitLane | None:
    return build_pitlane(data, build_centerline(data)[0])


# --- el pit lane: sin cuerdas, sin gancho, validado con los coches ---


def test_clean_session_pit_lane_follows_the_cars() -> None:
    c = build_circuit(synthetic_session()[0], CIRCUIT_ID, "Synthetic")
    assert c.geometry_version == GEOMETRY_VERSION == 3
    sampled, joins = _lane_offset(c)
    assert sampled < 1.0 and joins < 3.0, (sampled, joins)
    assert c.quality["pitFitP90M"] < 1.0
    assert c.quality["pitFitFarShare"] == 0.0
    assert c.quality["pitFitSamples"] > 100
    assert c.pit_entry_s is not None and c.pit_exit_s is not None
    span = np.mod(c.pit_exit_s - c.pit_entry_s, c.length)
    assert abs(span - PIT_SPAN) < 15.0, span


@pytest.mark.parametrize("how", ["gap", "slow"])
def test_pit_lane_never_bridges_a_gap_in_a_straight_line(how: str) -> None:
    """La parada más corta (el drive-through del coche 2) no tiene muestras útiles en mitad del pit lane: su
    recorrido cruzaría la curva de la entrada y la de la salida en línea recta, 9 m por dentro."""
    data, sims = synthetic_session()
    _gap_in_the_lane(data, sims, "2", how)
    c = build_circuit(data, CIRCUIT_ID, "Synthetic")
    assert c.pitlane is not None
    sampled, joins = _lane_offset(c)
    assert sampled < 1.0 and joins < 3.0, (sampled, joins)
    assert c.quality["pitFitP90M"] < 1.0


@pytest.mark.parametrize(
    ("more_stops", "v0", "v1", "from_the_gap"),
    [
        (True, 150.0, 205.0, True),  # en la recta, por donde van las otras 7 paradas
        (True, 20.0, 90.0, False),  # cruza la curva de la entrada: la recta va 6,6 m por dentro
        (False, 150.0, 205.0, False),  # en la recta, pero solo 2 paradas más: no se puede comprobar
    ],
)
def test_a_gap_is_bridged_only_where_the_other_cars_go(
    more_stops: bool, v0: float, v1: float, from_the_gap: bool
) -> None:
    """La parada más corta va a menos de 30 km/h unos 60 m (la cola de la clasificación: esas muestras no
    se usan). En la clasificación de Singapur 2026, paradas con huecos así de 45-71 m en la recta del pit
    lane, que siguen todas las demás, se descartaban: un hueco solo vale si la recta que lo cruza va por
    donde van las otras paradas."""
    data, sims = synthetic_session()
    if more_stops:
        _more_stops(data, sims)
    _gap_in_the_lane(data, sims, "2", "slow", v0, v1)
    pit = _pit_lane_of(data)
    assert pit is not None
    assert (pit.car == "2") is from_the_gap, pit.car


def test_gaps_follow_the_cars_checks_every_metre_of_the_bridge() -> None:
    """Recorrido en L (40 m en diagonal y luego recto, como la entrada del sintético) y muestras de otras
    paradas por él: un hueco en la recta vale; uno que cruza la esquina (la recta va 6,6 m por dentro), no; y
    con menos de 5 paradas con que comprobarlo, ninguno."""
    corner = np.array([[0.0, 0.0, 0.0], [50.0, -20.0, 0.0], [350.0, -20.0, 0.0]])
    truth = resample(corner, 1.0, closed=False)
    v = np.hypot(*np.diff(truth[:, :2], axis=0).T).cumsum()
    v = np.r_[0.0, v]
    runs = [truth[k::5] for k in range(5)]  # cinco paradas, cada una con una muestra cada 5 m

    def with_gap(v0: float, v1: float) -> np.ndarray:
        return truth[(v <= v0) | (v >= v1)][::4]

    assert gaps_follow_the_cars(with_gap(150.0, 210.0), runs)
    assert not gaps_follow_the_cars(with_gap(20.0, 90.0), runs)
    assert not gaps_follow_the_cars(with_gap(150.0, 210.0), runs[:4])


def test_pit_lane_through_where_no_other_car_goes_is_not_used() -> None:
    """La parada más corta va 6 m fuera de la pista 80 m antes de la entrada (las demás siguen en la pista,
    pegadas a la línea, hasta el pit lane): sus muestras de pit lane siguen bien ese pit lane, pero ese tramo
    no lo cubre ninguna de las otras 7 paradas. Se usa el de otra parada."""
    data, sims = synthetic_session()
    _more_stops(data, sims)
    sim, pos = sims["2"], data.pos["2"]
    t = pos["t_ms"].to_numpy(dtype=np.float64)
    t_in = sim.pit_in[0]
    rows = np.flatnonzero((t > t_in - 80.0 / TRACK_SPEED * 1000) & (t < t_in))
    assert len(rows) >= 5
    pos.loc[pos.index[rows], "y"] -= 60  # 6 m hacia fuera (hacia el pit lane)
    pit = _pit_lane_of(data)
    assert pit is not None and pit.car != "2", pit.car if pit else None
    assert pit.fit.uncovered_share <= 0.10


def test_a_later_stop_that_follows_the_cars_better_wins() -> None:
    """La parada más corta va 6 m por fuera durante ~30 m: su pit lane vale (lo siguen las otras paradas,
    p90 ≤ 3 m), pero deja más muestras lejos que el de la siguiente, que es el que se usa."""
    data, sims = synthetic_session()
    pos = data.pos["2"]
    v = _pit_v(sims["2"], pos["t_ms"].to_numpy(dtype=np.float64))
    shift = np.nan_to_num(np.clip(np.minimum(v - 200.0, 231.0 - v) / 8.0, 0.0, 1.0)) * 6.0
    pos["y"] = pos["y"] - np.rint(shift * 10).astype(np.int64)
    c = build_circuit(data, CIRCUIT_ID, "Synthetic")
    assert c.pitlane is not None
    sampled, joins = _lane_offset(c)
    assert sampled < 1.0 and joins < 3.0, (sampled, joins)


def test_pit_lane_exit_stops_where_the_car_runs_along_the_track() -> None:
    """Tras salir, la parada más corta sigue 90 m a 3 m de la línea, por el borde de la pista (en la
    carrera de Suzuka, hasta 210 m): el pit lane sigue la salida que se junta con la pista, no más de
    `PIT_MERGE_MAX_M`."""
    data, sims = synthetic_session()
    sim, pos = sims["2"], data.pos["2"]
    t = pos["t_ms"].to_numpy(dtype=np.float64)
    t_out = sim.pit_out[0]
    rows = np.flatnonzero((t > t_out) & (t < t_out + 90.0 / TRACK_SPEED * 1000))
    pos.loc[pos.index[rows], "y"] -= 30  # 3 m hacia fuera, en la recta de después de la salida
    c = build_circuit(data, CIRCUIT_ID, "Synthetic")
    assert c.pit_entry_s is not None and c.pit_exit_s is not None
    span = np.mod(c.pit_exit_s - c.pit_entry_s, c.length)
    # La salida sintética se junta con la pista en PIT_SPAN; más allá, como mucho los 60 m y la unión (sin
    # tope, ~95 m).
    assert span < PIT_SPAN + 70.0, span


def _shift_out(data: SessionData, sims: dict[str, CarSim], car: str) -> None:
    """Las muestras del pit lane del coche van 6 m más afuera entre los metros 90 y 310 (sin huecos ni giros
    bruscos: un fallo del feed que solo se ve comparando con las otras paradas)."""
    pos = data.pos[car]
    v = _pit_v(sims[car], pos["t_ms"].to_numpy(dtype=np.float64))
    shift = np.nan_to_num(np.clip(np.minimum(v - 90.0, 310.0 - v) / 30.0, 0.0, 1.0)) * 6.0
    pos["y"] = pos["y"] - np.rint(shift * 10).astype(np.int64)  # hacia fuera del circuito


def test_pit_lane_goes_where_the_other_cars_go() -> None:
    """La parada más corta va 6 m por fuera de las demás: el pit lane sale de otra que siguen todas."""
    data, sims = synthetic_session()
    _shift_out(data, sims, "2")
    c = build_circuit(data, CIRCUIT_ID, "Synthetic")
    assert c.pitlane is not None
    sampled, joins = _lane_offset(c)
    assert sampled < 1.0 and joins < 3.0, (sampled, joins)
    assert c.quality["pitFitStopShare"] == 0.5  # lo sigue la otra parada; la desviada, no


def test_a_pit_lane_the_other_cars_do_not_follow_is_not_used() -> None:
    """La única parada sin huecos va 6 m por fuera de las otras dos (que tienen un hueco de 100 m y no dan
    el pit lane, pero sí con qué comprobarlo): no hay pit lane, mejor que uno por donde no van los coches."""
    data, sims = synthetic_session()
    _shift_out(data, sims, "2")
    for car in ("1", "4"):
        _gap_in_the_lane(data, sims, car, "gap", 150.0, 250.0)
    c = build_circuit(data, CIRCUIT_ID, "Synthetic")
    assert c.pitlane is None


def test_a_single_stop_with_a_slow_stretch_gives_no_pit_lane() -> None:
    """Una sola parada (sin otras con que compararla) y a menos de 30 km/h por la curva de la entrada (la
    cola de la clasificación): su recorrido rápido la cruzaría en línea recta, 7 m por dentro. Sin otra
    parada que lo desmienta, solo el hueco lo delata: no hay pit lane."""
    data, sims = synthetic_session()
    laps = data.laps
    laps.loc[laps["car"].isin(["1", "4"]), ["pit_in_ms", "pit_out_ms"]] = -1
    _gap_in_the_lane(data, sims, "2", "slow", 30.0, 120.0)
    c = build_circuit(data, CIRCUIT_ID, "Synthetic")
    assert c.pitlane is None


def test_no_pit_lane_rather_than_a_wrong_one() -> None:
    """Todas las paradas tienen el hueco: ninguna da el pit lane, así que no hay (antes, una cuerda). Y sin
    pit lane, el coche en el pit lane (20 m fuera de la recta) queda sin dato, nunca pegado a la trazada."""
    data, sims = synthetic_session()
    _gap_in_every_stop(data, sims, 30.0, PIT_LEN - 30.0)
    c = build_circuit(data, CIRCUIT_ID, "Synthetic")
    assert c.pitlane is None and c.pit_entry_s is None and c.pit_exit_s is None
    assert "pitFitP90M" not in c.quality

    m = project_session(data, c)["4"]  # bandera roja: 10 min parado en el pit lane, junto a la salida
    hold = next(g for g in sims["4"].segs if g.mode == "pit" and g.p0 == g.p1)
    xyz, _, _ = sims["4"].truth(m.t_ms.astype(np.float64))
    track = PolylineIndex(_flat(c.centerline), closed=True)
    far = track.project(_flat(c.to_canonical(xyz * 10.0)))[1] > 8.0
    in_lane = far & (m.t_ms > hold.t0) & (m.t_ms < hold.t1)
    assert in_lane.sum() > 1000
    assert np.all(m.path[in_lane] == PATH_NODATA)


def test_no_pit_lane_hides_the_exit_queue_after_pit_out() -> None:
    """Sin pit lane, el cronometraje da la salida 20 s antes de que el coche deje la cola del semáforo (en
    Singapur 2026, hasta 24 s): esa cola, fuera de la pista, queda sin dato; con un margen de 3 s se dibujaba
    en la pista."""
    data, sims = synthetic_session()
    _gap_in_every_stop(data, sims, 30.0, PIT_LEN - 30.0)
    laps = data.laps
    out = (laps["car"] == "4") & (laps["pit_out_ms"] >= 0)
    assert out.sum() == 1
    laps.loc[out, "pit_out_ms"] -= 20_000
    c = build_circuit(data, CIRCUIT_ID, "Synthetic")
    assert c.pitlane is None
    m = project_session(data, c)["4"]
    xyz, _, _ = sims["4"].truth(m.t_ms.astype(np.float64))
    track = PolylineIndex(_flat(c.centerline), closed=True)
    far = track.project(_flat(c.to_canonical(xyz * 10.0)))[1] > 8.0
    queue = far & (m.t_ms > sims["4"].pit_out[0] - 20_000 + 3000)
    assert queue.sum() > 20
    assert np.all(m.path[queue] == PATH_NODATA)


def test_pit_lane_starts_where_it_leaves_the_track_without_a_hook() -> None:
    """El feed deja el coche en la pista 8 m por delante en los primeros 10 m del pit lane: el pit lane no
    puede empezar en esa muestra de pista y volver hacia atrás."""
    data, sims = synthetic_session()
    _pin_to_the_track(data, sims, lead_m=8.0)
    c = build_circuit(data, CIRCUIT_ID, "Synthetic")
    assert c.pitlane is not None
    # Desde el primer punto, su proyección en la pista nunca retrocede.
    track = PolylineIndex(_flat(c.centerline), closed=True)
    u, _ = track.project(_flat(c.pitlane[:60]))
    du = np.diff(np.unwrap(u, period=track.length))
    assert du.min() > -0.05, du.min()
    sampled, joins = _lane_offset(c)
    assert sampled < 1.0 and joins < 3.0, (sampled, joins)


def test_clean_pit_path_drops_a_last_point_that_goes_back() -> None:
    """El último punto solo se conserva si avanza: un fallo ahí dejaría un gancho al final."""
    path = np.column_stack([np.r_[np.arange(20) * 5.0, 80.0], np.zeros(21), np.zeros(21)])
    out = clean_pit_path(path, None, heading=np.array([1.0, 0.0]))
    assert np.all(np.diff(out[:, 0]) > 0)
    assert out[-1, 0] == 95.0


def test_pit_core_merge_has_a_length_limit() -> None:
    """Tras el pit lane, 150 m a 3 m de la línea (un coche por el borde de la pista): el recorrido sigue la
    salida lenta como mucho `PIT_MERGE_MAX_M` (unos 12 m de ellos, el salto de 15 a 3 m)."""
    track = PolylineIndex(_ring(500.0, 0.0, 2 * np.pi, 1.0), closed=True, z_weight=0.0)
    pts = np.vstack(
        [
            _ring(500.0, -0.10, 0.00),
            _ring(515.0, 0.00, 0.50),
            _ring(503.0, 0.50, 0.80),
            _ring(500.0, 0.80, 0.90),
        ]
    )
    core = pit_core(pts, None, track)
    assert core is not None
    angle = np.arctan2(core[:, 1], core[:, 0])
    assert 0.5 + 30.0 / 503 < angle.max() < 0.5 + 60.0 / 503, angle.max()
    assert PIT_MERGE_MAX_M == 60.0


def test_clean_pit_path_uses_the_track_heading_at_the_start() -> None:
    """Sin metros detrás, un segundo punto 3 m por detrás del primero pasaba: el gancho del principio."""
    path = np.column_stack([np.r_[0.0, -3.0, np.arange(1, 20) * 5.0], np.zeros(21), np.zeros(21)])
    out = clean_pit_path(path, None, heading=np.array([1.0, 0.0]))
    assert np.all(np.diff(out[:, 0]) > 0)
    assert len(out) == 20


def _ring(radius: float, a0: float, a1: float, step_m: float = 5.0) -> np.ndarray:
    n = max(2, round((a1 - a0) * radius / step_m))
    a = np.linspace(a0, a1, n, endpoint=False)
    return np.column_stack([radius * np.cos(a), radius * np.sin(a), np.zeros(n)])


def test_pit_core_follows_a_slow_merge_and_ignores_a_later_excursion() -> None:
    """Pista: un círculo de 500 m de radio. La parada: 15 m fuera durante 250 m; luego 40 m a 3 m de la línea
    (la salida que se junta poco a poco, como en Suzuka); 110 m por la pista; y una salida de pista de 8 m en
    la vuelta de salida. El recorrido sigue la salida lenta hasta el final y no llega a la salida de pista."""
    track = PolylineIndex(_ring(500.0, 0.0, 2 * np.pi, 1.0), closed=True, z_weight=0.0)
    pts = np.vstack(
        [
            _ring(500.0, -0.10, 0.00),  # por la pista hasta la bifurcación
            _ring(515.0, 0.00, 0.50),  # el pit lane
            _ring(503.0, 0.50, 0.58),  # la salida, a 3 m de la línea
            _ring(500.0, 0.58, 0.80),  # la pista
            _ring(508.0, 0.80, 0.82),  # una salida de pista
            _ring(500.0, 0.82, 0.90),
        ]
    )
    core = pit_core(pts, None, track)
    assert core is not None
    angle = np.arctan2(core[:, 1], core[:, 0])
    assert angle.max() == pytest.approx(0.58, abs=0.015)  # hasta la última muestra a 3 m, no más
    assert np.all(np.diff(angle) > 0)


# --- las transiciones: nunca hacia atrás, sin mover muestras, ocultas poco ---


@pytest.mark.parametrize("lead_m", [8.0, 12.0])
def test_pit_entry_overshoot_is_no_data_and_never_drawn_backwards(lead_m: float) -> None:
    """Sin quitarlas, la monotonía promediaba la muestra de pista de más con la primera del pit lane: movía
    las dos (en el sintético, la de pista hasta 2 m hacia atrás) o, sin bastarle 5 m, quitaba una de ellas."""
    data, sims = synthetic_session()
    pinned = _pin_to_the_track(data, sims, lead_m=lead_m)
    c = build_circuit(data, CIRCUIT_ID, "Synthetic")
    motion = project_session(data, c)
    for car in pinned:
        sim, m, pos = sims[car], motion[car], data.pos[car]
        assert np.array_equal(m.t_ms, pos["t_ms"].to_numpy())
        t = m.t_ms.astype(np.float64)
        raw = c.to_canonical(pos[["x", "y", "z"]].to_numpy(dtype=np.float64))[:, :2]
        drawn = _drawn(c, m.path, m.s_m)
        err = np.hypot(*(drawn - raw).T)
        visible = m.path != PATH_NODATA
        truth, _, _ = sim.truth(t)
        for t_in in sim.pit_in:
            near = (t > t_in - 8000) & (t < t_in + 8000)
            # Lo que se ve está donde dice el feed: nada se mueve (en el pit lane, a lo que se aparta del
            # verdadero el pit lane modelado junto a la bifurcación).
            on_track = near & (m.path == PATH_TRACK)
            assert err[on_track].max() < 1.0, (car, err[on_track].max())
            on_pit = near & (m.path == PATH_PIT)
            assert on_pit.sum() > 10
            assert err[on_pit].max() < 3.0, (car, err[on_pit].max())
            # Nunca hacia atrás: entre dos muestras visibles seguidas, lo dibujado avanza en la dirección de
            # la marcha (a menos de 1 m).
            idx = np.flatnonzero(near & visible)
            for a, b in itertools.pairwise(idx):
                heading = truth[b, :2] - truth[a, :2]
                if np.hypot(*heading) < 0.5:
                    continue
                along = float(np.dot(drawn[b] - drawn[a], heading) / np.hypot(*heading))
                assert along > -1.0, (car, t[a], along)
            # Se oculta poco: lo que tarda en llegar a la primera muestra del pit lane.
            assert np.diff(t[idx]).max() < 1500, car
    # Las muestras de pista que el feed dejó por delante de la primera del pit lane (en s, la equivalente)
    # quedan sin dato: alguna, con tantos metros de más.
    assert sum(int((motion[car].path[rows] == PATH_NODATA).sum()) for car, rows in pinned.items()) > 0


def test_switch_overshoot_marks_only_the_old_path_ahead_of_the_new() -> None:
    T, P, N = PATH_TRACK, PATH_PIT, PATH_NODATA
    t = np.array([0, 250, 500, 750, 1000, 1250, 1500, 4000, 4250, 4500])
    path = np.array([T, T, T, T, N, P, P, P, T, T], dtype=np.uint8)
    s = np.array([0.0, 5.0, 11.0, 14.0, 0.0, 9.5, 12.0, 70.0, 69.5, 75.0])
    # 11 y 14 quedan más de 1 m por delante de 9,5 (aunque haya una muestra sin dato en medio); 5 no.
    # 70 → 69,5 está dentro de la tolerancia, y el cambio 12 → 70 es tras más de 2 s.
    assert np.flatnonzero(switch_overshoot(t, path, s)).tolist() == [2, 3]


def test_switch_overshoot_at_the_exit_and_only_in_the_last_2_s() -> None:
    """Igual en la salida (muestras del pit lane por delante de la primera de pista) y solo en los 2 s
    antes del cambio: una de antes, aunque quede por delante, ya no es el feed pegado al camino viejo."""
    T, P = PATH_TRACK, PATH_PIT
    t = np.array([0, 500, 1500, 2600, 2800, 3000])
    path = np.array([P, P, P, P, P, T], dtype=np.uint8)
    s = np.array([30.0, 31.0, 32.0, 33.0, 34.0, 20.0])
    assert np.flatnonzero(switch_overshoot(t, path, s)).tolist() == [2, 3, 4]


# --- un circuito guardado con el pit lane mal ---


def test_outdated_pit_lane_the_cars_do_not_follow_is_dropped(tmp_path: Path) -> None:
    """Singapur 2026: el circuito guardado (versión 2) tiene una cuerda por pit lane. Al volver a descargar
    la sesión no hay parada que dé uno bueno: se reconstruye sin pit lane en vez de conservar la cuerda."""
    v1 = tmp_path / "v1"
    build_session(synthetic_session()[0], tmp_path)
    good = load_circuit(CIRCUIT_ID, v1)
    assert good is not None and good.pitlane is not None
    a, b = good.pitlane[0], good.pitlane[-1]
    chord = a + np.linspace(0.0, 1.0, 400)[:, None] * (b - a)
    save_circuit(replace(good, pitlane=chord, geometry_version=2), v1)

    data, sims = synthetic_session(seed=7)
    _gap_in_every_stop(data, sims, 150.0, 250.0)  # 100 m sin muestras: ninguna parada da el pit lane
    notes = _notes(build_session(data, tmp_path))
    assert any(n["code"] == "circuit-rebuilt" and "queda sin pit lane" in n["text"] for n in notes), notes
    # La app lo dice (por código): sin pit lane porque el guardado no seguía a los coches.
    missing = [n for n in notes if n["code"] == "pitlane-missing"]
    assert [n["params"]["reason"] for n in missing] == ["dropped"], notes
    assert 0 <= missing[0]["params"]["stopShare"] < 50
    rebuilt = load_circuit(CIRCUIT_ID, v1)
    assert rebuilt is not None and rebuilt.pitlane is None
    assert rebuilt.geometry_version == GEOMETRY_VERSION

    # Se recupera solo: la siguiente sesión con paradas que lo dé se lo añade, sin tocar lo demás.
    notes = _notes(build_session(synthetic_session(seed=11)[0], tmp_path))
    assert any(n["code"] == "circuit-rebuilt" and n["params"]["reason"] == "gains-pit" for n in notes), notes
    assert not any(n["code"] == "pitlane-missing" for n in notes), notes
    grown = load_circuit(CIRCUIT_ID, v1)
    assert grown is not None and grown.pitlane is not None
    assert np.array_equal(grown.centerline, rebuilt.centerline)
    assert "pitDroppedStopShare" not in grown.quality and grown.quality["pitFitStopShare"] == 1.0
    sampled, joins = _lane_offset(grown)
    assert sampled < 1.0 and joins < 3.0, (sampled, joins)


def test_a_circuit_without_pit_lane_says_why_and_gains_one(tmp_path: Path) -> None:
    """Un circuito al día sin pit lane (ninguna parada de la sesión que lo construyó lo daba) lo dice en cada
    sesión que lo usa, y lo gana con la primera que lo dé; una sesión sin paradas no lo toca."""
    v1 = tmp_path / "v1"
    data, sims = synthetic_session()
    _gap_in_every_stop(data, sims, 150.0, 250.0)
    notes = _notes(build_session(data, tmp_path))
    missing = [n for n in notes if n["code"] == "pitlane-missing"]
    assert [(n["params"]["reason"], n["params"]["stops"]) for n in missing] == [("none-valid", 3)], notes
    bare = load_circuit(CIRCUIT_ID, v1)
    assert bare is not None and bare.pitlane is None

    no_stops = synthetic_session(seed=5)[0]
    no_stops.laps[["pit_in_ms", "pit_out_ms"]] = -1
    notes = _notes(build_session(no_stops, tmp_path))
    assert not any(n["code"] == "circuit-rebuilt" for n in notes), notes
    assert [n["params"]["reason"] for n in notes if n["code"] == "pitlane-missing"] == ["none-valid"]

    notes = _notes(build_session(synthetic_session(seed=11)[0], tmp_path))
    assert any(n["code"] == "circuit-rebuilt" and n["params"]["reason"] == "gains-pit" for n in notes), notes
    grown = load_circuit(CIRCUIT_ID, v1)
    assert grown is not None and grown.pitlane is not None
    assert np.array_equal(grown.centerline, bare.centerline)
    assert "pitStops" not in grown.quality


def test_a_circuit_built_without_stops_says_so(tmp_path: Path) -> None:
    data = synthetic_session()[0]
    data.laps[["pit_in_ms", "pit_out_ms"]] = -1
    notes = _notes(build_session(data, tmp_path))
    assert [n["params"] for n in notes if n["code"] == "pitlane-missing"] == [{"reason": "no-stops"}]


def test_outdated_pit_lane_that_fits_is_kept_when_the_session_gives_none(tmp_path: Path) -> None:
    """El mismo caso con el pit lane guardado bueno: se conserva (no se pierde por una sesión sin uno)."""
    v1 = tmp_path / "v1"
    build_session(synthetic_session()[0], tmp_path)
    good = load_circuit(CIRCUIT_ID, v1)
    assert good is not None and good.pitlane is not None
    save_circuit(replace(good, geometry_version=2), v1)

    data, sims = synthetic_session(seed=7)
    _gap_in_every_stop(data, sims, 150.0, 250.0)
    notes = _notes(build_session(data, tmp_path))
    assert any(n["code"] == "circuit-outdated-kept" for n in notes), notes
    kept = load_circuit(CIRCUIT_ID, v1)
    assert kept is not None and kept.pitlane is not None and kept.geometry_version == 2
