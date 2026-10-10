"""Orquestación: SessionData → circuito canónico → proyección → ficheros + manifest + catálogo."""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from trazada_pipeline import __version__, schema
from trazada_pipeline.circuit import registry
from trazada_pipeline.circuit.build import MIN_FINISH_LAPS, Circuit, build_circuit
from trazada_pipeline.circuit.store import load_circuit, save_circuit
from trazada_pipeline.encode import trzb
from trazada_pipeline.files import write_hashed
from trazada_pipeline.projection import PATH_NODATA, CarMotion, motion_tables, pit_windows, project_session
from trazada_pipeline.racecontrol.parser import parse
from trazada_pipeline.racecontrol.state import build_events
from trazada_pipeline.sources.base import QualityNote, SessionData
from trazada_pipeline.timing import timing_tables

log = logging.getLogger(__name__)

PRE_RACE_MS = 10 * 60 * 1000
POST_RACE_MS = 5 * 60 * 1000
PRE_SESSION_MS = 2 * 60 * 1000
COVERAGE_GAP_MS = 2000

SOURCE_ATTRIBUTION = {
    "fastf1": "F1 live timing (vía FastF1)",
    "fastf1-offline-cache": "F1 live timing (vía FastF1)",
    "openf1": "OpenF1",
    "tracinginsights-dev": "TracingInsights, derivado de FastF1 (solo desarrollo)",
    "synthetic": "Datos sintéticos",
}


@dataclass
class BuildReport:
    manifest_path: Path
    status: str
    sizes: dict[str, int]
    quality: dict[str, Any]
    warnings: list[str] = field(default_factory=list)


def playback_window(data: SessionData) -> tuple[int, int, int | None]:
    laps = data.laps
    ends = laps["end_ms"][laps["end_ms"] > 0]
    data_end = int(max((int(df["t_ms"].max()) for df in data.pos.values() if len(df)), default=0))
    if data.is_race_like:
        lap1 = laps[(laps["lap"] == 1) & (laps["start_ms"] > 0)]["start_ms"]
        lights_out = int(lap1.min()) if len(lap1) else (data.session_start_ms or 0)
        chequered = [
            int(t)
            for t, x in zip(data.race_control["t_ms"], data.race_control["text"], strict=True)
            if parse(x).kind == "chequered_flag"
        ]
        finish = chequered[-1] if chequered else (int(ends.max()) if len(ends) else data_end)
        return max(0, lights_out - PRE_RACE_MS), min(data_end, finish + POST_RACE_MS), lights_out
    start = data.session_start_ms if data.session_start_ms and data.session_start_ms > 0 else 0
    end = int(ends.max()) if len(ends) else data_end
    return max(0, start - PRE_SESSION_MS), min(data_end, end + PRE_SESSION_MS), None


def _trim(df: pd.DataFrame, a: int, b: int) -> pd.DataFrame:
    return df[(df["t_ms"] >= a) & (df["t_ms"] <= b)].reset_index(drop=True)


def on_track_intervals(data: SessionData, car: str, a: int, b: int) -> list[tuple[int, int]]:
    laps = data.laps[data.laps["car"] == car]
    valid = laps[(laps["start_ms"] >= 0) & (laps["end_ms"] > laps["start_ms"])]
    if valid.empty:
        return []
    lo, hi = max(a, int(valid["start_ms"].min())), min(b, int(valid["end_ms"].max()))
    if hi <= lo:
        return []
    out = [(lo, hi)]
    for pa, pb in pit_windows(laps, hi):
        nxt = []
        for x, y in out:
            if pb <= x or pa >= y:
                nxt.append((x, y))
                continue
            if pa > x:
                nxt.append((x, pa))
            if pb < y:
                nxt.append((pb, y))
        out = nxt
    return [(x, y) for x, y in out if y - x > 1000]


def coverage_ratio(times: np.ndarray, intervals: list[tuple[int, int]]) -> float:
    total = sum(b - a for a, b in intervals)
    if total <= 0:
        return 1.0
    missing = 0
    for a, b in intervals:
        t = np.unique(times[(times >= a) & (times <= b)])
        gaps = np.diff(np.r_[a, t, b])
        missing += int(gaps[gaps > COVERAGE_GAP_MS].sum())  # un hueco > 2 s cuenta entero
    return max(0.0, 1.0 - missing / total)


def elevation_ok(circuit: Circuit, data: SessionData) -> tuple[bool, dict[str, float]]:
    glitches = []
    for df in data.pos.values():
        valid = df[~((df["x"] == 0) & (df["y"] == 0))]
        if len(valid):
            glitches.append(float((valid["z"] == 0).mean()))
    glitch = float(np.mean(glitches)) if glitches else 1.0
    drop = float(circuit.centerline[:, 2].max() - circuit.centerline[:, 2].min())
    residual = float(circuit.quality.get("residualP95M", 99.0))
    ok = glitch < 0.02 and drop < 150.0 and residual < 1.0
    return ok, {"zGlitchFraction": round(glitch, 5), "elevationRangeM": round(drop, 2)}


def car_tables(car: dict[str, pd.DataFrame]) -> dict[str, dict[str, Any]]:
    cars = sorted(car, key=int)
    starts, counts, parts = [], [], []
    offset = 0
    for c in cars:
        df = car[c].drop_duplicates("t_ms").sort_values("t_ms")
        starts.append(offset)
        counts.append(len(df))
        offset += len(df)
        parts.append(df)
    cat = (
        pd.concat(parts)
        if parts
        else pd.DataFrame(columns=["t_ms", "speed", "rpm", "gear", "throttle", "brake", "drs"])
    )
    drs = cat["drs"].to_numpy(dtype=np.int64)
    return {
        "cars": {
            "car": np.array([int(c) for c in cars]),
            "start": np.array(starts),
            "count": np.array(counts),
        },
        "tel": {
            "t": cat["t_ms"].to_numpy(dtype=np.int64),
            # i16 con delta: |v[i] - v[i-1]| ≤ 32767 si 0 ≤ v ≤ 32767
            "speed": np.clip(cat["speed"].to_numpy(dtype=np.int64), 0, 32767),
            "rpm": np.clip(cat["rpm"].to_numpy(dtype=np.int64), 0, 32767),
            "gear": np.clip(cat["gear"].to_numpy(dtype=np.int64), 0, 255),
            "throttle": np.clip(cat["throttle"].to_numpy(dtype=np.int64), 0, 255),
            "brake": np.clip(cat["brake"].to_numpy(dtype=np.int64), 0, 1),
            "drs": np.where(drs < 0, 255, np.clip(drs, 0, 254)),
        },
    }


def _session_dir(v1: Path, data: SessionData) -> Path:
    return v1 / "sessions" / str(data.season) / f"{data.round:02d}-{data.slug}" / data.session_type


def _rel(from_dir: Path, target: Path) -> str:
    return os.path.relpath(target, from_dir).replace("\\", "/")


def circuit_notes(circuit: Circuit, official_length_m: float | None) -> list[QualityNote]:
    """Avisos de calidad del circuito canónico (van en cada sesión que lo use)."""
    notes: list[QualityNote] = []
    q = circuit.quality
    if "finishLineLaps" in q:
        laps = int(q["finishLineLaps"])
        notes.append(
            QualityNote(
                "finish-line-fallback",
                f"Línea de meta aproximada: solo {laps} vueltas servían para situarla (hacen falta "
                f"{MIN_FINISH_LAPS}); está en la primera muestra de la vuelta de referencia.",
                {"laps": laps},
            )
        )
    if q.get("closureM", 0) > 2.0:
        notes.append(
            QualityNote(
                "centerline-not-closed",
                f"cierre de la línea central {q['closureM']:.2f} m > 2 m",
                {"closureM": round(float(q["closureM"]), 2)},
            )
        )
    if official_length_m:
        dev = abs(circuit.length - official_length_m) / official_length_m
        if dev > 0.03:
            notes.append(
                QualityNote(
                    "length-vs-official",
                    f"longitud {circuit.length:.0f} m vs oficial {official_length_m} m (> 3 %)",
                    {"lengthM": round(circuit.length), "officialM": official_length_m},
                )
            )
    if circuit.corners.empty:
        notes.append(
            QualityNote(
                "no-corners",
                "circuito sin curvas ni rotación oficial (MultiViewer no estaba accesible al construirlo)",
            )
        )
    return notes


def build_session(data: SessionData, data_root: Path, *, rebuild_circuit: bool = False) -> BuildReport:
    v1 = data_root / f"v{schema.schema_major()}"
    notes: list[QualityNote] = list(data.notes)
    layout = registry.resolve(data.circuit_key, data.season, data.slug, dev=data.dev)

    circuit = None if rebuild_circuit else load_circuit(layout.circuit_id, v1)
    if circuit is None:
        save_circuit(build_circuit(data, layout.circuit_id, layout.name), v1)
        # Se proyecta siempre sobre la geometría tal y como queda guardada (cuantizada): así el
        # resultado es idéntico tanto si el circuito se acaba de construir como si ya existía.
        circuit = load_circuit(layout.circuit_id, v1)
        assert circuit is not None
    pointer = v1 / "circuits" / layout.circuit_id / "circuit.json"
    circuit_ref = json.loads(pointer.read_text(encoding="utf-8"))["file"]
    if circuit.dev and not data.dev:
        # Un circuito con fuentes de desarrollo contamina la sesión: queda como dev y no se publica.
        data = replace(data, dev=True)
        notes.append(
            QualityNote(
                "dev-circuit",
                f"El circuito {layout.circuit_id} usa fuentes de desarrollo: la sesión queda marcada como "
                "dev (no publicable). Reconstrúyelo sin ellas con --rebuild-circuit.",
                {"circuit": layout.circuit_id},
            )
        )

    start_ms, end_ms, lights_out = playback_window(data)
    pos = {c: _trim(df, start_ms, end_ms) for c, df in data.pos.items()}
    car = {c: _trim(df, start_ms, end_ms) for c, df in data.car.items()}
    trimmed = SessionData(**{**data.__dict__, "pos": pos, "car": car})

    motion: dict[str, CarMotion] = project_session(trimmed, circuit)

    # Calidad y validación
    coverage: dict[str, dict[str, float]] = {}
    with_data = 0
    for d in data.drivers:
        m = motion.get(d.number)
        intervals = on_track_intervals(trimmed, d.number, start_ms, end_ms)
        if m is None or len(m.t_ms) == 0:
            coverage[d.number] = {"pos": 0.0, "car": 0.0}
            continue
        valid_t = m.t_ms[m.path != PATH_NODATA]
        car_t = car[d.number]["t_ms"].to_numpy() if d.number in car else np.zeros(0)
        coverage[d.number] = {
            "pos": round(coverage_ratio(valid_t, intervals), 4),
            "car": round(coverage_ratio(car_t, intervals), 4),
        }
        if len(valid_t) and len(car_t):
            with_data += 1
    status = "ok" if with_data >= 0.9 * max(1, len(data.drivers)) else "no-position"
    low = [v["pos"] for v in coverage.values() if 0 < v["pos"] < 0.99]
    if status == "ok" and low:
        notes.append(
            QualityNote(
                "position-coverage-low",
                "cobertura de posición < 99 % en algún piloto",
                {"cars": len(low), "minPos": min(low)},
            )
        )

    for c, m in motion.items():
        v = m.path != PATH_NODATA
        if np.any(np.diff(m.s_m[v]) < -1e-6):
            raise RuntimeError(f"coche {c}: s no monótona")

    notes += circuit_notes(circuit, layout.official_length_m)
    elev_ok, elev_q = elevation_ok(circuit, data)

    corner_s = {
        int(n): float(s) for n, s in zip(circuit.corners["number"], circuit.corners["s"], strict=True)
    }
    events = build_events(data.race_control, data.track_status, end_ms, corner_s)
    schema.validate("events", events)

    folder = _session_dir(v1, data)
    files = {
        "motion": write_hashed(
            folder,
            "motion",
            ".trzb.gz",
            trzb.gzip_bytes(trzb.encode("motion", motion_tables(motion))),
            layout="motion@1",
        ),
        "car": write_hashed(
            folder, "car", ".trzb.gz", trzb.gzip_bytes(trzb.encode("car", car_tables(car))), layout="car@1"
        ),
        "timing": write_hashed(
            folder,
            "timing",
            ".trzb.gz",
            trzb.gzip_bytes(trzb.encode("timing", timing_tables(trimmed))),
            layout="timing@1",
        ),
        "events": write_hashed(
            folder,
            "events",
            ".json.gz",
            trzb.gzip_bytes(json.dumps(events, ensure_ascii=False, separators=(",", ":")).encode("utf-8")),
            layout="events@1",
        ),
    }
    circuit_file = dict(circuit_ref)
    circuit_file["path"] = _rel(folder, v1 / "circuits" / layout.circuit_id / circuit_ref["path"])
    files["circuit"] = circuit_file

    estimated = sorted(set(data.estimated))
    manifest = {
        "schema": "trazada.session",
        "schemaVersion": schema.schema_version(),
        "minReader": schema.versions()["minReader"],
        "generatedAt": datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "pipeline": {
            "version": __version__,
            "source": data.source,
            **{k: v for k, v in data.source_versions.items() if k in ("fastf1", "apiCoreVersion")},
        },
        "session": {
            "season": data.season,
            "round": data.round,
            "slug": data.slug,
            "event": data.event,
            "type": data.session_type,
            "name": data.session_name,
            "circuit": layout.circuit_id,
            "t0Utc": data.t0_utc.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "gmtOffset": data.gmt_offset,
            "playback": {"startMs": int(start_ms), "endMs": int(end_ms), "lightsOutMs": lights_out},
            "totalLaps": data.total_laps,
            "status": status,
        },
        "drivers": [
            {
                "number": d.number,
                "tla": d.tla,
                "first": d.first,
                "last": d.last,
                "team": d.team,
                "color": d.color,
            }
            for d in data.drivers
        ],
        "channels": {
            "drs": "present" if data.drs_channel else "absent",
            "overtakeWindows": "raceControl"
            if any(w["kind"] == "overtake" for w in events["windows"])
            else "none",
            "elevation": "real" if elev_ok else "flat",
            "timingStream": "present" if data.stream is not None and len(data.stream) else "absent",
            "marshalSectors": "present" if circuit.marshal_sectors is not None else "absent",
        },
        "quality": {
            "coverage": coverage,
            "centerlineClosureM": round(float(circuit.quality.get("closureM", 0.0)), 3),
            "elevationRangeM": elev_q["elevationRangeM"],
            "estimated": estimated,
            "notes": [n.to_json() for n in notes],
        },
        "files": files,
        "attribution": [SOURCE_ATTRIBUTION[data.source], *circuit.sources[1:]],
    }
    schema.validate("manifest", manifest)
    folder.mkdir(parents=True, exist_ok=True)
    manifest_path = folder / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    update_catalog(v1, data, manifest_path, status, sum(f["bytes"] for f in files.values()))
    return BuildReport(
        manifest_path=manifest_path,
        status=status,
        sizes={k: v["bytes"] for k, v in files.items()},
        quality={**circuit.quality, **elev_q},
        warnings=[n.text for n in notes],
    )


SESSION_NAMES = {
    "fp1": "Practice 1",
    "fp2": "Practice 2",
    "fp3": "Practice 3",
    "sq": "Sprint Qualifying",
    "sprint": "Sprint",
    "q": "Qualifying",
    "race": "Race",
}
SESSION_ORDER = list(SESSION_NAMES)


def update_catalog(v1: Path, data: SessionData, manifest_path: Path, status: str, total_bytes: int) -> None:
    path = v1 / "catalog.json"
    catalog = (
        json.loads(path.read_text(encoding="utf-8"))
        if path.exists()
        else {"schema": "trazada.catalog", "schemaVersion": schema.schema_version(), "seasons": []}
    )
    season = next((s for s in catalog["seasons"] if s["season"] == data.season), None)
    if season is None:
        season = {"season": data.season, "events": []}
        catalog["seasons"].append(season)
    event = next((e for e in season["events"] if e["round"] == data.round and e["slug"] == data.slug), None)
    if event is None:
        event = {
            "round": data.round,
            "slug": data.slug,
            "event": data.event,
            "country": data.country,
            "sessions": [],
        }
        season["events"].append(event)
    if data.date_start:
        # El primer día con datos: no cambia según la sesión que se genere después.
        day = data.date_start.isoformat()
        event["dateStart"] = min(day, event.get("dateStart") or day)
    entry = {
        "session": data.session_type,
        "name": data.session_name,
        "status": status,
        "path": _rel(v1, manifest_path),
        "bytes": int(total_bytes),
    }
    if data.dev:
        entry["dev"] = True
    event["sessions"] = sorted(
        [s for s in event["sessions"] if s["session"] != data.session_type] + [entry],
        key=lambda s: SESSION_ORDER.index(s["session"]),
    )
    season["events"].sort(key=lambda e: e["round"])
    catalog["seasons"].sort(key=lambda s: -s["season"])
    catalog["schemaVersion"] = schema.schema_version()
    catalog["generatedAt"] = datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    schema.validate("catalog", catalog)
    # Escritura atómica: el gestor local lo relee mientras se generan otras sesiones.
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)
