"""Circuito canónico y proyección sobre una sesión sintética con los casos difíciles de H2."""

from __future__ import annotations

import numpy as np
import pytest
from synthetic import PIT_ENTRY_S, PIT_EXIT_S, PIT_LEN, L, synthetic_session

from trazada_pipeline.circuit.build import build_circuit
from trazada_pipeline.projection import (
    PATH_NODATA,
    PATH_PIT,
    PATH_TRACK,
    fake_stops,
    monotone_fit,
    pava,
    pit_windows,
    project_session,
)


@pytest.fixture(scope="module")
def session():
    return synthetic_session()


@pytest.fixture(scope="module")
def circuit(session):
    return build_circuit(session[0], "0-synthetic-dev", "Synthetic")


@pytest.fixture(scope="module")
def motion(session, circuit):
    return project_session(session[0], circuit)


def _circ(a: float, b: float) -> float:
    d = abs(a - b) % L
    return min(d, L - d)


# --- PAVA ---


def test_pava_known_cases() -> None:
    np.testing.assert_allclose(pava(np.array([3.0, 1.0, 2.0])), [2.0, 2.0, 2.0])
    np.testing.assert_allclose(pava(np.array([1.0, 3.0, 2.0, 4.0])), [1.0, 2.5, 2.5, 4.0])
    assert len(pava(np.array([]))) == 0


def test_pava_is_monotone_and_keeps_sorted_input() -> None:
    rng = np.random.default_rng(1)
    y = np.cumsum(rng.normal(1, 3, 500))
    out = pava(y)
    assert np.all(np.diff(out) >= -1e-12)
    assert out.sum() == pytest.approx(y.sum())  # la media de cada bloque conserva la suma
    sorted_y = np.sort(y)
    np.testing.assert_array_equal(pava(sorted_y), sorted_y)


def test_monotone_fit_drops_the_glitch_not_its_neighbours() -> None:
    y = np.r_[np.arange(0.0, 50.0, 5.0), 160.0, np.arange(55.0, 100.0, 5.0)]  # una muestra 110 m adelante
    fit, keep = monotone_fit(y, 5.0)
    assert np.flatnonzero(~keep).tolist() == [10]
    np.testing.assert_allclose(fit[keep], y[keep])
    assert np.isnan(fit[10])
    # Ruido pequeño: se ajusta (PAVA) sin descartar nada.
    noisy = np.array([0.0, 1.0, 0.8, 2.0, 3.0])
    fit, keep = monotone_fit(noisy, 5.0)
    assert keep.all() and np.all(np.diff(fit) >= 0)


def test_fake_stops_need_speed_and_time() -> None:
    t = np.arange(0, 4000, 250)
    s = np.r_[np.arange(0.0, 20.0, 5.0), np.full(len(t) - 4, 20.0)]  # se para tras 1 s
    valid = np.ones(len(t), dtype=bool)
    fake = fake_stops(t, s, valid, np.full(len(t), 150.0))
    assert not fake[:5].any() and fake[5:].all()  # la primera muestra parada (s = 20) se conserva
    assert not fake_stops(t, s, valid, np.zeros(len(t))).any()  # parado de verdad: telemetría a 0
    short = t < 1000
    assert not fake_stops(
        t[short], np.full(short.sum(), 3.0), valid[short], np.full(short.sum(), 150.0)
    ).any()


def test_pit_windows_pairs_in_and_out() -> None:
    import pandas as pd

    laps = pd.DataFrame(
        {"lap": [1, 2, 3, 4], "pit_in_ms": [-1, 100, -1, 900], "pit_out_ms": [50, -1, 200, -1]}
    )
    w = pit_windows(laps, 1000)
    assert w[0][1] == 50 and w[0][0] < 0  # en boxes hasta la primera salida
    assert w[1] == (100, 200)
    assert w[2][0] == 900 and w[2][1] > 1000  # entra y no vuelve a salir


# --- circuito ---


def test_centerline_geometry(circuit) -> None:
    assert abs(circuit.length - L) / L < 0.005
    assert circuit.quality["closureM"] < 2.0
    assert circuit.quality["residualP95M"] < 1.0
    # s = 0 en la meta: el inicio de la línea está en mitad de la recta (x≈0, y≈-100 antes de centrar)
    assert circuit.pit_entry_s is not None and circuit.pit_exit_s is not None
    assert _circ(circuit.pit_entry_s, PIT_ENTRY_S) < 25
    assert _circ(circuit.pit_exit_s, PIT_EXIT_S) < 25
    assert abs(circuit.pit_length - PIT_LEN) / PIT_LEN < 0.10
    assert circuit.quality["elevationRangeM"] == pytest.approx(6.0, abs=0.5)


# --- proyección ---


def test_s_is_monotone_and_close_to_truth(session, circuit, motion) -> None:
    _, sims = session
    scale = L / circuit.length  # la línea suavizada mide ~0,03 % menos: se compara en fracción de vuelta
    for car, m in motion.items():
        valid = m.path != PATH_NODATA
        assert np.all(np.diff(m.s_m[valid]) >= -1e-9), car
        _, s_true, _ = sims[car].truth(m.t_ms.astype(float))
        err = np.abs(m.s_m[valid] * scale - s_true[valid])
        assert np.percentile(err, 95) < 6.0, (car, np.percentile(err, 95))
        assert np.percentile(err, 50) < 2.0, (car, np.percentile(err, 50))


def test_pit_stop_crossing_s0_inside_pit_lane(session, motion) -> None:
    _, sims = session
    sim, m = sims["1"], motion["1"]
    t_in, t_out = sim.pit_in[0], sim.pit_out[0]
    sel = (m.t_ms > t_in + 3000) & (m.t_ms < t_out - 3000)
    assert np.mean(m.path[sel] == PATH_PIT) > 0.95
    # cruza s = k·L dentro del pit lane sin saltos
    s = m.s_m[(m.t_ms >= t_in - 5000) & (m.t_ms <= t_out + 5000)]
    assert s.min() < 4 * L < s.max()
    assert np.max(np.diff(s)) < 60.0


def test_drive_through(session, motion) -> None:
    _, sims = session
    sim, m = sims["2"], motion["2"]
    sel = (m.t_ms > sim.pit_in[0] + 3000) & (m.t_ms < sim.pit_out[0] - 3000)
    assert sel.sum() > 30
    assert np.mean(m.path[sel] == PATH_PIT) > 0.95
    after = m.t_ms > sim.pit_out[0] + 5000
    assert np.all(m.path[after] == PATH_TRACK)


def test_red_flag_queue_in_pit_lane(session, motion) -> None:
    _, sims = session
    sim, m = sims["4"], motion["4"]
    hold = next(g for g in sim.segs if g.mode == "pit" and g.p0 == g.p1)
    sel = (m.t_ms > hold.t0 + 2000) & (m.t_ms < hold.t1 - 2000)
    assert sel.sum() > 2000
    assert np.all(m.path[sel] == PATH_PIT)
    assert np.ptp(m.s_m[sel]) < 2.0


def test_car_stopped_on_track(session, motion) -> None:
    _, sims = session
    sim, m = sims["3"], motion["3"]
    sel = m.t_ms > sim.retired_at + 2000
    assert sel.sum() > 2000
    assert np.all(m.path[sel] == PATH_TRACK)
    assert np.ptp(m.s_m[sel]) < 2.0
    assert m.s_m[sel][0] == pytest.approx(4 * L + 900, abs=5.0)
