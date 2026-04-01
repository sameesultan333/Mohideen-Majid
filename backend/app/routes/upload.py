import os
import uuid
from fastapi import APIRouter, UploadFile, File, HTTPException
from typing import List

router = APIRouter(prefix="/upload", tags=["Upload"])


# ─────────────────────────────────────────────────────────────
# 📁 DIRECTORIES
# ─────────────────────────────────────────────────────────────
BASE_DIR = os.path.abspath("uploads")
AUDIO_DIR = os.path.join(BASE_DIR, "audio")
IMAGE_DIR = os.path.join(BASE_DIR, "images")

os.makedirs(AUDIO_DIR, exist_ok=True)
os.makedirs(IMAGE_DIR, exist_ok=True)


# ─────────────────────────────────────────────────────────────
# 🔐 CONFIG
# ─────────────────────────────────────────────────────────────
MAX_FILE_SIZE_MB = 5  # limit file size
ALLOWED_AUDIO_EXT = {"wav", "mp3", "m4a"}
ALLOWED_IMAGE_EXT = {"jpg", "jpeg", "png"}


# ─────────────────────────────────────────────────────────────
# 🧠 HELPERS
# ─────────────────────────────────────────────────────────────
def validate_file(file: UploadFile, allowed_ext: set):
    if not file.filename:
        raise HTTPException(400, "No file provided")

    file_ext = file.filename.split(".")[-1].lower()

    if file_ext not in allowed_ext:
        raise HTTPException(400, f"Invalid file type: {file_ext}")

    return file_ext


async def save_file(file: UploadFile, directory: str, file_ext: str):
    filename = f"{uuid.uuid4()}.{file_ext}"
    file_path = os.path.join(directory, filename)

    size = 0

    with open(file_path, "wb") as buffer:
        while chunk := await file.read(1024 * 1024):  # 1MB chunks
            size += len(chunk)

            if size > MAX_FILE_SIZE_MB * 1024 * 1024:
                os.remove(file_path)
                raise HTTPException(400, "File too large")

            buffer.write(chunk)

    return filename


# ─────────────────────────────────────────────────────────────
# 🎤 AUDIO UPLOAD
# ─────────────────────────────────────────────────────────────
@router.post("/audio")
async def upload_audio(file: UploadFile = File(...)):
    try:
        file_ext = validate_file(file, ALLOWED_AUDIO_EXT)

        filename = await save_file(file, AUDIO_DIR, file_ext)

        return {
            "url": f"/uploads/audio/{filename}",
            "filename": filename
        }

    except HTTPException as e:
        raise e
    except Exception:
        raise HTTPException(500, "Audio upload failed")


# ─────────────────────────────────────────────────────────────
# 🖼 IMAGE UPLOAD
# ─────────────────────────────────────────────────────────────
@router.post("/image")
async def upload_image(file: UploadFile = File(...)):
    try:
        file_ext = validate_file(file, ALLOWED_IMAGE_EXT)

        filename = await save_file(file, IMAGE_DIR, file_ext)

        return {
            "url": f"/uploads/images/{filename}",
            "filename": filename
        }

    except HTTPException as e:
        raise e
    except Exception:
        raise HTTPException(500, "Image upload failed")