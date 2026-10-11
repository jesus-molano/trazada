"""Criterios de H2 sobre las sesiones de referencia ya generadas en data/ (solo en local: `pytest -m local`).

Variables de entorno:
- TRAZADA_DATA: raíz de datos (por defecto <repo>/data).
- TRAZADA_FF1_CACHE: caché de FastF1 para repetir el build y comprobar el determinismo
  (por defecto <repo>/.cache/fastf1-sanitized).
- TRAZADA_TI_ROOT: copia local de TracingInsights; su posición final (que viene de Jolpica) se usa SOLO
  como referencia del orden de carrera en este test, nunca en los datos.
"""

from __future__ import annotations

import gzip
import json
import os
from pathlib import Path

import numpy as np
import pytest

from trazada_pipeline.circuit import registry
from trazada_pipeline.encode import trzb

pytestmark = pytest.mark.local

REPO = Path(__file__).resolve().parents[2]
DATA = Path(os.environ.get("TRAZADA_DATA", REPO / "data"))
V1 = DATA / "v1"
FF1_CACHE = Path(os.environ.get("TRAZADA_FF1_CACHE", REPO / ".cache" / "fastf1-sanitized"))
TI_ROOT = os.environ.get("TRAZADA_TI_ROOT")
MANIFESTS = sorted(V1.glob("sessions/*/*/*/manifest.json")) if V1.exists() else []
IDS = [str(p.parent.relative_to(V1 / "sessions")) for p in MANIFESTS]
RACE_MAX_BYTES = 5 * 1024 * 1024
RACE_TYPES = ("race", "sprint")


def _manifest(path: Path) -> dict:
    return json.loads(path.read_text())


def _decode(manifest_path: Path, key: str) -> trzb.Decoded:
    f = _manifest(manifest_path)["files"][key]
    return trzb.decode(gzip.decompress((manifest_path.parent / f["path"]).read_bytes()))


def _is_dev(m: dict) -> bool:
    return m["pipeline"]["source"] in ("tracinginsights-dev", "synthetic")


def _session_id(p: Path) -> str:
    return str(p.parent.relative_to(V1 / "sessions"))


if not MANIFESTS:
    pytest.skip(f"no hay sesiones generadas en {V1}", allow_module_level=True)

RACES = [p for p in MANIFESTS if _manifest(p)["session"]["type"] in RACE_TYPES]
NON_RACES = [p for p in MANIFESTS if _manifest(p)["session"]["type"] not in RACE_TYPES]
OFFLINE = [p for p in MANIFESTS if _manifest(p)["pipeline"]["source"] == "fastf1-offline-cache"]


@pytest.mark.parametrize("path", MANIFESTS, ids=IDS)
def test_coverage(path: Path) -> None:
    m = _manifest(path)
    assert m["session"]["status"] == "ok"
    # Las fuentes dev no traen posiciones tras un abandono: margen documentado en el informe de H2. Las
    # oficiales: un feed congelado con el coche en marcha cuenta como hueco (sin dato); en Bélgica FP1 el
    # del coche 5 se congela 2-3,5 s en cada vuelta en s ≈ 4.670 m y se queda en el 97,9 % (PLAN, H2).
    limit = 0.95 if _is_dev(m) else 0.975
    low = {car: c for car, c in m["quality"]["coverage"].items() if min(c["pos"], c["car"]) < limit}
    assert not low, low


@pytest.mark.parametrize("path", MANIFESTS, ids=IDS)
def test_geometry(path: Path) -> None:
    m = _manifest(path)
    circuit = _decode(path, "circuit")
    meta = circuit.meta
    q = meta["quality"]
    assert q["closureM"] < 2.0
    key = int(meta["circuitId"].split("-")[0])
    layout = registry.resolve(key, m["session"]["season"], m["session"]["slug"], dev=_is_dev(m))
    assert layout.official_length_m, "falta la longitud oficial en circuits.json"
    assert abs(meta["lengthM"] - layout.official_length_m) / layout.official_length_m <= 0.03
    assert meta["pit"] is not None and meta["pit"]["entryS"] is not None and meta["pit"]["exitS"] is not None
    assert abs(meta["pit"]["lengthM"] - q["pitSamplesLengthM"]) / q["pitSamplesLengthM"] <= 0.10
    assert m["channels"]["elevation"] == "real"
    motion = _decode(path, "motion").tables
    for start, count in zip(motion["cars"]["start"], motion["cars"]["count"], strict=True):
        s = motion["pos"]["s"][start : start + count]
        valid = motion["pos"]["path"][start : start + count] != 2
        assert np.all(np.diff(s[valid]) >= -1e-9)


@pytest.mark.parametrize("path", MANIFESTS, ids=IDS)
def test_weight(path: Path) -> None:
    m = _manifest(path)
    total = sum(f["bytes"] for f in m["files"].values())
    if m["session"]["type"] in RACE_TYPES:
        assert total <= RACE_MAX_BYTES


def _best_lap_order(laps: dict[str, np.ndarray]) -> list[int]:
    best: dict[int, float] = {}
    for car, lap_ms, deleted in zip(laps["car"], laps["lapMs"], laps["deleted"], strict=True):
        if lap_ms > 0 and not deleted:
            best[int(car)] = min(best.get(int(car), np.inf), float(lap_ms))
    return sorted(best, key=lambda c: best[c])


@pytest.mark.parametrize("path", NON_RACES, ids=_session_id)
def test_best_lap_order_matches_timing_tower(path: Path) -> None:
    """Orden de mejores vueltas = posición final de la propia torre de tiempos del live timing."""
    m = _manifest(path)
    if m["channels"].get("timingStream") != "present":
        pytest.skip("sin torre de tiempos")
    timing = _decode(path, "timing").tables
    ours = _best_lap_order(timing["laps"])
    st = timing["stream"]
    final: dict[int, int] = {}
    for car, pos in zip(st["car"], st["position"], strict=True):
        if pos > 0:
            final[int(car)] = int(pos)
    tower = [c for c in sorted(final, key=lambda c: final[c]) if c in ours]
    assert ours == tower


def _derived_race_order(laps: dict[str, np.ndarray]) -> tuple[list[int], int, set[int]]:
    """Orden por (vueltas completadas desc, fin de la última vuelta asc), vueltas del líder y coches que
    cruzan la meta después del ganador (los que reciben la bandera a cuadros)."""
    last: dict[int, tuple[int, float]] = {}
    for car, lap, end in zip(laps["car"], laps["lap"], laps["endMs"], strict=True):
        if end > 0 and (int(car) not in last or lap > last[int(car)][0]):
            last[int(car)] = (int(lap), float(end))
    order = sorted(last, key=lambda c: (-last[c][0], last[c][1]))
    winner_end = last[order[0]][1]
    flagged = {c for c, (_, end) in last.items() if end >= winner_end}
    return order, last[order[0]][0], flagged


@pytest.mark.parametrize("path", RACES, ids=_session_id)
def test_race_laps_and_order(path: Path) -> None:
    m = _manifest(path)
    order, leader_laps, flagged = _derived_race_order(_decode(path, "timing").tables["laps"])
    assert leader_laps == m["session"]["totalLaps"]
    if m["pipeline"]["source"] != "tracinginsights-dev" or not TI_ROOT:
        pytest.skip("sin referencia local de clasificación (TRAZADA_TI_ROOT)")
    session_dir = Path(TI_ROOT) / str(m["session"]["season"]) / m["session"]["event"] / m["session"]["name"]
    drivers = json.loads((session_dir / "drivers.json").read_text())["drivers"]
    ref: dict[int, int] = {}
    for d in drivers:
        lt = json.loads((session_dir / d["driver"] / "laptimes.json").read_text())
        pos = [p for p in lt["pos"] if p not in (None, "None", "nan")]
        if pos:
            ref[int(d["dn"])] = int(float(pos[-1]))
    # La posición de la última vuelta solo es la clasificación final para quien recibe la bandera.
    assert len(flagged) >= 15
    assert [c for c in order if c in flagged] == sorted(flagged, key=lambda c: ref[c])


@pytest.mark.parametrize("path", OFFLINE, ids=_session_id)
def test_rebuild_is_deterministic(path: Path, tmp_path: Path) -> None:
    from trazada_pipeline.build import build_session
    from trazada_pipeline.sources.fastf1_source import load_fastf1

    if not FF1_CACHE.exists():
        pytest.skip("sin caché de FastF1")
    m = _manifest(path)
    s = m["session"]
    data = load_fastf1(s["season"], s["event"], s["type"], FF1_CACHE, offline=True)
    # el circuito existente se reutiliza (copiado), como en un build normal
    circuit_dir = V1 / "circuits" / s["circuit"]
    dst = tmp_path / "v1" / "circuits" / s["circuit"]
    dst.mkdir(parents=True)
    for f in circuit_dir.iterdir():
        (dst / f.name).write_bytes(f.read_bytes())
    report = build_session(data, tmp_path)
    again = json.loads(report.manifest_path.read_text())["files"]
    assert {k: v["sha256"] for k, v in again.items()} == {k: v["sha256"] for k, v in m["files"].items()}


@pytest.mark.skipif(not TI_ROOT, reason="sin datos crudos locales (TRAZADA_TI_ROOT)")
def test_suzuka_bridge_dz_matches_raw_positions() -> None:
    """Cruce en ocho de Suzuka: la Δz de la línea central = la de las muestras crudas ±0,5 m."""
    from trazada_pipeline.circuit.geometry import PolylineIndex
    from trazada_pipeline.circuit.store import load_circuit
    from trazada_pipeline.sources.dev_tracinginsights import load_tracinginsights

    circuit = load_circuit("0-suzuka-dev", V1)
    if circuit is None:
        pytest.skip("circuito de Suzuka no generado")
    line = circuit.centerline
    n = len(line)
    # Par de puntos más cercanos en planta que están lejos a lo largo de la pista: el cruce.
    best = (np.inf, 0, 0)
    for i in range(0, n, 2):
        d = np.hypot(line[:, 0] - line[i, 0], line[:, 1] - line[i, 1])
        idx = np.abs(np.arange(n) - i)
        d[np.minimum(idx, n - idx) < 300] = np.inf
        j = int(np.argmin(d))
        if d[j] < best[0]:
            best = (float(d[j]), i, j)
    gap, i, j = best
    assert gap < 3.0, f"no se encontró el cruce (distancia mínima {gap:.1f} m)"
    dz_line = float(line[i, 2] - line[j, 2])
    assert abs(dz_line) > 2.0  # es un puente, no un cruce a nivel

    data = load_tracinginsights(Path(TI_ROOT) / "2026" / "Japanese Grand Prix" / "Race", 2026, 3, "suzuka")
    pts = np.vstack(
        [circuit.to_canonical(df[["x", "y", "z"]].to_numpy(dtype=np.float64)) for df in data.pos.values()]
    )
    # Radio pequeño: con más, la pendiente de los dos tramos diluye la diferencia de cota en el cruce.
    near = pts[np.hypot(pts[:, 0] - line[i, 0], pts[:, 1] - line[i, 1]) < 4.0]
    # Cada muestra pertenece al tramo más cercano en 3D (la z separa el de arriba del de abajo).
    u, _ = PolylineIndex(line, closed=True).project(near)
    length = float(circuit.length)
    si, sj = i * length / n, j * length / n
    circ = lambda a, b: np.minimum(np.abs(a - b), length - np.abs(a - b))  # noqa: E731
    upper_i = near[circ(u, si) < circ(u, sj)]
    upper_j = near[circ(u, si) >= circ(u, sj)]
    assert len(upper_i) > 50 and len(upper_j) > 50
    dz_raw = float(np.median(upper_i[:, 2]) - np.median(upper_j[:, 2]))
    assert abs(dz_line - dz_raw) <= 0.5, f"Δz línea {dz_line:.2f} m frente a crudos {dz_raw:.2f} m"
