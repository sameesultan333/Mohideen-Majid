"""Normalized search matches the client-side rules in admin/src/utils/search.ts."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.utils.search import normalize_search, search_tokens


def test_normalize_strips_case_space_and_punctuation():
    assert normalize_search("S.A. Mohideen Arif (A1 Hardwares)") == "samohideenarifa1hardwares"
    assert normalize_search("98419 74095") == "9841974095"
    assert normalize_search("MM-CH-202601-000001") == "mmch202601000001"
    assert normalize_search(None) == ""
    assert normalize_search("   ") == ""


def test_normalize_keeps_non_ascii_letters():
    # Tamil names must survive normalization, not be stripped to "".
    assert normalize_search("முகைதீன்") != ""


def test_search_tokens_splits_and_drops_empties():
    assert search_tokens("  sa   mohideen ") == ["sa", "mohideen"]
    assert search_tokens("S.A. Mohideen") == ["sa", "mohideen"]
    assert search_tokens("") == []
    assert search_tokens(None) == []
    assert search_tokens("!!! ???") == []
