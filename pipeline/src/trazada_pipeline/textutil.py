"""Utilidades de texto."""

from __future__ import annotations

import re
import unicodedata


def slugify(text: str) -> str:
    """'São Paulo' → 'sao-paulo'; 'Spa-Francorchamps' → 'spa-francorchamps'."""
    norm = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii").lower()
    return re.sub(r"[^a-z0-9]+", "-", norm).strip("-") or "x"
