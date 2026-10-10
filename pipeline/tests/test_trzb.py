from __future__ import annotations

import gzip
import json
import os
from pathlib import Path

import numpy as np
import pytest
from golden_data import GOLDEN_META, golden_tables

from trazada_pipeline import schema
from trazada_pipeline.encode import trzb

GOLDEN_DIR = schema.schema_dir() / "test" / "golden"


def _as_jsonable(tables: dict[str, dict[str, np.ndarray]]) -> dict[str, dict[str, list[float]]]:
    return {t: {c: [float(x) for x in np.asarray(v)] for c, v in cols.items()} for t, cols in tables.items()}


@pytest.mark.parametrize("name", ["motion", "car", "circuit", "timing"])
def test_roundtrip_exact(name: str) -> None:
    tables = golden_tables()[name]
    data = trzb.encode(name, tables, GOLDEN_META[name])
    dec = trzb.decode(data)
    assert dec.header["layout"] == name
    assert dec.header["schemaVersion"] == schema.schema_version()
    assert dec.meta == GOLDEN_META[name]
    for tname, cols in tables.items():
        for cname, values in cols.items():
            expected = np.asarray(values, dtype=np.float64)
            got = dec.tables[tname][cname]
            spec = schema.layout(name)["tables"][tname]["columns"][cname]
            if spec["type"] == "f32":
                np.testing.assert_array_equal(got, expected.astype(np.float32).astype(np.float64))
            else:
                np.testing.assert_allclose(got, expected, rtol=0, atol=1e-9)


def test_encode_is_deterministic() -> None:
    tables = golden_tables()["motion"]
    assert trzb.encode("motion", tables) == trzb.encode("motion", tables)
    assert trzb.gzip_bytes(b"abc") == trzb.gzip_bytes(b"abc")


def test_columns_are_8_byte_aligned() -> None:
    data = trzb.encode("car", golden_tables()["car"])
    _, _, _, hlen = trzb.PREAMBLE.unpack_from(data, 0)
    header = json.loads(data[trzb.PREAMBLE.size : trzb.PREAMBLE.size + hlen])
    base = (trzb.PREAMBLE.size + hlen + 7) // 8 * 8
    for table in header["tables"]:
        for col in table["columns"]:
            assert (base + col["byteOffset"]) % 8 == 0


def test_rejects_wrong_columns() -> None:
    tables = golden_tables()["car"]
    tables["tel"] = {k: v for k, v in tables["tel"].items() if k != "rpm"}
    with pytest.raises(trzb.TrzbError, match="columnas"):
        trzb.encode("car", tables)


def test_rejects_out_of_range_and_non_integers() -> None:
    tables = golden_tables()["car"]
    tables["tel"]["speed"] = [0, 1, 2, 3, 4, 70000]
    with pytest.raises(trzb.TrzbError, match="fuera de rango"):
        trzb.encode("car", tables)
    tables = golden_tables()["car"]
    tables["tel"]["gear"] = [0, 1.5, 2, 3, 4, 5]
    with pytest.raises(trzb.TrzbError, match="no enteros"):
        trzb.encode("car", tables)


def test_rejects_mismatched_rows() -> None:
    tables = golden_tables()["car"]
    tables["tel"]["speed"] = [0, 1]
    with pytest.raises(trzb.TrzbError, match="filas"):
        trzb.encode("car", tables)


def test_bad_magic() -> None:
    with pytest.raises(trzb.TrzbError, match="magic"):
        trzb.decode(b"XXXX" + b"\0" * 20)


@pytest.mark.parametrize("name", ["motion", "car", "circuit", "timing"])
def test_golden_files_match(name: str) -> None:
    """El fichero dorado (que decodifica el test de TS) es exactamente lo que produce el codificador."""
    data = trzb.encode(name, golden_tables()[name], GOLDEN_META[name])
    path: Path = GOLDEN_DIR / f"{name}.trzb.gz"
    expected_json = GOLDEN_DIR / f"{name}.expected.json"
    if os.environ.get("UPDATE_GOLDEN") == "1":
        GOLDEN_DIR.mkdir(parents=True, exist_ok=True)
        path.write_bytes(trzb.gzip_bytes(data))
        dec = trzb.decode(data)
        expected_json.write_text(
            json.dumps({"meta": dec.meta, "tables": _as_jsonable(dec.tables)}, indent=1) + "\n",
            encoding="utf-8",
        )
    assert path.exists(), "falta el fichero dorado: UPDATE_GOLDEN=1 uv run pytest tests/test_trzb.py"
    assert gzip.decompress(path.read_bytes()) == data, "el fichero dorado no coincide con el codificador"


@pytest.mark.parametrize("dtype", ["<i2", "<u2", "<i4", "<f4", "<f8", "u1"])
def test_shuffle_roundtrip(dtype: str) -> None:
    rng = np.random.default_rng(7)
    arr = (rng.normal(size=257) * 1000).astype(dtype)
    raw = trzb.shuffle_bytes(arr)
    assert len(raw) == arr.nbytes
    np.testing.assert_array_equal(trzb.unshuffle_bytes(raw, np.dtype(dtype), len(arr)), arr)


def test_shuffle_flag_is_written_to_header() -> None:
    data = trzb.encode("motion", golden_tables()["motion"])
    dec = trzb.decode(data)
    cols = {c["name"]: c for c in dec.header["tables"][1]["columns"]}
    assert cols["t"]["shuffle"] is True and cols["s"]["shuffle"] is True
    assert "shuffle" not in cols["path"]
