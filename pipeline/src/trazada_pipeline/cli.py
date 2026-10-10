"""CLI del pipeline: `uv run trazada --help`."""

from __future__ import annotations

import typer

from trazada_pipeline import __version__

app = typer.Typer(no_args_is_help=True, add_completion=False, help="Pipeline de datos de Trazada.")


@app.callback()
def main() -> None:
    """Pipeline de datos de Trazada."""


@app.command()
def version() -> None:
    """Muestra la versión del pipeline."""
    typer.echo(__version__)


if __name__ == "__main__":
    app()
