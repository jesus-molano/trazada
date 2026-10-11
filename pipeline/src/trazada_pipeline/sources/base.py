"""Modelo normalizado de una sesión, común a todas las fuentes.

Convenciones:
- Tiempos en milisegundos de **tiempo de sesión** (0 = t0 del flujo de datos, como en FastF1), int64.
- Posiciones X/Y/Z en **decímetros** del sistema del feed (sin rotar ni centrar).
- Coches identificados por su número como cadena ("1", "44").
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

import pandas as pd

SESSION_TYPES = ("fp1", "fp2", "fp3", "sq", "sprint", "q", "race")
RACE_LIKE = ("race", "sprint")

POS_COLUMNS = ("t_ms", "x", "y", "z")
CAR_COLUMNS = ("t_ms", "speed", "rpm", "gear", "throttle", "brake", "drs")
LAP_COLUMNS = (
    "car",
    "lap",
    "start_ms",
    "end_ms",
    "lap_ms",
    "s1_ms",
    "s2_ms",
    "s3_ms",
    "compound",
    "tyre_life",
    "fresh",
    "stint",
    "pit_in_ms",
    "pit_out_ms",
    "position",
    "track_status",
    "deleted",
    "accurate",
)
STREAM_COLUMNS = ("t_ms", "car", "position", "gap_ms", "interval_ms", "laps_behind")
RC_COLUMNS = ("t_ms", "lap", "category", "flag", "scope", "sector", "car", "text", "status")
#: Meteorología (`weather.py`): una fila por muestra; None = sin dato (nunca el 0 de relleno de FastF1).
WEATHER_COLUMNS = ("t_ms", "air_c", "track_c", "humidity", "pressure_hpa", "rain", "wind_ms", "wind_deg")


@dataclass(frozen=True)
class Driver:
    number: str
    tla: str
    first: str
    last: str
    team: str
    color: str  # "#RRGGBB"


@dataclass
class CircuitInfo:
    """Marcadores de circuito (MultiViewer) en el sistema del feed (dm), sin rotar."""

    corners: pd.DataFrame  # number, letter, x, y, angle
    marshal_sectors: pd.DataFrame | None  # number, x, y
    rotation_deg: float
    source: str = "multiviewer"
    # Copia de desarrollo (TracingInsights): todo lo que se construya con ella queda como dev.
    dev: bool = False


@dataclass
class QualityNote:
    """Aviso de calidad de la sesión (`quality.notes` del manifest).

    `code` es estable y la UI lo traduce con `params`; `text` es el mismo aviso en español, para el log
    y para quien lea el JSON. Los códigos válidos son el `enum` de `qualityNote` en el esquema.
    """

    code: str
    text: str
    params: dict[str, float | int | str] = field(default_factory=dict)

    def to_json(self) -> dict[str, Any]:
        doc: dict[str, Any] = {"code": self.code, "text": self.text}
        if self.params:
            doc["params"] = dict(self.params)
        return doc


@dataclass
class SessionData:
    season: int
    round: int
    event: str  # EventName corto
    country: str
    slug: str
    session_type: str  # uno de SESSION_TYPES
    session_name: str
    date_start: date | None
    t0_utc: datetime  # UTC, tz-aware
    gmt_offset: str  # "+09:00"
    circuit_key: int
    drivers: list[Driver]
    pos: dict[str, pd.DataFrame]
    car: dict[str, pd.DataFrame]
    laps: pd.DataFrame
    stream: pd.DataFrame | None
    track_status: pd.DataFrame  # t_ms, code
    session_status: pd.DataFrame  # t_ms, status
    race_control: pd.DataFrame
    circuit_info: CircuitInfo | None
    session_start_ms: int | None
    total_laps: int | None
    drs_channel: bool
    source: str
    source_versions: dict[str, str | int] = field(default_factory=dict)
    dev: bool = False
    notes: list[QualityNote] = field(default_factory=list)
    # Datos que la fuente no da y se derivan (el front los pinta con la etiqueta "Estimado"):
    # `positions`, `telemetry`, `trackStatus`.
    estimated: list[str] = field(default_factory=list)
    # Meteorología del live timing (WEATHER_COLUMNS, `weather.py`), o None si la fuente no la trae.
    weather: pd.DataFrame | None = None

    @property
    def is_race_like(self) -> bool:
        return self.session_type in RACE_LIKE

    def driver(self, number: str) -> Driver | None:
        return next((d for d in self.drivers if d.number == number), None)
