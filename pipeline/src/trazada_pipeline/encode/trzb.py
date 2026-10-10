"""Contenedor binario TRZB (ver docs/DATA_FORMAT.md).

Formato (little-endian):
    "TRZB" | u16 containerVersion | u16 flags | u32 headerLen | header JSON UTF-8 |
    padding a 8 | columnas, cada una alineada a 8 (byteOffset relativo al inicio de la sección de datos)

El codificador valida las tablas contra el layout compartido (packages/schema/trzb/*.layout.json):
tablas y columnas exactas, mismo nº de filas por tabla, valores representables sin pérdida en el tipo
del disco (con la cuantización `scale`/`offset` del layout) y deltas dentro del rango del tipo.
"""

from __future__ import annotations

import gzip
import json
import struct
from dataclasses import dataclass
from typing import Any

import numpy as np

from trazada_pipeline import schema

MAGIC = b"TRZB"
PREAMBLE = struct.Struct("<4sHHI")  # magic, containerVersion, flags, headerLen
ALIGN = 8

DTYPES: dict[str, str] = {
    "u8": "<u1",
    "i8": "<i1",
    "u16": "<u2",
    "i16": "<i2",
    "u32": "<u4",
    "i32": "<i4",
    "f32": "<f4",
    "f64": "<f8",
}
INT_TYPES = {"u8", "i8", "u16", "i16", "u32", "i32"}


class TrzbError(ValueError):
    """Error de validación o de formato TRZB."""


def _align(n: int) -> int:
    return (n + ALIGN - 1) // ALIGN * ALIGN


def _quantize(name: str, values: np.ndarray, spec: dict[str, Any]) -> np.ndarray:
    """Convierte valores físicos al entero/float del disco, sin pérdidas silenciosas."""
    typ = spec["type"]
    scale = spec.get("scale")
    offset = spec.get("offset", 0)
    arr = np.asarray(values)
    if arr.ndim != 1:
        raise TrzbError(f"columna {name}: se esperaba un array 1D")
    if typ in INT_TYPES:
        if scale is not None or offset:
            q = np.rint((arr.astype(np.float64) - offset) / (scale if scale is not None else 1.0))
        else:
            if arr.dtype.kind == "f":
                if not np.all(np.isfinite(arr)):
                    raise TrzbError(f"columna {name}: contiene NaN/inf")
                if not np.all(np.equal(np.mod(arr, 1), 0)):
                    raise TrzbError(f"columna {name}: valores no enteros para tipo {typ}")
            q = arr
        return q.astype(np.int64)
    # floats
    if scale is not None or offset:
        return ((arr.astype(np.float64) - offset) / scale).astype(np.float64)
    return arr.astype(np.float64)


def _to_disk(name: str, values: np.ndarray, spec: dict[str, Any]) -> np.ndarray:
    typ = spec["type"]
    dtype = np.dtype(DTYPES[typ])
    q = _quantize(name, values, spec)
    if spec.get("encoding") == "delta":
        if typ not in INT_TYPES:
            raise TrzbError(f"columna {name}: encoding delta solo admite enteros")
        q = np.diff(q, prepend=np.int64(0)) if q.size else q
    if typ in INT_TYPES:
        info = np.iinfo(dtype)
        if q.size and (q.min() < info.min or q.max() > info.max):
            raise TrzbError(f"columna {name}: valores fuera de rango para {typ} [{q.min()}, {q.max()}]")
        return q.astype(dtype)
    out = q.astype(dtype)
    if q.size and not np.all(np.isfinite(out[np.isfinite(q)])):
        raise TrzbError(f"columna {name}: desbordamiento al convertir a {typ}")
    return out


def encode(
    layout_name: str,
    tables: dict[str, dict[str, Any]],
    meta: dict[str, Any] | None = None,
) -> bytes:
    """Codifica tablas (valores físicos) según el layout compartido. Determinista."""
    lay = schema.layout(layout_name)
    spec_tables: dict[str, Any] = lay["tables"]
    if set(tables) != set(spec_tables):
        raise TrzbError(
            f"{layout_name}: tablas {sorted(tables)} no coinciden con el layout {sorted(spec_tables)}"
        )
    header_tables: list[dict[str, Any]] = []
    chunks: list[bytes] = []
    cursor = 0
    for tname, tspec in spec_tables.items():
        cols_spec: dict[str, Any] = tspec["columns"]
        given = tables[tname]
        if set(given) != set(cols_spec):
            raise TrzbError(
                f"{layout_name}.{tname}: columnas {sorted(given)} no coinciden con {sorted(cols_spec)}"
            )
        lengths = {c: len(np.asarray(v)) for c, v in given.items()}
        if len(set(lengths.values())) > 1:
            raise TrzbError(f"{layout_name}.{tname}: columnas con distinto nº de filas {lengths}")
        rows = next(iter(lengths.values())) if lengths else 0
        header_cols: list[dict[str, Any]] = []
        for cname, cspec in cols_spec.items():
            disk = _to_disk(f"{tname}.{cname}", given[cname], cspec)
            raw = disk.tobytes()
            col: dict[str, Any] = {"name": cname, "type": cspec["type"]}
            for key in ("encoding", "scale", "offset", "unit", "decode"):
                if key in cspec:
                    col[key] = cspec[key]
            col["byteOffset"] = cursor
            col["byteLength"] = len(raw)
            header_cols.append(col)
            padded = _align(len(raw))
            chunks.append(raw + b"\0" * (padded - len(raw)))
            cursor += padded
        header_tables.append({"name": tname, "rows": rows, "columns": header_cols})

    header = {
        "layout": layout_name,
        "revision": lay["revision"],
        "schemaVersion": schema.schema_version(),
        "tables": header_tables,
        "meta": meta or {},
    }
    header_bytes = json.dumps(header, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode(
        "utf-8"
    )
    preamble = PREAMBLE.pack(MAGIC, schema.versions()["containerVersion"], 0, len(header_bytes))
    head = preamble + header_bytes
    head += b"\0" * (_align(len(head)) - len(head))
    return head + b"".join(chunks)


@dataclass(frozen=True)
class Decoded:
    header: dict[str, Any]
    tables: dict[str, dict[str, np.ndarray]]

    @property
    def meta(self) -> dict[str, Any]:
        return self.header.get("meta", {})


def decode(data: bytes) -> Decoded:
    """Decodifica a valores físicos (para tests y validación del pipeline)."""
    if len(data) < PREAMBLE.size:
        raise TrzbError("fichero demasiado corto")
    magic, version, _flags, header_len = PREAMBLE.unpack_from(data, 0)
    if magic != MAGIC:
        raise TrzbError("magic incorrecto: no es un fichero TRZB")
    if version != schema.versions()["containerVersion"]:
        raise TrzbError(f"containerVersion {version} no soportada")
    header = json.loads(data[PREAMBLE.size : PREAMBLE.size + header_len].decode("utf-8"))
    base = _align(PREAMBLE.size + header_len)
    tables: dict[str, dict[str, np.ndarray]] = {}
    for table in header["tables"]:
        cols: dict[str, np.ndarray] = {}
        for col in table["columns"]:
            dtype = np.dtype(DTYPES[col["type"]])
            start = base + col["byteOffset"]
            arr = np.frombuffer(data, dtype=dtype, count=table["rows"], offset=start)
            values: np.ndarray = arr.astype(np.int64) if col["type"] in INT_TYPES else arr.astype(np.float64)
            if col.get("encoding") == "delta":
                values = np.cumsum(values)
            if "scale" in col or "offset" in col:
                values = values.astype(np.float64) * col.get("scale", 1.0) + col.get("offset", 0.0)
            cols[col["name"]] = values
        tables[table["name"]] = cols
    return Decoded(header=header, tables=tables)


def gzip_bytes(data: bytes) -> bytes:
    """gzip determinista (mtime=0, sin nombre de fichero)."""
    return gzip.compress(data, compresslevel=9, mtime=0)
