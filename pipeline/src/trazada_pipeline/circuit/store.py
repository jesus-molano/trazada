"""Persistencia del circuito canónico: /v1/circuits/{id}/circuit.{hash8}.trzb.gz + circuit.json (puntero)."""

from __future__ import annotations

import gzip
import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from trazada_pipeline.circuit.build import Circuit
from trazada_pipeline.encode import trzb
from trazada_pipeline.files import write_hashed


def circuit_tables(c: Circuit) -> dict[str, dict[str, Any]]:
    pit = c.pitlane if c.pitlane is not None else np.zeros((0, 3))
    ms = c.marshal_sectors
    return {
        "centerline": {"x": c.centerline[:, 0], "y": c.centerline[:, 1], "z": c.centerline[:, 2]},
        "pitlane": {"x": pit[:, 0], "y": pit[:, 1], "z": pit[:, 2]},
        "corners": {
            "number": c.corners["number"].to_numpy(dtype=np.int64),
            "letter": c.corners["letter"].to_numpy(dtype=np.int64),
            "s": c.corners["s"].to_numpy(dtype=np.float64),
            "x": c.corners["x"].to_numpy(dtype=np.float64),
            "y": c.corners["y"].to_numpy(dtype=np.float64),
            "angle": c.corners["angle"].to_numpy(dtype=np.float64),
        },
        "marshalSectors": {
            "number": [] if ms is None else ms["number"].to_numpy(dtype=np.int64),
            "sStart": [] if ms is None else ms["s_start"].to_numpy(dtype=np.float64),
            "sEnd": [] if ms is None else ms["s_end"].to_numpy(dtype=np.float64),
        },
    }


def circuit_meta(c: Circuit) -> dict[str, Any]:
    return {
        "circuitId": c.circuit_id,
        "name": c.name,
        "lengthM": round(c.length, 3),
        "stepM": 1.0,
        "rotationDeg": c.rotation_deg,
        "center": [round(c.center[0], 4), round(c.center[1], 4)],
        "zBase": round(c.z_base, 4),
        "pit": None
        if c.pitlane is None
        else {
            "entryS": round(c.pit_entry_s or 0.0, 3),
            "exitS": round(c.pit_exit_s or 0.0, 3),
            "lengthM": round(c.pit_length or 0.0, 3),
        },
        "quality": {k: round(v, 4) for k, v in c.quality.items()},
        "sources": c.sources,
    }


def save_circuit(c: Circuit, v1_root: Path) -> dict[str, Any]:
    folder = v1_root / "circuits" / c.circuit_id
    folder.mkdir(parents=True, exist_ok=True)
    raw = trzb.encode("circuit", circuit_tables(c), circuit_meta(c))
    ref = write_hashed(folder, "circuit", ".trzb.gz", trzb.gzip_bytes(raw), layout="circuit@1")
    (folder / "circuit.json").write_text(json.dumps({"file": ref, "meta": circuit_meta(c)}, indent=2) + "\n")
    return ref


def load_circuit(circuit_id: str, v1_root: Path) -> Circuit | None:
    pointer = v1_root / "circuits" / circuit_id / "circuit.json"
    if not pointer.exists():
        return None
    info = json.loads(pointer.read_text())
    data = gzip.decompress((pointer.parent / info["file"]["path"]).read_bytes())
    dec = trzb.decode(data)
    meta = dec.meta
    t = dec.tables
    line = np.column_stack([t["centerline"]["x"], t["centerline"]["y"], t["centerline"]["z"]])
    pit = (
        np.column_stack([t["pitlane"]["x"], t["pitlane"]["y"], t["pitlane"]["z"]])
        if len(t["pitlane"]["x"])
        else None
    )
    ms = t["marshalSectors"]
    return Circuit(
        circuit_id=meta["circuitId"],
        name=meta["name"],
        rotation_deg=meta["rotationDeg"],
        center=(meta["center"][0], meta["center"][1]),
        z_base=meta["zBase"],
        centerline=line,
        pitlane=pit,
        pit_entry_s=meta["pit"]["entryS"] if meta.get("pit") else None,
        pit_exit_s=meta["pit"]["exitS"] if meta.get("pit") else None,
        corners=pd.DataFrame(
            {
                "number": t["corners"]["number"].astype(int),
                "letter": t["corners"]["letter"].astype(int),
                "s": t["corners"]["s"],
                "x": t["corners"]["x"],
                "y": t["corners"]["y"],
                "angle": t["corners"]["angle"],
            }
        ),
        marshal_sectors=None
        if len(ms["number"]) == 0
        else pd.DataFrame({"number": ms["number"].astype(int), "s_start": ms["sStart"], "s_end": ms["sEnd"]}),
        quality=dict(meta.get("quality", {})),
        sources=list(meta.get("sources", [])),
    )
