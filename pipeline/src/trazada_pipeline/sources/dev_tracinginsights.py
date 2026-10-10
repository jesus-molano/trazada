"""Fuente SOLO DE DESARROLLO: JSON procesados del repo público TracingInsights (derivados de FastF1).

Sirve para desarrollar y probar el replay de una carrera completa sin acceso al archivo de F1. Nunca se
publica: las sesiones salen marcadas `dev` y con `pipeline.source = tracinginsights-dev`.

Limitaciones (documentadas en el manifest):
- La telemetría viene fusionada por vuelta: las muestras de posición se recuperan como las filas con
  X/Y/Z enteras (valores crudos en dm) y las de coche como las filas con velocidad y rpm enteras.
- No hay TrackStatus ni torre de tiempos: el estado de pista se aproxima desde race control.
- Como en la fuente FastF1, se descartan las vueltas que inventa FastF1 (marca `ff1G` o, sin ella, el
  patrón de la vuelta final de 150 000 ms sin tiempo ni sectores).
- Los tiempos/posiciones de vuelta de carrera de esa fuente están sobrescritos con datos de Ergast/Jolpica;
  por eso aquí la vuelta 1 va sin tiempo y no se usa nada más de esa procedencia en producción.
"""

from __future__ import annotations

import json
from datetime import UTC
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from trazada_pipeline.racecontrol.state import track_status_from_race_control
from trazada_pipeline.sources.base import (
    CAR_COLUMNS,
    LAP_COLUMNS,
    POS_COLUMNS,
    RC_COLUMNS,
    CircuitInfo,
    Driver,
    SessionData,
)

SESSION_TYPE_BY_DIR = {
    "Practice 1": "fp1",
    "Practice 2": "fp2",
    "Practice 3": "fp3",
    "Sprint Qualifying": "sq",
    "Sprint": "sprint",
    "Qualifying": "q",
    "Race": "race",
}


def _none(v: Any) -> Any:
    if v is None or v in ("None", "nan", "NaN", "") or (isinstance(v, float) and np.isnan(v)):
        return None
    return v


def _num(v: Any) -> float | None:
    v = _none(v)
    try:
        return None if v is None else float(v)
    except (TypeError, ValueError):
        return None


def _ms(v: Any) -> int:
    x = _num(v)
    return -1 if x is None else round(x * 1000)


def _is_int(a: np.ndarray) -> np.ndarray:
    return np.isfinite(a) & np.isclose(a, np.round(a), atol=1e-6)


#: Duración que FastF1 supone para la última vuelta de un coche parado en pista si no sabe cuándo se paró.
FASTF1_ASSUMED_LAP_MS = 150_000


def _no_timing(row: dict[str, Any]) -> bool:
    return all(row[k] < 0 for k in ("lap_ms", "s1_ms", "s2_ms", "s3_ms"))


def real_laps(rows: list[dict[str, Any]], generated: list[bool] | None) -> list[dict[str, Any]]:
    """Vueltas de un coche sin las que inventa FastF1 (la fuente es derivada de FastF1).

    Con la marca `ff1G` (FastF1Generated) se descartan las marcadas. Sin ella, el mismo patrón: el
    tramo final de vueltas sin tiempo ni sectores, desde la que dura exactamente 150 000 ms (el fin
    supuesto de FastF1 para un coche parado en pista) en adelante.
    """
    if generated is not None:
        return [r for r, g in zip(rows, generated, strict=True) if not g]
    order = sorted(range(len(rows)), key=lambda i: rows[i]["lap"])
    tail = len(order)
    while tail > 0 and _no_timing(rows[order[tail - 1]]):
        tail -= 1
    cut = next(
        (
            k
            for k in range(tail, len(order))
            if rows[order[k]]["start_ms"] >= 0
            and rows[order[k]]["end_ms"] - rows[order[k]]["start_ms"] == FASTF1_ASSUMED_LAP_MS
        ),
        len(order),
    )
    drop = set(order[cut:])
    return [r for i, r in enumerate(rows) if i not in drop]


def _flag(value: Any) -> bool:
    return value is True or str(value).strip().lower() == "true"


def load_ti_corners(path: Path) -> CircuitInfo:
    """`corners.json` de TracingInsights (curvas y rotación de MultiViewer, sin sectores de comisarios)."""
    c = json.loads(Path(path).read_text(encoding="utf-8"))
    return CircuitInfo(
        corners=pd.DataFrame(
            {
                "number": [int(v) for v in c["CornerNumber"]],
                "letter": [""] * len(c["CornerNumber"]),
                "x": [float(v) for v in c["X"]],
                "y": [float(v) for v in c["Y"]],
                "angle": [float(v) for v in c["Angle"]],
            }
        ),
        marshal_sectors=None,
        rotation_deg=float(_num(c.get("Rotation")) or 0.0),
        source="multiviewer (vía TracingInsights, dev)",
        dev=True,
    )


def load_tracinginsights(
    session_dir: Path, season: int, round_: int, slug: str, circuit_key: int = 0
) -> SessionData:
    session_dir = Path(session_dir)
    event = session_dir.parent.name
    session_type = SESSION_TYPE_BY_DIR[session_dir.name]
    drivers_raw = json.loads((session_dir / "drivers.json").read_text(encoding="utf-8"))["drivers"]

    drivers: list[Driver] = []
    pos: dict[str, pd.DataFrame] = {}
    car: dict[str, pd.DataFrame] = {}
    lap_rows: list[dict[str, Any]] = []
    t0_candidates: list[pd.Timestamp] = []

    for d in drivers_raw:
        tla, number = d["driver"], str(d["dn"])
        drivers.append(
            Driver(
                number=number,
                tla=tla,
                first=d.get("fn") or "",
                last=d.get("ln") or "",
                team=d.get("team") or "",
                color=f"#{str(d.get('tc') or '9BA4B0').upper()}",
            )
        )
        lt_path = session_dir / tla / "laptimes.json"
        if not lt_path.exists():
            continue
        lt = json.loads(lt_path.read_text(encoding="utf-8"))
        n = len(lt["lap"])
        lap_start = {}
        car_rows: list[dict[str, Any]] = []
        for i in range(n):
            lap = int(_num(lt["lap"][i]) or 0)
            lst = _num(lt["lST"][i])
            lsd = _none(lt["lSD"][i])
            if lst is not None and lsd is not None:
                t0_candidates.append(pd.Timestamp(lsd) - pd.Timedelta(seconds=lst))
            lap_start[lap] = lst
            lap_ms = _ms(lt["time"][i])
            if session_type in ("race", "sprint") and lap == 1:
                lap_ms = -1
            car_rows.append(
                {
                    "car": number,
                    "lap": lap,
                    "start_ms": _ms(lst),
                    "end_ms": _ms(lt["sesT"][i]),
                    "lap_ms": lap_ms,
                    "s1_ms": _ms(lt["s1"][i]),
                    "s2_ms": _ms(lt["s2"][i]),
                    "s3_ms": _ms(lt["s3"][i]),
                    "compound": str(_none(lt["compound"][i]) or "UNKNOWN").upper(),
                    "tyre_life": _num(lt["life"][i]) if _num(lt["life"][i]) is not None else np.nan,
                    "fresh": {True: 1, False: 0}.get(_none(lt["fresh"][i]), -1),
                    "stint": int(_num(lt["stint"][i]) or 0),
                    "pit_in_ms": _ms(lt["pin"][i]),
                    "pit_out_ms": _ms(lt["pout"][i]),
                    "position": int(_num(lt["pos"][i]) or 0),
                    "track_status": str(_none(lt["status"][i]) or ""),
                    "deleted": bool(_none(lt["del"][i]) or False),
                    "accurate": bool(_none(lt["iacc"][i]) or False),
                }
            )
        # Las muestras de posición y telemetría de una vuelta inventada sí son reales: solo sobra la fila.
        generated = [_flag(v) for v in lt["ff1G"]] if "ff1G" in lt else None
        lap_rows += real_laps(car_rows, generated)
        p_parts, c_parts = [], []
        for lap, lst in lap_start.items():
            if lst is None:
                continue
            f = session_dir / tla / f"{lap}_tel.json"
            if not f.exists():
                continue
            tel = json.loads(f.read_text(encoding="utf-8"))["tel"]
            t = np.array([_num(v) if _num(v) is not None else np.nan for v in tel["time"]])
            t_ms = np.rint((lst + t) * 1000)
            cols = {
                k: np.array([_num(v) if _num(v) is not None else np.nan for v in tel[k]])
                for k in ("x", "y", "z", "speed", "rpm", "gear", "throttle", "brake")
            }
            is_pos = _is_int(cols["x"]) & _is_int(cols["y"]) & _is_int(cols["z"]) & np.isfinite(t_ms)
            is_car = _is_int(cols["speed"]) & _is_int(cols["rpm"]) & np.isfinite(t_ms)
            p_parts.append(
                pd.DataFrame(
                    {
                        "t_ms": t_ms[is_pos],
                        "x": cols["x"][is_pos],
                        "y": cols["y"][is_pos],
                        "z": cols["z"][is_pos],
                    }
                )
            )
            c_parts.append(
                pd.DataFrame(
                    {
                        "t_ms": t_ms[is_car],
                        "speed": cols["speed"][is_car],
                        "rpm": cols["rpm"][is_car],
                        "gear": np.nan_to_num(cols["gear"][is_car]),
                        "throttle": np.where(
                            np.isfinite(cols["throttle"][is_car]), cols["throttle"][is_car], 255
                        ),
                        "brake": np.nan_to_num(cols["brake"][is_car]),
                        "drs": np.full(int(is_car.sum()), -1),
                    }
                )
            )
        if p_parts:
            pdf = pd.concat(p_parts).drop_duplicates("t_ms").sort_values("t_ms")
            pos[number] = pdf.astype({"t_ms": np.int64})[list(POS_COLUMNS)].reset_index(drop=True)
        if c_parts:
            cdf = pd.concat(c_parts).drop_duplicates("t_ms").sort_values("t_ms")
            cdf["throttle"] = np.where((cdf["throttle"] < 0) | (cdf["throttle"] > 100), 255, cdf["throttle"])
            car[number] = cdf.astype(dict.fromkeys(CAR_COLUMNS, np.int64))[list(CAR_COLUMNS)].reset_index(
                drop=True
            )

    if not t0_candidates:
        raise ValueError(f"{session_dir}: sin marcas de tiempo para t0")
    t0 = min(t0_candidates)  # el retraso de marcas nunca es negativo (criterio de FastF1)
    laps = (
        pd.DataFrame(lap_rows, columns=list(LAP_COLUMNS)).sort_values(["car", "lap"]).reset_index(drop=True)
    )

    rc_raw = json.loads((session_dir / "rcm.json").read_text(encoding="utf-8"))
    n = len(rc_raw["msg"])

    def col(k: str) -> list[Any]:
        return [_none(v) for v in rc_raw.get(k, [None] * n)]

    times = pd.to_datetime(pd.Series(col("time")))
    rc = (
        pd.DataFrame(
            {
                "t_ms": np.rint((times - t0).dt.total_seconds().to_numpy() * 1000).astype(np.int64),
                "lap": [int(_num(v)) if _num(v) is not None else None for v in col("lap")],
                "category": [v or "Other" for v in col("cat")],
                "flag": col("flag"),
                "scope": col("scope"),
                "sector": [int(_num(v)) if _num(v) is not None else None for v in col("sector")],
                "car": [str(v) if v is not None else None for v in col("dNum")],
                "text": [str(v or "") for v in col("msg")],
                "status": col("status"),
            }
        )[list(RC_COLUMNS)]
        .sort_values("t_ms")
        .reset_index(drop=True)
    )

    corners_path = session_dir / "corners.json"
    circuit_info = load_ti_corners(corners_path) if corners_path.exists() else None

    start_ms = int(laps["start_ms"][laps["start_ms"] >= 0].min()) if len(laps) else None
    return SessionData(
        season=season,
        round=round_,
        event=event,
        country="",
        slug=slug,
        session_type=session_type,
        session_name=session_dir.name,
        date_start=t0.date(),
        t0_utc=t0.to_pydatetime().replace(tzinfo=UTC),
        gmt_offset="+00:00",
        circuit_key=circuit_key,
        drivers=sorted(drivers, key=lambda d: int(d.number)),
        pos=pos,
        car=car,
        laps=laps,
        stream=None,
        track_status=track_status_from_race_control(rc),
        session_status=pd.DataFrame({"t_ms": [start_ms or 0], "status": ["Started"]}),
        race_control=rc,
        circuit_info=circuit_info,
        session_start_ms=start_ms,
        total_laps=int(laps["lap"].max()) if session_type in ("race", "sprint") and len(laps) else None,
        drs_channel=season < 2026,
        source="tracinginsights-dev",
        source_versions={"tracinginsights": "dev"},
        dev=True,
        estimated=["positions", "telemetry", "trackStatus"],
        notes=[
            "Datos de desarrollo (fuente secundaria TracingInsights): no publicar.",
            "Muestras de posición y telemetría reconstruidas desde telemetría fusionada por vuelta.",
            "Estado de pista aproximado desde race control; sin torre de tiempos.",
        ],
    )
