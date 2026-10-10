"""Generador de sesiones sintéticas para tests (sin datos reales).

Trazado tipo estadio (dos rectas de 600 m y dos curvas de 100 m de radio, ~1828 m) con la meta en
mitad de la recta inferior y un pit lane paralelo que **cruza s = 0** (entrada en L - 200, salida en
200). Cada coche sigue un guion de tramos lineales en el tiempo; las muestras se toman a ~3,8 Hz con
fluctuación, ruido de ±0,3 m y se redondean a dm, como el feed.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, date, datetime

import numpy as np
import pandas as pd

from trazada_pipeline.circuit.geometry import arclength, resample
from trazada_pipeline.sources.base import (
    CAR_COLUMNS,
    LAP_COLUMNS,
    POS_COLUMNS,
    RC_COLUMNS,
    Driver,
    SessionData,
)

STRAIGHT = 600.0
RADIUS = 100.0
PIT_OFFSET = 20.0
PIT_ENTRY_BEFORE = 200.0  # m antes de la meta
PIT_EXIT_AFTER = 200.0  # m después de la meta
TRACK_SPEED = 50.0
PIT_SPEED = 22.0
START_MS = 60_000


def _track_polyline() -> np.ndarray:
    h = STRAIGHT / 2
    pts = [np.column_stack([np.linspace(0, h, 300, endpoint=False), np.full(300, -RADIUS)])]
    a = np.linspace(-np.pi / 2, np.pi / 2, 400, endpoint=False)
    pts.append(np.column_stack([h + RADIUS * np.cos(a), RADIUS * np.sin(a)]))
    pts.append(np.column_stack([np.linspace(h, -h, 600, endpoint=False), np.full(600, RADIUS)]))
    a = np.linspace(np.pi / 2, 3 * np.pi / 2, 400, endpoint=False)
    pts.append(np.column_stack([-h + RADIUS * np.cos(a), RADIUS * np.sin(a)]))
    pts.append(np.column_stack([np.linspace(-h, 0, 300, endpoint=False), np.full(300, -RADIUS)]))
    xy = np.vstack(pts)
    line = resample(np.column_stack([xy, np.zeros(len(xy))]), 0.5, closed=True)
    s = arclength(line, closed=True)[:-1]
    line[:, 2] = 100.0 + 3.0 * np.sin(2 * np.pi * s / s[-1])  # altitud real: z = 0 es un fallo del feed
    return line


TRACK = _track_polyline()
TRACK_S = arclength(TRACK, closed=True)
L = float(TRACK_S[-1])
PIT_ENTRY_S = L - PIT_ENTRY_BEFORE
PIT_EXIT_S = PIT_EXIT_AFTER
PIT_SPAN = PIT_ENTRY_BEFORE + PIT_EXIT_AFTER


def track_point(s: np.ndarray) -> np.ndarray:
    u = np.mod(s, L)
    closed = np.vstack([TRACK, TRACK[:1]])
    return np.column_stack([np.interp(u, TRACK_S, closed[:, k]) for k in range(3)])


def _pit_polyline() -> np.ndarray:
    e, x = track_point(np.array([PIT_ENTRY_S, PIT_EXIT_S]))
    y = -RADIUS - PIT_OFFSET
    knots = np.array([e, [e[0] + 50, y, 0], [x[0] - 50, y, 0], x])
    line = resample(knots, 0.5, closed=False)
    # z: la de la pista en la s equivalente
    v = arclength(line)
    line[:, 2] = track_point(PIT_ENTRY_S + v / v[-1] * PIT_SPAN)[:, 2]
    return line


PIT = _pit_polyline()
PIT_V = arclength(PIT)
PIT_LEN = float(PIT_V[-1])


def pit_point(v: np.ndarray) -> np.ndarray:
    return np.column_stack([np.interp(v, PIT_V, PIT[:, k]) for k in range(3)])


@dataclass
class Seg:
    mode: str  # track | pit
    t0: float
    t1: float
    p0: float  # track: s acumulada; pit: v
    p1: float
    base: float = 0.0  # pit: s acumulada en la entrada


@dataclass
class CarSim:
    number: str
    t: float
    s: float
    segs: list[Seg] = field(default_factory=list)
    pit_in: list[float] = field(default_factory=list)
    pit_out: list[float] = field(default_factory=list)
    retired_at: float | None = None

    def drive_to(self, s_target: float, speed: float = TRACK_SPEED) -> CarSim:
        dt = (s_target - self.s) / speed * 1000
        self.segs.append(Seg("track", self.t, self.t + dt, self.s, s_target))
        self.t += dt
        self.s = s_target
        return self

    def laps(self, n: float, speed: float = TRACK_SPEED) -> CarSim:
        return self.drive_to(self.s + n * L, speed)

    def to_pit_entry(self) -> CarSim:
        k = np.floor((self.s - PIT_ENTRY_S) / L) + 1
        return self.drive_to(PIT_ENTRY_S + k * L)

    def hold(self, seconds: float) -> CarSim:
        last = self.segs[-1]
        p = last.p1
        self.segs.append(Seg(last.mode, self.t, self.t + seconds * 1000, p, p, last.base))
        self.t += seconds * 1000
        return self

    def pit(self, stop_at_v: float | None = None, stop_s: float = 0.0, speed: float = PIT_SPEED) -> CarSim:
        base = self.s
        self.pit_in.append(self.t)
        stops = [] if stop_at_v is None else [(stop_at_v, stop_s)]
        v = 0.0
        for sv, ss in [*stops, (PIT_LEN, 0.0)]:
            dt = (sv - v) / speed * 1000
            self.segs.append(Seg("pit", self.t, self.t + dt, v, sv, base))
            self.t += dt
            v = sv
            if ss:
                self.hold(ss)
        self.pit_out.append(self.t)
        self.s = base + PIT_SPAN
        return self

    def retire(self, end_ms: float) -> CarSim:
        self.retired_at = self.t
        return self.hold((end_ms - self.t) / 1000)

    # --- verdad ---
    def knots(self) -> tuple[np.ndarray, np.ndarray]:
        t, s = [], []
        for g in self.segs:
            for tt, p in ((g.t0, g.p0), (g.t1, g.p1)):
                t.append(tt)
                s.append(p if g.mode == "track" else g.base + p / PIT_LEN * PIT_SPAN)
        return np.array(t), np.array(s)

    def truth(self, times: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """(xyz en m, s acumulada equivalente, modo 0 pista / 1 pit) en cada instante."""
        xyz = np.zeros((len(times), 3))
        s_eq = np.zeros(len(times))
        mode = np.zeros(len(times), dtype=np.uint8)
        for g in self.segs:
            sel = (times >= g.t0) & (times <= g.t1)
            if not sel.any():
                continue
            f = (times[sel] - g.t0) / max(g.t1 - g.t0, 1e-9)
            p = g.p0 + f * (g.p1 - g.p0)
            if g.mode == "track":
                xyz[sel] = track_point(p)
                s_eq[sel] = p
            else:
                xyz[sel] = pit_point(p)
                s_eq[sel] = g.base + p / PIT_LEN * PIT_SPAN
                mode[sel] = 1
        return xyz, s_eq, mode


def _sample_times(rng: np.random.Generator, t0: float, t1: float, mean_ms: float = 263.0) -> np.ndarray:
    n = int((t1 - t0) / mean_ms) + 2
    t = t0 + np.cumsum(rng.uniform(mean_ms - 30, mean_ms + 30, n))
    return np.rint(t[t <= t1]).astype(np.int64)


def _laps(car: CarSim, end_ms: float) -> list[dict]:
    kt, ks = car.knots()
    order = np.argsort(kt, kind="stable")
    kt, ks = kt[order], ks[order]
    n_full = int(np.floor(ks.max() / L))
    # instante del primer paso por cada múltiplo de L (s no decreciente)
    cross = [float(kt[0])] + [float(np.interp(k * L, ks, kt)) for k in range(1, n_full + 1)]
    rows = []
    for i in range(len(cross)):
        start = cross[i]
        end = cross[i + 1] if i + 1 < len(cross) else None
        if end is None and car.retired_at is None:
            break
        lap = i + 1
        pin = next((p for p in car.pit_in if start <= p < (end if end is not None else end_ms + 1)), -1)
        pout = next((p for p in car.pit_out if start <= p < (end if end is not None else end_ms + 1)), -1)
        rows.append(
            {
                "car": car.number,
                "lap": lap,
                "start_ms": round(start),
                "end_ms": round(end) if end is not None else -1,
                "lap_ms": round(end - start) if end is not None and lap > 1 else -1,
                "s1_ms": -1,
                "s2_ms": -1,
                "s3_ms": -1,
                "compound": "MEDIUM",
                "tyre_life": float(lap),
                "fresh": 1,
                "stint": 1 + sum(1 for p in car.pit_out if p <= start),
                "pit_in_ms": round(pin) if pin >= 0 else -1,
                "pit_out_ms": round(pout) if pout >= 0 else -1,
                "position": 0,
                "track_status": "1",
                "deleted": False,
                "accurate": True,
            }
        )
    return rows


def scenario_cars(end_ms: float) -> list[CarSim]:
    """Coches 1 a 6 con los casos del criterio de H2."""
    cars = []
    # 1: parada normal con el box después de s = 0 (cruce de la meta dentro del pit lane)
    c = CarSim("1", START_MS, 1.0).laps(3).to_pit_entry().pit(stop_at_v=PIT_ENTRY_BEFORE + 20, stop_s=2.5)
    cars.append(c.laps(4))
    # 2: drive-through (sin parar)
    cars.append(CarSim("2", START_MS + 1500, 1.0).laps(2).to_pit_entry().pit().laps(5))
    # 3: se para en pista a mitad de vuelta y abandona
    c3 = CarSim("3", START_MS + 3000, 1.0).laps(4)
    cars.append(c3.drive_to(c3.s + 900).retire(end_ms))
    # 4: bandera roja: cola en el pit lane, parado 10 min junto a la salida
    c = CarSim("4", START_MS + 4500, 1.0).laps(5).to_pit_entry().pit(stop_at_v=PIT_LEN - 25, stop_s=600)
    cars.append(c.laps(2))
    # 5, 6: vueltas limpias
    cars.append(CarSim("5", START_MS + 6000, 1.0).laps(8))
    cars.append(CarSim("6", START_MS + 7500, 1.0).laps(8))
    return cars


def synthetic_session(seed: int = 2026, noise_m: float = 0.3) -> tuple[SessionData, dict[str, CarSim]]:
    rng = np.random.default_rng(seed)
    end_ms = START_MS + 1_100_000
    cars = scenario_cars(end_ms)
    pos, car_data, laps = {}, {}, []
    for c in cars:
        t = _sample_times(rng, c.segs[0].t0, min(c.t, end_ms))
        xyz, _, _ = c.truth(t.astype(np.float64))
        xyz += rng.normal(0, noise_m, xyz.shape) * np.array([1, 1, 0.3])
        dm = np.rint(xyz * 10).astype(np.int64)
        pos[c.number] = pd.DataFrame({"t_ms": t, "x": dm[:, 0], "y": dm[:, 1], "z": dm[:, 2]})[
            list(POS_COLUMNS)
        ]
        tc = _sample_times(rng, c.segs[0].t0, min(c.t, end_ms), 270.0)
        _, _, mode = c.truth(tc.astype(np.float64))
        speed = np.where(mode == 1, PIT_SPEED, TRACK_SPEED) * 3.6
        car_data[c.number] = pd.DataFrame(
            {
                "t_ms": tc,
                "speed": np.rint(speed).astype(np.int64),
                "rpm": np.full(len(tc), 10500),
                "gear": np.full(len(tc), 7),
                "throttle": np.full(len(tc), 100),
                "brake": np.zeros(len(tc), np.int64),
                "drs": np.full(len(tc), -1),
            }
        )[list(CAR_COLUMNS)]
        laps += _laps(c, end_ms)
    laps_df = pd.DataFrame(laps, columns=list(LAP_COLUMNS))
    finish = max(float(r["end_ms"]) for r in laps)
    red = next(c for c in cars if c.number == "4").pit_in[0]
    rc = pd.DataFrame(
        [
            (round(red), None, "Flag", "RED", "Track", None, None, "RED FLAG", None),
            (
                round(red + 600_000),
                None,
                "Flag",
                "GREEN",
                "Track",
                None,
                None,
                "GREEN LIGHT - PIT EXIT OPEN",
                None,
            ),
            (round(finish), None, "Flag", "CHEQUERED", "Track", None, None, "CHEQUERED FLAG", None),
        ],
        columns=list(RC_COLUMNS),
    )
    data = SessionData(
        season=2026,
        round=0,
        event="Synthetic Grand Prix",
        country="Nowhere",
        slug="synthetic",
        session_type="race",
        session_name="Race",
        date_start=date(2026, 1, 1),
        t0_utc=datetime(2026, 1, 1, 12, 0, tzinfo=UTC),
        gmt_offset="+00:00",
        circuit_key=0,
        drivers=[
            Driver(c.number, chr(64 + int(c.number)) * 3, "Test", f"Driver {c.number}", "Team", "#3366FF")
            for c in cars
        ],
        pos=pos,
        car=car_data,
        laps=laps_df,
        stream=None,
        track_status=pd.DataFrame({"t_ms": [0, round(red), round(red + 600_000)], "code": [1, 5, 1]}),
        session_status=pd.DataFrame({"t_ms": [START_MS - 1000], "status": ["Started"]}),
        race_control=rc,
        circuit_info=None,
        session_start_ms=START_MS - 1000,
        total_laps=8,
        drs_channel=False,
        source="synthetic",
        source_versions={},
        dev=True,
    )
    return data, {c.number: c for c in cars}
