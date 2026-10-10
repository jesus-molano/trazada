"""Fixture e2e: extracto recortado de una sesión ya generada, más variantes para probar estados del front.

El extracto conserva todos los coches en una ventana de pocos minutos (la de más coches en pista) y se
re-codifica con el mismo esquema. Para que la clasificación, los contadores de vuelta y el feed de
dirección de carrera del extracto sean los que hubo (nunca un estado que no existió), lleva además, de
antes de la ventana:

- de cada coche, la última fila de la torre anterior o igual al inicio de la ventana (con su instante
  real: el lector toma la última fila con t ≤ reloj, así que no hace falta moverla);
- todas las vueltas empezadas antes del final de la ventana (vueltas completadas y mejor vuelta);
- todos los mensajes de dirección de carrera anteriores al final de la ventana (el recuento del feed, las
  banderas azules de los segundos previos y los mensajes de vuelta anulada son los de la sesión).

Las variantes son estados **inventados solo para los tests** (el catálogo las marca `dev` y su manifest
lleva la nota `e2e-variant`). Reutilizan los ficheros del extracto:

- `fp2`: sesión `no-position` (no disponible en el catálogo; su manifest lo declara);
- `fp3`: manifest con un `minReader` de un major futuro (versión no soportada);
- `q`: manifest cuyo fichero `motion` está corrupto (sha256 y gzip inválidos);
- `race`: entrada de catálogo cuyo manifest no existe (404).
"""

from __future__ import annotations

import gzip
import json
import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np

from trazada_pipeline import schema
from trazada_pipeline.build import SESSION_ORDER
from trazada_pipeline.encode import trzb
from trazada_pipeline.files import write_hashed

PATH_TRACK = 0
#: Tope del fixture e2e (política de fixtures: extractos mínimos, ≤ 1 MB en total).
FIXTURE_MAX_BYTES = 1_000_000
#: Variantes de estado (inventadas para los tests): tipo de sesión → nombre en el catálogo.
VARIANTS = {"fp2": "Practice 2", "fp3": "Practice 3", "q": "Qualifying", "race": "Race"}
EXTRACT_NOTE = {"code": "e2e-extract", "text": "Extracto recortado para tests e2e."}
VARIANT_NOTE = {
    "code": "e2e-variant",
    "text": "Variante inventada para los tests e2e (estado de error o no disponible): no es una sesión real.",
}


def _decode(folder: Path, ref: dict[str, Any]) -> trzb.Decoded:
    return trzb.decode(gzip.decompress((folder / ref["path"]).read_bytes()))


def _write_json(path: Path, doc: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def best_window(motion: trzb.Decoded, start_ms: int, end_ms: int, minutes: float) -> tuple[int, int]:
    """Ventana de `minutes` con más muestras en pista (todos los coches)."""
    pos = motion.tables["pos"]
    t = pos["t"][pos["path"] == PATH_TRACK]
    width = int(minutes * 60_000)
    if end_ms - start_ms <= width:
        return start_ms, end_ms
    bins = np.arange(start_ms, end_ms - width + 1, 15_000)
    counts = [np.count_nonzero((t >= a) & (t < a + width)) for a in bins]
    a = int(bins[int(np.argmax(counts))])
    return a, a + width


def _trim_per_car(dec: trzb.Decoded, table: str, a: int, b: int) -> dict[str, dict[str, np.ndarray]]:
    cars = dec.tables["cars"]
    rows = dec.tables[table]
    keep_idx, starts, counts = [], [], []
    offset = 0
    for start, count in zip(cars["start"], cars["count"], strict=True):
        idx = np.arange(start, start + count)
        idx = idx[(rows["t"][idx] >= a) & (rows["t"][idx] <= b)]
        keep_idx.append(idx)
        starts.append(offset)
        counts.append(len(idx))
        offset += len(idx)
    sel = np.concatenate(keep_idx) if keep_idx else np.zeros(0, dtype=np.int64)
    return {
        "cars": {"car": cars["car"], "start": np.array(starts), "count": np.array(counts)},
        table: {k: v[sel] for k, v in rows.items()},
    }


def _stream_rows(stream: dict[str, np.ndarray], a: int, b: int) -> np.ndarray:
    """Filas de la torre de la ventana, más la última de cada coche anterior o igual a `a`."""
    t, car = stream["t"], stream["car"]
    keep = (t > a) & (t <= b)
    for c in np.unique(car):
        before = np.flatnonzero((car == c) & (t <= a))
        if len(before):
            # La que usa el lector: la de mayor t y, a igual t, la última (su orden es estable).
            keep[before[t[before] == t[before].max()][-1]] = True
    return keep


def _trim_timing(dec: trzb.Decoded, a: int, b: int) -> dict[str, dict[str, np.ndarray]]:
    laps = dec.tables["laps"]
    # Todas las vueltas empezadas antes del final (o sin inicio conocido): las completadas antes de la
    # ventana hacen falta para el contador de vueltas y la mejor vuelta.
    started = laps["startMs"] <= b
    st = dec.tables["stream"]
    ts = dec.tables["trackStatus"]
    ss = dec.tables["sessionStatus"]
    keep = _stream_rows(st, a, b)
    return {
        "laps": {k: v[started] for k, v in laps.items()},
        "stream": {k: v[keep] for k, v in st.items()},
        "trackStatus": {k: v[ts["t"] <= b] for k, v in ts.items()},
        "sessionStatus": {k: v[ss["t"] <= b] for k, v in ss.items()},
    }


def _trim_events(events: dict[str, Any], a: int, b: int) -> dict[str, Any]:
    def overlaps(w: dict[str, Any]) -> bool:
        return w["fromMs"] <= b and (w["toMs"] is None or w["toMs"] >= a)

    return {
        **events,
        # También los anteriores a la ventana: el feed muestra todos los mensajes con t ≤ reloj.
        "raceControl": [e for e in events["raceControl"] if e["t"] <= b],
        "sectorFlags": [w for w in events["sectorFlags"] if overlaps(w)],
        "windows": [w for w in events["windows"] if overlaps(w)],
    }


def make_e2e_fixture(
    src_data: Path, session: str, out_data: Path, minutes: float = 9.0, start_min: float | None = None
) -> dict[str, Any]:
    """Escribe el extracto en `out_data/v1/...` (borra lo anterior) y devuelve un resumen."""
    src_v1 = src_data / "v1"
    src_dir = src_v1 / "sessions" / session
    manifest = json.loads((src_dir / "manifest.json").read_text(encoding="utf-8"))
    if manifest["pipeline"]["source"] in ("tracinginsights-dev",):
        raise ValueError("el fixture e2e solo puede salir de una fuente publicable (no dev)")
    if manifest["session"]["type"] in VARIANTS:
        raise ValueError(f"las variantes de test ocupan {', '.join(VARIANTS)}: usa otra sesión de origen")
    files = manifest["files"]
    motion = _decode(src_dir, files["motion"])
    car = _decode(src_dir, files["car"])
    timing = _decode(src_dir, files["timing"])
    events = json.loads(gzip.decompress((src_dir / files["events"]["path"]).read_bytes()))
    pb = manifest["session"]["playback"]
    if start_min is None:
        a, b = best_window(motion, pb["startMs"], pb["endMs"], minutes)
    else:
        a = max(pb["startMs"], int(start_min * 60_000))
        b = min(pb["endMs"], a + int(minutes * 60_000))

    out_v1 = out_data / "v1"
    if out_v1.exists():
        shutil.rmtree(out_v1)
    folder = out_v1 / "sessions" / session
    new_files = {
        "motion": write_hashed(
            folder,
            "motion",
            ".trzb.gz",
            trzb.gzip_bytes(trzb.encode("motion", _trim_per_car(motion, "pos", a, b))),
            layout="motion@1",
        ),
        "car": write_hashed(
            folder,
            "car",
            ".trzb.gz",
            trzb.gzip_bytes(trzb.encode("car", _trim_per_car(car, "tel", a, b))),
            layout="car@1",
        ),
        "timing": write_hashed(
            folder,
            "timing",
            ".trzb.gz",
            trzb.gzip_bytes(trzb.encode("timing", _trim_timing(timing, a, b))),
            layout="timing@1",
        ),
        "events": write_hashed(
            folder,
            "events",
            ".json.gz",
            trzb.gzip_bytes(
                json.dumps(_trim_events(events, a, b), ensure_ascii=False, separators=(",", ":")).encode(
                    "utf-8"
                )
            ),
            layout="events@1",
        ),
    }
    circuit_id = manifest["session"]["circuit"]
    # Se copia exactamente el fichero que referencia el manifest (no el puntero vigente del circuito).
    src_circuit_file = (src_dir / files["circuit"]["path"]).resolve()
    dst_circuit = out_v1 / "circuits" / circuit_id
    dst_circuit.mkdir(parents=True)
    shutil.copy2(src_circuit_file, dst_circuit / src_circuit_file.name)
    pointer = {"file": {**files["circuit"], "path": src_circuit_file.name}}
    (dst_circuit / "circuit.json").write_text(json.dumps(pointer, indent=2) + "\n", encoding="utf-8")
    new_files["circuit"] = files["circuit"]

    fixture = {
        **manifest,
        "generatedAt": "2026-01-01T00:00:00Z",
        "session": {**manifest["session"], "playback": {**pb, "startMs": a, "endMs": b}},
        "quality": {**manifest["quality"], "notes": [*manifest["quality"].get("notes", []), EXTRACT_NOTE]},
        "files": new_files,
    }
    schema.validate("manifest", fixture)
    (folder / "manifest.json").write_text(
        json.dumps(fixture, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    # Variantes de estado (mismo evento), inventadas para los tests: lo dicen su nota y el catálogo (dev).
    event_dir = folder.parent
    # Las variantes están a la misma profundidad que la sesión: el circuito conserva su ruta relativa.
    shared = {
        k: v if k == "circuit" else {**v, "path": f"../{folder.name}/{v['path']}"}
        for k, v in new_files.items()
    }

    def variant(stype: str, **over: Any) -> dict[str, Any]:
        doc = {**fixture, "files": shared, **over}
        session_over = over.get("session", {})
        return {
            **doc,
            "session": {**fixture["session"], **session_over, "type": stype, "name": VARIANTS[stype]},
            "quality": {**fixture["quality"], "notes": [*fixture["quality"]["notes"], VARIANT_NOTE]},
        }

    unsupported = variant("fp3", schemaVersion="99.0.0", minReader="99.0.0")
    _write_json(event_dir / "fp3" / "manifest.json", unsupported)

    no_position = variant("fp2", session={"status": "no-position"})
    schema.validate("manifest", no_position)
    _write_json(event_dir / "fp2" / "manifest.json", no_position)

    good = (folder / new_files["motion"]["path"]).read_bytes()
    bad = bytearray(good)
    for i in range(len(bad) // 3, len(bad) // 3 + 64):
        bad[i] ^= 0xA5
    (event_dir / "q").mkdir()
    (event_dir / "q" / "motion.corrupt.trzb.gz").write_bytes(bytes(bad))
    corrupt = variant(
        "q", files={**shared, "motion": {**new_files["motion"], "path": "motion.corrupt.trzb.gz"}}
    )
    schema.validate("manifest", corrupt)
    _write_json(event_dir / "q" / "manifest.json", corrupt)

    s = fixture["session"]
    base = f"sessions/{session}"
    rel = base.rsplit("/", 1)[0]
    status = {"fp2": "no-position", "fp3": "ok", "q": "ok", "race": "ok"}  # race: manifest inexistente (404)
    src_event = _source_event(src_v1, s)
    # Si la sesión de origen es dev (p. ej. por su circuito), el extracto también.
    src_dev = any(e.get("dev") for e in src_event.get("sessions", []) if e.get("session") == s["type"])
    sessions = [
        {
            "session": s["type"],
            "name": s["name"],
            "status": "ok",
            "path": f"{base}/manifest.json",
            "bytes": sum(f["bytes"] for f in new_files.values()),
            **({"dev": True} if src_dev else {}),
        },
        *(
            {
                "session": stype,
                "name": name,
                "status": status[stype],
                "path": f"{rel}/{stype}/manifest.json",
                "dev": True,
            }
            for stype, name in VARIANTS.items()
        ),
    ]
    catalog = {
        "schema": "trazada.catalog",
        "schemaVersion": schema.schema_version(),
        "generatedAt": datetime(2026, 1, 1, tzinfo=UTC).isoformat().replace("+00:00", "Z"),
        "seasons": [
            {
                "season": s["season"],
                "events": [
                    {
                        "round": s["round"],
                        "slug": s["slug"],
                        "event": s["event"],
                        "country": str(src_event.get("country", "")),
                        "sessions": sorted(sessions, key=lambda e: SESSION_ORDER.index(e["session"])),
                    }
                ],
            }
        ],
    }
    schema.validate("catalog", catalog)
    (out_v1 / "catalog.json").write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    total = sum(p.stat().st_size for p in out_v1.rglob("*") if p.is_file())
    if total > FIXTURE_MAX_BYTES:
        raise ValueError(f"el fixture ocupa {total} bytes (> {FIXTURE_MAX_BYTES}): acorta la ventana")
    return {"window": [a, b], "bytes": total, "files": {k: v["bytes"] for k, v in new_files.items()}}


def _source_event(src_v1: Path, s: dict[str, Any]) -> dict[str, Any]:
    """Entrada del evento de origen en su catálogo (vacía si no está)."""
    cat = src_v1 / "catalog.json"
    if cat.exists():
        for season in json.loads(cat.read_text(encoding="utf-8"))["seasons"]:
            for ev in season["events"]:
                if season["season"] == s["season"] and ev["round"] == s["round"]:
                    return dict(ev)
    return {}
