"""
Unit tests for the phone number normalization pipeline used in the Excel importer.

These tests guard against the float64 truncation bug where pandas reads phone
numbers as float (e.g. 9150003309.0), str() appends ".0", the digit filter
produces 11 digits, and [-10:] silently drops the real leading digit.

Run with:  python -m pytest backend/tests/test_phone_normalize.py -v
"""

import math
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.routes.admin import normalize


# ── normalize() unit tests ────────────────────────────────────────────────────

class TestNormalize:
    def test_exact_10_digits(self):
        assert normalize("9150003309") == "9150003309"

    def test_exact_10_digits_second(self):
        assert normalize("9003199878") == "9003199878"

    def test_11_digits_leading_zero(self):
        # STD-prefixed numbers like "09150003309"
        assert normalize("09150003309") == "9150003309"

    def test_11_digits_no_leading_zero_returns_none(self):
        # "91500033090" — the corrupted form — must NOT be silently truncated
        assert normalize("91500033090") is None

    def test_11_digits_corrupted_second(self):
        assert normalize("90031998780") is None

    def test_spaces_and_dashes(self):
        assert normalize("91500-03309") == "9150003309"

    def test_too_short_returns_none(self):
        assert normalize("123456") is None

    def test_empty_returns_none(self):
        assert normalize("") is None

    def test_all_zeros(self):
        # 10 zeros is technically valid by length — normalize accepts it
        assert normalize("0000000000") == "0000000000"


# ── Importer phone-parsing simulation ────────────────────────────────────────

def _parse_phone(raw_phone):
    """Mirrors the exact logic in upload_heads() for converting a raw Excel cell."""
    if raw_phone is None or (isinstance(raw_phone, float) and not math.isfinite(raw_phone)):
        return None
    if isinstance(raw_phone, (int, float)):
        phone_str = str(int(raw_phone))
    else:
        phone_str = str(raw_phone).strip()

    if phone_str.lower() in ("", "n/a", "na", "none", "null", "-", "nan"):
        return None
    return normalize(phone_str) or None


class TestImporterPhoneParsing:
    def test_pandas_float64_9150003309(self):
        # pandas reads 9150003309 as 9150003309.0
        assert _parse_phone(9150003309.0) == "9150003309"

    def test_pandas_float64_9003199878(self):
        assert _parse_phone(9003199878.0) == "9003199878"

    def test_int_value(self):
        assert _parse_phone(9150003309) == "9150003309"

    def test_string_value(self):
        assert _parse_phone("9150003309") == "9150003309"

    def test_string_with_decimal(self):
        # If somehow a string "9150003309.0" arrives
        assert _parse_phone("9150003309.0") is None  # normalize rejects 11-digit result

    def test_nan_returns_none(self):
        assert _parse_phone(float("nan")) is None

    def test_inf_returns_none(self):
        assert _parse_phone(float("inf")) is None

    def test_none_returns_none(self):
        assert _parse_phone(None) is None

    def test_na_string_returns_none(self):
        assert _parse_phone("N/A") is None

    def test_empty_string_returns_none(self):
        assert _parse_phone("") is None

    def test_dash_returns_none(self):
        assert _parse_phone("-") is None
