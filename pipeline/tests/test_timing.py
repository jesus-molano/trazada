from __future__ import annotations

import pandas as pd
import pytest

from trazada_pipeline.timing import parse_gap, track_status_mask


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("+1.234", (1234, 0)),
        ("+0.050", (50, 0)),
        ("+1:02.500", (62500, 0)),
        ("+1 LAP", (-1, 1)),
        ("+2 LAPS", (-1, 2)),
        ("3L", (-1, 3)),
        ("LAP 12", (-1, 0)),
        ("", (-1, 0)),
        (None, (-1, 0)),
        (float("nan"), (-1, 0)),
        (pd.Timedelta(1500, unit="ms"), (1500, 0)),
        ("basura", (-1, 0)),
    ],
)
def test_parse_gap(value: object, expected: tuple[int, int]) -> None:
    assert parse_gap(value) == expected


def test_track_status_mask() -> None:
    assert track_status_mask("1") == 0
    assert track_status_mask("24") == 1 | 2
    assert track_status_mask("67") == 8 | 16
    assert track_status_mask("") == 0
