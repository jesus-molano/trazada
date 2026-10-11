"""Sonda del feed (`trazada probe-feed`, R4): decodificación y resumen con mensajes sintéticos, sin red."""

from __future__ import annotations

import base64
import json
import zlib
from typing import Any

import fastf1.api
import pytest
from typer.testing import CliRunner

from trazada_pipeline import cli, feedprobe
from trazada_pipeline.feedprobe import (
    CONSUMED_PAGES,
    KNOWN_CAR_CHANNELS,
    FeedDecodeError,
    consumed_topics,
    decode_z,
    feed_topics,
    format_report,
    known_topics,
    probe,
    scan_car_data,
    scan_race_control,
    verdict,
)

PAGES = dict(fastf1.api.pages)
#: Canales que llegan en 2026 (sin el 45).
CH_2026 = {"0": 11000, "2": 287, "3": 7, "4": 100, "5": 0}


def z(obj: Any) -> str:
    """Mensaje `.z` como lo publica F1: json, deflate crudo, base64 y entre comillas."""
    deflate = zlib.compressobj(9, zlib.DEFLATED, -zlib.MAX_WBITS)
    raw = deflate.compress(json.dumps(obj).encode()) + deflate.flush()
    return '"' + base64.b64encode(raw).decode() + '"'


def car_line(t: str, cars: dict[str, dict[str, Any]], entries: int = 2) -> str:
    """Línea de `CarData.z.jsonStream`: sello de 12 caracteres y mensaje con `entries` instantes."""
    msg = {
        "Entries": [
            {"Utc": f"2026-07-19T13:00:0{i}.000Z", "Cars": {c: {"Channels": ch} for c, ch in cars.items()}}
            for i in range(entries)
        ]
    }
    return t + z(msg)


def index(*topics: str) -> dict[str, Any]:
    return {"Feeds": {t: {"KeyFramePath": f"{t}.json", "StreamPath": f"{t}.jsonStream"} for t in topics}}


def rc_line(*texts: str, as_dict: bool = False) -> list[Any]:
    msgs = [{"Utc": "2026-07-19T13:00:00", "Category": "Other", "Message": t} for t in texts]
    return ["00:00:01.000", {"Messages": {str(i): m for i, m in enumerate(msgs)} if as_dict else msgs}]


# --- decodificación ---


def test_decode_z_como_fastf1() -> None:
    obj = {"Entries": [{"Cars": {"1": {"Channels": CH_2026}}}]}
    assert decode_z(z(obj)) == obj
    assert fastf1.api.parse(z(obj), zipped=True) == obj  # la misma lectura que FastF1
    assert decode_z('{"a": 1}') == {"a": 1}  # json sin comprimir, como en FastF1


@pytest.mark.parametrize(
    "payload", ['"%%%no-base64%%%"', '"' + base64.b64encode(b"no es deflate").decode() + '"', "{roto"]
)
def test_decode_z_ilegible(payload: str) -> None:
    with pytest.raises(FeedDecodeError):
        decode_z(payload)


def test_decode_z_con_tope_de_tamano() -> None:
    """Una «bomba» (mucho más grande al descomprimir) no se expande entera: se rechaza."""
    big = z({"x": "0" * 100_000})
    assert decode_z(big)["x"] == "0" * 100_000
    with pytest.raises(FeedDecodeError, match="bytes al descomprimir"):
        decode_z(big, max_bytes=1000)


# --- temas ---


def test_temas_del_indice() -> None:
    assert feed_topics(index("SessionInfo", "CarData.z", "TimingData")) == [
        "CarData.z",
        "SessionInfo",
        "TimingData",
    ]
    # El nombre sale del StreamPath, como en OpenF1; sin él, de la clave.
    assert feed_topics({"Feeds": {"X": {"StreamPath": "Y.jsonStream"}, "Z": {}}}) == ["Y", "Z"]
    for bad in (None, [], {"Meetings": []}, {"Feeds": ["a"]}):
        assert feed_topics(bad) == []


def test_temas_que_lee_el_pipeline() -> None:
    assert set(CONSUMED_PAGES) <= set(PAGES)  # páginas reales de FastF1
    consumed = consumed_topics(PAGES)
    assert {
        "CarData.z",
        "Position.z",
        "TimingData",
        "TimingAppData",
        "RaceControlMessages",
        "WeatherData",
    } <= consumed
    assert consumed <= known_topics(PAGES)
    assert "Index" not in known_topics(PAGES)


# --- CarData.z ---


def test_cardata_2026_sin_canales_nuevos() -> None:
    lines = [car_line(f"00:00:0{i}.000", {"1": CH_2026, "44": CH_2026}) for i in range(3)]
    stats = scan_car_data(lines)
    assert (stats.total, stats.read, stats.errors, stats.samples) == (3, 3, 0, 12)
    assert stats.per_car == {"1": {"0", "2", "3", "4", "5"}, "44": {"0", "2", "3", "4", "5"}}
    assert stats.new_channels == []
    assert stats.channel_samples["45"] == 0
    report = probe(fetcher(car=lines), PAGES)
    assert verdict(report) == "resultado: sin canales nuevos"
    text = "\n".join(format_report(report, "2026 · Belgian Grand Prix · Race", "/static/x/"))
    assert "canal 45 (DRS): ausente en las 12 muestras" in text
    assert "por coche: {0, 2, 3, 4, 5} en 2 coches (1, 44)" in text


def test_cardata_con_canal_nuevo_y_drs_a_cero() -> None:
    """Un canal que nadie conoce (aquí el 46, en un solo coche) sale en el resultado con sus valores."""
    lines = [
        car_line("00:00:01.000", {"1": {**CH_2026, "45": 0, "46": 1}, "44": {**CH_2026, "45": 0}}),
        car_line("00:00:02.000", {"1": {**CH_2026, "45": None, "46": 2}, "44": CH_2026}),
    ]
    stats = scan_car_data(lines)
    assert stats.new_channels == ["46"]
    assert stats.cars_with("46") == ["1"]
    assert dict(stats.values["45"]) == {"0": 4, "null": 2}
    assert dict(stats.values["46"]) == {"1": 2, "2": 2}
    report = probe(fetcher(car=lines), PAGES)
    assert verdict(report) == "resultado: canales nuevos: 46 (en 1 coches)"
    text = "\n".join(format_report(report, "s", "p"))
    assert "canal 45 (DRS): presente en 6 muestras (0: 4, null: 2); ausente en 2" in text
    assert "canal 46 (nuevo): valores 1: 2, 2: 2" in text
    assert "46 (nuevo): 4" in text


def test_cardata_muestra_ilegibles_y_valores_raros() -> None:
    many = {**CH_2026, "99": "x"}
    lines = [
        "corta",
        "00:00:00.000" + '"%%%"',
        "00:00:00.000" + z({"sin": "Entries"}),
        *[car_line(f"00:00:{i:02d}.000", {"7": {**many, "99": f"v{i}"}}, entries=1) for i in range(20)],
    ]
    stats = scan_car_data(lines, max_records=10)
    assert (stats.total, stats.read, stats.errors) == (23, 10, 3)
    assert stats.samples == 7
    stats = scan_car_data(lines)
    # Hasta MAX_DISTINCT_VALUES valores distintos; el resto, en «otros».
    assert len(stats.values["99"]) == feedprobe.MAX_DISTINCT_VALUES
    assert stats.other_values["99"] == 20 - feedprobe.MAX_DISTINCT_VALUES
    text = "\n".join(format_report(probe(fetcher(car=lines), PAGES), "s", "p"))
    assert "otros: 8" in text


def test_lo_del_feed_se_escapa_al_imprimir() -> None:
    evil = "Aero\x1b[2J\nOVERTAKE"
    lines = [car_line("00:00:01.000", {evil: {**CH_2026, evil: 1}}, entries=1)]
    report = probe(fetcher(car=lines, idx=index("CarData.z", evil)), PAGES)
    text = "\n".join(format_report(report, "s", "p"))
    assert "\x1b" not in text
    assert all("\n" not in line for line in format_report(report, "s", "p"))
    assert repr(evil[:8]) in text


# --- dirección de carrera ---


def test_mensajes_de_overtake_y_drs() -> None:
    records = [
        rc_line("OVERTAKE ENABLED", "GREEN LIGHT - PIT EXIT OPEN"),
        rc_line("OVERTAKE DISABLED", "OVERTAKE ENABLED", as_dict=True),
        rc_line("DRS DISABLED IN ZONE 2"),
        ["mal", None],
    ]
    counts = scan_race_control(records)
    assert dict(counts) == {
        "overtake_enabled": 2,
        "overtake_disabled": 1,
        "drs_enabled": 0,
        "drs_disabled": 1,
    }


# --- informe completo y CLI ---


def fetcher(
    car: list[str] | None = None,
    idx: Any = "default",
    rc: list[Any] | None = None,
) -> Any:
    pages = {
        "index": index("SessionInfo", "CarData.z", "Position.z", "DriverRaceInfo", "ActiveAero")
        if idx == "default"
        else idx,
        "car_data": car,
        "race_control_messages": rc if rc is not None else [rc_line("OVERTAKE ENABLED")],
    }
    return lambda name: pages[name]


def test_informe_de_temas() -> None:
    lines = [car_line("00:00:01.000", {"1": CH_2026})]
    text = "\n".join(format_report(probe(fetcher(car=lines), PAGES), "s", "p"))
    assert "temas:      5 publicados" in text
    assert "los lee el pipeline (3): CarData.z, Position.z, SessionInfo" in text
    assert "no los lee (2): ActiveAero, DriverRaceInfo" in text
    assert "FastF1 no los conoce (2): ActiveAero, DriverRaceInfo" in text
    assert "el pipeline los lee y no están publicados:" in text
    assert "OVERTAKE ENABLED: 1 · OVERTAKE DISABLED: 0 · DRS ENABLED: 0 · DRS DISABLED: 0" in text


def test_sin_indice_ni_mensajes_sigue_con_cardata() -> None:
    lines = [car_line("00:00:01.000", {"1": CH_2026})]
    report = probe(lambda name: lines if name == "car_data" else None, PAGES)
    text = format_report(report, "s", "p")
    assert any(line.startswith("temas:      sin Index.json — sin respuesta") for line in text)
    assert any(line.startswith("dirección de carrera: sin mensajes") for line in text)
    assert text[-1] == "resultado: sin canales nuevos"


def test_un_fallo_de_red_no_rompe_la_sonda() -> None:
    def fetch(name: str) -> Any:
        raise ConnectionError("403 Forbidden")

    report = probe(fetch, PAGES)
    assert report.car is None
    assert report.errors["car_data"].startswith("ConnectionError: ")
    assert verdict(report).startswith("resultado: sin datos")


def _patch_session(monkeypatch: pytest.MonkeyPatch, fetch: Any) -> list[tuple[Any, ...]]:
    calls: list[tuple[Any, ...]] = []

    def fake_open(season: int, event: Any, session: str, cache_dir: Any, *, offline: bool = False) -> Any:
        calls.append((season, event, session, offline))
        return "2026 · Belgian Grand Prix · Race", "/static/2026/x/y/", fetch, PAGES

    monkeypatch.setattr(feedprobe, "open_session", fake_open)
    return calls


def test_cli_probe_feed(monkeypatch: pytest.MonkeyPatch) -> None:
    lines = [car_line("00:00:01.000", {"1": CH_2026, "16": CH_2026})]
    calls = _patch_session(monkeypatch, fetcher(car=lines))
    result = CliRunner().invoke(cli.app, ["probe-feed", "2026", "10", "race", "--offline"])
    assert result.exit_code == 0, result.output
    assert calls == [(2026, 10, "race", True)]
    out = result.stdout.splitlines()
    assert out[0] == "sesión:     2026 · Belgian Grand Prix · Race"
    assert out[-1] == "resultado: sin canales nuevos"
    assert "conocidos: " + ", ".join(f"{k} {v}" for k, v in KNOWN_CAR_CHANNELS.items()) in result.stdout


def test_cli_probe_feed_con_canales_nuevos_sale_con_0(monkeypatch: pytest.MonkeyPatch) -> None:
    lines = [car_line("00:00:01.000", {"1": {**CH_2026, "50": 3}})]
    _patch_session(monkeypatch, fetcher(car=lines))
    result = CliRunner().invoke(cli.app, ["probe-feed", "2026", "Belgian Grand Prix", "race"])
    assert result.exit_code == 0, result.output
    assert result.stdout.splitlines()[-1] == "resultado: canales nuevos: 50 (en 1 coches)"


def test_cli_probe_feed_sin_cardata_falla(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_session(monkeypatch, lambda name: None)
    result = CliRunner().invoke(cli.app, ["probe-feed", "2026", "10", "race"])
    assert result.exit_code == 1
    assert "IP residencial" in result.stderr


def test_cli_probe_feed_valida_la_sesion() -> None:
    result = CliRunner().invoke(cli.app, ["probe-feed", "2026", "10", "warmup"])
    assert result.exit_code == 2
