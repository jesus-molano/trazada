"""Garantías de procedencia: nada de Ergast/Jolpica ni fotos en lo que sale de la fuente FastF1."""

from __future__ import annotations

import ast
import inspect

import pandas as pd

from trazada_pipeline.sources import fastf1_source


def test_fastf1_source_never_reads_results() -> None:
    """`session.results` (y el resto de API de Ergast) no se usa en ningún sitio del adaptador."""
    tree = ast.parse(inspect.getsource(fastf1_source))
    attrs = {n.attr for n in ast.walk(tree) if isinstance(n, ast.Attribute)}
    names = {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)}
    assert not {"results", "ergast", "Ergast", "get_driver"} & (attrs | names)
    strings = {n.value for n in ast.walk(tree) if isinstance(n, ast.Constant) and isinstance(n.value, str)}
    assert "HeadshotUrl" not in strings


def test_race_lap_one_time_is_dropped() -> None:
    td = pd.to_timedelta
    raw = pd.DataFrame(
        {
            "DriverNumber": ["1", "1"],
            "LapNumber": [1.0, 2.0],
            "LapTime": td(["0:01:40", "0:01:31"]),
            "LapStartTime": td(["0:10:00", "0:11:40"]),
            "Time": td(["0:11:40", "0:13:11"]),
            "Sector1Time": td([None, "0:00:30"]),
            "Sector2Time": td([None, "0:00:31"]),
            "Sector3Time": td([None, "0:00:30"]),
            "Compound": ["SOFT", "SOFT"],
            "TyreLife": [1.0, 2.0],
            "FreshTyre": [True, True],
            "Stint": [1.0, 1.0],
            "PitInTime": td([None, None]),
            "PitOutTime": td([None, None]),
            "Position": [1.0, 1.0],
            "TrackStatus": ["1", "1"],
            "Deleted": [False, False],
            "IsAccurate": [False, True],
        }
    )
    race = fastf1_source._laps(raw, race_like=True)
    assert race["lap_ms"].tolist() == [-1, 91000]
    practice = fastf1_source._laps(raw, race_like=False)
    assert practice["lap_ms"].tolist() == [100000, 91000]


def test_drivers_drop_photos() -> None:
    drivers = fastf1_source._drivers(
        {
            "1": {
                "RacingNumber": "1",
                "Tla": "VER",
                "FirstName": "Max",
                "LastName": "VERSTAPPEN",
                "TeamName": "Red Bull Racing",
                "TeamColour": "3671C6",
                "HeadshotUrl": "https://example.invalid/x.png",
            },
        }
    )
    assert drivers[0].tla == "VER" and drivers[0].color == "#3671C6"
    assert "https" not in repr(drivers[0])
