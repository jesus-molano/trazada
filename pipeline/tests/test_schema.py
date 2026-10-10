from __future__ import annotations

import copy
import json

import pytest

from trazada_pipeline import schema


def _example(name: str) -> dict:
    return json.loads((schema.schema_dir() / "examples" / f"{name}.example.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("name", ["manifest", "catalog", "events"])
def test_examples_validate(name: str) -> None:
    schema.validate(name, _example(name))


def test_manifest_rejects_unknown_fields_and_bad_colors() -> None:
    m = _example("manifest")
    bad = copy.deepcopy(m)
    bad["session"]["officialName"] = "FORMULA 1 SPONSOR GRAND PRIX"
    with pytest.raises(ValueError, match="officialName"):
        schema.validate("manifest", bad)
    bad = copy.deepcopy(m)
    bad["drivers"][0]["color"] = "red"
    with pytest.raises(ValueError, match="color"):
        schema.validate("manifest", bad)


def test_layouts_and_versions_load() -> None:
    assert schema.schema_major() == 1
    for name in ("motion", "car", "circuit", "timing"):
        assert schema.layout(name)["revision"] >= 1
    assert schema.enum_code("compound", "MEDIUM") == 2
    assert schema.enum_code("compound", "NO-EXISTE") == 0
