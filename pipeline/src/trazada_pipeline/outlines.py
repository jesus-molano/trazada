"""Miniaturas de trazado para el selector (D27), desde bacinger/f1-circuits (GeoJSON, licencia MIT).

Se ejecuta una vez en desarrollo (`trazada outlines <checkout>`) y su salida se versiona en el front: no
son datos de F1 ni de MultiViewer, sino trazados dibujados a mano sobre imagen de satélite por su autor.
Cada circuito pasa a un path SVG en un viewBox de 64 x 64, con el norte arriba (igual para todas las
tarjetas) y simplificado con Ramer-Douglas-Peucker por debajo del píxel.

Del mismo GeoJSON sale el centro de cada circuito (latitud y longitud, el centro de la caja del trazado
redondeado a 0,01°, ~1 km): con él y la hora UTC de la sesión, la escena calcula la altura del sol para
su ambiente decorativo (D37). No es la hora local ni el tiempo atmosférico.
"""

from __future__ import annotations

import json
import math
import subprocess
from pathlib import Path
from typing import Any

from trazada_pipeline.textutil import slugify

VIEW = 64.0
MARGIN = 4.0
#: Tolerancia de la simplificación, en unidades del viewBox (a 40-64 px, por debajo del píxel).
EPSILON = 0.35
#: Decimales de los centros (0,01° ≈ 1 km): de sobra para la altura del sol (un grado de longitud son 4 min).
CENTER_DECIMALS = 2
REPO_URL = "https://github.com/bacinger/f1-circuits"

#: Localidades de FastF1 (slug de `Location`, la misma regla que `event_slug`) que no coinciden con las de
#: bacinger. Comprobado contra los calendarios de FastF1 2018-2026: con estos alias se resuelven los 196 GP.
LOCATION_ALIASES: dict[str, str] = {
    "monte-carlo": "mc-1929",
    "miami-gardens": "us-2022",
    "yas-island": "ae-2009",
    "marina-bay": "sg-2008",
    "nurburgring": "de-1927",
    "mugello": "it-1914",
    "kuala-lumpur": "my-1999",  # GP de Baréin 2026, disputado en Sepang
}

#: Eventos cuyo trazado no está en bacinger (`temporada-ronda` → null): mejor sin miniatura que con una falsa.
EVENT_EXCEPTIONS: dict[str, str | None] = {
    "2020-16": None,  # GP de Sakhir 2020: trazado exterior de Baréin
}


def project(coords: list[list[float]]) -> list[tuple[float, float]]:
    """Lon/lat (WGS84) → metros con una equirrectangular centrada en el circuito; y hacia abajo (SVG)."""
    lat0 = sum(c[1] for c in coords) / len(coords)
    lon0 = sum(c[0] for c in coords) / len(coords)
    r = 6_371_000.0
    k = math.cos(math.radians(lat0))
    return [(math.radians(lon - lon0) * k * r, -math.radians(lat - lat0) * r) for lon, lat, *_ in coords]


Points = list[tuple[float, float]]


def fit(points: Points, size: float = VIEW, margin: float = MARGIN) -> Points:
    """Escala sin deformar y centra en un cuadrado de `size` con `margin` libre a cada lado."""
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    w = max(xs) - min(xs)
    h = max(ys) - min(ys)
    scale = (size - 2 * margin) / max(w, h, 1e-9)
    ox = (size - w * scale) / 2 - min(xs) * scale
    oy = (size - h * scale) / 2 - min(ys) * scale
    return [(x * scale + ox, y * scale + oy) for x, y in points]


def _dist(p: tuple[float, float], a: tuple[float, float], b: tuple[float, float]) -> float:
    dx, dy = b[0] - a[0], b[1] - a[1]
    if dx == 0 and dy == 0:
        return math.hypot(p[0] - a[0], p[1] - a[1])
    t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)))
    return math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))


def simplify(points: list[tuple[float, float]], epsilon: float = EPSILON) -> list[tuple[float, float]]:
    """Ramer-Douglas-Peucker iterativo: conserva los extremos y lo que se aleja más de `epsilon`."""
    if len(points) < 3:
        return list(points)
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        i, j = stack.pop()
        best, idx = 0.0, -1
        for k in range(i + 1, j):
            d = _dist(points[k], points[i], points[j])
            if d > best:
                best, idx = d, k
        if idx >= 0 and best > epsilon:
            keep[idx] = True
            stack.extend([(i, idx), (idx, j)])
    return [p for p, k in zip(points, keep, strict=True) if k]


def to_path(points: list[tuple[float, float]], closed: bool) -> str:
    def num(v: float) -> str:
        s = f"{v:.1f}"
        return "0" if s in ("0.0", "-0.0") else s.rstrip("0").rstrip(".")

    pts = points[:-1] if closed and len(points) > 1 and points[0] == points[-1] else points
    body = " ".join(f"{num(x)} {num(y)}" for x, y in pts)
    return f"M{body}{'Z' if closed else ''}"


def outline_path(coords: list[list[float]]) -> str:
    """Path SVG (viewBox 0 0 64 64, norte arriba) de un LineString de GeoJSON."""
    pts = fit(project(coords))
    closed = math.hypot(pts[0][0] - pts[-1][0], pts[0][1] - pts[-1][1]) < 1.0
    if closed:
        pts[-1] = pts[0]
    return to_path(simplify(pts), closed)


def center(coords: list[list[float]]) -> dict[str, float]:
    """Centro de la caja del trazado (lon/lat de GeoJSON) en grados, redondeado a `CENTER_DECIMALS`."""
    lons = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    return {
        "lat": round((min(lats) + max(lats)) / 2, CENTER_DECIMALS),
        "lon": round((min(lons) + max(lons)) / 2, CENTER_DECIMALS),
    }


def _commit(src: Path) -> str:
    try:
        out = subprocess.run(
            ["git", "-C", str(src), "rev-parse", "HEAD"], capture_output=True, text=True, check=True
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        raise RuntimeError(f"{src} no es un checkout de git: indica el commit con --commit") from exc
    return out.stdout.strip()


def build_outlines(src: Path, commit: str | None = None) -> dict[str, Any]:
    """Lee `<src>/circuits/*.geojson` y devuelve el documento que usa el front."""
    outlines: dict[str, str] = {}
    centers: dict[str, dict[str, float]] = {}
    by_location: dict[str, str] = {}
    for path in sorted((src / "circuits").glob("*.geojson")):
        doc = json.loads(path.read_text(encoding="utf-8"))
        feature = next(f for f in doc["features"] if f["geometry"]["type"] == "LineString")
        cid = str(feature["properties"]["id"])
        outlines[cid] = outline_path(feature["geometry"]["coordinates"])
        centers[cid] = center(feature["geometry"]["coordinates"])
        by_location[slugify(str(feature["properties"]["Location"]))] = cid
    if not outlines:
        raise RuntimeError(f"No hay circuitos en {src / 'circuits'}")
    for alias, cid in LOCATION_ALIASES.items():
        if cid not in outlines:
            raise RuntimeError(f"El alias {alias} apunta a {cid}, que no está en el checkout")
        by_location[alias] = cid
    return {
        "source": {
            "repo": REPO_URL,
            "commit": commit or _commit(src),
            "license": "MIT",
            "copyright": "Copyright (c) 2019-2025 Tomislav Bacinger",
        },
        "viewBox": f"0 0 {VIEW:g} {VIEW:g}",
        "byLocation": dict(sorted(by_location.items())),
        "exceptions": EVENT_EXCEPTIONS,
        "outlines": outlines,
        "centers": centers,
    }


def write_outlines(src: Path, out: Path, commit: str | None = None) -> dict[str, Any]:
    """Escribe el JSON y, al lado, el texto de la licencia MIT del origen (condición de la licencia)."""
    doc = build_outlines(src, commit)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    license_text = (src / "LICENSE.md").read_text(encoding="utf-8")
    out.with_suffix(".LICENSE.txt").write_text(
        f"Circuit outlines in {out.name} are simplified from bacinger/f1-circuits ({REPO_URL}),\n"
        f"commit {doc['source']['commit']}, under the MIT License:\n\n{license_text}",
        encoding="utf-8",
    )
    return doc
