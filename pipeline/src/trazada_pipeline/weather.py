"""Meteorología del live timing (stream WeatherData, D36): una muestra por minuto de la estación del circuito.

Honestidad. FastF1 (`fastf1.api.weather_data`) rellena con 0 cualquier clave que falte o no se pueda
convertir (y la lluvia, con False): ese 0 no se distingue de una medida real. Por eso:

- **Online** se lee el stream crudo (`parse_raw`, con `fastf1.api.fetch_page`): una clave ausente o
  ilegible queda en None («sin dato») y un 0 que manda el feed es un 0 de verdad.
- **Offline** (caché ya parseada por FastF1, `from_fastf1_parsed`): un 0 exacto se trata como sin dato,
  porque es el valor de relleno; una fila con todo a cero, entera (también la lluvia). Como mucho se pierde
  una medida real de 0 (calma, 0°); nunca se presenta un relleno como medida.

Cada mensaje del stream es una muestra completa (como lo lee FastF1): lo que no trae no se arrastra de la
anterior. La lluvia es solo sí/no (Rainfall '1'/'0'), nunca intensidad ni mm. No se interpola: el front
muestra el último valor y lo da por caducado a los 150 s.
"""

from __future__ import annotations

import math
import re
from collections.abc import Iterable, Mapping
from typing import Any

import numpy as np
import pandas as pd

from trazada_pipeline.sources.base import WEATHER_COLUMNS

#: Claves numéricas del stream WeatherData → columna de WEATHER_COLUMNS.
NUMERIC_KEYS: dict[str, str] = {
    "AirTemp": "air_c",
    "TrackTemp": "track_c",
    "Humidity": "humidity",
    "Pressure": "pressure_hpa",
    "WindSpeed": "wind_ms",
    "WindDirection": "wind_deg",
}
RAIN_KEY = "Rainfall"

#: Columna de WEATHER_COLUMNS → clave en `events.weather` (JSON).
EVENT_KEYS: dict[str, str] = {
    "t_ms": "t",
    "air_c": "airC",
    "track_c": "trackC",
    "humidity": "humidity",
    "pressure_hpa": "pressureHpa",
    "rain": "rain",
    "wind_ms": "windMs",
    "wind_deg": "windDeg",
}

_TIMESTAMP = re.compile(r"^(\d+):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$")


def timestamp_ms(text: Any) -> int | None:
    """Marca de tiempo del jsonStream ('HH:MM:SS.mmm', tiempo de sesión) → ms; None si no se puede leer."""
    if not isinstance(text, str):
        return None
    m = _TIMESTAMP.match(text.strip())
    if m is None:
        return None
    h, mi, s, frac = m.groups()
    ms = round(int((frac or "0").ljust(6, "0")) / 1000)
    return ((int(h) * 60 + int(mi)) * 60 + int(s)) * 1000 + ms


def _number(value: Any) -> float | None:
    """Número finito (del texto del feed o ya convertido); None si falta o no se puede leer."""
    if value is None or isinstance(value, bool | np.bool_):
        return None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def _rain(value: Any) -> bool | None:
    """Rainfall: '1' sí, '0' no (el feed manda texto). Cualquier otra cosa es sin dato."""
    if isinstance(value, bool | np.bool_):
        return bool(value)
    if isinstance(value, str):
        return {"1": True, "0": False}.get(value.strip())
    if isinstance(value, int | np.integer) and value in (0, 1):
        return bool(value)
    return None


def _clean(column: str, value: float | None) -> float | int | None:
    """Rango físico de cada magnitud: fuera de él, sin dato (nunca se recorta a un valor «parecido»)."""
    if value is None:
        return None
    if column == "humidity" and not 0 <= value <= 100:
        return None
    if column == "pressure_hpa" and value <= 0:
        return None
    if column == "wind_ms" and value < 0:
        return None
    if column == "wind_deg":
        if not 0 <= value <= 360:
            return None
        return round(value) % 360
    return round(value, 2)


def _frame(rows: list[dict[str, Any]]) -> pd.DataFrame:
    """Filas → DataFrame con WEATHER_COLUMNS (object: None es «sin dato»), por t y sin instantes repetidos."""
    frame = pd.DataFrame(rows, columns=list(WEATHER_COLUMNS), dtype=object)
    if frame.empty:
        return frame
    frame["t_ms"] = frame["t_ms"].astype(np.int64)
    frame = frame.sort_values("t_ms", kind="stable").drop_duplicates("t_ms", keep="last")
    return frame.reset_index(drop=True)


def parse_raw(entries: Iterable[Any]) -> pd.DataFrame:
    """Stream crudo (`fastf1.api.fetch_page(api_path, 'weather_data')`: [marca, dict] por mensaje) → filas.

    Una clave ausente o ilegible queda en None; un mensaje sin marca de tiempo legible se descarta.
    """
    rows: list[dict[str, Any]] = []
    for entry in entries:
        if not isinstance(entry, list | tuple) or len(entry) < 2:
            continue
        t = timestamp_ms(entry[0])
        payload = entry[1]
        if t is None or not isinstance(payload, Mapping):
            continue
        row: dict[str, Any] = {"t_ms": t, "rain": _rain(payload.get(RAIN_KEY))}
        for key, column in NUMERIC_KEYS.items():
            row[column] = _clean(column, _number(payload.get(key)))
        rows.append(row)
    return _frame(rows)


def _td_ms(value: Any) -> int | None:
    if value is None:
        return None
    try:
        td = pd.Timedelta(value)
    except (TypeError, ValueError):
        return None
    if pd.isna(td):
        return None
    return round(td.total_seconds() * 1000)


def _is_fill(value: Any) -> bool:
    """El 0 con el que FastF1 rellena una clave ausente o ilegible (o un hueco ya vacío)."""
    v = _number(value)
    return v is None or v == 0


def from_fastf1_parsed(data: Mapping[str, Any]) -> pd.DataFrame:
    """Caché ya parseada por FastF1 (`weather_data.ff1pkl`: columnas Time, AirTemp…) → filas.

    Cada 0 exacto es sin dato (es el relleno de FastF1); una fila sin nada distinto de 0 y sin lluvia queda
    entera sin dato, también la lluvia (su False sería otro relleno).
    """
    times = list(data.get("Time", []))
    n = len(times)

    def column(key: str) -> list[Any]:
        values = list(data.get(key, []))
        return values if len(values) == n else [None] * n

    numeric = {key: column(key) for key in NUMERIC_KEYS}
    rain = column(RAIN_KEY)
    rows: list[dict[str, Any]] = []
    for i in range(n):
        t = _td_ms(times[i])
        if t is None:
            continue
        raining = _rain(rain[i])
        empty = all(_is_fill(numeric[key][i]) for key in NUMERIC_KEYS) and not raining
        row: dict[str, Any] = {"t_ms": t, "rain": None if empty else raining}
        for key, col in NUMERIC_KEYS.items():
            v = numeric[key][i]
            row[col] = None if _is_fill(v) else _clean(col, _number(v))
        rows.append(row)
    return _frame(rows)


def window(frame: pd.DataFrame | None, start_ms: int, end_ms: int) -> pd.DataFrame | None:
    """Las muestras del intervalo de reproducción y, delante, la última anterior a su inicio (el valor
    vigente al empezar, si no ha caducado: eso lo decide el front)."""
    if frame is None or frame.empty:
        return None
    t = frame["t_ms"].to_numpy(dtype=np.int64)
    keep = (t >= start_ms) & (t <= end_ms)
    before = np.flatnonzero(t < start_ms)
    if len(before):
        keep[before[-1]] = True
    out = frame[keep].reset_index(drop=True)
    return out if len(out) else None


def _json(column: str, value: Any) -> Any:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    if column == "rain":
        return bool(value)
    if column in ("t_ms", "wind_deg"):
        return int(value)
    return float(value)


def to_events(frame: pd.DataFrame | None) -> dict[str, list[Any]] | None:
    """`events.weather`: columnas del mismo largo, null = sin dato. None si no hay ninguna muestra."""
    if frame is None or frame.empty:
        return None
    return {key: [_json(col, v) for v in frame[col].tolist()] for col, key in EVENT_KEYS.items()}
