"""Registro de trazados (pipeline/circuits.json): id canónico y longitud oficial de referencia."""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class Layout:
    circuit_id: str  # "{circuitKey}-{layoutId}"
    name: str
    official_length_m: float | None
    length_source: str | None


@cache
def _registry() -> dict[str, Any]:
    return json.loads((Path(__file__).resolve().parents[3] / "circuits.json").read_text(encoding="utf-8"))


def resolve(circuit_key: int, season: int, slug: str, *, dev: bool = False) -> Layout:
    reg = _registry()
    if dev or circuit_key == 0:
        entry = reg.get("dev", {}).get(slug)
        if entry:
            return Layout(
                f"0-{entry['layoutId']}",
                entry["name"],
                entry.get("officialLengthM"),
                entry.get("lengthSource"),
            )
        return Layout(f"0-{slug}-dev", slug, None, None)
    entry = reg["circuits"].get(str(circuit_key))
    if not entry:
        return Layout(f"{circuit_key}-a", slug, None, None)
    layouts = [
        lay for lay in entry["layouts"] if lay.get("fromSeason", 0) <= season <= lay.get("toSeason", 9999)
    ]
    lay = layouts[-1] if layouts else entry["layouts"][-1]
    return Layout(
        f"{circuit_key}-{lay['id']}", entry["name"], lay.get("officialLengthM"), lay.get("lengthSource")
    )
