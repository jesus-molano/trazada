"""Orquestador de punta a punta sobre la sesión sintética: ficheros, manifest, catálogo y determinismo."""

from __future__ import annotations

import gzip
import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from synthetic import L, synthetic_session

from trazada_pipeline import schema
from trazada_pipeline.build import BuildReport, build_session, coverage_ratio, playback_window
from trazada_pipeline.encode import trzb
from trazada_pipeline.sources.base import WEATHER_COLUMNS, CircuitInfo, SessionData

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


def _events(report: BuildReport) -> dict:
    ref = json.loads(report.manifest_path.read_text())["files"]["events"]
    return json.loads(gzip.decompress((report.manifest_path.parent / ref["path"]).read_bytes()))


def test_without_weather_the_channel_is_absent(built) -> None:
    """La fuente no trae meteorología: el manifest lo dice (`absent`) y events.json no la lleva."""
    _, _, report = built
    assert json.loads(report.manifest_path.read_text())["channels"]["weather"] == "absent"
    assert "weather" not in _events(report)


def test_weather_reaches_events_cut_to_the_playback(tmp_path: Path) -> None:
    """D36: las muestras de la reproducción y la vigente al empezar; null sigue siendo null (nunca 0)."""
    data, _ = synthetic_session()
    data.session_type, data.session_name, data.total_laps = "fp1", "Practice 1", None
    data.session_start_ms = 300_000  # la reproducción empieza 2 min antes: en 180 000
    start, end, _ = playback_window(data)
    assert start == 180_000
    times = list(range(30_000, end + 180_000, 60_000))  # una por minuto, de antes del inicio a después
    rows = [
        {
            "t_ms": t,
            "air_c": None if i == 4 else 20.0 + i / 10,
            "track_c": 30.5,
            "humidity": 50.0,
            "pressure_hpa": 1013.2,
            "rain": i % 7 == 0,
            "wind_ms": 1.0,
            "wind_deg": 90,
        }
        for i, t in enumerate(times)
    ]
    data.weather = pd.DataFrame(rows, columns=list(WEATHER_COLUMNS), dtype=object)
    report = build_session(data, tmp_path)
    manifest = json.loads(report.manifest_path.read_text())
    assert manifest["channels"]["weather"] == "present"
    assert manifest["schemaVersion"] == schema.schema_version()
    assert manifest["minReader"] == "1.0.0"  # cambio aditivo (1.1.0): un lector 1.0.0 lo lee y lo ignora
    w = _events(report)["weather"]
    schema.validate("events", _events(report))
    assert w["t"][0] == 150_000  # la última anterior al inicio
    assert all(start <= t <= end for t in w["t"][1:])
    assert w["t"] == [t for t in times if start - 60_000 < t <= end]
    assert len({len(col) for col in w.values()}) == 1
    assert w["airC"][w["t"].index(times[4])] is None
    assert w["rain"] == [i % 7 == 0 for i, t in enumerate(times) if start - 60_000 < t <= end]


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


@pytest.mark.parametrize("session_start", [-1, 0, None])
def test_unknown_lights_out_is_not_invented(session_start: int | None) -> None:
    """Sin inicio de la vuelta 1 ni de la sesión (-1, 0 o nada), la salida queda sin dato."""
    data, _ = synthetic_session()
    data.laps.loc[data.laps["lap"] == 1, "start_ms"] = -1
    data.session_start_ms = session_start
    start, _, lights_out = playback_window(data)
    assert lights_out is None and start == 0


def test_unknown_lights_out_reaches_the_manifest(tmp_path: Path) -> None:
    data, _ = synthetic_session()
    data.laps.loc[data.laps["lap"] == 1, "start_ms"] = -1
    data.session_start_ms = -1
    manifest = json.loads(build_session(data, tmp_path).manifest_path.read_text())
    assert manifest["session"]["playback"]["lightsOutMs"] is None
    assert "lights-out-unknown" in {n["code"] for n in manifest["quality"]["notes"]}


def test_coverage_ratio() -> None:
    t = np.arange(0, 10_001, 250)
    assert coverage_ratio(t, [(0, 10_000)]) == 1.0
    gap = t[(t < 3000) | (t > 8000)]
    assert coverage_ratio(gap, [(0, 10_000)]) == pytest.approx(1 - 5500 / 10_000)  # hueco 2750→8250
    assert coverage_ratio(np.array([]), []) == 1.0


def test_dev_circuit_taints_the_session(tmp_path: Path) -> None:
    """Curvas de una copia de desarrollo: el circuito y la sesión quedan como dev (nunca se publican)."""
    data, _ = synthetic_session()
    data.circuit_info = CircuitInfo(
        corners=pd.DataFrame({"number": [1], "letter": [""], "x": [0.0], "y": [0.0], "angle": [0.0]}),
        marshal_sectors=None,
        rotation_deg=0.0,
        source="multiviewer (vía TracingInsights, dev)",
        dev=True,
    )
    data.dev = False
    report = build_session(data, tmp_path)
    catalog = json.loads((tmp_path / "v1" / "catalog.json").read_text())
    entry = catalog["seasons"][0]["events"][0]["sessions"][0]
    assert entry["dev"] is True
    # El informe también (el gestor local lo pasa a la interfaz antes de releer el catálogo).
    assert report.dev is True
    assert any("fuentes de desarrollo" in w for w in report.warnings)


def test_old_circuit_with_dev_sources_is_detected(tmp_path: Path) -> None:
    from trazada_pipeline.circuit.store import load_circuit

    data, _ = synthetic_session()
    build_session(data, tmp_path)
    v1 = tmp_path / "v1"
    circuit_id = next((v1 / "circuits").iterdir()).name
    c = load_circuit(circuit_id, v1)
    assert c is not None and c.dev is True  # sesión sintética: su circuito es dev


def _note_codes() -> set[str]:
    doc = json.loads((schema.schema_dir() / "manifest.schema.json").read_text())
    return set(doc["$defs"]["qualityNote"]["properties"]["code"]["enum"])


def test_quality_notes_are_machine_readable(built) -> None:
    """Cada aviso lleva un código estable (la UI lo traduce) y su texto, el mismo que se imprime."""
    _, _, report = built
    notes = json.loads(report.manifest_path.read_text())["quality"]["notes"]
    assert notes and all(isinstance(n, dict) and n["code"] in _note_codes() for n in notes)
    assert [n["text"] for n in notes] == report.warnings
    assert "no-corners" in {n["code"] for n in notes}  # la sesión sintética no trae curvas
    assert "finishLineLaps" not in report.quality  # con vueltas de sobra, la meta no es la de reserva


def test_finish_line_fallback_is_recorded(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Pocas vueltas para situar la meta: el aviso llega al manifest (también al reutilizar el circuito)."""
    from trazada_pipeline.circuit import build as circuit_build
    from trazada_pipeline.circuit.build import build_centerline, finish_line_s

    data, _ = synthetic_session()
    line, _ = build_centerline(data)
    _, laps = finish_line_s(data, line)
    assert laps >= 3

    monkeypatch.setattr(circuit_build, "MIN_FINISH_LAPS", laps + 1)
    report = build_session(data, tmp_path)
    assert report.quality["finishLineLaps"] == laps
    monkeypatch.undo()
    again = build_session(synthetic_session()[0], tmp_path)  # circuito ya guardado: se reutiliza
    for r in (report, again):
        notes = json.loads(r.manifest_path.read_text())["quality"]["notes"]
        fallback = [n for n in notes if n["code"] == "finish-line-fallback"]
        assert len(fallback) == 1 and fallback[0]["params"] == {"laps": laps}
        assert fallback[0]["text"] in r.warnings


# --- Reutilizar el circuito solo si la sesión encaja (auditoría G) ---


def _stretched(data: SessionData, factor: float = 1.1) -> SessionData:
    """Otro trazado: las rectas un 10 % más largas (y las curvas, elipses)."""
    for pos in data.pos.values():
        pos["x"] = np.rint(pos["x"] * factor).astype(np.int64)
    return data


def _manifest(report: BuildReport) -> dict:
    return json.loads(report.manifest_path.read_text())


def _circuit_dirs(root: Path) -> list[str]:
    return sorted(p.name for p in (root / "v1" / "circuits").iterdir())


def test_same_layout_reuses_the_stored_circuit(tmp_path: Path) -> None:
    build_session(synthetic_session()[0], tmp_path)
    pointer = tmp_path / "v1" / "circuits" / "0-synthetic-dev" / "circuit.json"
    before = pointer.read_text()
    report = build_session(synthetic_session(seed=7)[0], tmp_path)  # otra sesión, mismo trazado
    m = _manifest(report)
    assert m["session"]["circuit"] == "0-synthetic-dev"
    assert _circuit_dirs(tmp_path) == ["0-synthetic-dev"]
    assert pointer.read_text() == before
    assert report.quality["fitDevM"] < 1.0
    assert not any("encaja" in n["text"] for n in m["quality"]["notes"])


def test_changed_layout_builds_a_new_variant(tmp_path: Path) -> None:
    from trazada_pipeline.circuit.store import load_circuit

    build_session(synthetic_session()[0], tmp_path)
    report = build_session(_stretched(synthetic_session(seed=7)[0]), tmp_path)
    m = _manifest(report)
    assert m["session"]["circuit"] == "0-synthetic-dev-v2"
    assert any(
        n["code"] == "circuit-layout-changed" and "0-synthetic-dev-v2" in n["text"]
        for n in m["quality"]["notes"]
    )
    folder = report.manifest_path.parent
    circuit = trzb.decode(gzip.decompress((folder / m["files"]["circuit"]["path"]).read_bytes()))
    assert circuit.meta["circuitId"] == "0-synthetic-dev-v2"
    assert circuit.meta["lengthM"] > 1.05 * L  # la geometría es la del trazado nuevo
    original = load_circuit("0-synthetic-dev", tmp_path / "v1")
    assert original is not None and abs(original.length - L) / L < 0.005  # el guardado no se toca

    # Otra sesión con el trazado nuevo reutiliza la variante (no crea una tercera).
    again = _manifest(build_session(_stretched(synthetic_session(seed=8)[0]), tmp_path))
    assert again["session"]["circuit"] == "0-synthetic-dev-v2"
    assert _circuit_dirs(tmp_path) == ["0-synthetic-dev", "0-synthetic-dev-v2"]
    assert any(
        n["code"] == "circuit-variant-used" and n["params"]["circuit"] == "0-synthetic-dev-v2"
        for n in again["quality"]["notes"]
    )


def test_unverifiable_fit_reuses_with_a_note(tmp_path: Path) -> None:
    build_session(synthetic_session()[0], tmp_path)
    data = synthetic_session(seed=7)[0]
    data.laps["lap_ms"] = -1  # sin vueltas con tiempo: no hay vueltas limpias con las que comprobarlo
    m = _manifest(build_session(data, tmp_path))
    assert m["session"]["circuit"] == "0-synthetic-dev"
    assert any(n["code"] == "circuit-fit-unchecked" for n in m["quality"]["notes"])


def test_outdated_geometry_is_rebuilt_in_place(tmp_path: Path) -> None:
    """Un circuito de una versión anterior (Spa: pit lane con el desvío) se reconstruye si la sesión
    encaja en él."""
    from dataclasses import replace

    from trazada_pipeline.circuit.store import load_circuit, save_circuit

    v1 = tmp_path / "v1"
    build_session(synthetic_session()[0], tmp_path)
    old = load_circuit("0-synthetic-dev", v1)
    assert old is not None
    save_circuit(replace(old, geometry_version=1), v1)
    m = _manifest(build_session(synthetic_session(seed=7)[0], tmp_path))
    assert m["session"]["circuit"] == "0-synthetic-dev"
    assert any(
        n["code"] == "circuit-rebuilt" and n["params"]["reason"] == "outdated" for n in m["quality"]["notes"]
    )
    rebuilt = load_circuit("0-synthetic-dev", v1)
    assert rebuilt is not None and rebuilt.geometry_version > 1


def _with_corners(data: SessionData) -> SessionData:
    data.circuit_info = CircuitInfo(
        corners=pd.DataFrame({"number": [1], "letter": [""], "x": [0.0], "y": [-1000.0], "angle": [0.0]}),
        marshal_sectors=None,
        rotation_deg=0.0,
    )
    return data


def test_circuit_without_corners_gets_them_when_a_session_brings_them(tmp_path: Path) -> None:
    """Auditoría G: Spa (7-a) se construyó sin MultiViewer y se habría quedado sin curvas para siempre."""
    from trazada_pipeline.circuit.store import load_circuit

    build_session(synthetic_session()[0], tmp_path)
    m = _manifest(build_session(_with_corners(synthetic_session(seed=7)[0]), tmp_path))
    assert any(
        n["code"] == "circuit-rebuilt" and n["params"]["reason"] == "gains-corners"
        for n in m["quality"]["notes"]
    )
    c = load_circuit("0-synthetic-dev", tmp_path / "v1")
    assert c is not None and len(c.corners) == 1


def test_outdated_circuit_is_not_rebuilt_if_it_would_lose_its_corners(tmp_path: Path) -> None:
    from dataclasses import replace

    from trazada_pipeline.circuit.store import load_circuit, save_circuit

    v1 = tmp_path / "v1"
    build_session(_with_corners(synthetic_session()[0]), tmp_path)
    old = load_circuit("0-synthetic-dev", v1)
    assert old is not None and len(old.corners) == 1
    save_circuit(replace(old, geometry_version=1), v1)
    m = _manifest(build_session(synthetic_session(seed=7)[0], tmp_path))  # sin MultiViewer
    assert any(n["code"] == "circuit-outdated-kept" for n in m["quality"]["notes"])
    kept = load_circuit("0-synthetic-dev", v1)
    assert kept is not None and len(kept.corners) == 1 and kept.geometry_version == 1


def test_outdated_circuit_is_not_rebuilt_from_a_session_without_pit_stops(tmp_path: Path) -> None:
    """Una sprint sin paradas encaja en el circuito, pero sin paradas no hay pit lane: reconstruirlo con ella
    dejaría el circuito canónico sin pit lane para todas las sesiones siguientes."""
    from dataclasses import replace

    from trazada_pipeline.circuit.store import load_circuit, save_circuit

    v1 = tmp_path / "v1"
    build_session(synthetic_session()[0], tmp_path)
    old = load_circuit("0-synthetic-dev", v1)
    assert old is not None and old.pitlane is not None
    save_circuit(replace(old, geometry_version=1), v1)
    sprint = synthetic_session(seed=7)[0]
    sprint.laps[["pit_in_ms", "pit_out_ms"]] = -1
    m = _manifest(build_session(sprint, tmp_path))
    assert any(
        n["code"] == "circuit-outdated-kept" and "perdería el pit lane" in n["text"]
        for n in m["quality"]["notes"]
    )
    kept = load_circuit("0-synthetic-dev", v1)
    assert kept is not None and kept.pitlane is not None and kept.geometry_version == 1


def test_outdated_circuit_is_kept_if_the_session_cannot_rebuild_it(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Antes se reutilizaba: un circuito que esta sesión no sabe construir no tumba el build."""
    from dataclasses import replace

    import trazada_pipeline.build as build_mod
    from trazada_pipeline.circuit.build import CircuitBuildError
    from trazada_pipeline.circuit.store import load_circuit, save_circuit

    v1 = tmp_path / "v1"
    build_session(synthetic_session()[0], tmp_path)
    old = load_circuit("0-synthetic-dev", v1)
    assert old is not None
    save_circuit(replace(old, geometry_version=1), v1)

    def fail(*_args: object) -> None:
        raise CircuitBuildError("hueco de 75 m sin muestras en la línea central")

    monkeypatch.setattr(build_mod, "build_circuit", fail)
    report = build_session(synthetic_session(seed=7)[0], tmp_path)
    assert report.status == "ok"
    assert any(
        n["code"] == "circuit-outdated-kept" and n["params"]["reason"] == "build-failed"
        for n in _manifest(report)["quality"]["notes"]
    )
    kept = load_circuit("0-synthetic-dev", v1)
    assert kept is not None and kept.geometry_version == 1
