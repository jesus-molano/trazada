"""Tablas de cronometraje (layout `timing`): vueltas, torre de tiempos, estado de pista y de sesión."""

from __future__ import annotations

import math
import re
from typing import Any

import numpy as np
import pandas as pd

from trazada_pipeline import schema
from trazada_pipeline.sources.base import SessionData

_GAP_LAPS = re.compile(r"^\+?\s*(\d+)\s*L(?:AP|APS)?$", re.IGNORECASE)
_GAP_LEADER = re.compile(r"^LAP\s*\d+$", re.IGNORECASE)
_GAP_TIME = re.compile(r"^\+?\s*(?:(\d+):)?(\d+(?:\.\d+)?)$")

#: Bits de `trackStatusMask` por código de TrackStatus.
TRACK_STATUS_BITS = {"2": 1, "4": 2, "5": 4, "6": 8, "7": 16}


def parse_gap(value: Any) -> tuple[int, int]:
    """Texto de gap del feed → (ms, vueltas por detrás). (-1, 0) para líder o sin dato.

    Ejemplos: "+1.234" → (1234, 0); "+1:02.500" → (62500, 0); "+2 LAPS" → (-1, 2); "LAP 12" → (-1, 0).
    """
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return -1, 0
    if isinstance(value, pd.Timedelta):
        return round(value.total_seconds() * 1000), 0
    if isinstance(value, int | float):
        return round(float(value) * 1000), 0
    text = str(value).strip()
    if not text or _GAP_LEADER.match(text):
        return -1, 0
    m = _GAP_LAPS.match(text)
    if m:
        return -1, int(m.group(1))
    m = _GAP_TIME.match(text)
    if m:
        minutes = int(m.group(1) or 0)
        return round((minutes * 60 + float(m.group(2))) * 1000), 0
    return -1, 0


def track_status_mask(codes: str) -> int:
    mask = 0
    for code in str(codes):
        mask |= TRACK_STATUS_BITS.get(code, 0)
    return mask


def _u8(values: Any, missing: int = 255) -> np.ndarray:
    arr = pd.to_numeric(pd.Series(values), errors="coerce").to_numpy(dtype=np.float64)
    return np.where(np.isfinite(arr) & (arr >= 0) & (arr < 255), np.rint(arr), missing).astype(np.int64)


def timing_tables(data: SessionData) -> dict[str, dict[str, Any]]:
    laps = data.laps
    stream = data.stream
    compounds = [schema.enum_code("compound", c) for c in laps["compound"]]
    statuses = schema.enums()["sessionStatus"]
    ss = data.session_status
    stream_tables: dict[str, Any] = {
        "t": [],
        "car": [],
        "position": [],
        "gapToLeaderMs": [],
        "intervalMs": [],
        "lapsBehind": [],
    }
    if stream is not None and len(stream):
        st = stream.sort_values(["t_ms", "car"], kind="stable")
        stream_tables = {
            "t": st["t_ms"].to_numpy(dtype=np.int64),
            "car": st["car"].astype(int).to_numpy(),
            "position": _u8(st["position"], 0),
            "gapToLeaderMs": st["gap_ms"].to_numpy(dtype=np.int64),
            "intervalMs": st["interval_ms"].to_numpy(dtype=np.int64),
            "lapsBehind": _u8(st["laps_behind"], 0),
        }
    return {
        "laps": {
            "car": laps["car"].astype(int).to_numpy(),
            "lap": laps["lap"].astype(int).to_numpy(),
            "startMs": laps["start_ms"].to_numpy(dtype=np.int64),
            "endMs": laps["end_ms"].to_numpy(dtype=np.int64),
            "lapMs": laps["lap_ms"].to_numpy(dtype=np.int64),
            "s1Ms": laps["s1_ms"].to_numpy(dtype=np.int64),
            "s2Ms": laps["s2_ms"].to_numpy(dtype=np.int64),
            "s3Ms": laps["s3_ms"].to_numpy(dtype=np.int64),
            "compound": np.asarray(compounds, dtype=np.int64),
            "tyreLife": _u8(laps["tyre_life"]),
            "fresh": _u8(laps["fresh"]),
            "stint": _u8(laps["stint"], 0),
            "pitInMs": laps["pit_in_ms"].to_numpy(dtype=np.int64),
            "pitOutMs": laps["pit_out_ms"].to_numpy(dtype=np.int64),
            "position": _u8(laps["position"], 0),
            "trackStatusMask": np.asarray([track_status_mask(c) for c in laps["track_status"]]),
            "deleted": laps["deleted"].astype(bool).to_numpy().astype(np.int64),
        },
        "stream": stream_tables,
        "trackStatus": {
            "t": data.track_status["t_ms"].to_numpy(dtype=np.int64),
            "code": data.track_status["code"].astype(int).to_numpy(),
        },
        "sessionStatus": {
            "t": ss["t_ms"].to_numpy(dtype=np.int64),
            "status": np.asarray([statuses.index(s) if s in statuses else 0 for s in ss["status"]]),
        },
    }
