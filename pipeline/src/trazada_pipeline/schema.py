"""Acceso al esquema compartido (packages/schema): versiones, layouts TRZB, enums y JSON Schemas."""

from __future__ import annotations

import json
import os
from functools import cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker


def schema_dir() -> Path:
    env = os.environ.get("TRAZADA_SCHEMA_DIR")
    if env:
        return Path(env)
    # pipeline/src/trazada_pipeline/schema.py -> raíz del repo
    return Path(__file__).resolve().parents[3] / "packages" / "schema"


@cache
def versions() -> dict[str, Any]:
    return json.loads((schema_dir() / "version.json").read_text(encoding="utf-8"))


def schema_version() -> str:
    return str(versions()["schemaVersion"])


def schema_major() -> int:
    return int(schema_version().split(".")[0])


@cache
def layout(name: str) -> dict[str, Any]:
    path = schema_dir() / "trzb" / f"{name}.layout.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("layout") != name:
        raise ValueError(f"{path} declara layout={data.get('layout')!r}, se esperaba {name!r}")
    return data


@cache
def enums() -> dict[str, list[str]]:
    return json.loads((schema_dir() / "trzb" / "enums.json").read_text(encoding="utf-8"))


def enum_code(enum: str, value: str) -> int:
    values = enums()[enum]
    return values.index(value) if value in values else 0


@cache
def _validator(name: str) -> Draft202012Validator:
    data = json.loads((schema_dir() / f"{name}.schema.json").read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(data)
    return Draft202012Validator(data, format_checker=FormatChecker())


def validate(name: str, document: dict[str, Any]) -> None:
    """Valida un documento (manifest, catalog, events) y lanza ValueError con todos los errores."""
    errors = sorted(_validator(name).iter_errors(document), key=lambda e: list(e.path))
    if errors:
        lines = [f"- {'/'.join(map(str, e.path)) or '<raíz>'}: {e.message}" for e in errors]
        raise ValueError(f"{name} no cumple el esquema:\n" + "\n".join(lines))
