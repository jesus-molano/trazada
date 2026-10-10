"""Saneado de cachés de FastF1 de terceros para usarlas offline.

Cada `.ff1pkl` se carga con el Unpickler restringido y se vuelve a serializar con `pickle` en una
caché propia: FastF1 solo lee ficheros generados por nosotros a partir de objetos validados.
"""

from __future__ import annotations

import pickle
from pathlib import Path

from trazada_pipeline.sources.safe_pickle import safe_load

#: Ficheros que forman la caché de "datos parseados" de una sesión en FastF1 3.8.
KNOWN_FILES = {
    "_extended_timing_data.ff1pkl",
    "car_data.ff1pkl",
    "driver_info.ff1pkl",
    "position_data.ff1pkl",
    "race_control_messages.ff1pkl",
    "session_info.ff1pkl",
    "session_status_data.ff1pkl",
    "timing_app_data.ff1pkl",
    "track_status_data.ff1pkl",
    "weather_data.ff1pkl",
    "lap_count.ff1pkl",
}


def sanitize_session_cache(src_session_dir: Path, dst_cache_root: Path) -> Path:
    """Copia saneada de `<raíz>/<año>/<evento>/<sesión>/` en `dst_cache_root` (misma estructura)."""
    src_session_dir = src_session_dir.resolve()
    rel = Path(*src_session_dir.parts[-3:])
    dst = dst_cache_root / rel
    dst.mkdir(parents=True, exist_ok=True)
    copied = 0
    for path in sorted(src_session_dir.glob("*.ff1pkl")):
        if path.name not in KNOWN_FILES:
            continue
        obj = safe_load(path)
        if not isinstance(obj, dict) or "data" not in obj or "version" not in obj:
            raise ValueError(f"{path}: estructura de caché FastF1 inesperada")
        with (dst / path.name).open("wb") as fh:
            pickle.dump(obj, fh, protocol=pickle.HIGHEST_PROTOCOL)
        copied += 1
    if copied == 0:
        raise ValueError(f"{src_session_dir}: no hay ficheros .ff1pkl reconocibles")
    return dst
