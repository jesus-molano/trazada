"""Radio de los equipos (D51) con un jsonStream sintético y un HTTP falso: capturas, validación de cada clip
(HTTP 200, tipo, bytes mágicos, topes, ruta dentro de la sesión) y su paso por `build_session`."""

from __future__ import annotations

import gzip
import hashlib
import json
from pathlib import Path

import pandas as pd
from synthetic import synthetic_session

from trazada_pipeline import radio, schema
from trazada_pipeline.build import build_session, playback_window
from trazada_pipeline.radio import Capture, HttpResult, RadioSource

T0 = pd.Timestamp("2026-05-24T13:00:00Z")
BASE = "https://livetiming.formula1.com/static/2026/2026-05-24_X/2026-05-24_Race/"
MP3 = b"ID3\x04\x00\x00" + bytes(2000)
FRAME = b"\xff\xfb\x90\x00" + bytes(1500)


def utc(ms: int) -> str:
    return (T0 + pd.to_timedelta(ms, unit="ms")).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def stream() -> list:
    """Como lo devuelve `fetch_page`: la primera vez una lista de capturas; luego, un dict por índice."""
    return [
        [
            "00:01:00.000",
            {
                "Captures": [
                    {"Utc": utc(60_500), "RacingNumber": "44", "Path": "TeamRadio/LEWHAM01_44_x.mp3"},
                    {"Utc": utc(90_000), "RacingNumber": "1", "Path": "TeamRadio/MAXVER01_1_x.mp3"},
                ]
            },
        ],
        [
            "00:02:00.000",
            {
                "Captures": {
                    "2": {"Utc": utc(120_250), "RacingNumber": "16", "Path": "TeamRadio/CHALEC01_16_x.mp3"}
                }
            },
        ],
        # Repetida, peligrosa, sin coche, sin hora y no mp3: fuera.
        [
            "00:02:10.000",
            {
                "Captures": {
                    "3": {"Utc": utc(90_000), "RacingNumber": "1", "Path": "TeamRadio/MAXVER01_1_x.mp3"}
                }
            },
        ],
        [
            "00:02:20.000",
            {"Captures": [{"Utc": utc(130_000), "RacingNumber": "4", "Path": "../../secret.mp3"}]},
        ],
        [
            "00:02:30.000",
            {"Captures": [{"Utc": utc(140_000), "RacingNumber": "HAM", "Path": "TeamRadio/a.mp3"}]},
        ],
        ["00:02:40.000", {"Captures": [{"Utc": "nunca", "RacingNumber": "4", "Path": "TeamRadio/b.mp3"}]}],
        [
            "00:02:50.000",
            {"Captures": [{"Utc": utc(150_000), "RacingNumber": "4", "Path": "TeamRadio/c.wav"}]},
        ],
        ["00:03:00.000", "basura"],
    ]


def test_captures_from_the_stream_with_session_time_like_race_control() -> None:
    caps = radio.parse_captures(stream(), T0)
    assert caps == [
        Capture(60_500, "44", "TeamRadio/LEWHAM01_44_x.mp3"),
        Capture(90_000, "1", "TeamRadio/MAXVER01_1_x.mp3"),
        Capture(120_250, "16", "TeamRadio/CHALEC01_16_x.mp3"),
    ]
    assert radio.parse_captures(None, T0) == []
    assert radio.parse_captures({"Captures": []}, T0) == []


def test_only_relative_mp3_paths_inside_the_session() -> None:
    assert radio.safe_path("TeamRadio/LEWHAM01_44_20230305_153245.mp3")
    for bad in [
        "../x.mp3",
        "TeamRadio/../../x.mp3",
        "/abs.mp3",
        "https://evil/x.mp3",
        "TeamRadio/./x.mp3",
        "x.mp3?a=1",
        "a b.mp3",
        "x.wav",
        None,
        3,
    ]:
        assert radio.safe_path(bad) is None, bad


def test_mp3_magic_bytes() -> None:
    assert radio.is_mp3(MP3[:4])
    assert radio.is_mp3(FRAME[:4])
    assert not radio.is_mp3(b"<!DO")
    assert not radio.is_mp3(b"RIFF")
    assert not radio.is_mp3(b"")


class FakeHttp:
    """HTTP falso: una respuesta por URL (si no, 404) y registro de lo pedido."""

    def __init__(self, responses: dict[str, HttpResult]) -> None:
        self.responses = responses
        self.asked: list[tuple[str, int]] = []

    def __call__(self, url: str, max_bytes: int) -> HttpResult:
        self.asked.append((url, max_bytes))
        res = self.responses.get(url, HttpResult(404, "text/html", None))
        if isinstance(res.body, bytes) and len(res.body) > max_bytes:
            return HttpResult(200, res.content_type, None, too_big=True)
        return res


def source(paths: list[str], t: int = 200_000) -> RadioSource:
    return RadioSource([Capture(t + i * 1000, str(10 + i), p) for i, p in enumerate(paths)], BASE)


def test_download_validates_each_clip_and_skips_the_bad_ones(tmp_path: Path) -> None:
    http = FakeHttp(
        {
            BASE + "TeamRadio/ok.mp3": HttpResult(200, "audio/mpeg", MP3),
            BASE + "TeamRadio/frame.mp3": HttpResult(200, None, FRAME),
            BASE + "TeamRadio/html.mp3": HttpResult(200, "text/html", MP3),
            BASE + "TeamRadio/notmp3.mp3": HttpResult(200, "audio/mpeg", b"<html>nope</html>"),
            BASE + "TeamRadio/big.mp3": HttpResult(200, "audio/mpeg", MP3 + bytes(5000)),
            BASE + "TeamRadio/empty.mp3": HttpResult(200, "audio/mpeg", b""),
        }
    )
    paths = ["ok.mp3", "frame.mp3", "missing.mp3", "html.mp3", "notmp3.mp3", "big.mp3", "empty.mp3"]
    steps: list[tuple[int, int]] = []
    got = radio.download(
        source([f"TeamRadio/{p}" for p in paths]),
        tmp_path,
        http,
        start_ms=0,
        end_ms=10**9,
        on_clip=lambda done, total: steps.append((done, total)),
        max_clip=4000,
    )
    assert [c["car"] for c in got.clips] == ["10", "11"]
    assert got.failed == 5 and got.total == 7 and got.capped == 0
    assert got.channel == "partial"
    assert steps[-1] == (7, 7) and len(steps) == 7
    assert all(max_bytes == 4000 for _, max_bytes in http.asked)
    # Por contenido, junto a la sesión y nada más en la carpeta.
    clip = got.clips[0]
    assert clip == {
        "t": 200_000,
        "car": "10",
        "file": f"radio/{hashlib.sha256(MP3).hexdigest()[:16]}.mp3",
        "bytes": len(MP3),
    }
    assert (tmp_path / clip["file"]).read_bytes() == MP3
    assert sorted(p.name for p in (tmp_path / "radio").iterdir()) == sorted(
        Path(c["file"]).name for c in got.clips
    )


def test_download_window_total_cap_and_network_errors(tmp_path: Path) -> None:
    def boom(url: str, max_bytes: int) -> HttpResult:
        raise TimeoutError("sin red")

    caps = source(["TeamRadio/a.mp3"])
    assert radio.download(caps, tmp_path, boom, start_ms=0, end_ms=10**9).channel == "absent"
    # Fuera de la ventana de reproducción, ni se pide.
    http = FakeHttp({})
    assert radio.download(caps, tmp_path, http, start_ms=0, end_ms=100).total == 0
    assert http.asked == []
    # Tope por sesión: los que quedan no se piden y cuentan como que faltan.
    ok = FakeHttp(
        {BASE + f"TeamRadio/{i}.mp3": HttpResult(200, "audio/mpeg", MP3 + bytes([i])) for i in range(5)}
    )
    got = radio.download(
        source([f"TeamRadio/{i}.mp3" for i in range(5)]),
        tmp_path,
        ok,
        start_ms=0,
        end_ms=10**9,
        max_total=2 * (len(MP3) + 1) + 1,
    )
    assert len(got.clips) == 3 and got.capped == 2 and len(ok.asked) == 3
    assert got.channel == "partial"


def test_the_real_http_only_goes_to_the_live_timing() -> None:
    try:
        radio.http_fetch("https://example.com/static/x.mp3", 10)
    except ValueError:
        pass
    else:
        raise AssertionError("debería negarse")


def _events(manifest_path: Path) -> dict:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    return json.loads(
        gzip.decompress((manifest_path.parent / manifest["files"]["events"]["path"]).read_bytes())
    )


def test_build_lists_the_clips_in_events_and_the_channel(tmp_path: Path) -> None:
    data, _ = synthetic_session()
    start, _, _ = playback_window(data)
    paths = [f"TeamRadio/{n}.mp3" for n in ("a", "b", "c")]
    data.radio = RadioSource([Capture(start + 10_000 * (i + 1), "1", p) for i, p in enumerate(paths)], BASE)
    http = FakeHttp(
        {BASE + p: HttpResult(200, "audio/mpeg", MP3 + bytes([i])) for i, p in enumerate(paths[:2])}
    )
    report = build_session(data, tmp_path, radio_fetch=http)
    manifest = json.loads(report.manifest_path.read_text(encoding="utf-8"))
    assert manifest["schemaVersion"] == schema.schema_version() == "1.2.0"
    assert manifest["channels"]["radio"] == "partial"
    notes = {n["code"]: n for n in manifest["quality"]["notes"]}
    assert notes["radio-partial"]["params"] == {"missing": 1, "total": 3}
    events = _events(report.manifest_path)
    schema.validate("events", events)
    assert [c["t"] for c in events["radio"]] == [start + 10_000, start + 20_000]
    for c in events["radio"]:
        assert (report.manifest_path.parent / c["file"]).stat().st_size == c["bytes"]


def test_build_without_radio_or_with_no_radio(tmp_path: Path) -> None:
    data, _ = synthetic_session()
    report = build_session(data, tmp_path / "a")
    manifest = json.loads(report.manifest_path.read_text(encoding="utf-8"))
    assert manifest["channels"]["radio"] == "absent"
    assert "radio" not in _events(report.manifest_path)
    assert all(n["code"] != "radio-skipped" for n in manifest["quality"]["notes"])

    start, _, _ = playback_window(data)
    data.radio = RadioSource([Capture(start + 1000, "1", "TeamRadio/a.mp3")], BASE)
    report = build_session(data, tmp_path / "b", radio_skipped="offline")
    manifest = json.loads(report.manifest_path.read_text(encoding="utf-8"))
    assert manifest["channels"]["radio"] == "absent"
    assert {n["code"]: n.get("params") for n in manifest["quality"]["notes"]}["radio-skipped"] == {
        "reason": "offline"
    }
    assert not (report.manifest_path.parent / "radio").exists()
