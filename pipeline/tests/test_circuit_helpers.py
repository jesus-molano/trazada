"""Piezas del circuito: fallos de z = 0, limpieza del recorrido del pit lane, encaje y variantes."""

from __future__ import annotations

from pathlib import Path

import numpy as np

from trazada_pipeline.circuit.build import clean_pit_path, max_turn_deg, z_glitches
from trazada_pipeline.circuit.fit import FIT_MAX_DEV_M, FIT_MIN_LAPS, Fit
from trazada_pipeline.circuit.store import circuit_variants, next_variant_id


def test_z_glitches_only_where_the_neighbours_are_high() -> None:
    t = np.arange(10) * 250
    z = np.array([4000, 4001, 0, 4003, 4004, 0, 0, 4006, 4007, 4008])
    assert np.flatnonzero(z_glitches(t, z)).tolist() == [2, 5, 6]
    # A nivel del mar, z = 0 puede ser real; y un feed sin altura (todo 0) no es un fallo puntual.
    assert not z_glitches(t, np.array([3, 1, 0, -2, 0, 4, 2, 0, 1, 2])).any()
    assert not z_glitches(t, np.zeros(10)).any()
    # El orden de las filas no importa.
    order = np.random.default_rng(1).permutation(10)
    assert np.flatnonzero(z_glitches(t[order], z[order])).tolist() == sorted(
        int(np.flatnonzero(order == i)[0]) for i in (2, 5, 6)
    )


def _straight(n: int, step: float = 5.0) -> np.ndarray:
    return np.column_stack([np.arange(n) * step, np.zeros(n), np.zeros(n)])


def test_clean_pit_path_drops_backward_steps() -> None:
    path = _straight(20)
    path[8] = [path[7, 0] - 15.0, 0.0, 0.0]  # fallo: 15 m hacia atrás
    out = clean_pit_path(path, None)
    assert np.all(np.diff(out[:, 0]) > 0)
    assert len(out) == 19


def test_clean_pit_path_drops_slow_garage_manoeuvres() -> None:
    path = _straight(30)
    speed = np.full(30, 80.0)
    garage = np.arange(12, 18)
    path[garage, 1] = -12.0  # dentro del garaje, despacio
    speed[garage] = 5.0
    out = clean_pit_path(path, speed)
    assert np.abs(out[:, 1]).max() == 0.0
    assert out[0].tolist() == path[0].tolist() and out[-1].tolist() == path[-1].tolist()


def test_max_turn_detects_a_reversal() -> None:
    line = _straight(30, 1.0)
    assert max_turn_deg(line) < 1.0
    zigzag = np.vstack([line[:15], line[14::-1][1:6], line[10:]])  # adelante, 5 m atrás, adelante
    assert max_turn_deg(zigzag) > 150.0


def test_fit_decision() -> None:
    good = Fit(laps=8, p50_m=0.05, p95_m=0.1, dev_m=0.3, length_ratio=0.997)
    assert good.checked and good.ok
    assert not Fit(8, 0.05, 0.2, FIT_MAX_DEV_M + 1, 0.998).ok  # una curva redibujada
    assert not Fit(8, 2.5, 3.0, 3.1, 0.997).ok  # otro sistema de coordenadas
    assert not Fit(8, 0.05, 0.1, 0.3, 1.06).ok  # otra longitud
    few = Fit(FIT_MIN_LAPS - 1, 9.0, 9.0, 30.0, 1.2)
    assert not few.checked and few.ok  # sin vueltas suficientes no se puede decir que no encaja


def test_variant_ids(tmp_path: Path) -> None:
    v1 = tmp_path / "v1"
    (v1 / "circuits").mkdir(parents=True)
    assert circuit_variants("7-a", v1) == []
    assert next_variant_id("7-a", v1) == "7-a-v2"
    for name in ("7-a", "7-a-v2", "7-a-v10", "7-a-vx", "7-b-v3"):
        (v1 / "circuits" / name).mkdir()
        (v1 / "circuits" / name / "circuit.json").write_text("{}")
    assert circuit_variants("7-a", v1) == ["7-a-v2", "7-a-v10"]
    assert next_variant_id("7-a", v1) == "7-a-v11"
