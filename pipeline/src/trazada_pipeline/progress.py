"""Progreso legible por máquina para el gestor de datos local (`trazada build --progress`).

Cada evento es una línea en stdout: `::<tipo> <json>`. Tipos: `progress` ({pct, phase, step}), `result`
({session, status, bytes, warnings}) y `error` ({code, message}). El servidor local las lee; el resto de la
salida (logs de FastF1 en stderr) solo se guarda como registro.
"""

from __future__ import annotations

import json
import logging
import sys
from typing import Any

PREFIX = "::"

#: Mensajes INFO de FastF1 (descarga o caché) → (porcentaje, paso). Se prueba en orden: lo más específico
#: primero. Si FastF1 cambia sus textos, el progreso se queda en el último paso reconocido (no falla nada).
FASTF1_STEPS: tuple[tuple[str, int, str], ...] = (
    ("finished loading data", 85, "loaded"),
    ("loading data for", 2, "start"),
    ("session info", 5, "session"),
    ("session_info", 5, "session"),
    ("driver list", 8, "drivers"),
    ("driver_info", 8, "drivers"),
    ("timing app data", 20, "timing"),
    ("timing_app_data", 20, "timing"),
    ("processing timing data", 24, "timing"),
    ("timing data", 12, "timing"),
    ("timing_data", 12, "timing"),
    ("track status", 28, "status"),
    ("track_status", 28, "status"),
    ("session status", 30, "status"),
    ("session_status", 30, "status"),
    ("race control", 32, "messages"),
    ("race_control", 32, "messages"),
    ("parsing car data", 50, "car"),
    ("car data", 40, "car"),
    ("car_data", 40, "car"),
    ("parsing position data", 75, "position"),
    ("position data", 60, "position"),
    ("position_data", 60, "position"),
)


def emit(kind: str, payload: dict[str, Any]) -> None:
    sys.stdout.write(f"{PREFIX}{kind} {json.dumps(payload, ensure_ascii=False)}\n")
    sys.stdout.flush()


class Progress:
    """Porcentaje monótono: nunca retrocede aunque FastF1 repita pasos."""

    def __init__(self) -> None:
        self.pct = 0

    def step(self, pct: int, phase: str, step: str) -> None:
        if pct <= self.pct:
            return
        self.pct = pct
        emit("progress", {"pct": pct, "phase": phase, "step": step})


#: Excepciones que indican que no hay red (por nombre de clase, para no importar requests aquí).
NETWORK_ERRORS = frozenset({"ConnectionError", "Timeout", "ConnectTimeout", "ReadTimeout", "TimeoutError"})


def _is_network(exc: BaseException | None) -> bool:
    return exc is not None and bool(NETWORK_ERRORS & {cls.__name__ for cls in type(exc).__mro__})


class FastF1ProgressHandler(logging.Handler):
    """Traduce los logs de FastF1 a pasos de descarga y detecta los fallos de red.

    FastF1 se traga los errores de descarga (los registra en DEBUG con la traza): `network` se activa si
    alguno era de red, para explicar el fallo final como «sin conexión» y no como un error genérico.
    """

    def __init__(self, progress: Progress | None) -> None:
        super().__init__(logging.DEBUG)
        self.progress = progress
        self.network = False

    def emit(self, record: logging.LogRecord) -> None:
        if record.exc_info and _is_network(record.exc_info[1]):
            self.network = True
        if self.progress is None or record.levelno < logging.INFO:
            return
        try:
            msg = record.getMessage().lower()
        except Exception:  # un log mal formado no debe tumbar la descarga
            return
        for needle, pct, step in FASTF1_STEPS:
            if needle in msg:
                self.progress.step(pct, "download", step)
                return


def attach_fastf1(progress: Progress | None) -> FastF1ProgressHandler:
    """Escucha los logs de FastF1 (también antes de importarlo: FastF1 configura después su logger)."""
    logger = logging.getLogger("fastf1")
    if logger.getEffectiveLevel() > logging.DEBUG:
        logger.setLevel(logging.DEBUG)
    handler = FastF1ProgressHandler(progress)
    logger.addHandler(handler)
    return handler


def detach_fastf1(handler: FastF1ProgressHandler) -> None:
    logging.getLogger("fastf1").removeHandler(handler)


def error_code(exc: BaseException, *, network: bool = False) -> str:
    """Clasifica un fallo para que la interfaz explique qué hacer (el mensaje va aparte, como registro).

    `network`: FastF1 registró fallos de red mientras cargaba; un fallo posterior genérico o de sesión vacía
    se debe casi seguro a eso.
    """
    from trazada_pipeline.sources.fastf1_source import EmptySessionError

    chain: list[BaseException] = []
    cur: BaseException | None = exc
    while cur is not None and len(chain) < 8:  # la causa original (raise … from exc) también cuenta
        chain.append(cur)
        cur = cur.__cause__ or cur.__context__
    names = {cls.__name__ for e in chain for cls in type(e).__mro__}
    if "RateLimitExceededError" in names:
        return "ratelimit"
    if any(_is_network(e) for e in chain) or "RequestException" in names:
        return "network"
    if network:
        return "network"
    if isinstance(exc, EmptySessionError):
        return "empty"
    return "failed"
