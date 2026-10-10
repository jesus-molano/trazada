"""Orquestador de punta a punta sobre la sesión sintética: ficheros, manifest, catálogo y determinismo."""

from __future__ import annotations

import gzip
import json
from pathlib import Path

import numpy as np
import pytest
from synthetic import synthetic_session

from trazada_pipeline import schema
from trazada_pipeline.build import build_session, coverage_ratio, playback_window
from trazada_pipeline.encode import trzb

#: Campos que FastF1 trae de Ergast/Jolpica (CC BY-NC-SA) o fotos: nunca deben aparecer en los datos.
FORBIDDEN_KEYS = {
    "ClassifiedPosition",
    "GridPosition",
    "Points",
    "Status",
    "HeadshotUrl",
    "BroadcastName",
    "DriverId",
    "TeamId",
    "CountryCode",
    "FullName",
    "Q1",
    "Q2",
    "Q3",
    "headshot",
    "points",
    "grid",
    "classifiedPosition",
}


@pytest.fixture(scope="module")
def built(tmp_path_factory: pytest.TempPathFactory):
    data, _ = synthetic_session()
    root = tmp_path_factory.mktemp("data")
    report = build_session(data, root)
    return data, root, report


def _keys(obj: object) -> set[str]:
    if isinstance(obj, dict):
        return set(obj) | set().union(*(_keys(v) for v in obj.values()))
    if isinstance(obj, list):
        return set().union(*(_keys(v) for v in obj)) if obj else set()
    return set()


def test_manifest_and_catalog(built) -> None:
    _, root, report = built
    manifest = json.loads(report.manifest_path.read_text())
    schema.validate("manifest", manifest)
    assert report.status == "ok"
    assert manifest["pipeline"]["source"] == "synthetic"
    assert manifest["session"]["circuit"] == "0-synthetic-dev"
    assert manifest["session"]["totalLaps"] == 8
    assert manifest["channels"]["drs"] == "absent"
    assert manifest["channels"]["elevation"] == "real"
    assert manifest["quality"]["estimated"] == []  # la fuente no declara nada derivado

    for f in manifest["files"].values():
        path = report.manifest_path.parent / f["path"]
        assert path.exists()
        assert len(path.read_bytes()) == f["bytes"]
    catalog = json.loads((root / "v1" / "catalog.json").read_text())
    schema.validate("catalog", catalog)
    entry = catalog["seasons"][0]["events"][0]["sessions"][0]
    assert entry["dev"] is True and entry["session"] == "race"
    assert (root / "v1" / entry["path"]).resolve() == report.manifest_path.resolve()


def test_estimated_fields_come_from_the_source(tmp_path: Path) -> None:
    data, _ = synthetic_session()
    data.estimated = ["trackStatus", "positions", "trackStatus"]
    report = build_session(data, tmp_path)
    manifest = json.loads(report.manifest_path.read_text())
    assert manifest["quality"]["estimated"] == ["positions", "trackStatus"]


def test_files_decode_and_motion_is_monotone(built) -> None:
    _, _, report = built
    manifest = json.loads(report.manifest_path.read_text())
    folder = report.manifest_path.parent
    motion = trzb.decode(gzip.decompress((folder / manifest["files"]["motion"]["path"]).read_bytes()))
    cars = motion.tables["cars"]
    pos = motion.tables["pos"]
    for start, count in zip(cars["start"], cars["count"], strict=True):
        s = pos["s"][start : start + count]
        valid = pos["path"][start : start + count] != 2
        assert np.all(np.diff(s[valid]) >= -1e-9)
    car = trzb.decode(gzip.decompress((folder / manifest["files"]["car"]["path"]).read_bytes()))
    assert set(car.tables["tel"]["drs"].tolist()) == {255}
    circuit = trzb.decode(gzip.decompress((folder / manifest["files"]["circuit"]["path"]).read_bytes()))
    assert circuit.meta["pit"]["entryS"] > circuit.meta["pit"]["exitS"]  # el pit lane cruza s = 0


def test_no_jolpica_or_photo_fields(built) -> None:
    _, _, report = built
    folder = report.manifest_path.parent
    manifest = json.loads(report.manifest_path.read_text())
    events = json.loads(gzip.decompress((folder / manifest["files"]["events"]["path"]).read_bytes()))
    assert not (_keys(manifest) | _keys(events)) & FORBIDDEN_KEYS
    assert all("finish" not in d for d in manifest["drivers"])


def test_build_is_deterministic(built, tmp_path: Path) -> None:
    _, _, report = built
    again = build_session(synthetic_session()[0], tmp_path)
    a = json.loads(report.manifest_path.read_text())["files"]
    b = json.loads(again.manifest_path.read_text())["files"]
    assert {k: v["sha256"] for k, v in a.items()} == {k: v["sha256"] for k, v in b.items()}


def test_playback_window_for_race(built) -> None:
    data, _, _ = built
    start, end, lights_out = playback_window(data)
    assert lights_out == int(data.laps[data.laps["lap"] == 1]["start_ms"].min())
    assert start == max(0, lights_out - 10 * 60 * 1000)
    chequered = int(data.race_control[data.race_control["text"] == "CHEQUERED FLAG"]["t_ms"].iloc[0])
    data_end = max(int(df["t_ms"].max()) for df in data.pos.values())
    assert end == min(data_end, chequered + 5 * 60 * 1000)


def test_coverage_ratio() -> None:
    t = np.arange(0, 10_001, 250)
    assert coverage_ratio(t, [(0, 10_000)]) == 1.0
    gap = t[(t < 3000) | (t > 8000)]
    assert coverage_ratio(gap, [(0, 10_000)]) == pytest.approx(1 - 5500 / 10_000)  # hueco 2750→8250
    assert coverage_ratio(np.array([]), []) == 1.0
