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
from synthetic import PIT, PIT_LEN, PIT_SPAN, CarSim, synthetic_session, track_point

from trazada_pipeline.build import BuildReport, build_session
from trazada_pipeline.circuit.build import (
    GEOMETRY_VERSION,
    Circuit,
    build_circuit,
    clean_pit_path,
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
    return json.loads(report.manifest_path.read_text())["quality"]["notes"]


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
    rebuilt = load_circuit(CIRCUIT_ID, v1)
    assert rebuilt is not None and rebuilt.pitlane is None
    assert rebuilt.geometry_version == GEOMETRY_VERSION


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
