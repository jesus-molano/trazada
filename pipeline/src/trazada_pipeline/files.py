"""Escritura de ficheros de datos con nombre por contenido (inmutables)."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any


def write_hashed(folder: Path, stem: str, suffix: str, payload: bytes, *, layout: str) -> dict[str, Any]:
    """Escribe `{stem}.{hash8}{suffix}` y devuelve la referencia para el manifest.

    Los ficheros anteriores del mismo `stem` NO se borran aquí: se conservan para clientes con
    manifests cacheados y se limpian con `trazada prune` (al menos 7 días después).
    """
    digest = hashlib.sha256(payload).hexdigest()
    name = f"{stem}.{digest[:8]}{suffix}"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / name
    if not path.exists() or path.read_bytes() != payload:
        path.write_bytes(payload)
    compression = "gzip" if suffix.endswith(".gz") else "none"
    return {
        "path": name,
        "bytes": len(payload),
        "sha256": digest,
        "layout": layout,
        "compression": compression,
    }
