"""Eventos de sesión (`events.json`): race control resuelto, banderas por sector y ventanas."""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from trazada_pipeline import schema
from trazada_pipeline.racecontrol.parser import parse

TRACK_STATUS_WINDOWS = {4: "sc", 5: "red", 6: "vsc", 7: "vsc-ending", 2: "yellow"}


def _opt_int(v: Any) -> int | None:
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return None
    return int(v)


def race_control_events(rc: pd.DataFrame, corner_s: dict[int, float] | None = None) -> list[dict[str, Any]]:
    out = []
    for row in rc.itertuples(index=False):
        parsed = parse(row.text).to_dict()
        turn = parsed.get("turn")
        parsed["s"] = (
            None if turn is None or not corner_s or turn not in corner_s else round(corner_s[turn], 1)
        )
        parsed["marshalSector"] = _opt_int(row.sector) if row.scope == "Sector" else None
        out.append(
            {
                "t": int(row.t_ms),
                "lap": _opt_int(row.lap),
                "category": str(row.category),
                "flag": row.flag,
                "scope": row.scope,
                "sector": _opt_int(row.sector),
                "car": row.car,
                "text": str(row.text),
                "parsed": parsed,
            }
        )
    return out


def sector_flags(events: list[dict[str, Any]], end_ms: int | None) -> list[dict[str, Any]]:
    """Intervalos de bandera amarilla/doble amarilla por sector de pista."""
    open_: dict[int, tuple[str, int]] = {}
    out: list[dict[str, Any]] = []

    def close(sector: int, t: int) -> None:
        if sector in open_:
            flag, start = open_.pop(sector)
            out.append({"sector": sector, "flag": flag, "fromMs": start, "toMs": t})

    for ev in sorted(events, key=lambda e: e["t"]):
        kind = ev["parsed"]["kind"]
        sector = ev["sector"]
        t = ev["t"]
        if kind in ("sector_yellow", "sector_double_yellow") and sector is not None:
            flag = "DOUBLE YELLOW" if kind == "sector_double_yellow" else "YELLOW"
            if sector in open_ and open_[sector][0] == flag:
                continue
            close(sector, t)
            open_[sector] = (flag, t)
        elif kind == "sector_clear" and sector is not None:
            close(sector, t)
        elif kind in ("track_clear", "green_light", "red_flag", "chequered_flag"):
            for s in list(open_):
                close(s, t)
    for s in list(open_):
        if end_ms is not None:
            close(s, end_ms)
        else:
            flag, start = open_.pop(s)
            out.append({"sector": s, "flag": flag, "fromMs": start, "toMs": None})
    return sorted(out, key=lambda w: (w["fromMs"], w["sector"]))


def status_windows(track_status: pd.DataFrame, end_ms: int | None) -> list[dict[str, Any]]:
    out = []
    ts = track_status.sort_values("t_ms")
    times = ts["t_ms"].to_numpy()
    codes = ts["code"].astype(int).to_numpy()
    for i, (t, code) in enumerate(zip(times, codes, strict=True)):
        kind = TRACK_STATUS_WINDOWS.get(int(code))
        if kind is None:
            continue
        to = int(times[i + 1]) if i + 1 < len(times) else end_ms
        out.append({"kind": kind, "fromMs": int(t), "toMs": to})
    return out


NEUTRALIZATIONS = ("sc", "vsc", "red")


def toggle_windows(
    events: list[dict[str, Any]],
    on: str,
    off: str,
    kind: str,
    end_ms: int | None,
    neutralizations: list[dict[str, Any]] | None = None,
) -> list[dict]:
    """Ventanas globales activadas/desactivadas por mensajes (sin zona).

    Una neutralización (SC, VSC o roja) también cierra la ventana: el reglamento lo desactiva y race
    control no siempre lo anuncia (Japón 2026: OVERTAKE ENABLED, safety car, OVERTAKE ENABLED). Solo
    se reabre con un mensaje explícito de activación.
    """
    stream: list[tuple[int, int, str]] = []  # (t, orden, acción): a igual t, cerrar antes que abrir
    for ev in events:
        p = ev["parsed"]
        if p.get("detail"):  # DRS por zona: no cambia el estado global
            continue
        if p["kind"] == on:
            stream.append((ev["t"], 1, "on"))
        elif p["kind"] == off:
            stream.append((ev["t"], 0, "off"))
    for w in neutralizations or []:
        if w["kind"] in NEUTRALIZATIONS:
            stream.append((w["fromMs"], 0, "off"))
    out = []
    start: int | None = None
    for t, _, action in sorted(stream):
        if action == "on" and start is None:
            start = t
        elif action == "off" and start is not None:
            if t > start:
                out.append({"kind": kind, "fromMs": start, "toMs": t})
            start = None
    if start is not None:
        out.append({"kind": kind, "fromMs": start, "toMs": end_ms})
    return out


def clip_intervals(items: list[dict[str, Any]], end_ms: int | None) -> list[dict[str, Any]]:
    """Recorta intervalos al final de la reproducción: fuera los que empiezan después, y el fin, saturado."""
    if end_ms is None:
        return items
    out = []
    for w in items:
        if w["fromMs"] >= end_ms:
            continue
        to = w["toMs"]
        out.append({**w, "toMs": end_ms if to is None or to > end_ms else to})
    return out


def build_events(
    rc: pd.DataFrame,
    track_status: pd.DataFrame,
    end_ms: int | None,
    corner_s: dict[int, float] | None = None,
) -> dict[str, Any]:
    events = race_control_events(rc, corner_s)
    windows = status_windows(track_status, end_ms)
    neutral = list(windows)
    windows += toggle_windows(events, "drs_enabled", "drs_disabled", "drs", end_ms, neutral)
    windows += toggle_windows(events, "overtake_enabled", "overtake_disabled", "overtake", end_ms, neutral)
    windows = clip_intervals(windows, end_ms)
    windows.sort(key=lambda w: (w["fromMs"], w["kind"]))
    return {
        "schema": "trazada.events",
        "schemaVersion": schema.schema_version(),
        "raceControl": events,
        "sectorFlags": clip_intervals(sector_flags(events, end_ms), end_ms),
        "windows": windows,
    }


def track_status_from_race_control(rc: pd.DataFrame) -> pd.DataFrame:
    """Estado de pista aproximado desde race control (solo fuentes de desarrollo sin TrackStatus)."""
    rows = [(0, 1)]
    state = 1
    for row in rc.sort_values("t_ms").itertuples(index=False):
        kind = parse(row.text).kind
        new = {
            "sc_deployed": 4,
            "vsc_deployed": 6,
            "vsc_ending": 7,
            "red_flag": 5,
            "track_clear": 1,
            "green_light": 1 if state == 5 else state,
        }.get(kind)
        if new is not None and new != state:
            rows.append((int(row.t_ms), new))
            state = new
    return pd.DataFrame(rows, columns=["t_ms", "code"])
