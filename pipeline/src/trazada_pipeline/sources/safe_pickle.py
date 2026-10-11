"""Carga de cachés `.ff1pkl` de terceros SIN ejecutar código arbitrario.

`pickle.load` sobre un fichero ajeno puede ejecutar código. Este Unpickler solo admite una lista
blanca exacta de clases de pandas/numpy/datetime (las que usa la caché de FastF1) y falla con
cualquier otra referencia global.
"""

from __future__ import annotations

import pickle
from pathlib import Path
from typing import Any

ALLOWED: frozenset[tuple[str, str]] = frozenset(
    {
        ("pandas.core.frame", "DataFrame"),
        ("pandas.core.internals.managers", "BlockManager"),
        ("pandas._libs.internals", "_unpickle_block"),
        ("pandas._libs.arrays", "__pyx_unpickle_NDArrayBacked"),
        ("pandas.core.arrays.datetimes", "DatetimeArray"),
        ("pandas.core.arrays.timedeltas", "TimedeltaArray"),
        ("pandas.core.indexes.base", "_new_Index"),
        ("pandas.core.indexes.base", "Index"),
        ("pandas.core.indexes.range", "RangeIndex"),
        ("numpy", "dtype"),
        ("numpy", "ndarray"),
        ("numpy._core.multiarray", "_reconstruct"),
        ("numpy._core.numeric", "_frombuffer"),
        ("numpy.core.multiarray", "_reconstruct"),
        ("numpy.core.numeric", "_frombuffer"),
        ("builtins", "slice"),
        ("datetime", "datetime"),
        ("datetime", "timedelta"),
        ("datetime", "timezone"),
    }
)


class UnsafePickleError(pickle.UnpicklingError):
    pass


class RestrictedUnpickler(pickle.Unpickler):
    def find_class(self, module: str, name: str) -> Any:
        if (module, name) not in ALLOWED:
            raise UnsafePickleError(f"referencia global no permitida: {module}.{name}")
        return super().find_class(module, name)


def safe_load(path: Path) -> Any:
    with path.open("rb") as fh:
        return RestrictedUnpickler(fh).load()
