"""Miniaturas de trazado (D27) y centros de circuito (D37): del GeoJSON de bacinger/f1-circuits al front."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from typer.testing import CliRunner

from trazada_pipeline import cli, outlines
from trazada_pipeline.textutil import slugify

LICENSE = "Copyright (c) 2019-2025 Tomislav Bacinger\n\nPermission is hereby granted…\n"


def _circuit(root: Path, cid: str, location: str, coords: list[list[float]]) -> None:
    feature = {
        "type": "Feature",
        "properties": {"id": cid, "Location": location, "Name": f"Circuito {cid}"},
        "geometry": {"type": "LineString", "coordinates": coords},
    }
    (root / "circuits").mkdir(parents=True, exist_ok=True)
    (root / "circuits" / f"{cid}.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": [feature]}), encoding="utf-8"
    )


def _checkout(tmp_path: Path) -> Path:
    src = tmp_path / "bacinger"
    # Un rectángulo alargado de este a oeste (2:1 en metros) en Spa, con puntos intermedios alineados.
    lat, lon = 50.44, 5.97
    dlat = 0.001
    dlon = 2 * dlat / 0.6368  # cos(50.44°) ≈ 0.6368: el doble de ancho que de alto en metros
    rect = [
        [lon, lat],
        [lon + dlon / 2, lat],
        [lon + dlon, lat],
        [lon + dlon, lat + dlat],
        [lon, lat + dlat],
        [lon, lat],
    ]
    _circuit(src, "be-1925", "Spa Francorchamps", rect)
    for cid, loc in [
        ("mc-1929", "Monaco"),
        ("us-2022", "Miami"),
        ("ae-2009", "Yas Marina"),
        ("sg-2008", "Singapore"),
        ("de-1927", "Nürburg"),
        ("it-1914", "Scarperia e San Piero"),
        ("my-1999", "Sepang"),
    ]:
        _circuit(src, cid, loc, [[0, 0], [0.01, 0], [0.01, 0.01], [0, 0]])
    (src / "LICENSE.md").write_text(LICENSE, encoding="utf-8")
    return src


def _points(d: str) -> list[tuple[float, float]]:
    nums = [float(n) for n in re.findall(r"-?\d+(?:\.\d+)?", d)]
    return list(zip(nums[::2], nums[1::2], strict=True))


def test_outline_fits_viewbox_north_up_and_simplified(tmp_path: Path) -> None:
    doc = outlines.build_outlines(_checkout(tmp_path), commit="abc123")
    d = doc["outlines"]["be-1925"]
    assert d.startswith("M") and d.endswith("Z")
    pts = _points(d)
    # El punto intermedio alineado se elimina y el cierre no repite el primer punto.
    assert len(pts) == 4
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    assert min(xs) == pytest.approx(4, abs=0.1) and max(xs) == pytest.approx(60, abs=0.1)
    # 2:1 → 56 de ancho y 28 de alto, centrado en vertical.
    assert max(ys) - min(ys) == pytest.approx(28, abs=0.3)
    assert (min(ys) + max(ys)) / 2 == pytest.approx(32, abs=0.1)
    # Norte arriba: el primer punto (sur) está abajo, es decir, con y mayor.
    assert pts[0][1] > pts[3][1]


def test_document_maps_locations_with_aliases_and_exceptions(tmp_path: Path) -> None:
    doc = outlines.build_outlines(_checkout(tmp_path), commit="abc123")
    assert doc["source"] == {
        "repo": "https://github.com/bacinger/f1-circuits",
        "commit": "abc123",
        "license": "MIT",
        "copyright": "Copyright (c) 2019-2025 Tomislav Bacinger",
    }
    loc = doc["byLocation"]
    # Misma regla de slug que el pipeline (event_slug): «Spa Francorchamps» → «spa-francorchamps».
    assert loc[slugify("Spa-Francorchamps")] == "be-1925"
    assert loc["monte-carlo"] == loc["monaco"] == "mc-1929"
    assert loc["kuala-lumpur"] == "my-1999"
    assert doc["exceptions"] == {"2020-16": None}
    assert doc["viewBox"] == "0 0 64 64"


def test_centers_are_bbox_midpoints_rounded_inside_the_outline(tmp_path: Path) -> None:
    src = _checkout(tmp_path)
    doc = outlines.build_outlines(src, commit="abc123")
    # Un centro por trazado, y nada más.
    assert set(doc["centers"]) == set(doc["outlines"])
    # El rectángulo de Spa: lat 50,44…50,441 y lon 5,97…5,973 → centro de la caja, redondeado a 0,01°.
    assert doc["centers"]["be-1925"] == {"lat": 50.44, "lon": 5.97}
    # Cada centro cae dentro de la caja de su trazado (con el redondeo, a menos de media centésima).
    for cid, c in doc["centers"].items():
        feature = json.loads((src / "circuits" / f"{cid}.geojson").read_text(encoding="utf-8"))["features"][0]
        coords = feature["geometry"]["coordinates"]
        lons = [p[0] for p in coords]
        lats = [p[1] for p in coords]
        assert min(lats) - 0.005 <= c["lat"] <= max(lats) + 0.005, cid
        assert min(lons) - 0.005 <= c["lon"] <= max(lons) + 0.005, cid
        assert c == {"lat": round(c["lat"], 2), "lon": round(c["lon"], 2)}


def test_center_of_a_line_string() -> None:
    coords = [[-97.64, 30.13], [-97.62, 30.14], [-97.63, 30.15, 120.0]]
    assert outlines.center(coords) == {"lat": 30.14, "lon": -97.63}


def test_alias_to_missing_circuit_fails(tmp_path: Path) -> None:
    src = _checkout(tmp_path)
    (src / "circuits" / "my-1999.geojson").unlink()
    with pytest.raises(RuntimeError, match="kuala-lumpur"):
        outlines.build_outlines(src, commit="x")


def test_simplify_keeps_shape_within_epsilon() -> None:
    pts = [(float(i), 0.15 * ((-1) ** i)) for i in range(20)]  # zigzag de ±0,15: a menos de 0,35
    assert outlines.simplify(pts) == [pts[0], pts[-1]]
    spike = [(0.0, 0.0), (1.0, 5.0), (2.0, 0.0)]
    assert outlines.simplify(spike) == spike


def test_cli_writes_json_and_license(tmp_path: Path) -> None:
    src = _checkout(tmp_path)
    out = tmp_path / "web" / "circuit-outlines.json"
    result = CliRunner().invoke(cli.app, ["outlines", str(src), "--out", str(out), "--commit", "abc123"])
    assert result.exit_code == 0, result.output
    doc = json.loads(out.read_text(encoding="utf-8"))
    assert set(doc["outlines"]) >= {"be-1925", "my-1999"}
    lic = out.with_suffix(".LICENSE.txt").read_text(encoding="utf-8")
    assert "Tomislav Bacinger" in lic and "abc123" in lic


def test_committed_outlines_cover_2023_to_2026() -> None:
    """El JSON versionado en el front resuelve todos los GP de las temporadas que se ofrecen."""
    path = cli.REPO / "apps" / "web" / "app" / "assets" / "circuit-outlines.json"
    doc = json.loads(path.read_text(encoding="utf-8"))
    locations = {
        "Sakhir", "Jeddah", "Melbourne", "Baku", "Miami", "Miami Gardens", "Monaco", "Monte Carlo",
        "Barcelona", "Montréal", "Spielberg", "Silverstone", "Budapest", "Spa-Francorchamps", "Zandvoort",
        "Monza", "Marina Bay", "Suzuka", "Lusail", "Austin", "Mexico City", "São Paulo", "Las Vegas",
        "Yas Island", "Yas Marina", "Shanghai", "Imola", "Madrid", "Kuala Lumpur",
    }  # fmt: skip
    missing = [loc for loc in sorted(locations) if slugify(loc) not in doc["byLocation"]]
    assert missing == []
    assert set(doc["byLocation"].values()) <= set(doc["outlines"])
    assert path.with_suffix(".LICENSE.txt").exists()


def test_committed_centers_match_known_circuit_positions() -> None:
    """Los centros versionados (ambiente, D37) están donde están los circuitos: a menos de 0,05° (~5 km)."""
    path = cli.REPO / "apps" / "web" / "app" / "assets" / "circuit-outlines.json"
    doc = json.loads(path.read_text(encoding="utf-8"))
    assert set(doc["centers"]) == set(doc["outlines"])
    for cid, c in doc["centers"].items():
        assert -90 <= c["lat"] <= 90 and -180 <= c["lon"] <= 180, cid
    # Coordenadas públicas de cada circuito (grados decimales), independientes del GeoJSON.
    known = {
        "be-1925": (50.437, 5.971),  # Spa-Francorchamps
        "jp-1962": (34.843, 136.541),  # Suzuka
        "sg-2008": (1.291, 103.864),  # Marina Bay
        "ae-2009": (24.467, 54.603),  # Yas Marina
        "my-1999": (2.761, 101.738),  # Sepang (GP de Baréin 2026, alias kuala-lumpur)
        "us-2023": (36.116, -115.168),  # Las Vegas
        "br-1940": (-23.704, -46.700),  # Interlagos
    }
    for cid, (lat, lon) in known.items():
        assert doc["centers"][cid]["lat"] == pytest.approx(lat, abs=0.05), cid
        assert doc["centers"][cid]["lon"] == pytest.approx(lon, abs=0.05), cid
