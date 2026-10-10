from typer.testing import CliRunner

from trazada_pipeline import __version__
from trazada_pipeline.cli import app


def test_version() -> None:
    result = CliRunner().invoke(app, ["version"])
    assert result.exit_code == 0
    assert result.stdout.strip() == __version__
