"""Parser de race control contra el golden set etiquetado a mano y estado derivado (events.json)."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

import pandas as pd
import pytest

from trazada_pipeline.racecontrol.parser import parse
from trazada_pipeline.racecontrol.state import build_events, sector_flags, track_status_from_race_control
from trazada_pipeline.sources.base import RC_COLUMNS

GOLDEN = Path(__file__).parent / "fixtures" / "rc_golden.jsonl"
ROWS = [json.loads(line) for line in GOLDEN.read_text(encoding="utf-8").splitlines() if line.strip()]
FIELDS = ("kind", "cars", "turn", "lap", "outcome", "detail")


def test_golden_set_size_and_coverage() -> None:
    assert len(ROWS) >= 300
    assert {r["year"] for r in ROWS} >= {2023, 2024, 2025, 2026}
    kinds = Counter(r["expected"]["kind"] for r in ROWS)
    for kind in (
        "blue_flag",
        "incident",
        "penalty",
        "lap_deleted",
        "sc_deployed",
        "vsc_deployed",
        "red_flag",
        "overtake_enabled",
        "drs_enabled",
        "chequered_flag",
    ):
        assert kinds[kind] > 0, f"el golden set no cubre {kind}"
    texts = " ".join(r["text"] for r in ROWS)
    assert "TRACK LIMITS" in texts and "NO FURTHER" in texts and "UNDER INVESTIGATION" in texts


@pytest.mark.parametrize("row", ROWS, ids=[str(r["id"]) for r in ROWS])
def test_parser_matches_golden(row: dict) -> None:
    got = parse(row["text"]).to_dict()
    assert {f: got[f] for f in FIELDS} == row["expected"], row["text"]


def test_other_rate_below_5_percent() -> None:
    other = [r["text"] for r in ROWS if parse(r["text"]).kind == "other"]
    assert len(other) / len(ROWS) <= 0.05, other


def test_prefixes_and_times_are_ignored() -> None:
    a = parse("CORRECTION: CAR 4 (NOR) TIME 1:30.123 DELETED - TRACK LIMITS AT TURN 4 LAP 7 14:01:02")
    assert (a.kind, a.cars, a.turn, a.lap, a.detail) == ("lap_deleted", ["4"], 4, 7, "TRACK LIMITS")
    b = parse("UPDATE: FIRST CAR TO TAKE THE FLAG - CAR 41 (LIN)")
    assert (b.kind, b.cars) == ("first_car_flag", ["41"])


def _rc(rows: list[tuple]) -> pd.DataFrame:
    return pd.DataFrame(
        [(t, None, cat, flag, scope, sector, None, text, None) for t, cat, flag, scope, sector, text in rows],
        columns=list(RC_COLUMNS),
    )


def test_sector_flags_open_and_close() -> None:
    rc = _rc(
        [
            (1000, "Flag", "YELLOW", "Sector", 5, "YELLOW IN TRACK SECTOR 5"),
            (2000, "Flag", "DOUBLE YELLOW", "Sector", 5, "DOUBLE YELLOW IN TRACK SECTOR 5"),
            (3000, "Flag", "CLEAR", "Sector", 5, "CLEAR IN TRACK SECTOR 5"),
            (4000, "Flag", "YELLOW", "Sector", 9, "YELLOW IN TRACK SECTOR 9"),
        ]
    )
    ev = build_events(rc, pd.DataFrame({"t_ms": [0], "code": [1]}), 10_000)
    assert ev["sectorFlags"] == [
        {"sector": 5, "flag": "YELLOW", "fromMs": 1000, "toMs": 2000},
        {"sector": 5, "flag": "DOUBLE YELLOW", "fromMs": 2000, "toMs": 3000},
        {"sector": 9, "flag": "YELLOW", "fromMs": 4000, "toMs": 10_000},
    ]
    assert sector_flags([], None) == []


def test_windows_from_track_status_and_overtake_toggles() -> None:
    rc = _rc(
        [
            (500, "Other", None, None, None, "OVERTAKE ENABLED"),
            (5000, "Other", None, None, None, "OVERTAKE DISABLED"),
            (6000, "Other", None, None, None, "OVERTAKE ENABLED"),
        ]
    )
    ts = pd.DataFrame({"t_ms": [0, 1000, 3000, 4000], "code": [1, 4, 1, 5]})
    ev = build_events(rc, ts, 9000, corner_s={1: 100.0})
    kinds = [(w["kind"], w["fromMs"], w["toMs"]) for w in ev["windows"]]
    assert ("sc", 1000, 3000) in kinds
    assert ("red", 4000, 9000) in kinds
    # El SC de 1000 cierra la ventana; el DISABLED de 5000 ya no cambia nada; el ENABLED de 6000 la reabre.
    assert [k for k in kinds if k[0] == "overtake"] == [("overtake", 500, 1000), ("overtake", 6000, 9000)]


def test_neutralization_closes_overtake_until_explicit_enable() -> None:
    # Japón 2026: OVERTAKE ENABLED, safety car (sin DISABLED), TRACK CLEAR, OVERTAKE ENABLED.
    rc = _rc(
        [
            (100, "Other", None, None, None, "OVERTAKE ENABLED"),
            (2000, "SafetyCar", None, None, None, "SAFETY CAR DEPLOYED"),
            (3000, "Other", None, None, None, "TRACK CLEAR"),
            (3500, "Other", None, None, None, "OVERTAKE ENABLED"),
            (5000, "Other", None, None, None, "DRS ENABLED"),
        ]
    )
    ts = pd.DataFrame({"t_ms": [0, 2000, 3000, 6000, 7000], "code": [1, 4, 1, 6, 1]})
    ev = build_events(rc, ts, 9000)
    got = [(w["kind"], w["fromMs"], w["toMs"]) for w in ev["windows"] if w["kind"] in ("overtake", "drs")]
    # Sin un ENABLED tras el VSC de 6000, las dos ventanas quedan cerradas hasta el final.
    assert got == [("overtake", 100, 2000), ("overtake", 3500, 6000), ("drs", 5000, 6000)]


def _assist(ev: dict) -> list[tuple]:
    return [(w["kind"], w["fromMs"], w["toMs"]) for w in ev["windows"] if w["kind"] in ("overtake", "drs")]


def test_chequered_flag_closes_overtake_and_drs() -> None:
    # Japón 2026: el último OVERTAKE ENABLED seguía abierto en la vuelta de enfriamiento.
    rc = _rc(
        [
            (1000, "Other", None, None, None, "OVERTAKE ENABLED"),
            (1500, "Drs", None, None, None, "DRS ENABLED"),
            (8000, "Flag", "CHEQUERED", "Track", None, "CHEQUERED FLAG"),
        ]
    )
    ev = build_events(rc, pd.DataFrame({"t_ms": [0], "code": [1]}), 9500)
    assert _assist(ev) == [("overtake", 1000, 8000), ("drs", 1500, 8000)]


def test_qualifying_keeps_drs_until_the_last_chequered_flag() -> None:
    # Clasificación: una bandera a cuadros por tanda y ningún DRS ENABLED nuevo en Q2 ni en Q3.
    rc = _rc(
        [
            (100, "Drs", None, None, None, "DRS ENABLED"),
            (1000, "Flag", "CHEQUERED", "Track", None, "CHEQUERED FLAG"),
            (2000, "Flag", "CHEQUERED", "Track", None, "CHEQUERED FLAG"),
            (3000, "Flag", "CHEQUERED", "Track", None, "CHEQUERED FLAG"),
        ]
    )
    ev = build_events(rc, pd.DataFrame({"t_ms": [0], "code": [1]}), 5000)
    assert _assist(ev) == [("drs", 100, 3000)]


def test_single_zone_messages_do_not_change_the_global_window() -> None:
    rc = _rc(
        [
            (100, "Drs", None, None, None, "DRS ENABLED"),
            (500, "Other", None, None, None, "DRS DISABLED IN ZONE 2"),
            (900, "Other", None, None, None, "DRS ENABLED IN ZONE 2"),
            (2000, "Drs", None, None, None, "DRS DISABLED"),
            (2500, "Other", None, None, None, "DRS ENABLED IN ZONE 1"),
        ]
    )
    ev = build_events(rc, pd.DataFrame({"t_ms": [0], "code": [1]}), 5000)
    # Ni el DISABLED de la zona 2 cierra la ventana global ni el ENABLED de la zona 1 la abre.
    assert _assist(ev) == [("drs", 100, 2000)]


def test_turn_maps_to_canonical_s() -> None:
    rc = _rc([(100, "Other", None, None, None, "TURN 3 INCIDENT INVOLVING CAR 1 (VER) NOTED - TRACK LIMITS")])
    ev = build_events(rc, pd.DataFrame({"t_ms": [0], "code": [1]}), 1000, corner_s={3: 812.34})
    assert ev["raceControl"][0]["parsed"]["s"] == 812.3
    assert ev["raceControl"][0]["text"].startswith("TURN 3")


def test_track_status_from_race_control() -> None:
    rc = _rc(
        [
            (100, "SafetyCar", None, None, None, "SAFETY CAR DEPLOYED"),
            (900, "Other", None, None, None, "TRACK CLEAR"),
            (1000, "Flag", "RED", None, None, "RED FLAG"),
            (2000, "Flag", "GREEN", None, None, "GREEN LIGHT - PIT EXIT OPEN"),
        ]
    )
    ts = track_status_from_race_control(rc)
    assert list(zip(ts["t_ms"], ts["code"], strict=True)) == [
        (0, 1),
        (100, 4),
        (900, 1),
        (1000, 5),
        (2000, 1),
    ]


def test_flags_and_windows_are_clipped_to_playback_end() -> None:
    rc = _rc(
        [
            (1000, "Flag", "YELLOW", "Sector", 3, "YELLOW IN TRACK SECTOR 3"),
            (12_000, "Flag", "DOUBLE YELLOW", "Sector", 9, "DOUBLE YELLOW IN TRACK SECTOR 9"),
        ]
    )
    ts = pd.DataFrame({"t_ms": [0, 2000, 11_000], "code": [1, 4, 6]})
    ev = build_events(rc, ts, 10_000)
    assert ev["sectorFlags"] == [{"sector": 3, "flag": "YELLOW", "fromMs": 1000, "toMs": 10_000}]
    assert [(w["kind"], w["fromMs"], w["toMs"]) for w in ev["windows"]] == [("sc", 2000, 10_000)]
    for w in ev["sectorFlags"] + ev["windows"]:
        assert w["toMs"] >= w["fromMs"]
