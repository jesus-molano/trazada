"""Meteorología (D36): parseo crudo sin el relleno a 0 de FastF1, reglas de la caché offline y recorte."""

from __future__ import annotations

import copy
import json
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pandas as pd
import pytest

from trazada_pipeline import schema, weather
from trazada_pipeline.sources import fastf1_source
from trazada_pipeline.sources.base import WEATHER_COLUMNS

FULL = {
    "AirTemp": "23.6",
    "Humidity": "45.0",
    "Pressure": "966.7",
    "Rainfall": "0",
    "TrackTemp": "41.2",
    "WindDirection": "330",
    "WindSpeed": "1.5",
    "_kf": True,
}


def _raw(*rows: tuple[str, dict[str, Any]]) -> list[list[Any]]:
    """Mensajes del stream como los devuelve `fastf1.api.fetch_page`: [marca, dict]."""
    return [[stamp, payload] for stamp, payload in rows]


def _row(frame: pd.DataFrame, i: int) -> dict[str, Any]:
    return {k: frame[k].iloc[i] for k in WEATHER_COLUMNS}


def test_timestamps_of_the_stream() -> None:
    assert weather.timestamp_ms("00:00:09.475") == 9_475
    assert weather.timestamp_ms("01:20:09.819") == 4_809_819
    assert weather.timestamp_ms("00:01:00") == 60_000
    for bad in ("", "9.475", "aa:bb:cc.ddd", None, 12):
        assert weather.timestamp_ms(bad) is None


def test_raw_stream_keeps_values_and_a_missing_key_is_no_data_not_zero() -> None:
    """FastF1 pondría 0 (y la lluvia, False) en las claves que faltan: aquí quedan sin dato."""
    no_wind = {k: v for k, v in FULL.items() if k not in ("WindSpeed", "WindDirection")}
    frame = weather.parse_raw(
        _raw(("00:00:09.475", FULL), ("00:01:09.472", no_wind), ("00:02:09.458", {"_kf": True}))
    )
    assert list(frame.columns) == list(WEATHER_COLUMNS)
    assert _row(frame, 0) == {
        "t_ms": 9_475,
        "air_c": 23.6,
        "track_c": 41.2,
        "humidity": 45.0,
        "pressure_hpa": 966.7,
        "rain": False,
        "wind_ms": 1.5,
        "wind_deg": 330,
    }
    second = _row(frame, 1)
    assert second["air_c"] == 23.6 and second["rain"] is False
    assert second["wind_ms"] is None and second["wind_deg"] is None
    # Un mensaje sin ninguna medida: la muestra existe, sin dato en todo (nunca ceros ni «sin lluvia»).
    assert {k: v for k, v in _row(frame, 2).items() if k != "t_ms"} == dict.fromkeys(WEATHER_COLUMNS[1:])


def test_raw_rain_is_yes_or_no_and_unreadable_values_are_no_data() -> None:
    rows = [
        ("00:00:01.000", {**FULL, "Rainfall": "1"}),
        ("00:01:01.000", {**FULL, "Rainfall": "0"}),
        ("00:02:01.000", {**FULL, "Rainfall": "0.7", "AirTemp": "-", "Humidity": "", "TrackTemp": "nan"}),
        ("00:03:01.000", {**FULL, "Rainfall": None, "WindDirection": "361", "Humidity": "120"}),
    ]
    frame = weather.parse_raw(_raw(*rows))
    assert frame["rain"].tolist() == [True, False, None, None]
    assert frame["air_c"].tolist() == [23.6, 23.6, None, 23.6]
    assert frame["track_c"].tolist() == [41.2, 41.2, None, 41.2]
    assert frame["humidity"].tolist() == [45.0, 45.0, None, None]
    assert frame["wind_deg"].tolist() == [330, 330, 330, None]


def test_raw_zero_from_the_feed_is_a_real_zero() -> None:
    """Online, un 0 que manda el feed es una medida (calma, 0° = norte): solo el relleno es dudoso."""
    frame = weather.parse_raw(_raw(("00:00:01.000", {**FULL, "WindSpeed": "0.0", "WindDirection": "0"})))
    assert frame["wind_ms"].tolist() == [0.0]
    assert frame["wind_deg"].tolist() == [0]
    north = weather.parse_raw(_raw(("00:00:01.000", {**FULL, "WindDirection": "360"})))
    assert north["wind_deg"].tolist() == [0]


def test_raw_stream_is_sorted_and_without_repeated_instants() -> None:
    later = {**FULL, "AirTemp": "24.0"}
    frame = weather.parse_raw(
        [
            *_raw(("00:02:00.000", FULL), ("00:01:00.000", FULL), ("00:02:00.000", later), ("roto", FULL)),
            ["00:03:00.000"],
            ["00:04:00.000", "no es un dict"],
        ]
    )
    assert frame["t_ms"].tolist() == [60_000, 120_000]
    assert frame["air_c"].tolist() == [23.6, 24.0]  # en el mismo instante, el último mensaje
    assert weather.parse_raw([]).empty


def _parsed(**over: list[Any]) -> dict[str, list[Any]]:
    """Caché ya parseada por FastF1 (`weather_data.ff1pkl`): columnas con el relleno a 0 ya aplicado."""
    base: dict[str, list[Any]] = {
        "Time": [timedelta(seconds=9.475), timedelta(seconds=69.472), timedelta(seconds=129.458)],
        "AirTemp": [23.6, 23.7, 23.9],
        "Humidity": [45.0, 45.4, 44.5],
        "Pressure": [966.7, 966.5, 966.5],
        "Rainfall": [False, False, True],
        "TrackTemp": [41.2, 41.1, 41.7],
        "WindDirection": [330, 317, 329],
        "WindSpeed": [1.5, 2.2, 2.2],
    }
    return {**base, **over}


def test_offline_cache_keeps_real_values() -> None:
    frame = weather.from_fastf1_parsed(_parsed())
    assert frame["t_ms"].tolist() == [9_475, 69_472, 129_458]
    assert frame["air_c"].tolist() == [23.6, 23.7, 23.9]
    assert frame["rain"].tolist() == [False, False, True]
    assert frame["wind_deg"].tolist() == [330, 317, 329]


def test_offline_cache_zero_fill_is_no_data() -> None:
    """Offline no se distingue el relleno de una medida: un 0 exacto (presión, viento…) es sin dato."""
    frame = weather.from_fastf1_parsed(
        _parsed(Pressure=[0.0, 966.5, 966.5], WindSpeed=[1.5, 0.0, 2.2], WindDirection=[330, 0, 329])
    )
    assert frame["pressure_hpa"].tolist() == [None, 966.5, 966.5]
    assert frame["wind_ms"].tolist() == [1.5, None, 2.2]
    assert frame["wind_deg"].tolist() == [330, None, 329]
    assert frame["air_c"].tolist() == [23.6, 23.7, 23.9]  # el resto de la fila sí vale
    assert frame["rain"].tolist() == [False, False, True]


def test_offline_cache_row_all_zero_is_entirely_no_data() -> None:
    """Una fila toda a 0 (sin ninguna clave): sin dato entera, también la lluvia (su False es relleno)."""
    zeros = {k: [v[0], 0, v[2]] for k, v in _parsed().items() if k not in ("Time", "Rainfall")}
    frame = weather.from_fastf1_parsed(_parsed(**zeros, Rainfall=[False, False, False]))
    assert {k: v for k, v in _row(frame, 1).items() if k != "t_ms"} == dict.fromkeys(WEATHER_COLUMNS[1:])
    assert frame["rain"].tolist() == [False, None, False]


def test_offline_cache_with_a_missing_or_short_column_is_no_data() -> None:
    frame = weather.from_fastf1_parsed({**_parsed(), "Humidity": [45.0]})
    assert frame["humidity"].tolist() == [None, None, None]
    data = _parsed()
    del data["TrackTemp"]
    assert weather.from_fastf1_parsed(data)["track_c"].tolist() == [None, None, None]
    assert weather.from_fastf1_parsed({}).empty


def test_window_keeps_the_sample_in_force_at_the_start() -> None:
    frame = weather.parse_raw(_raw(*((f"00:0{m}:00.000", FULL) for m in range(6))))
    cut = weather.window(frame, 150_000, 240_000)
    assert cut is not None
    assert cut["t_ms"].tolist() == [120_000, 180_000, 240_000]  # 2:00 es la vigente al empezar (2:30)
    assert weather.window(frame, -10_000, 30_000)["t_ms"].tolist() == [0]  # type: ignore[index]
    assert weather.window(frame, 400_000, 500_000)["t_ms"].tolist() == [300_000]  # type: ignore[index]
    assert weather.window(None, 0, 1) is None
    assert weather.window(frame.iloc[0:0], 0, 1) is None


def test_events_columns_are_json_with_null_and_validate() -> None:
    frame = weather.parse_raw(_raw(("00:00:09.475", FULL), ("00:01:09.472", {"Rainfall": "1"})))
    doc = weather.to_events(frame)
    assert doc == {
        "t": [9_475, 69_472],
        "airC": [23.6, None],
        "trackC": [41.2, None],
        "humidity": [45.0, None],
        "pressureHpa": [966.7, None],
        "rain": [False, True],
        "windMs": [1.5, None],
        "windDeg": [330, None],
    }
    text = json.dumps(doc)
    assert "NaN" not in text and json.loads(text) == doc
    schema.validate("events", {**_example_events(), "weather": doc})
    assert weather.to_events(None) is None
    assert weather.to_events(frame.iloc[0:0]) is None


def _example_events() -> dict[str, Any]:
    path = schema.schema_dir() / "examples" / "events.example.json"
    return json.loads(path.read_text(encoding="utf-8"))


def test_events_schema_rejects_rain_intensity_and_accepts_old_events() -> None:
    events = _example_events()
    old = {k: v for k, v in events.items() if k != "weather"}
    schema.validate("events", {**old, "schemaVersion": "1.0.0"})
    bad = copy.deepcopy(events)
    bad["weather"]["rain"] = [0.5, False, None]
    with pytest.raises(ValueError, match="rain"):
        schema.validate("events", bad)


class _Session(SimpleNamespace):
    api_path = "/static/2026/2026-07-19_Belgian_Grand_Prix/2026-07-17_Practice_1/"


def _no_fastf1_parse(*_a: Any, **_k: Any) -> None:
    pytest.fail("parseo de FastF1 (con el relleno a 0)")


def test_source_reads_the_raw_stream(monkeypatch: pytest.MonkeyPatch) -> None:
    import fastf1.api

    calls: list[str] = []

    def fetch_page(path: str, name: str) -> list[list[Any]]:
        calls.append(name)
        return _raw(("00:00:09.475", FULL))

    monkeypatch.setattr(fastf1.api, "fetch_page", fetch_page)
    monkeypatch.setattr(fastf1.api, "weather_data", _no_fastf1_parse)
    frame = fastf1_source._weather(_Session(), offline=False)
    assert calls == ["weather_data"]
    assert frame is not None and frame["air_c"].tolist() == [23.6]


def test_source_without_weather_online_is_absent(monkeypatch: pytest.MonkeyPatch) -> None:
    import fastf1.api

    monkeypatch.setattr(fastf1.api, "fetch_page", lambda *_a: None)
    monkeypatch.setattr(fastf1.api, "weather_data", _no_fastf1_parse)
    assert fastf1_source._weather(_Session(), offline=False) is None

    def boom(*_a: Any) -> None:
        raise ConnectionError("sin red")

    monkeypatch.setattr(fastf1.api, "fetch_page", boom)
    assert fastf1_source._weather(_Session(), offline=False) is None


def test_source_offline_falls_back_to_the_parsed_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    import fastf1.api

    monkeypatch.setattr(fastf1.api, "fetch_page", lambda *_a: None)  # la caché HTTP no lo guarda
    monkeypatch.setattr(fastf1.api, "weather_data", lambda *_a, **_k: _parsed(Pressure=[0.0, 966.5, 966.5]))
    frame = fastf1_source._weather(_Session(), offline=True)
    assert frame is not None and frame["pressure_hpa"].tolist() == [None, 966.5, 966.5]

    def gone(*_a: Any, **_k: Any) -> None:
        raise SystemExit  # la envoltura de caché de FastF1 llama a exit() si no puede cargar

    monkeypatch.setattr(fastf1.api, "weather_data", gone)
    assert fastf1_source._weather(_Session(), offline=True) is None


@pytest.mark.local
def test_spa_fp1_cache_has_weather() -> None:
    """La caché saneada de Bélgica FP1 2026 trae meteorología (81 muestras, una por minuto)."""
    from trazada_pipeline.sources.safe_pickle import safe_load

    root = Path(__file__).resolve().parents[2] / ".cache" / "fastf1-sanitized"
    path = next(root.glob("2026/*Belgian*/*Practice_1/weather_data.ff1pkl"), None)
    if path is None:
        pytest.skip("sin la caché saneada de Bélgica FP1")
    frame = weather.from_fastf1_parsed(safe_load(path)["data"])
    assert len(frame) == 81
    assert frame["rain"].tolist().count(True) == 0
    assert frame["wind_ms"].isna().sum() == 1  # la fila con viento 0/0: relleno o calma, sin dato
