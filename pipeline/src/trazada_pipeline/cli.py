"""CLI del pipeline: `uv run trazada --help`."""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Callable
from pathlib import Path
from typing import TYPE_CHECKING

import typer

from trazada_pipeline import __version__

if TYPE_CHECKING:
    from trazada_pipeline.build import BuildReport

app = typer.Typer(no_args_is_help=True, add_completion=False, help="Pipeline de datos de Trazada.")

REPO = Path(__file__).resolve().parents[3]
DEFAULT_DATA = REPO / "data"
DEFAULT_CACHE = REPO / ".cache" / "fastf1"
DEFAULT_SANITIZED = REPO / ".cache" / "fastf1-sanitized"
PRUNE_AFTER_DAYS = 7
#: Tipos de sesión de Trazada (los mismos que `FASTF1_SESSION` y `SESSION_ORDER`; lo comprueba un test).
SESSION_TYPES = ("fp1", "fp2", "fp3", "sq", "sprint", "q", "race")


@app.callback()
def main(verbose: bool = typer.Option(False, "--verbose", "-v", help="Log detallado.")) -> None:
    """Pipeline de datos de Trazada."""
    logging.basicConfig(
        level=logging.INFO if verbose else logging.WARNING, format="%(levelname)s %(message)s"
    )


@app.command()
def version() -> None:
    """Muestra la versión del pipeline."""
    typer.echo(__version__)


def _report(report: object) -> None:
    from trazada_pipeline.build import BuildReport

    assert isinstance(report, BuildReport)
    typer.echo(f"manifest: {report.manifest_path}")
    typer.echo(f"estado:   {report.status}")
    total = sum(report.sizes.values())
    sizes = ", ".join(f"{k} {v / 1024:.0f} KiB" for k, v in report.sizes.items())
    typer.echo(f"tamaño:   {total / 1024 / 1024:.2f} MiB ({sizes})")
    for w in report.warnings:
        typer.echo(f"aviso:    {w}")


@app.command()
def build(
    season: int = typer.Argument(..., help="Temporada, p. ej. 2026."),
    event: str = typer.Argument(..., help="Ronda (número) o nombre del evento según FastF1."),
    session: str = typer.Argument(..., help="fp1|fp2|fp3|sq|sprint|q|race"),
    data: Path = typer.Option(DEFAULT_DATA, help="Raíz de salida (se escribe en <data>/v1/)."),
    cache: Path | None = typer.Option(None, help="Caché de FastF1 (por defecto .cache/fastf1)."),
    offline: bool = typer.Option(False, help="Solo caché (p. ej. una caché saneada con sanitize-cache)."),
    rebuild_circuit: bool = typer.Option(False, help="Reconstruye el circuito canónico aunque exista."),
    dev_corners: Path | None = typer.Option(
        None, help="SOLO DESARROLLO: corners.json de TracingInsights si MultiViewer no es accesible."
    ),
    progress: bool = typer.Option(
        False, help="Progreso en líneas `::` para el gestor de datos local (pnpm local)."
    ),
) -> None:
    """Descarga (o lee de caché) una sesión con FastF1 y genera sus ficheros."""
    if session not in SESSION_TYPES:
        typer.echo(f"ERROR: sesión desconocida {session!r} (usa {'|'.join(SESSION_TYPES)})", err=True)
        raise typer.Exit(2)
    ev: str | int = int(event) if event.isdigit() else event
    cache_dir = cache or (DEFAULT_SANITIZED if offline else DEFAULT_CACHE)
    if not progress:
        _report(_build(season, ev, session, data, cache_dir, offline, rebuild_circuit, dev_corners))
        return

    import traceback

    from trazada_pipeline.progress import Progress, attach_fastf1, detach_fastf1, emit, error_code

    prog = Progress()
    handler = attach_fastf1(prog)
    try:
        prog.step(1, "download", "start")
        report = _build(
            season,
            ev,
            session,
            data,
            cache_dir,
            offline,
            rebuild_circuit,
            dev_corners,
            on_loaded=lambda: prog.step(88, "process", "process"),
        )
    except Exception as exc:
        traceback.print_exc()
        code = error_code(exc, network=handler.network)
        emit("error", {"code": code, "message": f"{type(exc).__name__}: {exc}"})
        raise typer.Exit(1) from None
    finally:
        detach_fastf1(handler)
    sessions_dir = data / f"v{_schema_major()}" / "sessions"
    emit(
        "result",
        {
            "session": report.manifest_path.parent.relative_to(sessions_dir).as_posix(),
            "status": report.status,
            "bytes": sum(report.sizes.values()),
            "dev": report.dev,
            "warnings": report.warnings,
        },
    )


def _schema_major() -> int:
    from trazada_pipeline import schema

    return schema.schema_major()


def _build(
    season: int,
    event: str | int,
    session: str,
    data: Path,
    cache_dir: Path,
    offline: bool,
    rebuild_circuit: bool,
    dev_corners: Path | None,
    on_loaded: Callable[[], None] | None = None,
) -> BuildReport:
    from trazada_pipeline.build import build_session
    from trazada_pipeline.sources.base import QualityNote
    from trazada_pipeline.sources.dev_tracinginsights import load_ti_corners
    from trazada_pipeline.sources.fastf1_source import load_fastf1

    sd = load_fastf1(season, event, session, cache_dir, offline=offline)
    if sd.circuit_info is None and dev_corners is not None:
        sd.circuit_info = load_ti_corners(dev_corners)
        sd.dev = True  # circuito "-dev" aparte: el canónico nunca recibe datos de desarrollo
        sd.notes.append(
            QualityNote(
                "dev-corners",
                "Curvas y rotación de MultiViewer leídas de una copia de TracingInsights (desarrollo).",
            )
        )
    if on_loaded is not None:
        on_loaded()
    return build_session(sd, data, rebuild_circuit=rebuild_circuit)


@app.command()
def schedule(
    season: int = typer.Argument(..., help="Temporada, p. ej. 2026."),
    cache: Path | None = typer.Option(None, help="Caché de FastF1 (por defecto .cache/fastf1)."),
) -> None:
    """Calendario de la temporada en una línea JSON: Grandes Premios y sesiones con su hora de inicio UTC."""
    import traceback

    from trazada_pipeline.progress import attach_fastf1, detach_fastf1, emit, error_code
    from trazada_pipeline.schedule import load_schedule

    handler = attach_fastf1(None)  # solo para saber si los fallos fueron de red
    try:
        events = load_schedule(season, cache or DEFAULT_CACHE)
    except Exception as exc:
        traceback.print_exc()
        code = error_code(exc, network=handler.network)
        emit("error", {"code": code, "message": f"{type(exc).__name__}: {exc}"})
        raise typer.Exit(1) from None
    finally:
        detach_fastf1(handler)
    typer.echo(json.dumps({"season": season, "events": events}, ensure_ascii=False))


@app.command("sanitize-cache")
def sanitize_cache(
    src: Path = typer.Argument(
        ..., help="Carpeta de sesión de una caché FastF1 de terceros (<año>/<evento>/<sesión>)."
    ),
    dst: Path = typer.Option(DEFAULT_SANITIZED, help="Raíz de la caché saneada."),
) -> None:
    """Re-serializa una caché FastF1 de terceros con un unpickler restringido (lista blanca)."""
    from trazada_pipeline.sources.offline_cache import sanitize_session_cache

    typer.echo(sanitize_session_cache(src, dst))


@app.command("dev-ti")
def dev_ti(
    session_dir: Path = typer.Argument(
        ..., help="Carpeta de sesión del repo TracingInsights (…/<evento>/<sesión>)."
    ),
    season: int = typer.Option(..., help="Temporada."),
    round_: int = typer.Option(..., "--round", help="Ronda."),
    slug: str = typer.Option(..., help="Slug del evento (registro dev de circuits.json)."),
    data: Path = typer.Option(DEFAULT_DATA, help="Raíz de salida."),
    rebuild_circuit: bool = typer.Option(False),
) -> None:
    """SOLO DESARROLLO: sesión desde JSON de TracingInsights (sale marcada `dev`, no publicable)."""
    from trazada_pipeline.build import build_session
    from trazada_pipeline.sources.dev_tracinginsights import load_tracinginsights

    sd = load_tracinginsights(session_dir, season, round_, slug)
    _report(build_session(sd, data, rebuild_circuit=rebuild_circuit))


@app.command("e2e-fixture")
def e2e_fixture(
    session: str = typer.Argument(..., help="Sesión ya generada, p. ej. 2026/10-spa-francorchamps/fp1."),
    data: Path = typer.Option(DEFAULT_DATA, help="Raíz de datos de origen."),
    out: Path = typer.Option(REPO / "apps" / "web" / "tests" / "fixtures" / "data", help="Raíz del fixture."),
    minutes: float = typer.Option(9.0, help="Duración del extracto."),
    start: float | None = typer.Option(
        None, help="Minuto de sesión en que empieza (por defecto, el de más coches)."
    ),
) -> None:
    """Genera el fixture e2e (extracto recortado + variantes de estado). Solo de fuentes publicables."""
    from trazada_pipeline.fixtures import make_e2e_fixture

    summary = make_e2e_fixture(data, session, out, minutes, start)
    typer.echo(json.dumps(summary))


@app.command()
def probe(timeout: float = typer.Option(10.0)) -> None:
    """Comprueba si esta red puede leer el archivo de live timing de F1 (las IPs de nube reciben 403)."""
    import urllib.error
    import urllib.request

    urls = {
        "livetiming": "https://livetiming.formula1.com/static/2025/Index.json",
        "openf1": "https://api.openf1.org/v1/sessions?year=2025&session_name=Race&country_name=Belgium",
    }
    ok = True
    for name, url in urls.items():
        req = urllib.request.Request(url, headers={"User-Agent": f"trazada-pipeline/{__version__}"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                code = resp.status
        except urllib.error.HTTPError as exc:
            code = exc.code
        except OSError as exc:
            code = f"error: {exc}"
        typer.echo(f"{name:<11} {code}")
        ok &= code == 200
    raise typer.Exit(0 if ok else 1)


@app.command("probe-feed")
def probe_feed(
    season: int = typer.Argument(..., help="Temporada, p. ej. 2026."),
    event: str = typer.Argument(..., help="Ronda (número) o nombre del evento según FastF1."),
    session: str = typer.Argument(..., help="fp1|fp2|fp3|sq|sprint|q|race"),
    cache: Path | None = typer.Option(None, help="Caché de FastF1 (por defecto .cache/fastf1, la de build)."),
    offline: bool = typer.Option(
        False,
        help="Solo la caché HTTP de FastF1: tras un build sirven CarData.z y dirección de carrera; "
        "el Index.json (temas) no lo descarga build.",
    ),
    max_records: int = typer.Option(
        0, min=0, help="Lee solo los N primeros mensajes de CarData.z (0: todos)."
    ),
) -> None:
    """R4: ¿publica el feed de la sesión temas o canales de CarData.z que el pipeline no lee?

    Lee el Index.json (temas), el CarData.z (canales por coche) y los OVERTAKE/DRS de dirección de carrera.

    Necesita una IP residencial (F1 da 403 a las de nube), salvo con --offline tras un build.

    Sale con 0 si pudo leer muestras de CarData.z, haya o no canales nuevos; con 1 si no.
    """
    if session not in SESSION_TYPES:
        typer.echo(f"ERROR: sesión desconocida {session!r} (usa {'|'.join(SESSION_TYPES)})", err=True)
        raise typer.Exit(2)
    from trazada_pipeline import feedprobe

    ev: str | int = int(event) if event.isdigit() else event
    try:
        label, path, fetch, pages = feedprobe.open_session(
            season, ev, session, cache or DEFAULT_CACHE, offline=offline
        )
    except Exception as exc:  # calendario inaccesible, evento o sesión inexistentes…
        typer.echo(f"ERROR: {type(exc).__name__}: {exc}", err=True)
        raise typer.Exit(1) from None
    report = feedprobe.probe(fetch, pages, max_records or None)
    for line in feedprobe.format_report(report, label, path):
        typer.echo(line)
    if report.car is None:
        typer.echo(
            "ERROR: no se pudo leer CarData.z. Si estás en una IP de nube, F1 responde 403: "
            "ejecuta la sonda desde una IP residencial (o con --offline tras un build).",
            err=True,
        )
        raise typer.Exit(1)
    if report.car.samples == 0:
        typer.echo(
            "ERROR: CarData.z no tiene ninguna muestra legible: no se puede decir nada de sus canales.",
            err=True,
        )
        raise typer.Exit(1)


def _referenced(v1: Path) -> set[Path]:
    refs: set[Path] = set()
    for manifest in v1.glob("sessions/*/*/*/manifest.json"):
        doc = json.loads(manifest.read_text(encoding="utf-8"))
        for f in doc["files"].values():
            refs.add((manifest.parent / f["path"]).resolve())
    for pointer in v1.glob("circuits/*/circuit.json"):
        refs.add((pointer.parent / json.loads(pointer.read_text(encoding="utf-8"))["file"]["path"]).resolve())
    return refs


@app.command()
def prune(
    data: Path = typer.Option(DEFAULT_DATA),
    days: int = typer.Option(
        PRUNE_AFTER_DAYS, help="Antigüedad mínima de un fichero huérfano para borrarlo."
    ),
    dry_run: bool = typer.Option(True, "--dry-run/--apply"),
) -> None:
    """Borra ficheros con hash que ningún manifest referencia y tienen más de N días."""
    v1 = data / "v1"
    refs = _referenced(v1)
    limit = time.time() - days * 86400
    for path in sorted(v1.rglob("*.gz")):
        if path.resolve() in refs or path.stat().st_mtime > limit:
            continue
        typer.echo(f"{'borraría' if dry_run else 'borrado'}: {path.relative_to(data)}")
        if not dry_run:
            path.unlink()


@app.command()
def catalog(data: Path = typer.Option(DEFAULT_DATA), public: bool = typer.Option(False)) -> None:
    """Muestra el catálogo; con --public falla si contiene sesiones de desarrollo (antes de publicar)."""
    path = data / "v1" / "catalog.json"
    doc = json.loads(path.read_text(encoding="utf-8"))
    dev = []
    for season in doc["seasons"]:
        for ev in season["events"]:
            for s in ev["sessions"]:
                flag = " [dev]" if s.get("dev") else ""
                typer.echo(
                    f"{season['season']} R{ev['round']:02d} {ev['slug']:<16} {s['session']:<7} "
                    f"{s['status']:<11} {s.get('bytes', 0) / 1024 / 1024:6.2f} MiB{flag}"
                )
                if s.get("dev"):
                    dev.append(f"{season['season']}/{ev['slug']}/{s['session']}")
    if public and dev:
        typer.echo(f"ERROR: el catálogo contiene sesiones de desarrollo: {', '.join(dev)}", err=True)
        raise typer.Exit(1)


@app.command()
def outlines(
    src: Path = typer.Argument(..., help="Checkout de github.com/bacinger/f1-circuits (MIT)."),
    out: Path = typer.Option(
        REPO / "apps" / "web" / "app" / "assets" / "circuit-outlines.json", help="JSON de salida (front)."
    ),
    commit: str | None = typer.Option(None, help="Commit del checkout (por defecto, git rev-parse HEAD)."),
) -> None:
    """Genera las miniaturas de trazado del selector (D27) desde el GeoJSON de bacinger/f1-circuits."""
    from trazada_pipeline.outlines import write_outlines

    doc = write_outlines(src, out, commit)
    size = out.stat().st_size
    commit_id = doc["source"]["commit"]
    typer.echo(f"{len(doc['outlines'])} trazados → {out} ({size / 1024:.1f} KiB), commit {commit_id}")


if __name__ == "__main__":
    app()
