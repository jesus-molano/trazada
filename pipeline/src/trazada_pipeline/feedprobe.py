"""Sonda del feed de live timing (`trazada probe-feed`, riesgo R4 del plan).

¿Publica el archivo de live timing algo del reglamento de 2026 (aerodinámica activa, modo adelantamiento,
Boost, energía) que el pipeline no lea? Con la misma función de FastF1 que usa el pipeline
(`fastf1.api.fetch_page`, con su caché HTTP: una sesión ya descargada no se vuelve a pedir) lee de la sesión:

- el `Index.json`, que lista los temas publicados (`Feeds`, cada uno con su `StreamPath`, como lo lee OpenF1);
- el `CarData.z`: los canales que trae cada coche frente a los conocidos (`KNOWN_CAR_CHANNELS`) y lo que vale
  el 45, el del antiguo DRS (en 2026 FastF1 lo rellena con 0 si no llega);
- los mensajes de dirección de carrera: cuántos `OVERTAKE`/`DRS` `ENABLED`/`DISABLED` hay (con el parser del
  pipeline).

Lo descargado no es de fiar: solo base64, zlib con tope de tamaño y json (nada de pickle ni eval), y lo que se
imprime del feed (nombres de temas, ids de canal, valores) se escapa y se recorta.
"""

from __future__ import annotations

import base64
import binascii
import json
import re
import zlib
from collections import Counter
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

#: Canales de `CarData.z` que conocen FastF1 y OpenF1 (los que lee el pipeline). El 45 era el DRS: desde 2026
#: no llega (FastF1 lo lee con `Channels.get('45', 0)`).
KNOWN_CAR_CHANNELS: dict[str, str] = {
    "0": "rpm",
    "2": "velocidad",
    "3": "marcha",
    "4": "acelerador",
    "5": "freno",
    "45": "DRS",
}
DRS_CHANNEL = "45"

#: Páginas de FastF1 (`fastf1.api.pages`) que lee el pipeline: las de `Session.load` con vueltas, telemetría y
#: mensajes, la lista de pilotos y la meteorología en crudo (`fastf1_source.load_fastf1`).
CONSUMED_PAGES = (
    "session_info",
    "driver_list",
    "timing_data",
    "timing_app_data",
    "track_status",
    "session_status",
    "lap_count",
    "race_control_messages",
    "weather_data",
    "car_data",
    "position",
)

#: Tope de un mensaje descomprimido: uno de `CarData.z` ocupa unos KB. Más es un feed roto (o una bomba zip).
MAX_INFLATED_BYTES = 8 * 1024 * 1024
#: Valores distintos que se guardan por canal (el resto se cuenta en «otros»).
MAX_DISTINCT_VALUES = 12
#: Longitud del sello de tiempo de cada línea de un `.jsonStream` (`00:00:00.000`), como en FastF1.
TIMESTAMP_LEN = 12
#: Mensajes de dirección de carrera que se cuentan (tipos del parser del pipeline, `racecontrol.parser`).
RC_KINDS = ("overtake_enabled", "overtake_disabled", "drs_enabled", "drs_disabled", "straight_mode")

Fetcher = Callable[[str], Any]
"""Página de FastF1 (`index`, `car_data`…) → lo que devuelve `fastf1.api.fetch_page` (None si falla)."""


class FeedDecodeError(ValueError):
    """Un mensaje del feed no se puede leer (base64, zlib o json inválidos, o demasiado grande)."""


def topic_of(stream_path: str) -> str:
    """`CarData.z.jsonStream` → `CarData.z` (el nombre del tema, como en `Index.json` y en OpenF1)."""
    for suffix in (".jsonStream", ".json"):
        if stream_path.endswith(suffix):
            return stream_path[: -len(suffix)]
    return stream_path


def known_topics(pages: Mapping[str, str]) -> set[str]:
    """Temas que conoce FastF1 (`fastf1.api.pages`), sin el `Index` de la propia sesión."""
    return {topic_of(p) for name, p in pages.items() if name != "index"}


def consumed_topics(pages: Mapping[str, str]) -> set[str]:
    """Temas que lee el pipeline (`CONSUMED_PAGES`)."""
    return {topic_of(pages[name]) for name in CONSUMED_PAGES}


def safe(value: object, limit: int = 32) -> str:
    """Texto del feed apto para imprimir: tal cual si es un nombre sencillo; si no, recortado y con `repr`."""
    text = value if isinstance(value, str) else str(value)
    if re.fullmatch(rf"[\w.\-]{{1,{limit}}}", text, flags=re.ASCII):
        return text
    return repr(text[:limit])


def feed_topics(index: Any) -> list[str]:
    """Temas de un `Index.json` de sesión (`{"Feeds": {nombre: {"StreamPath": …}}}`), ordenados."""
    feeds = index.get("Feeds") if isinstance(index, dict) else None
    if not isinstance(feeds, dict):
        return []
    topics = set()
    for name, info in feeds.items():
        path = info.get("StreamPath") if isinstance(info, dict) else None
        topics.add(topic_of(path) if isinstance(path, str) and path else str(name))
    return sorted(topics, key=str.casefold)


def decode_z(payload: str, max_bytes: int = MAX_INFLATED_BYTES) -> Any:
    """Mensaje `.z` (json comprimido con deflate crudo y en base64, entre comillas) → objeto json.

    Igual que `fastf1.api.parse(…, zipped=True)`, pero con tope de tamaño al descomprimir.
    """
    text = payload.strip()
    if text.startswith("{"):
        try:
            return json.loads(text)
        except json.JSONDecodeError as exc:
            raise FeedDecodeError(f"json: {exc}") from None
    text = text.strip('"')
    try:
        raw = base64.b64decode(text)
    except (binascii.Error, ValueError) as exc:
        raise FeedDecodeError(f"base64: {exc}") from None
    inflater = zlib.decompressobj(-zlib.MAX_WBITS)
    try:
        out = inflater.decompress(raw, max_bytes)
    except zlib.error as exc:
        raise FeedDecodeError(f"zlib: {exc}") from None
    if inflater.unconsumed_tail:
        raise FeedDecodeError(f"más de {max_bytes} bytes al descomprimir")
    try:
        return json.loads(out.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise FeedDecodeError(f"json: {exc}") from None
    except RecursionError:
        # Dato no fiable: un json anidado sin fin no puede tumbar la sonda; cuenta como ilegible.
        raise FeedDecodeError("json: anidado demasiado profundo") from None


def value_key(value: object) -> str:
    """Valor de un canal como texto corto para contarlo (`null` si llega vacío)."""
    if value is None:
        return "null"
    if isinstance(value, bool | int | float):
        return json.dumps(value)
    if isinstance(value, str):
        return safe(value, 16)
    return f"<{type(value).__name__}>"


@dataclass
class CarDataStats:
    """Lo que trae `CarData.z`: canales por coche y valores de los que no son los de siempre (y del 45)."""

    total: int = 0
    """Mensajes del stream."""
    read: int = 0
    """Mensajes que se han intentado leer (todos, o `max_records`)."""
    errors: int = 0
    """Mensajes ilegibles."""
    samples: int = 0
    """Muestras: un coche en un instante."""
    channel_samples: Counter[str] = field(default_factory=Counter)
    """Muestras en que aparece cada canal."""
    per_car: dict[str, set[str]] = field(default_factory=dict)
    """Canales vistos en cada coche."""
    values: dict[str, Counter[str]] = field(default_factory=dict)
    """Valores (como texto) de los canales nuevos y del 45 (`MAX_DISTINCT_VALUES` por canal)."""
    other_values: Counter[str] = field(default_factory=Counter)
    """Muestras de cada canal con un valor que ya no cupo en `values`."""

    @property
    def new_channels(self) -> list[str]:
        return sort_channels(set(self.channel_samples) - set(KNOWN_CAR_CHANNELS))

    def cars_with(self, channel: str) -> list[str]:
        return sort_channels({car for car, chans in self.per_car.items() if channel in chans})


def sort_channels(ids: Iterable[str]) -> list[str]:
    """Ids de canal o de coche en orden numérico (los que no son números, detrás y por texto)."""
    return sorted(ids, key=lambda s: (0, int(s), "") if s.isdigit() else (1, 0, s))


def _count_value(stats: CarDataStats, channel: str, value: object) -> None:
    counter = stats.values.setdefault(channel, Counter())
    key = value_key(value)
    if key in counter or len(counter) < MAX_DISTINCT_VALUES:
        counter[key] += 1
    else:
        stats.other_values[channel] += 1


def scan_entries(stats: CarDataStats, message: Any) -> None:
    """Suma a `stats` un mensaje de `CarData.z` ya decodificado.

    Forma: `{"Entries": [{"Cars": {coche: {"Channels": {id: valor}}}}]}`. Sin `Entries`, cuenta como ilegible.
    """
    entries = message.get("Entries") if isinstance(message, dict) else None
    if not isinstance(entries, list):
        raise FeedDecodeError("sin «Entries»")
    for entry in entries:
        cars = entry.get("Cars") if isinstance(entry, dict) else None
        if not isinstance(cars, dict):
            continue
        for car, data in cars.items():
            channels = data.get("Channels") if isinstance(data, dict) else None
            if not isinstance(channels, dict):
                continue
            car_id = safe(car, 8)
            seen = stats.per_car.setdefault(car_id, set())
            stats.samples += 1
            for raw_id, value in channels.items():
                ch = safe(raw_id, 8)
                seen.add(ch)
                stats.channel_samples[ch] += 1
                if ch == DRS_CHANNEL or ch not in KNOWN_CAR_CHANNELS:
                    _count_value(stats, ch, value)


def scan_car_data(records: Iterable[str], max_records: int | None = None) -> CarDataStats:
    """Lee las líneas crudas de `CarData.z.jsonStream` (sello de 12 caracteres y mensaje `.z`).

    `max_records`: lee solo los primeros N mensajes (una muestra); None, todos.
    """
    stats = CarDataStats()
    for line in records:
        stats.total += 1
        if max_records is not None and stats.read >= max_records:
            continue
        stats.read += 1
        if not isinstance(line, str) or len(line) <= TIMESTAMP_LEN:
            stats.errors += 1
            continue
        try:
            scan_entries(stats, decode_z(line[TIMESTAMP_LEN:]))
        except FeedDecodeError:
            stats.errors += 1
    return stats


def scan_race_control(records: Iterable[Any]) -> Counter[str]:
    """Cuenta los `RC_KINDS` de `RaceControlMessages` (líneas `[sello, {"Messages": …}]` de FastF1)."""
    from trazada_pipeline.racecontrol.parser import parse

    counts: Counter[str] = Counter({kind: 0 for kind in RC_KINDS})
    for rec in records:
        body = rec[1] if isinstance(rec, list | tuple) and len(rec) == 2 else None
        messages = body.get("Messages") if isinstance(body, dict) else None
        if isinstance(messages, dict):
            messages = list(messages.values())
        if not isinstance(messages, list):
            continue
        for msg in messages:
            text = msg.get("Message") if isinstance(msg, dict) else None
            if isinstance(text, str):
                kind = parse(text).kind
                if kind in counts:
                    counts[kind] += 1
    return counts


@dataclass
class ProbeReport:
    topics: list[str] | None
    """Temas del `Index.json` (None si no se pudo leer)."""
    car: CarDataStats | None
    """None si no se pudo leer `CarData.z` (la sonda falla)."""
    race_control: Counter[str] | None
    consumed: set[str]
    known: set[str]
    errors: dict[str, str] = field(default_factory=dict)
    """Página → por qué no se pudo leer."""


def _fetch(fetch: Fetcher, name: str, errors: dict[str, str]) -> Any:
    try:
        response = fetch(name)
    except Exception as exc:  # red, API caída… (FastF1 no los distingue)
        errors[name] = f"{type(exc).__name__}: {safe(str(exc), 200)}"
        return None
    if response is None:
        errors[name] = (
            "sin respuesta: no está en la caché (build no descarga el Index.json) y el servidor no respondió "
            "(404, 403 a una IP de nube, o no se pidió con --offline)"
        )
    return response


def probe(fetch: Fetcher, pages: Mapping[str, str], max_records: int | None = None) -> ProbeReport:
    """Lee el índice, `CarData.z` y los mensajes de dirección de carrera de una sesión y los resume."""
    errors: dict[str, str] = {}
    index = _fetch(fetch, "index", errors)
    car_raw = _fetch(fetch, "car_data", errors)
    rc_raw = _fetch(fetch, "race_control_messages", errors)
    topics = feed_topics(index) if index is not None else None
    if index is not None and not topics:
        errors["index"] = "sin «Feeds» reconocibles"
    car = scan_car_data(car_raw, max_records) if isinstance(car_raw, list) else None
    if car_raw is not None and car is None:
        errors["car_data"] = f"formato inesperado ({type(car_raw).__name__})"
    rc = scan_race_control(rc_raw) if isinstance(rc_raw, list) else None
    return ProbeReport(
        topics=topics or None,
        car=car,
        race_control=rc,
        consumed=consumed_topics(pages),
        known=known_topics(pages),
        errors=errors,
    )


def _num(n: int) -> str:
    return f"{n:,}".replace(",", " ")


def _list(items: Iterable[str], limit: int = 40) -> str:
    items = list(items)
    if not items:
        return "ninguno"
    shown = ", ".join(items[:limit])
    return shown + (f" y {len(items) - limit} más" if len(items) > limit else "")


def _channel_label(ch: str) -> str:
    name = KNOWN_CAR_CHANNELS.get(ch)
    return f"{ch} ({name})" if name else f"{ch} (nuevo)"


def _values(stats: CarDataStats, ch: str) -> str:
    counter = stats.values.get(ch, Counter())
    parts = [f"{v}: {_num(n)}" for v, n in counter.most_common()]
    if stats.other_values[ch]:
        parts.append(f"otros: {_num(stats.other_values[ch])}")
    return ", ".join(parts) or "—"


def verdict(report: ProbeReport) -> str:
    """Última línea: `resultado: sin canales nuevos` o `resultado: canales nuevos: …`."""
    car = report.car
    if car is None:
        return "resultado: sin datos (no se pudo leer CarData.z)"
    if car.samples == 0:
        return "resultado: sin datos (CarData.z sin ninguna muestra legible)"
    new = car.new_channels
    if not new:
        return "resultado: sin canales nuevos"
    detail = ", ".join(f"{ch} (en {len(car.cars_with(ch))} coches)" for ch in new)
    return f"resultado: canales nuevos: {detail}"


def format_report(report: ProbeReport, label: str, path: str) -> list[str]:
    """Informe legible (una lista de líneas) para la consola."""
    lines = [f"sesión:     {label}", f"ruta:       {path}"]

    if report.topics is None:
        lines.append(f"temas:      sin Index.json — {report.errors.get('index', 'sin dato')}")
    else:
        published = [safe(t) for t in report.topics]
        consumed = [t for t in published if t in report.consumed]
        ignored = [t for t in published if t not in report.consumed]
        unknown = [t for t in published if t not in report.known]
        missing = sorted(report.consumed - set(published), key=str.casefold)
        lines += [
            f"temas:      {len(published)} publicados",
            f"  los lee el pipeline ({len(consumed)}): {_list(consumed)}",
            f"  no los lee ({len(ignored)}): {_list(ignored)}",
            f"  FastF1 no los conoce ({len(unknown)}): {_list(unknown)}",
        ]
        if missing:
            lines.append(f"  el pipeline los lee y no están publicados: {_list(missing)}")

    car = report.car
    if car is None:
        lines.append(f"CarData.z:  sin datos — {report.errors.get('car_data', 'sin dato')}")
    else:
        sample = "" if car.read == car.total else f" (muestra: los {_num(car.read)} primeros)"
        lines.append(
            f"CarData.z:  {_num(car.read)} de {_num(car.total)} mensajes{sample}, "
            f"{_num(car.errors)} ilegibles; {len(car.per_car)} coches, {_num(car.samples)} muestras"
        )
        known = ", ".join(f"{ch} {name}" for ch, name in KNOWN_CAR_CHANNELS.items())
        lines.append(f"  conocidos: {known}")
        seen = sort_channels(car.channel_samples)
        lines.append(
            "  canales vistos: "
            + (
                "; ".join(f"{_channel_label(ch)}: {_num(car.channel_samples[ch])}" for ch in seen)
                or "ninguno"
            )
        )
        groups: dict[tuple[str, ...], list[str]] = {}
        for car_id, chans in car.per_car.items():
            groups.setdefault(tuple(sort_channels(chans)), []).append(car_id)
        for chans, cars in sorted(groups.items(), key=lambda kv: -len(kv[1])):
            who = _list(sort_channels(cars), 30)
            lines.append(f"  por coche: {{{', '.join(chans)}}} en {len(cars)} coches ({who})")
        drs_present = car.channel_samples[DRS_CHANNEL]
        drs_absent = car.samples - drs_present
        if drs_present == 0:
            lines.append(f"  canal 45 (DRS): ausente en las {_num(car.samples)} muestras")
        else:
            lines.append(
                f"  canal 45 (DRS): presente en {_num(drs_present)} muestras ({_values(car, DRS_CHANNEL)}); "
                f"ausente en {_num(drs_absent)}"
            )
        for ch in car.new_channels:
            lines.append(f"  canal {ch} (nuevo): valores {_values(car, ch)}")

    rc = report.race_control
    if rc is None:
        lines.append(
            f"dirección de carrera: sin mensajes — {report.errors.get('race_control_messages', 'sin dato')}"
        )
    else:
        counts = " · ".join(f"{k.replace('_', ' ').upper()}: {rc[k]}" for k in RC_KINDS)
        lines.append(f"dirección de carrera: {counts}")

    lines.append(verdict(report))
    return lines


def open_session(
    season: int, event: str | int, session_type: str, cache_dir: Path, *, offline: bool = False
) -> tuple[str, str, Fetcher, Mapping[str, str]]:
    """(nombre legible, ruta del archivo, lector de páginas, `fastf1.api.pages`) de una sesión.

    La ruta sale del calendario oficial, como en `build` (`official_event`, sin Ergast/Jolpica), y las páginas
    se leen con `fastf1.api.fetch_page` y la caché HTTP de FastF1 (offline: solo de la caché).
    """
    import fastf1
    import fastf1.api

    from trazada_pipeline.sources.fastf1_source import fastf1_identifier, official_event

    cache_dir.mkdir(parents=True, exist_ok=True)
    fastf1.Cache.enable_cache(str(cache_dir))
    if offline:
        fastf1.Cache.offline_mode(True)
    ev = official_event(season, event)
    session = ev.get_session(fastf1_identifier(ev, session_type))
    path = str(session.api_path)
    label = f"{season} · {ev['EventName']} · {session.name}"
    return label, path, lambda name: fastf1.api.fetch_page(path, name), dict(fastf1.api.pages)
