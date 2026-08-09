"""
Upload hardening for the payment-proof endpoint.

/uploads is mounted with StaticFiles on the same origin as the API, so a stored
file is served back from that origin. The proof upload used to take its
extension straight from the attacker-supplied filename with no allowlist, no
size cap and no content check, which meant "x.html" was stored and served as
HTML - stored XSS against any admin who opened the proof.
"""
import io
import os
import sys

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.routes.upload import (
    ALLOWED_IMAGE_EXT,
    _IMAGE_MAGIC,
    _safe_ext,
    _verify_magic,
)


PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


@pytest.mark.parametrize("filename", [
    "x.html",                       # stored XSS
    "x.htm",
    "x.svg",                        # script-bearing image type
    "payload.php",
    "run.exe",
    "script.js",
    "note.py",
])
def test_dangerous_extensions_are_rejected(filename):
    with pytest.raises(HTTPException) as exc:
        _safe_ext(filename, ALLOWED_IMAGE_EXT)
    assert exc.value.status_code == 400


@pytest.mark.parametrize("filename", [
    "a.b/../../../../etc/passwd",
    "x.jpg/../../../app/main.py",
    "../../../../evil",
    "proof.jpg\x00.html",
])
def test_traversal_and_null_byte_filenames_are_rejected(filename):
    """Nothing derived from the filename may escape the upload directory."""
    with pytest.raises(HTTPException):
        ext = _safe_ext(filename, ALLOWED_IMAGE_EXT)
        # If it somehow returned, it must at least be a plain safe token.
        assert "/" not in ext and "\\" not in ext and ".." not in ext


def test_ordinary_image_is_accepted():
    assert _safe_ext("proof.png", ALLOWED_IMAGE_EXT) == "png"
    _verify_magic(PNG, "png", _IMAGE_MAGIC)   # must not raise


def test_extension_spoofing_is_caught_by_magic_bytes():
    """An HTML payload renamed to .png must not be stored."""
    html = b"<script>alert(document.cookie)</script>"
    ext = _safe_ext("payload.png", ALLOWED_IMAGE_EXT)
    with pytest.raises(HTTPException) as exc:
        _verify_magic(html, ext, _IMAGE_MAGIC)
    assert exc.value.status_code == 400


def test_proof_upload_uses_the_hardened_helpers():
    """Guard against the raw open()/copyfileobj path being reintroduced."""
    src = io.open(
        os.path.join(os.path.dirname(__file__), "..", "app", "routes", "user_pay.py"),
        encoding="utf-8",
    ).read()
    assert "_safe_ext(" in src
    assert "_verify_magic(" in src
    assert "_read_bytes(" in src
    assert "shutil.copyfileobj(file.file" not in src


def test_public_receipt_does_not_leak_home_address():
    """The receipt endpoint is unauthenticated so QR links work; ids are
    sequential, so it must not return anything worth harvesting."""
    src = io.open(
        os.path.join(os.path.dirname(__file__), "..", "app", "routes", "finance.py"),
        encoding="utf-8",
    ).read()
    start = src.index('@router.get("/receipt/{receipt_id}")')
    body = src[start:start + 4000]
    assert '"address":' not in body
