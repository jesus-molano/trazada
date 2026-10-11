"""Pit lane y proyección frente a los fallos del feed vistos en Bélgica FP1 2026 (auditoría D, E y F).

A la sesión sintética se le inyecta cada fallo. Los tests usan la API pública (`build_circuit`,
`project_session`, `project_car`) para que también se puedan pasar contra el código anterior y fallen.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
from synthetic import (
    PIT,
    PIT_LEN,
    PIT_SPEED,
    START_MS,
    CarSim,
    L,
    Seg,
    add_car,
    pit_point,
    synthetic_session,
    track_point,
)

from trazada_pipeline.circuit.build import Circuit, build_circuit
from trazada_pipeline.circuit.geometry import PolylineIndex
from trazada_pipeline.projection import PATH_NODATA, PATH_PIT, PATH_TRACK, project_car, project_session

CIRCUIT_ID = "0-synthetic-dev"


def _max_turn_deg(lane: np.ndarray, window: int = 5) -> float:
    """Mayor cambio de rumbo en `window` vértices (la polilínea va a paso de 1 m)."""
    d = np.diff(lane[:, :2], axis=0)
    heading = np.unwrap(np.arctan2(d[:, 1], d[:, 0]))
    return float(np.degrees(np.abs(heading[window:] - heading[:-window]).max()))


def _set_xyz(pos: pd.DataFrame, rows: np.ndarray, xyz_m: np.ndarray) -> None:
    pos.loc[pos.index[rows], ["x", "y", "z"]] = np.rint(np.atleast_2d(xyz_m) * 10).astype(np.int64)


def _flat(points: np.ndarray) -> np.ndarray:
    return np.column_stack([points[:, :2], np.zeros(len(points))])


def _track_distance(circuit: Circuit, xyz_m: np.ndarray) -> np.ndarray:
    """Distancia en planta de posiciones verdaderas (m, sistema sintético) a la línea central."""
    index = PolylineIndex(_flat(circuit.centerline), closed=True)
    return index.project(_flat(circuit.to_canonical(xyz_m * 10.0)))[1]


# --- D: pit lane sin desvíos ---


def test_pit_lane_ignores_a_position_glitch_going_backwards() -> None:
    """Spa: una muestra del coche que da el pit lane salta 15 m hacia atrás y el pit lane hacía una Z."""
    clean = build_circuit(synthetic_session()[0], CIRCUIT_ID, "Synthetic")
    data, sims = synthetic_session()
    sim, pos = sims["2"], data.pos["2"]  # drive-through: la parada más corta, de la que sale el pit lane
    t = pos["t_ms"].to_numpy(dtype=np.float64)
    _, _, mode = sim.truth(t)
    i = int(np.flatnonzero(mode == 1)[int((mode == 1).sum()) // 2])
    v = (t[i] - sim.pit_in[0]) / 1000 * PIT_SPEED
    _set_xyz(pos, np.array([i]), pit_point(np.array([v - 15.0])))

    c = build_circuit(data, CIRCUIT_ID, "Synthetic")
    assert c.pitlane is not None and c.pit_length is not None
    assert _max_turn_deg(c.pitlane) < 90.0
    assert clean.pit_length is not None
    assert abs(c.pit_length - clean.pit_length) < 3.0  # la Z añadía ~30 m


def test_pit_lane_ignores_the_garage_detour() -> None:
    """El coche que da el pit lane se mete en su garaje (12 m de lado, despacio) y vuelve a salir.

    Es la única parada (sin el drive-through del coche 2 ni la bandera roja del coche 4). Las muestras lentas
    no se usan y dejan un hueco de ~30 m alrededor del box, como en Spa, Japón o Singapur (con 1,5 s a
    cada lado a velocidad de pit lane eran 66 m: un hueco que el pit lane ya no cruza en línea recta)."""
    data, sims = synthetic_session()
    laps = data.laps
    laps.loc[laps["car"].isin(["2", "4"]), ["pit_in_ms", "pit_out_ms"]] = -1
    sim, pos, tel = sims["1"], data.pos["1"], data.car["1"]
    hold = next(g for g in sim.segs if g.mode == "pit" and g.p0 == g.p1)
    t = pos["t_ms"].to_numpy(dtype=np.float64)
    a, b = hold.t0 - 600, hold.t1 + 600
    ramp = np.clip(np.minimum(t - a, b - t) / 500, 0, 1)
    rows = np.flatnonzero(ramp > 0)
    xyz, _, _ = sim.truth(t[rows])
    xyz[:, 1] -= 12.0 * ramp[rows]  # hacia fuera de la pista, hasta el fondo del garaje
    _set_xyz(pos, rows, xyz)
    tt = tel["t_ms"].to_numpy(dtype=np.float64)
    tel.loc[(tt >= a) & (tt <= b), "speed"] = 8  # maniobra en el garaje

    c = build_circuit(data, CIRCUIT_ID, "Synthetic")
    assert c.pitlane is not None
    truth = PolylineIndex(_flat(c.to_canonical(PIT * 10.0)), closed=False)
    _, off = truth.project(_flat(c.pitlane))
    assert off.max() < 2.0, off.max()


# --- E: altura del pit lane y fallos de z = 0 ---


def test_pit_lane_height_follows_the_track() -> None:
    """El feed da la misma altura a todo el pit lane (Spa: 7 m por debajo de la pista en la salida)."""
    data, sims = synthetic_session()
    for car, sim in sims.items():
        pos = data.pos[car]
        _, _, mode = sim.truth(pos["t_ms"].to_numpy(dtype=np.float64))
        pos.loc[mode == 1, "z"] = 1000  # 100 m fijos; la pista va de 98 a 102 m a lo largo del pit lane

    c = build_circuit(data, CIRCUIT_ID, "Synthetic")
    assert c.pitlane is not None
    u, _ = PolylineIndex(_flat(c.centerline), closed=True).project(_flat(c.pitlane))
    track_z = PolylineIndex(c.centerline, closed=True).point_at(u)[:, 2]
    dz = np.abs(c.pitlane[:, 2] - track_z)
    assert dz.max() < 0.3, dz.max()
    assert dz[0] < 0.15 and dz[-1] < 0.15  # sin escalón en la entrada ni en la salida


def test_z_zero_glitches_do_not_dent_the_centerline() -> None:
    data, _ = synthetic_session()
    rng = np.random.default_rng(5)
    for pos in data.pos.values():
        pos.loc[rng.random(len(pos)) < 0.01, "z"] = 0  # 1 %: por debajo del umbral de «elevación plana»

    c = build_circuit(data, CIRCUIT_ID, "Synthetic")
    assert c.quality["elevationRangeM"] == pytest.approx(6.0, abs=0.5)


def test_z_zero_glitch_does_not_lose_the_sample() -> None:
    """A 4 km de altura con la pendiente suave del sintético (como Spa: 400 m y rampas del 10 %), la búsqueda
    3D de una muestra con z = 0 acaba en el tramo más bajo, a decenas de metros."""
    data, sims = synthetic_session()
    for pos in data.pos.values():
        pos["z"] += 40_000
    circuit = build_circuit(data, CIRCUIT_ID, "Synthetic")
    pos = data.pos["5"]
    rows = np.arange(200, len(pos) - 200, 97)
    pos.loc[pos.index[rows], "z"] = 0

    m = project_session(data, circuit)["5"]
    sel = np.isin(m.t_ms, pos["t_ms"].to_numpy()[rows])
    assert sel.sum() == len(rows)
    assert np.all(m.path[sel] == PATH_TRACK)
    _, s_true, _ = sims["5"].truth(m.t_ms[sel].astype(np.float64))
    assert np.abs(m.s_m[sel] * L / circuit.length - s_true).max() < 3.0


# --- D: monotonía sin paradas falsas ---


def test_position_glitch_is_a_gap_not_a_freeze() -> None:
    """Una muestra 60 m por delante y otra 40 m por detrás: sin dato, sin arrastrar a sus vecinas."""
    data, sims = synthetic_session()
    sim, pos = sims["5"], data.pos["5"]
    t = pos["t_ms"].to_numpy(dtype=np.float64)
    glitches = {400: 60.0, 800: -40.0}
    for i, ds in glitches.items():
        _, s_true, _ = sim.truth(t[i : i + 1])
        _set_xyz(pos, np.array([i]), track_point(s_true + ds))
    circuit = build_circuit(data, CIRCUIT_ID, "Synthetic")

    m = project_session(data, circuit)["5"]
    bad = np.isin(m.t_ms, t[list(glitches)].astype(np.int64))
    assert np.all(m.path[bad] == PATH_NODATA)
    valid = m.path != PATH_NODATA
    assert valid.sum() >= len(m.t_ms) - 2
    _, s_true, _ = sim.truth(m.t_ms.astype(np.float64))
    err = np.abs(m.s_m * L / circuit.length - s_true)[valid]
    assert err.max() < 5.0, err.max()


def test_frozen_feed_at_speed_is_a_gap_not_a_stop() -> None:
    """El feed repite 3 s la última posición mientras la telemetría dice 180 km/h (Spa, coche 5)."""
    data, _ = synthetic_session()
    pos = data.pos["6"]
    t = pos["t_ms"].to_numpy()
    frozen = np.flatnonzero((t >= 200_000) & (t <= 203_000))
    first = frozen[0]
    pos.loc[pos.index[frozen], ["x", "y", "z"]] = pos.loc[pos.index[first], ["x", "y", "z"]].to_numpy()
    circuit = build_circuit(data, CIRCUIT_ID, "Synthetic")

    m = project_session(data, circuit)["6"]
    after_first = (m.t_ms > t[first]) & (m.t_ms <= 203_000)
    assert after_first.sum() >= 8
    assert np.all(m.path[after_first] == PATH_NODATA)
    assert m.path[m.t_ms == t[first]][0] == PATH_TRACK  # la última posición buena se conserva


def test_pit_run_after_the_last_lap_continues_from_the_lap_before() -> None:
    """Se queda en el pit lane hasta el final y el feed tiene un hueco justo al cruzar la meta: el tramo
    siguiente no tiene ninguna vuelta del cronometraje y no se puede anclar a la vuelta 1."""
    data, _ = synthetic_session()
    c = CarSim("9", START_MS + 9000, 1.0).laps(2).to_pit_entry()
    c.pit_in.append(c.t)
    base = c.s
    for v0, v1 in ((0.0, 160.0), (160.0, 300.0)):
        dt = (v1 - v0) / PIT_SPEED * 1000
        c.segs.append(Seg("pit", c.t, c.t + dt, v0, v1, base))
        c.t += dt
    c.hold(60)
    add_car(data, c)
    t_line = c.pit_in[0] + PIT_LEN / 2 / PIT_SPEED * 1000  # cruce de la meta dentro del pit lane
    pos = data.pos["9"]
    data.pos["9"] = pos[(pos["t_ms"] < t_line - 300) | (pos["t_ms"] > t_line + 2700)].reset_index(drop=True)
    circuit = build_circuit(data, CIRCUIT_ID, "Synthetic")

    m = project_session(data, circuit)["9"]
    valid = m.path != PATH_NODATA
    assert np.all(np.diff(m.s_m[valid]) >= -1e-9)
    _, s_true, _ = c.truth(m.t_ms.astype(np.float64))
    late = valid & (m.t_ms > t_line + 3000)
    assert late.sum() > 100
    assert np.all(m.path[late] == PATH_PIT)
    assert np.abs(m.s_m[late] * L / circuit.length - s_true[late]).max() < 6.0


def test_pit_lane_behind_the_track_at_the_entry_keeps_s_monotonic() -> None:
    """La s equivalente del pit lane puede quedar por detrás de la última de pista al cambiar de camino (cada
    tramo es monótono por separado): la serie entera tampoco va hacia atrás, y no se pierde casi nada."""
    from dataclasses import replace

    data, _ = synthetic_session()
    built = build_circuit(data, CIRCUIT_ID, "Synthetic")
    assert built.pit_entry_s is not None
    lagging = replace(built, pit_entry_s=float(np.mod(built.pit_entry_s - 15.0, built.length)))

    for car in ("1", "2"):
        m = project_session(data, lagging)[car]
        valid = m.path != PATH_NODATA
        assert np.all(np.diff(m.s_m[valid]) >= -1e-9), car
        assert np.any(m.path == PATH_PIT)
        assert (~valid).sum() - (project_session(data, built)[car].path == PATH_NODATA).sum() <= 6, car


# --- F: cerca del pit lane decide la geometría ---


def test_pit_lane_samples_outside_the_timing_window_stay_in_the_pit_lane() -> None:
    """Las horas de entrada y salida del cronometraje llegan 6 s tarde y 6 s pronto (Spa: hasta 60 s en la
    cola de salida): el coche está en el pit lane y no se puede dibujar sobre la trazada."""
    data, sims = synthetic_session()
    laps = data.laps
    for car in ("1", "2"):
        ins = (laps["car"] == car) & (laps["pit_in_ms"] >= 0)
        outs = (laps["car"] == car) & (laps["pit_out_ms"] >= 0)
        laps.loc[ins, "pit_in_ms"] += 6000
        laps.loc[outs, "pit_out_ms"] -= 6000
    circuit = build_circuit(data, CIRCUIT_ID, "Synthetic")

    motion = project_session(data, circuit)
    for car in ("1", "2"):
        m = motion[car]
        xyz, _, mode = sims[car].truth(m.t_ms.astype(np.float64))
        assert not np.any((m.path == PATH_TRACK) & (m.proj_err_m > 8.0)), car
        in_lane = (mode == 1) & (_track_distance(circuit, xyz) > 8.0)
        assert in_lane.sum() > 40
        assert np.mean(m.path[in_lane] == PATH_PIT) > 0.95, car


def test_queue_at_the_pit_exit_is_in_the_pit_lane() -> None:
    """Spa FP1, coche 5 entre 900 y 925 s: espera 20 s en el semáforo de salida, a 4-5 m de la trazada y al
    final del pit lane, y el cronometraje ya le había dado la salida de boxes. No se dibuja parado en
    pista."""
    data, _ = synthetic_session()
    queue_v = PIT_LEN - 12.0  # a ~4,5 m de la línea, donde el pit lane se junta con la pista
    c = CarSim("9", START_MS + 9000, 1.0).laps(2).to_pit_entry().pit(stop_at_v=queue_v, stop_s=20.0).laps(2)
    add_car(data, c)
    hold = next(g for g in c.segs if g.mode == "pit" and g.p0 == g.p1)
    laps = data.laps
    # El cronometraje da la salida de boxes al llegar a la cola, 20 s antes de que el coche la deje.
    laps.loc[(laps["car"] == "9") & (laps["pit_out_ms"] >= 0), "pit_out_ms"] = round(hold.t0)
    circuit = build_circuit(data, CIRCUIT_ID, "Synthetic")
    xyz, _, _ = c.truth(np.array([hold.t0]))
    assert 3.0 < _track_distance(circuit, xyz)[0] < 6.0

    m = project_session(data, circuit)["9"]
    queued = (m.t_ms > hold.t0 + 3500) & (m.t_ms < hold.t1 - 500)
    assert queued.sum() > 50
    assert np.all(m.path[queued] == PATH_PIT)
    assert m.proj_err_m[queued].max() < 2.0


def test_off_both_paths_next_to_the_pit_entry_is_no_data() -> None:
    """22 m fuera de la recta y a 15 m del tramo de entrada al pit lane, fuera de una ventana de boxes:
    ni pista ni pit lane (la calle de entrada real que la polilínea no cubre)."""
    data, _ = synthetic_session()
    circuit = build_circuit(data, CIRCUIT_ID, "Synthetic")
    t = np.arange(500_000, 510_000, 250)
    pos = pd.DataFrame({"t_ms": t, "x": -1850, "y": -1220, "z": 982})
    track_index = PolylineIndex(circuit.centerline, closed=True)
    pit_index = PolylineIndex(circuit.pitlane, closed=False)
    d = track_index.project(circuit.to_canonical(pos[["x", "y", "z"]].to_numpy(dtype=np.float64)[:1]))[1][0]
    assert 18 < d < 26

    m = project_car(pos, data.laps.iloc[0:0], circuit, track_index, pit_index)
    assert np.all(m.path == PATH_NODATA)
