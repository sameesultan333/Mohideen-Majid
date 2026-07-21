from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app import models

HADITH_TTL_HOURS = 48
UPLOADS_PREFIX = "/uploads/"
BACKEND_DIR = Path(__file__).resolve().parents[2]


def _normalize_upload_url(url: str | None) -> str | None:
    if not url:
        return None

    cleaned = url.strip()
    if not cleaned:
        return None

    if UPLOADS_PREFIX in cleaned:
        cleaned = cleaned[cleaned.index(UPLOADS_PREFIX) :]

    if not cleaned.startswith(UPLOADS_PREFIX):
        return None

    return cleaned


def _upload_path(url: str | None) -> Path | None:
    normalized = _normalize_upload_url(url)
    if not normalized:
        return None
    return BACKEND_DIR / normalized.lstrip("/")


def _delete_upload(url: str | None) -> bool:
    file_path = _upload_path(url)
    if not file_path or not file_path.exists() or not file_path.is_file():
        return False

    file_path.unlink()
    return True


def _clear_missing_file_reference(instance: object, field_name: str) -> bool:
    url = getattr(instance, field_name, None)
    if not url:
        return False

    file_path = _upload_path(url)
    if file_path and file_path.exists():
        return False

    setattr(instance, field_name, None)
    return True


def delete_expired_hadiths(db: Session, now: datetime | None = None) -> int:
    cutoff = (now or datetime.utcnow()) - timedelta(hours=HADITH_TTL_HOURS)
    expired_hadiths = (
        db.query(models.Hadith)
        .filter(models.Hadith.created_at < cutoff)
        .all()
    )

    deleted_count = 0

    for hadith in expired_hadiths:
        _delete_upload(hadith.voice_url)
        _delete_upload(hadith.image_url)
        db.query(models.Reply).filter(
            models.Reply.hadith_id == hadith.id
        ).delete(synchronize_session=False)
        db.delete(hadith)
        deleted_count += 1

    if deleted_count:
        db.commit()

    return deleted_count


def scrub_missing_media_references(db: Session) -> dict[str, int]:
    cleaned = {
        "hadith_fields": 0,
        "question_fields": 0,
        "answer_fields": 0,
    }

    hadiths = (
        db.query(models.Hadith)
        .filter(
            or_(
                models.Hadith.voice_url.isnot(None),
                models.Hadith.image_url.isnot(None),
            )
        )
        .all()
    )
    for hadith in hadiths:
        cleaned["hadith_fields"] += int(
            _clear_missing_file_reference(hadith, "voice_url")
        )
        cleaned["hadith_fields"] += int(
            _clear_missing_file_reference(hadith, "image_url")
        )

    questions = (
        db.query(models.Question)
        .filter(models.Question.question_voice_url.isnot(None))
        .all()
    )
    for question in questions:
        cleaned["question_fields"] += int(
            _clear_missing_file_reference(question, "question_voice_url")
        )

    answers = (
        db.query(models.Answer)
        .filter(
            or_(
                models.Answer.answer_voice_url.isnot(None),
                models.Answer.answer_image_url.isnot(None),
            )
        )
        .all()
    )
    for answer in answers:
        cleaned["answer_fields"] += int(
            _clear_missing_file_reference(answer, "answer_voice_url")
        )
        cleaned["answer_fields"] += int(
            _clear_missing_file_reference(answer, "answer_image_url")
        )

    if any(cleaned.values()):
        db.commit()

    return cleaned


def run_content_cleanup(db: Session) -> dict[str, int]:
    deleted_hadiths = delete_expired_hadiths(db)
    scrubbed = scrub_missing_media_references(db)
    return {
        "deleted_hadiths": deleted_hadiths,
        **scrubbed,
    }
