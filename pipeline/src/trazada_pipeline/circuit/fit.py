"""¿Encaja una sesión en un circuito ya guardado? Se comprueba antes de reutilizarlo.

El circuito canónico se comparte entre las sesiones de un trazado (D21), pero `circuits.json` puede no
saber que el trazado cambió (una chicane nueva, curvas redibujadas) o que el feed cambió de sistema de
coordenadas. Se proyectan las vueltas limpias de la sesión sobre la línea guardada (en planta) y se mira
a qué distancia quedan y cuánto miden: si no encajan, la sesión necesita otra variante del circuito.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from trazada_pipeline.circuit.build import Circuit, _valid_pos, reference_laps
from trazada_pipeline.circuit.geometry import PolylineIndex, arclength
from trazada_pipeline.sources.base import SessionData

FIT_LAPS = 8
#: Vueltas limpias necesarias para poder decidir; con menos se reutiliza y se avisa.
FIT_MIN_LAPS = 3
#: Mayor desvío de una vuelta mantenido en dos muestras seguidas (mediana de las vueltas). El feed ajusta
#: las posiciones a una línea (en la misma sesión de Spa, p95 de 0,1 m), así que un desvío sostenido de
#: más de 5 m es otro trazado; un fallo de posición suelto es una sola muestra y no cuenta.
FIT_MAX_DEV_M = 5.0
#: Mediana de la distancia: con el mismo sistema de coordenadas, décimas de metro.
FIT_MAX_P50_M = 2.0
#: Longitud de una vuelta (polilínea de sus muestras) frente a la del circuito. Las cuerdas acortan las
#: curvas y faltan los trozos antes de la primera muestra y tras la última: en Spa, un 0,3 % menos.
FIT_MAX_LENGTH_DEV = 0.03


@dataclass(frozen=True)
class Fit:
    laps: int
    p50_m: float
    p95_m: float
    dev_m: float
    length_ratio: float

    @property
    def checked(self) -> bool:
        return self.laps >= FIT_MIN_LAPS

    @property
    def ok(self) -> bool:
        """Encaja (o no hay vueltas suficientes para decir que no)."""
        if not self.checked:
            return True
        return (
            self.dev_m <= FIT_MAX_DEV_M
            and self.p50_m <= FIT_MAX_P50_M
            and abs(self.length_ratio - 1.0) <= FIT_MAX_LENGTH_DEV
        )

    def describe(self) -> str:
        return (
            f"desvío sostenido {self.dev_m:.1f} m, mediana {self.p50_m:.1f} m, p95 {self.p95_m:.1f} m, "
            f"longitud {self.length_ratio:.1%} de la guardada; {self.laps} vueltas limpias"
        )

    def quality(self) -> dict[str, float]:
        return {
            "fitLaps": float(self.laps),
            "fitDevM": round(self.dev_m, 3),
            "fitP50M": round(self.p50_m, 3),
            "fitP95M": round(self.p95_m, 3),
            "fitLengthRatio": round(self.length_ratio, 5),
        }


def circuit_fit(data: SessionData, circuit: Circuit) -> Fit:
    """Encaje de las vueltas limpias más rápidas de la sesión sobre la línea central guardada."""
    flat = np.column_stack([circuit.centerline[:, :2], np.zeros(len(circuit.centerline))])
    index = PolylineIndex(flat, closed=True)
    dists, devs, ratios = [], [], []
    for lap in reference_laps(data, FIT_LAPS).itertuples():
        df = data.pos.get(lap.car)
        if df is None:
            continue
        v = _valid_pos(df)
        sel = v[(v["t_ms"] >= lap.start_ms) & (v["t_ms"] <= lap.end_ms)].sort_values("t_ms")
        if len(sel) < 50:
            continue
        pts = circuit.to_canonical(sel[["x", "y", "z"]].to_numpy(dtype=np.float64))
        pts[:, 2] = 0.0
        _, d = index.project(pts)
        dists.append(d)
        devs.append(float(np.minimum(d[:-1], d[1:]).max()))
        ratios.append(float(arclength(pts)[-1]) / circuit.length)
    if not dists:
        return Fit(0, 0.0, 0.0, 0.0, 1.0)
    all_d = np.concatenate(dists)
    return Fit(
        laps=len(dists),
        p50_m=float(np.percentile(all_d, 50)),
        p95_m=float(np.percentile(all_d, 95)),
        dev_m=float(np.median(devs)),
        length_ratio=float(np.median(ratios)),
    )
