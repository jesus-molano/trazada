"""Radio de los equipos (D51): el stream TeamRadio del live timing y sus clips mp3.

El archivo público de cada sesión trae `TeamRadio.jsonStream` (FastF1 lo mapea como `team_radio` y se lee con
`fastf1.api.fetch_page`, como la meteorología). Cada captura trae:

- `Utc`: la hora de **publicación**. El mensaje pudo decirse unos segundos antes; el front lo dice.
- `RacingNumber`: el coche.
- `Path`: el mp3, relativo a la ruta de la sesión en el live timing.

Cada clip se descarga validando HTTP 200, el tipo (audio u octet-stream, si lo da) y los bytes mágicos
MP3/ID3, con un tope por clip y otro por sesión, y nunca fuera de la carpeta de la sesión (la ruta se valida
antes de construir la URL). Se guarda como `sessions/<id>/radio/<sha256[:16]>.mp3` y se lista en
`events.radio` con su `t` (ms de sesión, la misma normalización que dirección de carrera: `Utc - t0`). Un
clip que falla se salta y se avisa en las notas.

Uso personal y solo local (D23, D25): los clips se quedan en `data/` y nunca van a git (DATA_NOTICE.md).
Nada de transcripción: no se usa IA con datos de F1.
"""

from __future__ import annotations

import hashlib
import logging
import posixpath
import re
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pandas as pd

log = logging.getLogger(__name__)

#: Tope por clip (los de verdad pesan de 20 a 200 KB).
MAX_CLIP_BYTES = 3 * 1024 * 1024
#: Tope por sesión: una carrera trae de 100 a 250 clips.
MAX_TOTAL_BYTES = 300 * 1024 * 1024
#: Ruta de un clip: relativa, sin `..`, solo estos caracteres y en .mp3.
_PATH = re.compile(r"^[A-Za-z0-9_\-./]+\.mp3$", re.IGNORECASE)
_CAR = re.compile(r"^[0-9]{1,3}$")


@dataclass(frozen=True)
class Capture:
    """Una captura del stream: hora de publicación (ms de sesión), coche y ruta del mp3 en la sesión."""

    t_ms: int
    car: str
    path: str


@dataclass(frozen=True)
class RadioSource:
    """Lo que la fuente sabe de la radio de una sesión: sus capturas y la URL de la carpeta de la sesión."""

    captures: list[Capture]
    #: `https://livetiming.formula1.com/static/<año>/<evento>/<sesión>/` (con la barra final).
    base_url: str


@dataclass(frozen=True)
class HttpResult:
    """Respuesta de una descarga. `body` es None si no se leyó (no 200, o más grande que el tope)."""

    status: int
    content_type: str | None
    body: bytes | None
    too_big: bool = False


#: Descarga `url` sin pasar de `max_bytes`. Inyectable (los tests usan un HTTP falso).
Fetch = Callable[[str, int], HttpResult]


@dataclass
class RadioResult:
    """Clips descargados (en orden de t) y lo que no se pudo bajar."""

    clips: list[dict[str, Any]] = field(default_factory=list)
    failed: int = 0
    #: Capturas que no se intentaron porque se llegó al tope por sesión.
    capped: int = 0
    #: Capturas de la ventana de reproducción.
    total: int = 0

    @property
    def channel(self) -> str:
        """`manifest.channels.radio`: present, partial (falló alguno o el tope) o absent (ninguno)."""
        if not self.clips:
            return "absent"
        return "partial" if self.failed or self.capped else "present"


def safe_path(path: Any) -> str | None:
    """Ruta del clip si es segura (relativa, sin salir de la sesión, .mp3); si no, None."""
    if not isinstance(path, str) or not _PATH.match(path) or path.startswith("/"):
        return None
    norm = posixpath.normpath(path)
    if norm != path or norm.startswith("..") or "/../" in f"/{norm}/":
        return None
    return path


def _captures(content: Any) -> Iterable[Mapping[str, Any]]:
    """Las capturas de un mensaje: la primera vez, una lista; luego, un dict por índice ({'7': {...}})."""
    if not isinstance(content, Mapping):
        return []
    caps = content.get("Captures")
    if isinstance(caps, list):
        return [c for c in caps if isinstance(c, Mapping)]
    if isinstance(caps, Mapping):
        return [c for c in caps.values() if isinstance(c, Mapping)]
    return []


def parse_captures(entries: Any, t0: pd.Timestamp) -> list[Capture]:
    """Stream crudo (`fetch_page(api_path, 'team_radio')`: [marca, contenido] por mensaje) → capturas válidas.

    Sin hora legible, coche o ruta segura, la captura se descarta (con un aviso en el log). Una ruta repetida
    cuenta una vez. En orden de t.
    """
    if not isinstance(entries, list):
        return []
    out: dict[str, Capture] = {}
    skipped = 0
    t0 = pd.Timestamp(t0)
    if t0.tzinfo is not None:
        t0 = t0.tz_convert("UTC").tz_localize(None)
    for entry in entries:
        content = entry[1] if isinstance(entry, list | tuple) and len(entry) == 2 else entry
        for cap in _captures(content):
            path = safe_path(cap.get("Path"))
            car = str(cap.get("RacingNumber", "")).strip()
            try:
                utc = pd.Timestamp(cap.get("Utc"))
            except (TypeError, ValueError):
                utc = pd.NaT
            if path is None or not _CAR.match(car) or pd.isna(utc):
                skipped += 1
                continue
            if utc.tzinfo is not None:
                utc = utc.tz_convert("UTC").tz_localize(None)
            if path not in out:
                out[path] = Capture(t_ms=round((utc - t0).total_seconds() * 1000), car=car, path=path)
    if skipped:
        log.warning("Radio: %d capturas descartadas (sin hora, coche o ruta segura)", skipped)
    return sorted(out.values(), key=lambda c: (c.t_ms, c.path))


def is_mp3(head: bytes) -> bool:
    """¿Empieza como un mp3? Etiqueta ID3 o la sincronía de una trama MPEG."""
    return head[:3] == b"ID3" or (len(head) >= 2 and head[0] == 0xFF and (head[1] & 0xE0) == 0xE0)


def _audio_type(content_type: str | None) -> bool:
    """Sin cabecera, audio o binario genérico: vale (deciden los bytes mágicos). Una página de error, no."""
    if not content_type:
        return True
    ct = content_type.split(";", 1)[0].strip().lower()
    return ct.startswith("audio/") or ct in ("application/octet-stream", "binary/octet-stream")


def download(
    source: RadioSource,
    folder: Path,
    fetch: Fetch,
    *,
    start_ms: int,
    end_ms: int,
    on_clip: Callable[[int, int], None] | None = None,
    max_clip: int = MAX_CLIP_BYTES,
    max_total: int = MAX_TOTAL_BYTES,
) -> RadioResult:
    """Descarga los clips de la ventana de reproducción a `folder/radio/` y los lista para `events.radio`."""
    caps = [c for c in source.captures if start_ms <= c.t_ms <= end_ms]
    result = RadioResult(total=len(caps))
    spent = 0
    for i, cap in enumerate(caps):
        if spent >= max_total:
            result.capped = len(caps) - i
            log.warning("Radio: tope de %d MB por sesión; %d clips sin bajar", max_total >> 20, result.capped)
            break
        url = source.base_url + cap.path
        try:
            res = fetch(url, max_clip)
        except Exception as exc:  # red, tiempo de espera…
            log.warning("Radio: %s: %s", cap.path, exc)
            res = None
        body = res.body if res is not None else None
        if (
            res is None
            or res.status != 200
            or res.too_big
            or body is None
            or len(body) == 0
            or len(body) > max_clip
            or not _audio_type(res.content_type)
            or not is_mp3(body[:4])
        ):
            result.failed += 1
            if res is not None:
                log.warning("Radio: %s descartado (HTTP %s, %s)", cap.path, res.status, res.content_type)
        else:
            digest = hashlib.sha256(body).hexdigest()[:16]
            radio_dir = folder / "radio"
            radio_dir.mkdir(parents=True, exist_ok=True)
            out = radio_dir / f"{digest}.mp3"
            if not out.exists() or out.stat().st_size != len(body):
                out.write_bytes(body)
            result.clips.append(
                {"t": int(cap.t_ms), "car": cap.car, "file": f"radio/{digest}.mp3", "bytes": len(body)}
            )
            spent += len(body)
        if on_clip is not None:
            on_clip(i + 1, len(caps))
    return result


def http_fetch(url: str, max_bytes: int, *, timeout: float = 20.0) -> HttpResult:
    """Descarga real (requests, en trozos): para en cuanto pasa del tope. Solo https al live timing."""
    import requests

    if not url.startswith("https://livetiming.formula1.com/static/"):
        raise ValueError(f"URL de radio fuera del live timing: {url}")
    headers = {"User-Agent": "BestHTTP", "Accept-Encoding": "gzip, identity"}
    with requests.get(url, stream=True, timeout=timeout, headers=headers) as r:
        ct = r.headers.get("Content-Type")
        if r.status_code != 200:
            return HttpResult(r.status_code, ct, None)
        length = r.headers.get("Content-Length")
        if length and length.isdigit() and int(length) > max_bytes:
            return HttpResult(200, ct, None, too_big=True)
        buf = bytearray()
        for chunk in r.iter_content(64 * 1024):
            buf += chunk
            if len(buf) > max_bytes:
                return HttpResult(200, ct, None, too_big=True)
        return HttpResult(200, ct, bytes(buf))
