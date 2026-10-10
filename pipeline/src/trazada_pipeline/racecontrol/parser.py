"""Parser de mensajes de dirección de carrera (especificación: docs/RACE_CONTROL.md).

El texto original nunca se modifica: `parse` devuelve solo la interpretación estructurada.
Las horas que aparecen en el texto son locales del circuito y se ignoran.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass

_TIME_HMS = re.compile(r"\(?\b\d{1,2}:\d{2}:\d{2}\b\)?")
_TIMED_AT = re.compile(r"\s*TIMED AT\s+\d{1,2}:\d{2}:\d{2}")
_CAR = re.compile(r"\bCARS?\s+((?:\d{1,3}\s*(?:\(\w{2,4}\))?\s*(?:,|AND|&)?\s*)+)")
_CAR_NUM = re.compile(r"\b(\d{1,3})\b\s*(?:\(\w{2,4}\))?")
_LIST = re.compile(r":\s*((?:\d{1,2}\s*(?:[,-]\s*)?)+)$")  # "…: 1, 16, 44" o "…: 1 - 44 - 14"
_TURN = re.compile(r"\bTURNS?\s+(\d{1,2})\b")
_LAP = re.compile(r"\bLAP\s+(\d{1,3})\b(?!\s+DELETED)")
_ZONE = re.compile(r"\bZONE\s+(\d+)\b")
_REASON = re.compile(r"\s[-\u2013]\s(.+)$")  # guion o raya (los textos reales usan ambos)


@dataclass(frozen=True)
class Parsed:
    kind: str
    cars: list[str]
    turn: int | None
    lap: int | None
    outcome: str | None = None
    detail: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)


def _strip_times(text: str) -> str:
    text = _TIMED_AT.sub("", text)
    return re.sub(r"\s{2,}", " ", _TIME_HMS.sub("", text)).strip()


def _cars(text: str) -> list[str]:
    out: list[str] = []
    for m in _CAR.finditer(text):
        for num in _CAR_NUM.findall(m.group(1)):
            if num not in out:
                out.append(num)
    return out


def _listed(text: str) -> list[str]:
    """Números listados tras los dos puntos finales ("ORDER FOR RESTART: 1, 16, 44")."""
    m = _LIST.search(text)
    return [] if not m else list(dict.fromkeys(re.findall(r"\d{1,2}", m.group(1))))


def _turn(text: str) -> int | None:
    m = _TURN.search(text)
    return int(m.group(1)) if m else None


def _lap(text: str) -> int | None:
    m = _LAP.search(text)
    return int(m.group(1)) if m else None


def _reason(text: str) -> str | None:
    """Motivo tras el último ' - ' (sin horas ni la referencia 'AT TURN n …')."""
    clean = _strip_times(text)
    m = _REASON.search(clean)
    if not m:
        return None
    reason = m.group(1).strip()
    reason = re.sub(r"\s+AT TURN\s+\d+.*$", "", reason)
    reason = re.sub(r"\s+LAP\s+\d+$", "", reason)  # la vuelta ya va en `lap`
    reason = re.sub(r"\s*\((?:NEXT LAP(?: PIT)?|\w{3})\)$", "", reason)
    return reason.strip() or None


_INCIDENT_STATUS = [
    (re.compile(r"REVIEWED NO FURTHER INVESTIGATION"), "no_further_investigation"),
    (re.compile(r"NO FURTHER INVESTIGATION"), "no_further_investigation"),
    (re.compile(r"NO FURTHER ACTION"), "no_further_action"),
    (re.compile(r"WILL BE INVESTIGATED AFTER"), "investigated_after"),
    (re.compile(r"UNDER INVESTIGATION"), "under_investigation"),
    (re.compile(r"\bNOTED\b"), "noted"),
]

_PENALTY = [
    (re.compile(r"\bSECOND TIME PENALTY\b"), "time_penalty"),
    (re.compile(r"\bDRIVE[ -]THROUGH PENALTY\b"), "drive_through"),
    (re.compile(r"\bSTOP AND GO PENALTY\b|\bSTOP/GO\b|\bSTOP-GO\b"), "stop_go"),
    (re.compile(r"\bGRID (?:PLACE )?PENALTY\b|\bPLACE GRID\b"), "grid_penalty"),
    (re.compile(r"\bREPRIMAND\b"), "reprimand"),
    (re.compile(r"\bDISQUALIFIED\b|\bDISQUALIFICATION\b"), "disqualified"),
    (re.compile(r"\bWARNING\b"), "warning"),
    (re.compile(r"\bPENALTY\b"), "other"),
]


def _simple(kind: str) -> Parsed:
    return Parsed(kind=kind, cars=[], turn=None, lap=None)


def parse(text: str) -> Parsed:
    raw = (text or "").strip()
    t = re.sub(r"^(?:CORRECTION|UPDATE):\s*", "", raw.upper()).strip()
    t = re.sub(r"^FIA STEWARDS:\s*(?=BLACK)", "", t)
    cars = _cars(t)
    turn = _turn(t)
    lap = _lap(t)

    def p(kind: str, outcome: str | None = None, detail: str | None = None, **over: object) -> Parsed:
        base = {"kind": kind, "cars": cars, "turn": turn, "lap": lap, "outcome": outcome, "detail": detail}
        base.update(over)
        return Parsed(**base)  # type: ignore[arg-type]

    # Banderas por sector de pista
    if re.match(r"^DOUBLE YELLOW IN TRACK SECTOR \d+", t):
        return p("sector_double_yellow")
    if re.match(r"^YELLOW IN TRACK SECTOR \d+", t):
        return p("sector_yellow")
    if re.match(r"^CLEAR IN TRACK SECTOR \d+", t):
        return p("sector_clear")
    if re.match(r"^TRACK SURFACE SLIPPERY", t):
        return p("slippery_surface")
    if t == "TRACK CLEAR":
        return p("track_clear")
    if t.startswith("GREEN LIGHT"):
        return p("green_light")
    if re.match(r"^RED FLAG\b", t):
        return p("red_flag")
    if t.startswith("CHEQUERED FLAG"):
        return p("chequered_flag")
    if t.startswith("FIRST CAR TO TAKE THE FLAG"):
        return p("first_car_flag")
    if re.search(r"\bBLUE FLAG\b", t):
        return p("blue_flag")
    if t.startswith("BLACK AND WHITE FLAG"):
        return p("black_and_white_flag", detail=_reason(t))
    if t.startswith("BLACK AND ORANGE FLAG"):
        return p("black_and_orange_flag", detail=_reason(t))
    if t.startswith("BLACK FLAG"):
        return p("black_flag", detail=_reason(t))
    if t.startswith("YELLOW IN PIT LANE"):
        return p("yellow_pit_lane")

    # Pit lane
    if re.match(r"^PIT EXIT CLOSED", t):
        return p("pit_exit_closed")
    if re.match(r"^PIT EXIT OPEN", t):
        return p("pit_exit_open")
    if re.match(r"^PIT (?:LANE )?ENTRY CLOSED", t):
        return p("pit_entry_closed")
    if re.match(r"^PIT (?:LANE )?ENTRY OPEN", t):
        return p("pit_entry_open")
    if t.startswith("PIT LANE CLEAR"):
        return p("pit_lane_clear")

    # Coche de seguridad
    if re.match(r"^(?:VIRTUAL SAFETY CAR|VSC) DEPLOYED", t):
        return p("vsc_deployed")
    if re.match(r"^(?:VIRTUAL SAFETY CAR|VSC) ENDING", t):
        return p("vsc_ending")
    if t.startswith("SAFETY CAR DEPLOYED"):
        return p("sc_deployed")
    if t.startswith("SAFETY CAR IN THIS LAP"):
        return p("sc_in_this_lap")
    if t.startswith("SAFETY CAR ENDING"):
        return p("sc_ending")
    if re.match(r"^(?:LAPPED CARS?\b|ALL CARS MAY OVERTAKE THE SAFETY CAR)", t):
        allowed = "not_allowed" if re.search(r"\bNOT\b", t) else "allowed"
        return p("lapped_cars_overtake", outcome=allowed, cars=cars or _listed(t))
    if t.startswith("MEDICAL CAR"):
        return p("medical_car")
    if t.startswith("RECOVERY VEHICLE"):
        return p("recovery_vehicle")
    if re.match(r"^MARSHALS? ON TRACK", t):
        return p("marshals_on_track")

    # DRS / Overtake
    m = re.match(r"^DRS (ENABLED|DISABLED)", t)
    if m:
        zone = _ZONE.search(t)
        return p(f"drs_{m.group(1).lower()}", detail=f"ZONE {zone.group(1)}" if zone else None)
    m = re.match(r"^OVERTAKE (ENABLED|DISABLED)", t)
    if m:
        return p(f"overtake_{m.group(1).lower()}")
    if t.startswith("STRAIGHT MODE"):
        return p("straight_mode", detail=_reason(t))
    rolling_or_standing = re.search(r"\b(?:ROLLING|STANDING) START\b", t)
    if (rolling_or_standing and not re.search(r"\bWILL (?:START|RESUME)\b", t)) or re.match(
        r"^DELAYED START\b", t
    ):
        return p("start_procedure")
    if re.match(r"^(?:ORDER FOR RESTART|RESTART ORDER)\b", t):
        return p("start_procedure", cars=cars or _listed(t))
    if re.match(
        r"^(?:THE )?SAFETY CAR (?:LIGHTS|THROUGH|WILL)"
        r"|^ALL CARS (?:THROUGH THE PIT LANE|TO FOLLOW THE SAFETY CAR|USE START/FINISH STRAIGHT)",
        t,
    ):
        return p("sc_procedure")

    # Vueltas o tiempos anulados / restituidos
    if re.search(r"\bREINSTATED\b", t):
        return p("lap_reinstated")
    if re.search(r"\bDELETED\b", t) and t.startswith("CAR"):
        outcome = "time_deleted" if re.search(r"\bTIME\s+\d+:\d{2}\.\d{3}", t) else "lap_deleted"
        return p("lap_deleted", outcome=outcome, detail=_reason(t))

    # Comportamientos en pista (avisos de dirección de carrera)
    if re.search(r"\bOFF TRACK AND CONTINUED\b", t):
        return p("off_track")
    if re.search(r"\bSPUN AND CONTINUED\b", t):
        return p("spun")
    if re.search(r"\bMISSED THE APEX\b", t):
        return p("missed_apex")
    if re.search(r"\bSTOPPED\b", t) and t.startswith("CAR"):
        return p("car_stopped")
    if re.match(r"^CARS? \d+.*\bTRACK LIMITS\b", t):
        return p("track_limits")

    # Comisarios: sanciones e incidentes
    if re.search(r"\bPENALTY SERVED\b", t):
        # "PENALTY SERVED - <sanción> - <motivo>": el detalle es el motivo (puede faltar)
        rest = re.sub(r"^.*?\bPENALTY SERVED\s*[-\u2013]\s*", "", t)
        return p("penalty_served", detail=_reason(rest))
    is_incident = (
        re.search(r"\bINCIDENTS?\b", t) is not None
        or re.match(r"^(?:FIA STEWARDS:\s*)?(?:LAP \d+ TURN \d+|RESTART PROCEDURE)\b", t) is not None
    )
    if not is_incident and re.search(r"\bPENALTY\b|\bREPRIMAND\b|\bDISQUALIFIED\b|\bWARNING FOR CARS?\b", t):
        outcome = next(o for rx, o in _PENALTY if rx.search(t))
        return p("penalty", outcome=outcome, detail=_reason(t))
    if is_incident:
        status = next((o for rx, o in _INCIDENT_STATUS if rx.search(t)), None)
        return p("incident", outcome=status, detail=_reason(t))

    # Horarios de sesión y procedimiento de salida
    if re.search(
        r"\bWILL (?:START|RESUME|NOT RESUME|NOT BE RESUMED|BE RESUMED|END AT|BE EXTENDED"
        r"|BE TEMPORARILY STOPPED)\b|\bWILL BE DELAYED\b|\bDELAYED\b|\bRESUMPTION\b"
        r"|^ESTIMATED (?:TIME OF \w+ START|RESTART TIME)\b",
        t,
    ):
        return p("session_schedule")
    if re.match(
        r"^(?:STANDING START|ROLLING START|EXTRA FORMATION LAP|START ABORTED|ABORTED START|RACE START\b|"
        r"STARTING PROCEDURE|FORMATION LAP WILL BE STARTED|FORMATION LAP\(S\) BEHIND|SPRINT START$|"
        r"START ORDER\b)",
        t,
    ):
        return p("start_procedure")
    if t.startswith("PUSH CARS TO FRONT"):
        return p("start_procedure", cars=cars or _listed(t))

    # Avisos generales
    if re.match(
        r"^(?:RISK OF RAIN|WET TRACK|DRY TRACK|LOW GRIP|NORMAL GRIP|ALL PASS HOLDERS|AWNINGS|TRACK TEST|"
        r"PIT LANE OPEN|PIT EXIT WILL|PIT LANE WILL|.*HEAD PADDING|.*TYRES?\b|"
        r"SESSION SUSPENDED|SESSION ABORTED|"
        r"NO PRACTICE STARTS|AIR TEMPERATURE|SESSION TEMPERATURES|CHANGE IN CLIMATIC|COVERS ON|PARC FERME|"
        r"DRIVERS BRIEFING|TEAMS ARE ALLOWED|ALL CARS ARE RELEASED|TOP \d+ CARS|(?:ORDER FOR )?RESTART ORDER|"
        r"ORDER FOR RESTART|(?:ESTIMATED )?TIME OF PIT EXIT|TEST\b|THIS IS A TEST|WEATHER RADAR|"
        r"F1 - POST-SPRINT PARC)",
        t,
    ):
        return p("info")
    return p("other")


__all__ = ["Parsed", "parse"]
