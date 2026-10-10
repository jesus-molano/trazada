"""Todo fichero de texto se lee y escribe en UTF-8 explícito.

En Windows con Python 3.13/3.14, `read_text()` sin codificación usa la página de códigos ANSI (cp1252): leer
el catálogo así y reescribirlo en UTF-8 corrompía «São Paulo» un poco más en cada descarga (revisión D26).
"""

from __future__ import annotations

import ast
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "src" / "trazada_pipeline"


def _text_io_without_encoding(tree: ast.AST) -> list[int]:
    lines = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
            continue
        name = node.func.attr
        kwargs = {k.arg for k in node.keywords}
        if name in ("read_text", "write_text") and "encoding" not in kwargs:
            lines.append(node.lineno)
        if name == "open" and "encoding" not in kwargs:
            mode = next((a.value for a in node.args if isinstance(a, ast.Constant)), "r")
            mode = next((k.value.value for k in node.keywords if k.arg == "mode"), mode)  # type: ignore[union-attr]
            if isinstance(mode, str) and "b" not in mode:
                lines.append(node.lineno)
    return lines


def test_every_text_file_operation_declares_utf8() -> None:
    offenders = {
        str(p.relative_to(SRC)): lines
        for p in sorted(SRC.rglob("*.py"))
        if (lines := _text_io_without_encoding(ast.parse(p.read_text(encoding="utf-8"))))
    }
    assert offenders == {}
