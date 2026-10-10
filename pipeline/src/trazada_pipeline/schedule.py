"""Calendario de una temporada (FastF1) para el gestor de datos local: qué Grandes Premios y sesiones hay.

Solo se usan el número de ronda, los nombres cortos (`EventName`, nunca `OfficialEventName`), el país, la
localidad (para el slug, con la misma regla que `build`) y las horas de inicio de cada sesión.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import pandas as pd

from trazada_pipeline.sources.fastf1_source import SESSION_TYPE_BY_NAME, event_slug

log = logging.getLogger(__name__)

#: Fuentes del calendario, por orden. Sin Ergast/Jolpica: el propio de FastF1 y, si falla, el de F1.
SCHEDULE_BACKENDS = ("fastf1", "f1timing")

#: Columnas de sesión del calendario de FastF1 (Session1…Session5).
_SESSION_SLOTS = range(1, 6)


def _utc_iso(value: Any) -> str | None:
    if value is None or pd.isna(value):
        return None
    ts = pd.Timestamp(value)
    ts = ts.tz_localize("UTC") if ts.tzinfo is None else ts.tz_convert("UTC")
    return ts.strftime("%Y-%m-%dT%H:%M:%SZ")


def _local_date(value: Any) -> str | None:
    if value is None or pd.isna(value):
        return None
    return pd.Timestamp(value).date().isoformat()


def schedule_events(frame: pd.DataFrame) -> list[dict[str, Any]]:
    """Normaliza un `EventSchedule` de FastF1: un evento por ronda (sin tests), sesiones en orden."""
    events: list[dict[str, Any]] = []
    for _, ev in frame.iterrows():
        rnd = int(ev["RoundNumber"])
        if rnd <= 0:  # tests de pretemporada: no son sesiones de un Gran Premio
            continue
        sessions: list[dict[str, Any]] = []
        first_day: str | None = None
        for i in _SESSION_SLOTS:
            name = ev.get(f"Session{i}")
            stype = SESSION_TYPE_BY_NAME.get(str(name)) if isinstance(name, str) else None
            if stype is None or any(s["session"] == stype for s in sessions):
                continue
            first_day = first_day or _local_date(ev.get(f"Session{i}Date"))
            sessions.append({"session": stype, "startUtc": _utc_iso(ev.get(f"Session{i}DateUtc"))})
        event: dict[str, Any] = {
            "round": rnd,
            "slug": event_slug(rnd, str(ev["EventName"]), str(ev["Location"])),
            "event": str(ev["EventName"]),
            "country": str(ev["Country"]),
            "sessions": sessions,
        }
        date_start = first_day or _local_date(ev.get("EventDate"))
        if date_start:
            event["dateStart"] = date_start
        events.append(event)
    events.sort(key=lambda e: e["round"])
    return events


def load_schedule(season: int, cache_dir: Path) -> list[dict[str, Any]]:
    """Descarga (o lee de la caché de FastF1) el calendario de una temporada."""
    import fastf1

    cache_dir.mkdir(parents=True, exist_ok=True)
    fastf1.Cache.enable_cache(str(cache_dir))
    last: Exception | None = None
    for backend in SCHEDULE_BACKENDS:
        try:
            frame = fastf1.get_event_schedule(season, include_testing=False, backend=backend)
        except Exception as exc:  # cada backend falla a su manera (red, formato, temporada sin datos)
            log.warning("Calendario %s con %s: %s", season, backend, exc)
            last = exc
            continue
        if len(frame):
            return schedule_events(frame)
    raise RuntimeError(f"No se pudo leer el calendario de {season}: {last}")
