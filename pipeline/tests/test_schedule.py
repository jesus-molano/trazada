"""Calendario para el gestor de datos local (`trazada schedule`) y progreso de `build --progress`."""

from __future__ import annotations

import json
import logging
from pathlib import Path

import pandas as pd
import pytest
import requests
from typer.testing import CliRunner

from trazada_pipeline import cli, schedule
from trazada_pipeline.build import SESSION_ORDER, BuildReport
from trazada_pipeline.progress import (
    FastF1ProgressHandler,
    Progress,
    attach_fastf1,
    detach_fastf1,
    error_code,
)
from trazada_pipeline.sources.fastf1_source import FASTF1_SESSION, EmptySessionError, event_slug


def _event(rnd: int, name: str, location: str, country: str, sessions: list[tuple[str, str | None]]) -> dict:
    row: dict = {
        "RoundNumber": rnd,
        "EventName": name,
        "OfficialEventName": f"FORMULA 1 {name.upper()} 2026",
        "Location": location,
        "Country": country,
        "EventDate": pd.Timestamp("2026-07-19"),
    }
    for i in range(1, 6):
        sname, utc = sessions[i - 1] if i <= len(sessions) else ("None", None)
        row[f"Session{i}"] = sname
        row[f"Session{i}DateUtc"] = pd.Timestamp(utc) if utc else pd.NaT
        row[f"Session{i}Date"] = (
            pd.Timestamp(utc).tz_localize("UTC").tz_convert("Europe/Brussels") if utc else pd.NaT
        )
    return row


FRAME = pd.DataFrame(
    [
        _event(0, "Pre-Season Testing", "Sakhir", "Bahrain", [("Practice 1", "2026-02-11 07:00")]),
        _event(
            10,
            "Belgian Grand Prix",
            "Spa-Francorchamps",
            "Belgium",
            [
                ("Practice 1", "2026-07-17 10:30"),
                ("Practice 2", "2026-07-17 14:00"),
                ("Practice 3", "2026-07-18 09:30"),
                ("Qualifying", "2026-07-18 13:00"),
                ("Race", "2026-07-19 13:00"),
            ],
        ),
        _event(
            2,
            "São Paulo Grand Prix",
            "São Paulo",
            "Brazil",
            [
                ("Practice 1", "2023-11-03 14:30"),
                ("Qualifying", "2023-11-03 18:00"),
                ("Sprint Shootout", "2023-11-04 14:30"),
                ("Sprint", None),
                ("Race", "2023-11-05 17:00"),
            ],
        ),
    ]
)


def test_schedule_events_normalizes_fastf1_schedule() -> None:
    events = schedule.schedule_events(FRAME)
    assert [e["round"] for e in events] == [2, 10]  # sin tests de pretemporada, por ronda
    spa = events[1]
    assert spa == {
        "round": 10,
        "slug": "spa-francorchamps",
        "event": "Belgian Grand Prix",
        "country": "Belgium",
        "dateStart": "2026-07-17",
        "sessions": [
            {"session": "fp1", "startUtc": "2026-07-17T10:30:00Z"},
            {"session": "fp2", "startUtc": "2026-07-17T14:00:00Z"},
            {"session": "fp3", "startUtc": "2026-07-18T09:30:00Z"},
            {"session": "q", "startUtc": "2026-07-18T13:00:00Z"},
            {"session": "race", "startUtc": "2026-07-19T13:00:00Z"},
        ],
    }
    brazil = events[0]
    assert brazil["slug"] == "sao-paulo"
    assert [s["session"] for s in brazil["sessions"]] == ["fp1", "q", "sq", "sprint", "race"]
    assert brazil["sessions"][3]["startUtc"] is None  # sin hora: se ofrece igual, sin fecha
    # Nunca el nombre oficial (marca registrada).
    assert "FORMULA 1" not in json.dumps(events)


def test_schedule_slug_matches_build_rule() -> None:
    assert event_slug(10, "Belgian Grand Prix", "Spa-Francorchamps") == "spa-francorchamps"
    assert event_slug(0, "Pre-Season Testing", "Sakhir") == "pre-season-testing"


def test_schedule_backends_never_use_jolpica() -> None:
    assert "ergast" not in schedule.SCHEDULE_BACKENDS


def test_load_schedule_falls_back_between_backends(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    import fastf1

    calls: list[str] = []

    def fake(season: int, *, include_testing: bool, backend: str) -> pd.DataFrame:
        calls.append(backend)
        assert include_testing is False
        if backend == "fastf1":
            raise ValueError("sin red")
        return FRAME

    monkeypatch.setattr(fastf1, "get_event_schedule", fake)
    monkeypatch.setattr(fastf1.Cache, "enable_cache", lambda *_a, **_k: None)
    assert [e["round"] for e in schedule.load_schedule(2026, tmp_path)] == [2, 10]
    assert calls == ["fastf1", "f1timing"]

    monkeypatch.setattr(fastf1, "get_event_schedule", lambda *_a, **_k: (_ for _ in ()).throw(OSError("x")))
    with pytest.raises(RuntimeError, match="calendario de 2026"):
        schedule.load_schedule(2026, tmp_path)


def _lines(out: str, kind: str) -> list[dict]:
    prefix = f"::{kind} "
    return [json.loads(line[len(prefix) :]) for line in out.splitlines() if line.startswith(prefix)]


def test_schedule_command_prints_one_json_line(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(schedule, "load_schedule", lambda season, cache: schedule.schedule_events(FRAME))
    result = CliRunner().invoke(cli.app, ["schedule", "2026"])
    assert result.exit_code == 0, result.output
    doc = json.loads(result.stdout.strip().splitlines()[-1])
    assert doc["season"] == 2026 and [e["slug"] for e in doc["events"]] == ["sao-paulo", "spa-francorchamps"]


def test_schedule_command_reports_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(season: int, cache: Path) -> list:
        raise requests.exceptions.ConnectionError("sin red")

    monkeypatch.setattr(schedule, "load_schedule", boom)
    result = CliRunner().invoke(cli.app, ["schedule", "2026"])
    assert result.exit_code == 1
    assert _lines(result.stdout, "error") == [{"code": "network", "message": "ConnectionError: sin red"}]


def test_session_types_are_consistent() -> None:
    assert list(cli.SESSION_TYPES) == list(FASTF1_SESSION) == SESSION_ORDER


def test_fastf1_logs_become_monotonic_progress(capsys: pytest.CaptureFixture[str]) -> None:
    logger = logging.getLogger("fastf1.test")
    handler = attach_fastf1(Progress())
    try:
        for msg in [
            "Loading data for Belgian Grand Prix - Practice 1 [v3.8.3]",
            "Fetching session info data...",
            "Fetching driver list...",
            "Fetching timing data...",
            "Parsing timing data...",
            "Fetching timing app data...",
            "Processing timing data...",
            "Using cached data for track_status_data",
            "Fetching race control messages...",
            "Fetching car data...",
            "Parsing car data...",
            "Fetching position data...",
            "Parsing position data...",
            "Something nobody expected",
            "Fetching driver list...",  # repetido: no retrocede
            "Finished loading data for 20 drivers: ['1', '4']",
        ]:
            logger.info(msg)
    finally:
        detach_fastf1(handler)
    events = _lines(capsys.readouterr().out, "progress")
    pcts = [e["pct"] for e in events]
    assert pcts == sorted(pcts) and len(set(pcts)) == len(pcts)
    assert [e["step"] for e in events] == [
        "start",
        "session",
        "drivers",
        "timing",
        "timing",
        "timing",
        "status",
        "messages",
        "car",
        "car",
        "position",
        "position",
        "loaded",
    ]
    assert {e["phase"] for e in events} == {"download"}


def test_error_codes() -> None:
    class RateLimitExceededError(Exception):
        pass

    assert error_code(EmptySessionError("403")) == "empty"
    assert error_code(requests.exceptions.ConnectionError("x")) == "network"
    assert error_code(requests.exceptions.ReadTimeout("x")) == "network"
    assert error_code(RateLimitExceededError("x")) == "ratelimit"
    assert error_code(ValueError("x")) == "failed"
    # FastF1 se traga los fallos de red: si los registró, el fallo final (vacía o genérico) es de red.
    assert error_code(EmptySessionError("vacía"), network=True) == "network"
    assert error_code(ValueError("Failed to load any schedule data."), network=True) == "network"
    # Y la causa encadenada también cuenta (load_schedule relanza con `from`).
    try:
        try:
            raise requests.exceptions.ConnectionError("sin red")
        except requests.exceptions.ConnectionError as inner:
            raise RuntimeError("No se pudo leer el calendario") from inner
    except RuntimeError as outer:
        assert error_code(outer) == "network"


def test_swallowed_network_errors_are_detected() -> None:
    """FastF1 registra el fallo de red en DEBUG con la traza y sigue: el manejador lo ve igualmente."""
    handler = attach_fastf1(None)
    try:
        try:
            raise requests.exceptions.ConnectionError("sin red")
        except requests.exceptions.ConnectionError as exc:
            logging.getLogger("fastf1.req").debug("Traceback for failure in car data", exc_info=exc)
    finally:
        detach_fastf1(handler)
    assert handler.network is True


def test_sprint_qualifying_identifier_follows_the_event() -> None:
    from trazada_pipeline.sources.fastf1_source import fastf1_identifier

    ev2023 = pd.Series({"Session1": "Practice 1", "Session2": "Qualifying", "Session3": "Sprint Shootout"})
    ev2024 = pd.Series({"Session1": "Practice 1", "Session2": "Sprint Qualifying", "Session3": "Sprint"})
    assert fastf1_identifier(ev2023, "sq") == "Sprint Shootout"
    assert fastf1_identifier(ev2024, "sq") == "Sprint Qualifying"
    assert fastf1_identifier(ev2024, "race") == "R"
    assert fastf1_identifier(pd.Series({"Session1": "Practice 1"}), "sq") == "SQ"


def _fake_report(data: Path) -> BuildReport:
    folder = data / "v1" / "sessions" / "2026" / "10-spa-francorchamps" / "fp2"
    return BuildReport(
        manifest_path=folder / "manifest.json",
        status="complete",
        sizes={"motion": 1000, "car": 2000},
        quality={},
        warnings=["aviso de prueba"],
    )


def test_build_progress_reports_steps_and_result(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    seen: dict = {}

    def fake_build(season, event, session, data, *_rest, on_loaded=None):
        seen.update(season=season, event=event, session=session, data=data)
        logging.getLogger("fastf1.core").info("Fetching car data...")
        assert on_loaded is not None
        on_loaded()
        return _fake_report(data)

    monkeypatch.setattr(cli, "_build", fake_build)
    result = CliRunner().invoke(
        cli.app, ["build", "2026", "10", "fp2", "--data", str(tmp_path), "--progress"]
    )
    assert result.exit_code == 0, result.output
    assert seen == {"season": 2026, "event": 10, "session": "fp2", "data": tmp_path}
    progress = _lines(result.stdout, "progress")
    assert [(p["pct"], p["phase"], p["step"]) for p in progress] == [
        (1, "download", "start"),
        (40, "download", "car"),
        (88, "process", "process"),
    ]
    assert _lines(result.stdout, "result") == [
        {
            "session": "2026/10-spa-francorchamps/fp2",
            "status": "complete",
            "bytes": 3000,
            "dev": False,
            "warnings": ["aviso de prueba"],
        }
    ]
    # El manejador de progreso no se queda colgado del logger de FastF1.
    assert not any(isinstance(h, FastF1ProgressHandler) for h in logging.getLogger("fastf1").handlers)


def test_build_progress_result_says_if_the_session_is_dev(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Una sesión que queda como dev (p. ej. por su circuito) lo dice en el resultado: la insignia DEV sale
    en el gestor antes de releer el catálogo."""

    def fake_build(_season, _event, _session, data, *_rest, on_loaded=None):
        report = _fake_report(data)
        report.dev = True
        return report

    monkeypatch.setattr(cli, "_build", fake_build)
    result = CliRunner().invoke(
        cli.app, ["build", "2026", "10", "fp2", "--data", str(tmp_path), "--progress"]
    )
    assert result.exit_code == 0, result.output
    assert _lines(result.stdout, "result")[0]["dev"] is True


def test_build_progress_reports_classified_errors(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    def fake_build(*_a, **_k):
        raise EmptySessionError("FastF1 devolvió una sesión vacía")

    monkeypatch.setattr(cli, "_build", fake_build)
    result = CliRunner().invoke(
        cli.app, ["build", "2026", "10", "fp2", "--data", str(tmp_path), "--progress"]
    )
    assert result.exit_code == 1
    assert _lines(result.stdout, "error") == [
        {"code": "empty", "message": "EmptySessionError: FastF1 devolvió una sesión vacía"}
    ]
    assert _lines(result.stdout, "result") == []


def test_build_progress_reports_network_when_fastf1_swallowed_it(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    def fake_build(*_a, **_k):
        try:
            raise requests.exceptions.ConnectionError("sin red")
        except requests.exceptions.ConnectionError as exc:
            logging.getLogger("fastf1.api").debug("Traceback for failure in timing data", exc_info=exc)
        raise EmptySessionError("FastF1 devolvió una sesión vacía")

    monkeypatch.setattr(cli, "_build", fake_build)
    result = CliRunner().invoke(
        cli.app, ["build", "2026", "10", "fp2", "--data", str(tmp_path), "--progress"]
    )
    assert result.exit_code == 1
    assert _lines(result.stdout, "error")[0]["code"] == "network"


def test_build_rejects_unknown_session(tmp_path: Path) -> None:
    result = CliRunner().invoke(cli.app, ["build", "2026", "10", "fp4", "--data", str(tmp_path)])
    assert result.exit_code == 2
