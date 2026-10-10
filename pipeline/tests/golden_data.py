"""Tablas sintéticas y deterministas para el fichero dorado TRZB (compartido con los tests de TS)."""

from __future__ import annotations

from typing import Any

import numpy as np


def golden_tables() -> dict[str, dict[str, dict[str, Any]]]:
    rng = np.random.default_rng(20261010)
    # motion: 2 coches, tiempos crecientes, s monótona en metros (con dm exactos), cruce de signo en t
    t1 = np.array([-480, -240, 0, 240, 520, 760, 1000], dtype=np.int64)
    t2 = np.array([10, 250, 490, 735], dtype=np.int64)
    s1 = np.array([0.0, 0.0, 1.2, 20.5, 47.0, 80.3, 120.0])
    s2 = np.array([5000.0, 5021.1, 5042.0, 5063.9])
    motion = {
        "cars": {"car": [1, 44], "start": [0, 7], "count": [7, 4]},
        "pos": {
            "t": np.concatenate([t1, t2]),
            "path": [0, 0, 0, 1, 1, 0, 2, 0, 0, 0, 0],
            "s": np.concatenate([s1, s2]),
            "projErr": [0, 1, 2, 3, 255, 0, 0, 5, 6, 7, 8],
        },
    }
    n = 6
    car = {
        "cars": {"car": [16], "start": [0], "count": [n]},
        "tel": {
            "t": np.cumsum(rng.integers(150, 520, size=n)),
            "speed": [0, 95, 180, 255, 312, 335],
            "rpm": [0, 9000, 10500, 11800, 12100, 13486],
            "gear": [0, 2, 4, 6, 7, 8],
            "throttle": [0, 50, 100, 100, 255, 0],
            "brake": [1, 0, 0, 0, 0, 1],
            "drs": [255, 255, 255, 255, 255, 255],
        },
    }
    m = 5
    circuit = {
        "centerline": {
            "x": np.round(np.cos(np.linspace(0, 2 * np.pi, m, endpoint=False)) * 100, 2),
            "y": np.round(np.sin(np.linspace(0, 2 * np.pi, m, endpoint=False)) * 100, 2),
            "z": [0.0, 0.5, 1.0, 0.5, 0.0],
        },
        "pitlane": {"x": [90.0, 95.0], "y": [-5.0, 0.0], "z": [0.0, 0.0]},
        "corners": {
            "number": [1, 2],
            "letter": [0, ord("A")],
            "s": [10.0, 300.5],
            "x": [99.0, -50.0],
            "y": [10.0, 86.0],
            "angle": [90.0, -45.0],
        },
        "marshalSectors": {"number": [1, 2], "sStart": [0.0, 300.0], "sEnd": [300.0, 0.0]},
    }
    timing = {
        "laps": {
            "car": [1, 1],
            "lap": [1, 2],
            "startMs": [0, 92000],
            "endMs": [92000, 183500],
            "lapMs": [-1, 91500],
            "s1Ms": [-1, 30100],
            "s2Ms": [40000, 31200],
            "s3Ms": [21000, 30200],
            "compound": [2, 2],
            "tyreLife": [1, 2],
            "fresh": [1, 1],
            "stint": [1, 1],
            "pitInMs": [-1, -1],
            "pitOutMs": [-1, -1],
            "position": [1, 1],
            "trackStatusMask": [0, 2],
            "deleted": [0, 0],
        },
        "stream": {
            "t": [100, 5000],
            "car": [1, 44],
            "position": [1, 2],
            "gapToLeaderMs": [-1, 1234],
            "intervalMs": [-1, 1234],
            "lapsBehind": [0, 0],
        },
        "trackStatus": {"t": [0, 60000], "code": [1, 4]},
        "sessionStatus": {"t": [0], "status": [2]},
    }
    return {"motion": motion, "car": car, "circuit": circuit, "timing": timing}


GOLDEN_META: dict[str, dict[str, Any]] = {
    "motion": {"note": "golden"},
    "car": {},
    "circuit": {"lengthM": 587.785, "pit": {"entryS": 450.0, "exitS": 20.0}},
    "timing": {},
}
