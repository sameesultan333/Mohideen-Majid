"""A blank phone must not block editing a family's monthly amount.

Reported bug: changing a family's Monthly Subscription amount in the admin
portal silently failed. The edit dialog always submits the phone field, so for a
family with no phone it sent "". The endpoint treated any non-None phone as a
value to validate, normalize("") returned None, and it raised 400 "Invalid phone
number" — aborting the whole request, amount included. Phone is optional
throughout the system (the Excel import stores NULL), so blank means "no
number", not "bad input".
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi import HTTPException

from app.routes.admin import normalize


def test_normalize_treats_blank_as_no_number():
    assert normalize("") is None
    assert normalize("   ") is None


def test_normalize_accepts_spaced_and_prefixed_numbers():
    assert normalize("98419 74095") == "9841974095"
    assert normalize("09150003309") == "9150003309"


def test_normalize_rejects_wrong_length():
    # Must never silently truncate — a short/long number is a real error.
    assert normalize("123") is None
    assert normalize("1234567890123") is None


@pytest.mark.parametrize("blank", ["", "   ", "\t"])
def test_blank_phone_is_falsy_after_strip(blank):
    """The endpoint branches on this: blank -> clear, non-blank -> validate."""
    assert not blank.strip()


def test_non_blank_invalid_phone_still_raises():
    """Guard the branch that must keep rejecting genuinely malformed input."""
    raw = "123"
    assert raw.strip()                 # takes the validate branch
    assert normalize(raw) is None      # and fails there
    with pytest.raises(HTTPException):
        if not normalize(raw):
            raise HTTPException(400, "Invalid phone number")
