"""Garantías de procedencia: nada de Ergast/Jolpica ni fotos en lo que sale de la fuente FastF1."""

from __future__ import annotations

import ast
import inspect
import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

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


def _ff1_laps(rows: list[tuple]) -> pd.DataFrame:
    """Vueltas con las columnas de FastF1: (coche, vuelta, inicio s, fin s, tiempo s | None, generada)."""

    def secs(values: list[float | None]) -> pd.Series:
        return pd.to_timedelta([None if v is None else f"{v}s" for v in values])

    car, lap, start, end, lap_time, generated = (list(c) for c in zip(*rows, strict=True))
    n = len(rows)
    return pd.DataFrame(
        {
            "DriverNumber": car,
            "LapNumber": [float(x) for x in lap],
            "LapTime": secs(lap_time),
            "LapStartTime": secs(start),
            "Time": secs(end),
            "Sector1Time": secs([None if t is None else 30.0 for t in lap_time]),
            "Sector2Time": secs([None if t is None else 30.0 for t in lap_time]),
            "Sector3Time": secs([None if t is None else t - 60.0 for t in lap_time]),
            "Compound": ["SOFT"] * n,
            "TyreLife": [float(x) for x in lap],
            "FreshTyre": [True] * n,
            "Stint": [1.0] * n,
            "PitInTime": pd.to_timedelta([None] * n),
            "PitOutTime": pd.to_timedelta([None] * n),
            "Position": [np.nan] * n,
            "TrackStatus": ["1"] * n,
            "Deleted": [False] * n,
            "FastF1Generated": generated,
            "IsAccurate": [g is False for g in generated],
        }
    )


def test_fastf1_generated_laps_are_dropped() -> None:
    """FastF1 inventa la vuelta 1 de quien no tomó la salida y la N+1 de un coche parado (+150 s)."""
    raw = _ff1_laps(
        [
            ("1", 1, 600.0, 700.0, None, False),
            ("1", 2, 700.0, 791.0, 91.0, False),
            # No tomó la salida: FastF1 le pone como fin el primer paso por meta de la parrilla.
            ("2", 1, 600.0, 700.0, None, True),
            ("3", 1, 600.0, 702.0, None, False),
            ("3", 2, 702.0, 795.0, 93.0, False),
            # Parado en pista en la vuelta 3: fin supuesto exactamente 150 s después.
            ("3", 3, 795.0, 945.0, None, True),
        ]
    )
    out = fastf1_source._laps(raw, race_like=True)
    assert list(zip(out["car"], out["lap"], strict=True)) == [("1", 1), ("1", 2), ("3", 1), ("3", 2)]
    assert out["end_ms"].max() == 795_000  # el fin inventado (945 s) no queda en ningún sitio


def test_fastf1_generated_missing_or_unknown_counts_as_real() -> None:
    raw = _ff1_laps([("1", 1, 600.0, 700.0, None, None), ("1", 2, 700.0, 791.0, 91.0, np.nan)])
    raw["FastF1Generated"] = raw["FastF1Generated"].astype(object)
    assert fastf1_source._laps(raw, race_like=False)["lap"].tolist() == [1, 2]
    no_column = raw.drop(columns=["FastF1Generated"])
    assert fastf1_source._laps(no_column, race_like=False)["lap"].tolist() == [1, 2]


def _ti_session(root: Path, laps: list[dict], with_flag: bool) -> Path:
    """Sesión mínima con el formato JSON de TracingInsights (un coche, sin telemetría)."""
    session = root / "Japanese Grand Prix" / "Race"
    (session / "BEA").mkdir(parents=True)
    driver = {"driver": "BEA", "dn": "87", "fn": "Oliver", "ln": "Bearman", "team": "Haas", "tc": "B6BABD"}
    (session / "drivers.json").write_text(json.dumps({"drivers": [driver]}))
    keys = ["lap", "lST", "lSD", "time", "sesT", "s1", "s2", "s3", "compound", "life", "fresh", "stint"]
    keys += ["pin", "pout", "pos", "status", "del", "iacc"] + (["ff1G"] if with_flag else [])
    lt = {k: [row.get(k, "None") for row in laps] for k in keys}
    (session / "BEA" / "laptimes.json").write_text(json.dumps(lt))
    rcm = {"time": ["2026-03-29T05:00:00"], "msg": ["GREEN LIGHT - PIT EXIT OPEN"]}
    (session / "rcm.json").write_text(json.dumps(rcm))
    return session


def _ti_lap(lap: int, start: float, end: float, time: float | None, generated: bool) -> dict:
    timed = time is not None
    return {
        "lap": lap,
        "lST": start,
        "lSD": f"2026-03-29T05:{lap:02d}:00",
        "time": time if timed else "None",
        "sesT": end,
        "s1": 30.0 if timed else "None",
        "s2": 30.0 if timed else "None",
        "s3": (time - 60.0) if time is not None else "None",
        "compound": "HARD",
        "life": lap,
        "fresh": True,
        "stint": 1,
        "pos": lap,
        "status": "1",
        "del": False,
        "iacc": timed,
        "ff1G": generated,
    }


TI_LAPS = [
    _ti_lap(19, 5600.0, 5693.73, 93.73, False),
    _ti_lap(20, 5693.73, 5789.334, 95.604, False),
    # Japón 2026, coche 87: la 21 dura exactamente 150 s y la 22 cuelga de ella; las dos, sin tiempo.
    _ti_lap(21, 5789.334, 5939.334, None, True),
    _ti_lap(22, 5939.334, 5939.546, None, True),
]


@pytest.mark.parametrize("with_flag", [True, False], ids=["ff1G", "patron-150s"])
def test_tracinginsights_drops_fastf1_generated_laps(tmp_path: Path, with_flag: bool) -> None:
    from trazada_pipeline.sources.dev_tracinginsights import load_tracinginsights

    data = load_tracinginsights(_ti_session(tmp_path, TI_LAPS, with_flag), 2026, 3, "suzuka")
    assert data.laps["lap"].tolist() == [19, 20]
    assert data.laps["end_ms"].max() == 5_789_334


def test_tracinginsights_pattern_needs_the_exact_150_s_lap() -> None:
    from trazada_pipeline.sources.dev_tracinginsights import real_laps

    def row(lap: int, start: int, end: int, timed: bool) -> dict:
        t = end - start if timed else -1
        return {"lap": lap, "start_ms": start, "end_ms": end, "lap_ms": t, "s1_ms": t, "s2_ms": t, "s3_ms": t}

    # Una vuelta final sin tiempo pero con una duración que no es la supuesta se conserva.
    real = [row(1, 0, 90_000, True), row(2, 90_000, 181_234, False)]
    assert [r["lap"] for r in real_laps(real, None)] == [1, 2]
    # Con 150 000 ms exactos se descarta, y también lo que cuelga de ella.
    phantom = [row(1, 0, 90_000, True), row(2, 90_000, 240_000, False), row(3, 240_000, 240_212, False)]
    assert [r["lap"] for r in real_laps(phantom, None)] == [1]
    # Si la vuelta de 150 s tiene tiempo, es real.
    timed = [row(1, 0, 90_000, True), row(2, 90_000, 240_000, True)]
    assert [r["lap"] for r in real_laps(timed, None)] == [1, 2]
    # Con la marca, manda la marca.
    assert [r["lap"] for r in real_laps(phantom, [False, False, True])] == [1, 2]
