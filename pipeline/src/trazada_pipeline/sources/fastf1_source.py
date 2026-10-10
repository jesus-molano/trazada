"""Fuente principal: FastF1 sobre el archivo de live timing de F1 (o una caché saneada, offline).

Solo se usan campos que vienen del live timing. Se descartan explícitamente:
- todo lo que FastF1 trae de Ergast/Jolpica (resultados, tiempo de la vuelta 1 en carrera; CC BY-NC-SA);
- las vueltas que FastF1 inventa (`FastF1Generated`): no son del cronometraje;
- `HeadshotUrl` (fotos de pilotos).
"""

from __future__ import annotations

import logging
from datetime import UTC
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from trazada_pipeline.sources.base import (
    CAR_COLUMNS,
    LAP_COLUMNS,
    POS_COLUMNS,
    RC_COLUMNS,
    STREAM_COLUMNS,
    CircuitInfo,
    Driver,
    SessionData,
)
from trazada_pipeline.textutil import slugify

log = logging.getLogger(__name__)

#: Identificadores de sesión de FastF1 por tipo de Trazada.
FASTF1_SESSION = {
    "fp1": "FP1",
    "fp2": "FP2",
    "fp3": "FP3",
    "sq": "SQ",
    "sprint": "S",
    "q": "Q",
    "race": "R",
}

#: Nombre de sesión de FastF1 → tipo de Trazada.
SESSION_TYPE_BY_NAME = {
    "Practice 1": "fp1",
    "Practice 2": "fp2",
    "Practice 3": "fp3",
    "Sprint Qualifying": "sq",
    "Sprint Shootout": "sq",
    "Sprint": "sprint",
    "Qualifying": "q",
    "Race": "race",
}


#: Fuentes del calendario, por orden. Sin Ergast/Jolpica: el propio de FastF1 y, si falla, el de F1.
SCHEDULE_BACKENDS = ("fastf1", "f1timing")


def official_event(season: int, event: str | int) -> Any:
    """Evento de FastF1 sacado solo del calendario oficial (`SCHEDULE_BACKENDS`).

    `fastf1.get_session` y `fastf1.get_event` sin `backend` acaban en Ergast/Jolpica si los otros fallan,
    y de ahí saldrían el nombre, el país y la ronda de la sesión (CC BY-NC-SA).
    """
    import fastf1

    last: Exception | None = None
    for backend in SCHEDULE_BACKENDS:
        try:
            found = fastf1.get_event(season, event, backend=backend)
        except Exception as exc:  # cada backend falla a su manera (red, formato, evento inexistente)
            log.warning("Calendario %s con %s: %s", season, backend, exc)
            last = exc
            continue
        if found is not None:
            return found
    raise RuntimeError(f"{season} {event!r}: no está en el calendario oficial ({last})") from last


def event_slug(round_number: int, event_name: str, location: str) -> str:
    """Slug del evento en las rutas: la localidad (`spa-francorchamps`); en los tests, el nombre."""
    return slugify(event_name if round_number == 0 else location)


def fastf1_identifier(event: Any, session_type: str) -> str:
    """Nombre de sesión que se pide a FastF1. La clasificación sprint se llamó «Sprint Shootout» en 2023 y
    FastF1 no acepta «SQ» para esos eventos: se usa el nombre real que trae el propio evento."""
    if session_type == "sq":
        for i in range(1, 6):
            name = event.get(f"Session{i}") if hasattr(event, "get") else None
            if isinstance(name, str) and SESSION_TYPE_BY_NAME.get(name) == "sq":
                return name
    return FASTF1_SESSION[session_type]


class EmptySessionError(RuntimeError):
    """FastF1 devolvió una sesión sin datos (p. ej. por un 403 de F1 a una IP de nube)."""


def _td_ms(value: Any) -> int:
    """Timedelta (o NaT) → ms enteros; -1 si no hay valor."""
    if value is None or pd.isna(value):
        return -1
    return round(pd.Timedelta(value).total_seconds() * 1000)


def _series_ms(series: pd.Series) -> np.ndarray:
    td = pd.to_timedelta(series)
    out = np.full(len(td), -1, dtype=np.int64)
    ok = ~td.isna().to_numpy()
    out[ok] = np.rint(td[ok].dt.total_seconds().to_numpy() * 1000).astype(np.int64)
    return out


def _gmt_offset(value: Any) -> str:
    td = pd.Timedelta(value) if value is not None and not pd.isna(value) else pd.Timedelta(0)
    minutes = int(td.total_seconds() // 60)
    sign = "+" if minutes >= 0 else "-"
    minutes = abs(minutes)
    return f"{sign}{minutes // 60:02d}:{minutes % 60:02d}"


def _color(raw: Any) -> str:
    text = str(raw or "").strip().lstrip("#")
    if len(text) == 6 and all(c in "0123456789abcdefABCDEF" for c in text):
        return f"#{text.upper()}"
    return "#9BA4B0"


def _drivers(api_info: dict[str, dict[str, Any]]) -> list[Driver]:
    drivers = []
    for number, info in api_info.items():
        tla = str(info.get("Tla") or "").upper()
        if not tla:
            continue
        drivers.append(
            Driver(
                number=str(info.get("RacingNumber") or number),
                tla=tla,
                first=str(info.get("FirstName") or ""),
                last=str(info.get("LastName") or "").title(),
                team=str(info.get("TeamName") or ""),
                color=_color(info.get("TeamColour")),
                # HeadshotUrl se descarta a propósito (fotos de pilotos).
            )
        )
    return sorted(drivers, key=lambda d: int(d.number))


def _pos_frames(pos_data: dict[str, Any]) -> dict[str, pd.DataFrame]:
    out: dict[str, pd.DataFrame] = {}
    for drv, tel in pos_data.items():
        df = pd.DataFrame(tel)
        if "Source" in df:
            df = df[df["Source"] == "pos"]
        frame = pd.DataFrame(
            {
                "t_ms": _series_ms(df["SessionTime"]),
                "x": df["X"].to_numpy(dtype=np.float64),
                "y": df["Y"].to_numpy(dtype=np.float64),
                "z": df["Z"].to_numpy(dtype=np.float64),
            }
        )
        out[str(drv)] = frame[list(POS_COLUMNS)].reset_index(drop=True)
    return out


def _car_frames(car_data: dict[str, Any], drs_present: bool) -> dict[str, pd.DataFrame]:
    out: dict[str, pd.DataFrame] = {}
    for drv, tel in car_data.items():
        df = pd.DataFrame(tel)
        if "Source" in df:
            df = df[df["Source"] == "car"]
        throttle = df["Throttle"].to_numpy(dtype=np.int64)
        throttle = np.where((throttle < 0) | (throttle > 100), 255, throttle)  # 104 = sin dato
        frame = pd.DataFrame(
            {
                "t_ms": _series_ms(df["SessionTime"]),
                "speed": df["Speed"].to_numpy(dtype=np.int64),
                "rpm": df["RPM"].to_numpy(dtype=np.int64),
                "gear": df["nGear"].to_numpy(dtype=np.int64),
                "throttle": throttle,
                "brake": df["Brake"].astype(bool).to_numpy().astype(np.int64),
                "drs": df["DRS"].to_numpy(dtype=np.int64) if drs_present else np.full(len(df), -1),
            }
        )
        out[str(drv)] = frame[list(CAR_COLUMNS)].reset_index(drop=True)
    return out


def _is_true(value: Any) -> bool:
    """Solo un booleano verdadero cuenta (None, NaN o la columna ausente valen False)."""
    return isinstance(value, bool | np.bool_) and bool(value)


def generated_mask(df: pd.DataFrame) -> np.ndarray:
    """Vueltas que FastF1 añade por su cuenta (`FastF1Generated`): no vienen del cronometraje.

    - Vuelta 1 de un piloto sin vueltas en carrera, con el fin = el primer paso por meta de la parrilla
      (FastF1 avisa: «potentially adds a nonexistent lap» para quien no tomó la salida).
    - Vuelta N+1 de un coche parado en pista, con un fin supuesto (velocidad 0 o +150 s).
    """
    if "FastF1Generated" not in df:
        return np.zeros(len(df), dtype=bool)
    return np.array([_is_true(v) for v in df["FastF1Generated"]], dtype=bool)


#: Compuestos que significan «sin dato de neumático» en las vueltas de FastF1.
_NO_TYRE_DATA = ("", "UNKNOWN", "NAN", "NONE")


def _fresh(df: pd.DataFrame, compound: np.ndarray) -> np.ndarray:
    """Neumático nuevo (1), usado (0) o sin dato (-1).

    FastF1 guarda `FreshTyre` como booleano y, sin datos de neumático para un piloto, lo deja en False:
    sin esta regla saldría «usado» sin saberlo. Sin compuesto conocido no hay dato de neumático.
    """
    if "FreshTyre" not in df:
        return np.full(len(df), -1, dtype=np.int64)
    fresh = df["FreshTyre"].map({True: 1, False: 0}).fillna(-1).astype(int).to_numpy()
    return np.where(np.isin(compound, _NO_TYRE_DATA), -1, fresh).astype(np.int64)


def _laps(laps: pd.DataFrame, race_like: bool) -> pd.DataFrame:
    df = pd.DataFrame(laps)
    generated = generated_mask(df)
    if generated.any():
        log.info("Se descartan %d vueltas inventadas por FastF1 (FastF1Generated)", int(generated.sum()))
        df = df[~generated].reset_index(drop=True)
    lap_ms = _series_ms(df["LapTime"])
    lap_no = df["LapNumber"].fillna(0).astype(int).to_numpy()
    if race_like:
        # La vuelta 1 de carrera la rellena FastF1 desde Ergast/Jolpica: no se publica.
        lap_ms = np.where(lap_no == 1, -1, lap_ms)
    compound = df["Compound"].fillna("UNKNOWN").astype(str).str.upper().to_numpy()
    out = pd.DataFrame(
        {
            "car": df["DriverNumber"].astype(str).to_numpy(),
            "lap": lap_no,
            "start_ms": _series_ms(df["LapStartTime"]),
            "end_ms": _series_ms(df["Time"]),
            "lap_ms": lap_ms,
            "s1_ms": _series_ms(df["Sector1Time"]),
            "s2_ms": _series_ms(df["Sector2Time"]),
            "s3_ms": _series_ms(df["Sector3Time"]),
            "compound": compound,
            "tyre_life": df["TyreLife"].to_numpy(dtype=np.float64),
            "fresh": _fresh(df, compound),
            "stint": df["Stint"].fillna(0).astype(int).to_numpy(),
            "pit_in_ms": _series_ms(df["PitInTime"]),
            "pit_out_ms": _series_ms(df["PitOutTime"]),
            "position": df["Position"].fillna(0).astype(int).to_numpy() if "Position" in df else 0,
            "track_status": df["TrackStatus"].fillna("").astype(str).to_numpy(),
            "deleted": df["Deleted"].fillna(False).astype(bool).to_numpy() if "Deleted" in df else False,
            "accurate": df["IsAccurate"].fillna(False).astype(bool).to_numpy(),
        }
    )
    return out[list(LAP_COLUMNS)].sort_values(["car", "lap"], kind="stable").reset_index(drop=True)


def _stream(stream: pd.DataFrame | None) -> pd.DataFrame | None:
    from trazada_pipeline.timing import parse_gap

    if stream is None or len(stream) == 0:
        return None
    rows = []
    for rec in stream.itertuples(index=False):
        gap_ms, laps_behind = parse_gap(getattr(rec, "GapToLeader", None))
        interval_ms, _ = parse_gap(getattr(rec, "IntervalToPositionAhead", None))
        pos = getattr(rec, "Position", None)
        rows.append(
            (
                _td_ms(rec.Time),
                str(rec.Driver),
                int(pos) if pos is not None and not pd.isna(pos) else 0,
                gap_ms,
                interval_ms,
                laps_behind,
            )
        )
    return pd.DataFrame(rows, columns=list(STREAM_COLUMNS))


def _race_control(rcm: pd.DataFrame, t0: pd.Timestamp) -> pd.DataFrame:
    df = pd.DataFrame(rcm)
    if df.empty:
        return pd.DataFrame(columns=list(RC_COLUMNS))
    times = pd.to_datetime(df["Time"])
    t_ms = np.rint((times - t0).dt.total_seconds().to_numpy() * 1000).astype(np.int64)

    def opt_int(v: Any) -> int | None:
        return None if v is None or pd.isna(v) else int(v)

    def opt_str(v: Any) -> str | None:
        return None if v is None or (isinstance(v, float) and np.isnan(v)) or v == "" else str(v)

    out = pd.DataFrame(
        {
            "t_ms": t_ms,
            "lap": [opt_int(v) for v in df.get("Lap", [None] * len(df))],
            "category": [opt_str(v) or "Other" for v in df["Category"]],
            "flag": [opt_str(v) for v in df["Flag"]],
            "scope": [opt_str(v) for v in df["Scope"]],
            "sector": [opt_int(v) for v in df["Sector"]],
            "car": [opt_str(v) for v in df["RacingNumber"]],
            "text": df["Message"].astype(str).to_numpy(),
            "status": [opt_str(v) for v in df["Status"]],
        }
    )
    return out.sort_values("t_ms", kind="stable").reset_index(drop=True)


def _circuit_info(session: Any) -> CircuitInfo | None:
    try:
        info = session.get_circuit_info()
    except Exception as exc:  # red bloqueada, API caída…
        log.warning("Sin info de circuito (MultiViewer): %s", exc)
        return None
    if info is None:
        return None
    corners = pd.DataFrame(
        {
            "number": info.corners["Number"].astype(int).to_numpy(),
            "letter": info.corners["Letter"].fillna("").astype(str).to_numpy(),
            "x": info.corners["X"].to_numpy(dtype=np.float64),
            "y": info.corners["Y"].to_numpy(dtype=np.float64),
            "angle": info.corners["Angle"].to_numpy(dtype=np.float64),
        }
    )
    ms = info.marshal_sectors
    marshal = (
        pd.DataFrame(
            {
                "number": ms["Number"].astype(int).to_numpy(),
                "x": ms["X"].to_numpy(dtype=np.float64),
                "y": ms["Y"].to_numpy(dtype=np.float64),
            }
        )
        if ms is not None and len(ms)
        else None
    )
    return CircuitInfo(corners=corners, marshal_sectors=marshal, rotation_deg=float(info.rotation))


def _weather(session: Any, offline: bool) -> pd.DataFrame | None:
    """Meteorología de la sesión (D36, `weather.py`), o None si no la hay.

    FastF1 no la carga (`weather=False`): su parseo pone a 0 lo que falta. Primero el stream crudo (online,
    o offline si la caché HTTP lo guarda); offline, si no está, la caché ya parseada por FastF1 con las
    reglas del relleno a 0. Que falte no impide generar la sesión: queda `channels.weather: absent`.
    """
    import fastf1.api

    from trazada_pipeline import weather

    try:
        raw = fastf1.api.fetch_page(session.api_path, "weather_data")
    except Exception as exc:  # red, API caída…
        log.warning("Sin meteorología del live timing: %s", exc)
        raw = None
    if isinstance(raw, list) and raw:
        frame = weather.parse_raw(raw)
        if len(frame):
            return frame
    if not offline:
        return None
    try:
        parsed = fastf1.api.weather_data(session.api_path)
    except (Exception, SystemExit) as exc:  # sin la caché, la envoltura de FastF1 puede llamar a exit()
        log.warning("Sin meteorología en la caché: %s", exc)
        return None
    frame = weather.from_fastf1_parsed(parsed) if isinstance(parsed, dict) else None
    return frame if frame is not None and len(frame) else None


def load_fastf1(
    season: int,
    event: str | int,
    session_type: str,
    cache_dir: Path,
    *,
    offline: bool = False,
    with_circuit_info: bool = True,
) -> SessionData:
    """Carga una sesión con FastF1 (online o desde caché) y la normaliza."""
    import fastf1
    import fastf1.api

    cache_dir.mkdir(parents=True, exist_ok=True)
    fastf1.Cache.enable_cache(str(cache_dir))
    if offline:
        fastf1.Cache.offline_mode(True)

    from fastf1.exceptions import DataNotLoadedError

    ev_info = official_event(season, event)
    session = ev_info.get_session(fastf1_identifier(ev_info, session_type))
    # La meteorología se lee aparte y en crudo (`_weather`): el parseo de FastF1 pone a 0 lo que falta.
    session.load(laps=True, telemetry=True, weather=False, messages=True)

    try:
        empty = session.t0_date is None or not session.pos_data or not session.car_data or session.laps.empty
    except DataNotLoadedError:  # FastF1 se traga los fallos de descarga y deja la sesión sin cargar
        empty = True
    if empty:
        raise EmptySessionError(
            f"{season} {event} {session_type}: FastF1 devolvió una sesión vacía. "
            "Si estás en una IP de nube, F1 responde 403 (ejecuta el pipeline desde una IP residencial)."
        )

    t0 = pd.Timestamp(session.t0_date)
    info = session.session_info
    race_like = session_type in ("race", "sprint")
    drs_present = season < 2026

    driver_info = fastf1.api.driver_info(session.api_path)
    stream_raw = None
    try:
        _laps_raw, stream_raw, *_ = fastf1.api.timing_data(session.api_path)
    except Exception as exc:
        log.warning("Sin flujo de la torre de tiempos: %s", exc)

    ev = session.event
    session_date = pd.Timestamp(session.date) if getattr(session, "date", None) is not None else None
    return SessionData(
        season=season,
        round=int(ev["RoundNumber"]),
        event=str(ev["EventName"]),
        country=str(ev["Country"]),
        slug=event_slug(int(ev["RoundNumber"]), str(ev["EventName"]), str(ev["Location"])),
        session_type=session_type,
        session_name=str(session.name),
        date_start=session_date.date() if session_date is not None else None,
        t0_utc=t0.to_pydatetime().replace(tzinfo=UTC),
        gmt_offset=_gmt_offset(info.get("GmtOffset")),
        circuit_key=int(info["Meeting"]["Circuit"]["Key"]),
        drivers=_drivers(driver_info),
        pos=_pos_frames(session.pos_data),
        car=_car_frames(session.car_data, drs_present),
        laps=_laps(session.laps, race_like),
        stream=_stream(stream_raw),
        track_status=pd.DataFrame(
            {
                "t_ms": _series_ms(session.track_status["Time"]),
                "code": session.track_status["Status"].astype(int).to_numpy(),
            }
        ),
        session_status=pd.DataFrame(
            {
                "t_ms": _series_ms(session.session_status["Time"]),
                "status": session.session_status["Status"].astype(str).to_numpy(),
            }
        ),
        race_control=_race_control(session.race_control_messages, t0),
        circuit_info=_circuit_info(session) if with_circuit_info else None,
        session_start_ms=_td_ms(session.session_start_time),
        total_laps=int(session.total_laps) if race_like and session.total_laps else None,
        drs_channel=drs_present,
        source="fastf1-offline-cache" if offline else "fastf1",
        source_versions={"fastf1": fastf1.__version__, "apiCoreVersion": 15},
        weather=_weather(session, offline),
    )
