"""Fixture e2e (`trazada e2e-fixture`): el extracto conserva la torre y las vueltas de la sesión completa."""

from __future__ import annotations

import gzip
import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import pytest
from synthetic import synthetic_session

from trazada_pipeline.build import build_session
from trazada_pipeline.encode import trzb
from trazada_pipeline.fixtures import FIXTURE_MAX_BYTES, make_e2e_fixture
from trazada_pipeline.sources.base import STREAM_COLUMNS

SESSION = "2026/00-synthetic/fp1"
WINDOW = {"start_min": 4.0, "minutes": 2.0}  # la ventana empieza con la sesión en marcha


def _tower(laps: pd.DataFrame) -> pd.DataFrame:
    """Torre sintética: en cada paso por meta, una fila por coche con el orden en la línea."""
    done: dict[str, tuple[int, int]] = {}
    rows = []
    for lap in laps[laps["end_ms"] > 0].sort_values(["end_ms", "car"]).itertuples():
        done[lap.car] = (int(lap.lap), int(lap.end_ms))
        order = sorted(done, key=lambda c: (-done[c][0], done[c][1]))
        for pos, car in enumerate(order, start=1):
            gap = -1 if pos == 1 else 1000 * pos + int(car)
            interval = -1 if pos == 1 else 100 * pos + int(car)
            rows.append((int(lap.end_ms), car, pos, gap, interval, 0))
    return pd.DataFrame(rows, columns=list(STREAM_COLUMNS))


@pytest.fixture(scope="module")
def source(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Sesión sintética de libres con torre de tiempos, generada como cualquier otra."""
    data, _ = synthetic_session()
    data.session_type, data.session_name, data.total_laps = "fp1", "Practice 1", None
    data.stream = _tower(data.laps)
    root = tmp_path_factory.mktemp("src")
    build_session(data, root)
    return root


@pytest.fixture(scope="module")
def extract(source: Path, tmp_path_factory: pytest.TempPathFactory) -> tuple[Path, dict[str, Any]]:
    out = tmp_path_factory.mktemp("fixture")
    return out, make_e2e_fixture(source, SESSION, out, **WINDOW)


def _timing(root: Path) -> dict[str, dict[str, np.ndarray]]:
    manifest_path = root / "v1" / "sessions" / SESSION / "manifest.json"
    ref = json.loads(manifest_path.read_text())["files"]["timing"]
    return trzb.decode(gzip.decompress((manifest_path.parent / ref["path"]).read_bytes())).tables


def tower_at(tables: dict[str, dict[str, np.ndarray]], t: int) -> dict[int, tuple]:
    """Como el lector (leaderboard.ts): por coche, la última fila de la torre con t ≤ reloj."""
    st = tables["stream"]
    out: dict[int, tuple] = {}
    for i in np.argsort(st["t"], kind="stable"):
        if st["t"][i] <= t:
            cols = ("position", "gapToLeaderMs", "intervalMs", "lapsBehind")
            out[int(st["car"][i])] = tuple(int(st[c][i]) for c in cols)
    return out


def laps_at(tables: dict[str, dict[str, np.ndarray]], t: int) -> dict[int, tuple]:
    """Por coche: vueltas completadas, mejor vuelta válida y vuelta en curso en t."""
    laps = tables["laps"]
    out: dict[int, tuple] = {}
    for car in np.unique(laps["car"]):
        sel = laps["car"] == car
        lap, start, end, ms, deleted = (laps[k][sel] for k in ("lap", "startMs", "endMs", "lapMs", "deleted"))
        done = (end > 0) & (end <= t)
        valid = done & (ms > 0) & (deleted == 0)
        current = (start >= 0) & (start <= t)
        out[int(car)] = (
            int(lap[done].max()) if done.any() else 0,
            int(ms[valid].min()) if valid.any() else None,
            int(lap[current].max()) if current.any() else 0,
        )
    return out


def test_fixture_tower_and_laps_match_the_full_session(source: Path, extract: tuple) -> None:
    """Sin las filas de antes de la ventana, el README mostraba una clasificación que nunca existió."""
    out, summary = extract
    a, b = summary["window"]
    full, ext = _timing(source), _timing(out)
    assert len(tower_at(full, a)) == 6  # todos los coches tienen ya fila en la torre al empezar
    for t in (a, a + 1, (a + b) // 2, b):
        assert tower_at(ext, t) == tower_at(full, t), t
        assert laps_at(ext, t) == laps_at(full, t), t
    # Solo lo necesario: la torre, hasta el final de la ventana; las vueltas, empezadas antes de él.
    assert ext["stream"]["t"].max() <= b
    assert len(ext["stream"]["t"]) < len(full["stream"]["t"])
    assert ext["laps"]["startMs"].max() <= b
    assert summary["bytes"] <= FIXTURE_MAX_BYTES


def test_fixture_variants_are_marked_test_only(source: Path, extract: tuple) -> None:
    out, _ = extract
    catalog = json.loads((out / "v1" / "catalog.json").read_text())
    sessions = {s["session"]: s for s in catalog["seasons"][0]["events"][0]["sessions"]}
    assert list(sessions) == ["fp1", "fp2", "fp3", "q", "race"]
    assert all(sessions[k].get("dev") is True for k in ("fp2", "fp3", "q", "race"))
    assert sessions["fp1"].get("dev") is True  # la sesión sintética de origen es dev: el extracto también
    event = out / "v1" / "sessions" / "2026" / "00-synthetic"

    def codes(path: Path) -> set[str]:
        notes = json.loads(path.read_text())["quality"]["notes"]
        return {n["code"] for n in notes if isinstance(n, dict)}

    for k in ("fp2", "fp3", "q"):
        assert json.loads((event / k / "manifest.json").read_text())["session"]["type"] == k
        assert "e2e-variant" in codes(event / k / "manifest.json")
    assert "e2e-extract" in codes(event / "fp1" / "manifest.json")
    assert "e2e-variant" not in codes(event / "fp1" / "manifest.json")
    assert not (event / "race").exists()  # 404 a propósito


def test_fixture_refuses_a_source_that_collides_with_the_variants(source: Path, tmp_path: Path) -> None:
    data, _ = synthetic_session()  # carrera: «race» es la variante 404
    build_session(data, tmp_path / "src")
    with pytest.raises(ValueError, match="variantes"):
        make_e2e_fixture(tmp_path / "src", "2026/00-synthetic/race", tmp_path / "out", **WINDOW)
