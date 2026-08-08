import logging
import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile

from app.rate_limit import rate_limit
from app.security import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/upload", tags=["Upload"])

# ── Directories ───────────────────────────────────────────────────────────────
BASE_DIR       = Path(os.path.abspath("uploads"))
IMAGE_DIR      = BASE_DIR / "images"
SCREENSHOT_DIR = BASE_DIR / "screenshots"
AUDIO_DIR      = BASE_DIR / "audio"
for _d in (IMAGE_DIR, SCREENSHOT_DIR, AUDIO_DIR):
    _d.mkdir(parents=True, exist_ok=True)

MAX_FILE_SIZE_MB  = 10
MAX_AUDIO_SIZE_MB = 20

# Allowed extensions mapped to their valid MIME magic bytes
# Format: ext → list of (offset, magic_bytes)
_IMAGE_MAGIC: dict[str, list[tuple[int, bytes]]] = {
    "jpg":  [(0, b"\xff\xd8\xff")],
    "jpeg": [(0, b"\xff\xd8\xff")],
    "png":  [(0, b"\x89PNG\r\n\x1a\n")],
    "webp": [(0, b"RIFF"), (8, b"WEBP")],
}
# Formats people actually produce. mp3/wav/m4a alone rejected the everyday cases:
# an Android voice recording is normally .mp4 or .aac, a desktop browser records
# .webm or .ogg, and the admin picker offers "audio/*" — so choosing an ordinary
# audio file failed the extension check and the announcement was published with
# no audio attached. Every entry below is still magic-byte verified, so widening
# the list does not weaken the upload check.
_AUDIO_MAGIC: dict[str, list[tuple[int, bytes]]] = {
    "mp3":  [(0, b"ID3"), (0, b"\xff\xfb"), (0, b"\xff\xf3"), (0, b"\xff\xf2")],
    "wav":  [(0, b"RIFF"), (8, b"WAVE")],
    # ISO base-media container — m4a, mp4 audio and AAC-in-mp4 share this header.
    "m4a":  [(4, b"ftyp")],
    "mp4":  [(4, b"ftyp")],
    "aac":  [(4, b"ftyp"), (0, b"\xff\xf1"), (0, b"\xff\xf9")],  # mp4-wrapped or raw ADTS
    "ogg":  [(0, b"OggS")],
    "opus": [(0, b"OggS")],
    "webm": [(0, b"\x1a\x45\xdf\xa3")],
    "amr":  [(0, b"#!AMR")],
}

ALLOWED_IMAGE_EXT = set(_IMAGE_MAGIC.keys())
ALLOWED_AUDIO_EXT = set(_AUDIO_MAGIC.keys())


# ── Cloudinary (optional — leave env vars empty to use local storage) ─────────
_CLOUDINARY_AVAILABLE = False
try:
    import cloudinary
    import cloudinary.uploader as _cu

    _cloud_name = os.getenv("CLOUDINARY_CLOUD_NAME")
    _api_key    = os.getenv("CLOUDINARY_API_KEY")
    _api_secret = os.getenv("CLOUDINARY_API_SECRET")

    if _cloud_name and _api_key and _api_secret:
        cloudinary.config(
            cloud_name=_cloud_name, api_key=_api_key,
            api_secret=_api_secret, secure=True,
        )
        _CLOUDINARY_AVAILABLE = True
except ImportError:
    pass


def _upload_to_cloudinary(data: bytes, folder: str, public_id: str) -> dict:
    result = _cu.upload(
        data, folder=f"masjid/{folder}", public_id=public_id, overwrite=False,
    )
    return {"url": result["secure_url"], "public_id": result["public_id"]}


# ── Security helpers ──────────────────────────────────────────────────────────

def _safe_ext(filename: str, allowed: set[str]) -> str:
    """Return lowercased extension or raise 400."""
    if not filename or "." not in filename:
        raise HTTPException(400, "Filename missing or has no extension")
    ext = filename.rsplit(".", 1)[-1].lower()
    if ext not in allowed:
        raise HTTPException(400, f"File type '.{ext}' not allowed")
    # Prevent double-extension attacks (e.g. evil.php.jpg)
    if filename.count(".") > 1:
        parts = filename.rsplit(".", 2)
        if len(parts) == 3 and parts[1].lower() in {
            "php", "py", "sh", "exe", "bat", "cmd", "pl", "rb", "js",
        }:
            raise HTTPException(400, "Suspicious filename rejected")
    return ext


def _verify_magic(data: bytes, ext: str, magic_map: dict) -> None:
    """Verify file starts with the expected magic bytes — prevents MIME spoofing."""
    rules = magic_map.get(ext, [])
    if not rules:
        return  # no magic defined for this ext
    if ext in ("webp", "wav"):
        # Both RIFF types: check all rules must pass
        for offset, magic in rules:
            if data[offset: offset + len(magic)] != magic:
                raise HTTPException(400, "File content does not match its extension")
    else:
        # Any one rule matching is sufficient (e.g. mp3 has multiple valid headers)
        for offset, magic in rules:
            if data[offset: offset + len(magic)] == magic:
                return
        raise HTTPException(400, "File content does not match its extension")


async def _read_bytes(file: UploadFile, max_mb: int) -> bytes:
    chunks, size = [], 0
    limit = max_mb * 1024 * 1024
    while chunk := await file.read(1024 * 1024):
        size += len(chunk)
        if size > limit:
            raise HTTPException(400, f"File exceeds {max_mb} MB limit")
        chunks.append(chunk)
    return b"".join(chunks)


def _save_local(data: bytes, directory: Path, ext: str) -> str:
    """Save bytes to a randomly-named file in directory. Returns filename only."""
    filename = f"{uuid.uuid4()}.{ext}"
    target = directory / filename
    # Guard against directory traversal (uuid4 makes this impossible, but be explicit)
    if not str(target.resolve()).startswith(str(directory.resolve())):
        raise HTTPException(400, "Invalid file path")
    target.write_bytes(data)
    return filename


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/image")
async def upload_image(request: Request, file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    await rate_limit(request, "upload")
    ext  = _safe_ext(file.filename or "", ALLOWED_IMAGE_EXT)
    data = await _read_bytes(file, MAX_FILE_SIZE_MB)
    _verify_magic(data, ext, _IMAGE_MAGIC)
    pid  = str(uuid.uuid4())

    if _CLOUDINARY_AVAILABLE:
        try:
            result = _upload_to_cloudinary(data, "images", pid)
            return {"url": result["url"], "public_id": result["public_id"], "storage": "cloudinary"}
        except Exception as exc:
            logger.warning("[upload] Cloudinary failed, using local: %s", exc)

    filename = _save_local(data, IMAGE_DIR, ext)
    return {"url": f"/uploads/images/{filename}", "filename": filename, "storage": "local"}


@router.post("/screenshot")
async def upload_screenshot(request: Request, file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    await rate_limit(request, "upload")
    ext  = _safe_ext(file.filename or "", ALLOWED_IMAGE_EXT)
    data = await _read_bytes(file, MAX_FILE_SIZE_MB)
    _verify_magic(data, ext, _IMAGE_MAGIC)
    pid  = str(uuid.uuid4())

    if _CLOUDINARY_AVAILABLE:
        try:
            result = _upload_to_cloudinary(data, "screenshots", pid)
            return {"url": result["url"], "public_id": result["public_id"], "storage": "cloudinary"}
        except Exception as exc:
            logger.warning("[upload] Cloudinary failed, using local: %s", exc)

    filename = _save_local(data, SCREENSHOT_DIR, ext)
    return {"url": f"/uploads/screenshots/{filename}", "filename": filename, "storage": "local"}


@router.post("/audio")
async def upload_audio(request: Request, file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    await rate_limit(request, "upload")
    ext  = _safe_ext(file.filename or "", ALLOWED_AUDIO_EXT)
    data = await _read_bytes(file, MAX_AUDIO_SIZE_MB)
    _verify_magic(data, ext, _AUDIO_MAGIC)
    pid  = str(uuid.uuid4())

    if _CLOUDINARY_AVAILABLE:
        try:
            result = _upload_to_cloudinary(data, "audio", pid)
            return {"url": result["url"], "public_id": result["public_id"], "storage": "cloudinary"}
        except Exception as exc:
            logger.warning("[upload] Cloudinary audio failed, using local: %s", exc)

    filename = _save_local(data, AUDIO_DIR, ext)
    return {"url": f"/uploads/audio/{filename}", "filename": filename, "storage": "local"}
