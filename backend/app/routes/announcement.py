# backend/app/routes/announcements.py

import logging
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app import models, schemas
from app.cache import cache_get, cache_set, cache_invalidate
from app.database import SessionLocal
from app.security import require_admin_or_imam
from app.services.audit_service import AuditAction, log_action
from app.utils.fcm import send_fcm_topic_notification, notify_user
from app.websocket_manager import manager
from app.rate_limit import rate_limit

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/announcements", tags=["Announcements"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ── Auto-delete expired announcements ─────────────────────────────────────────
def delete_expired_announcements(db: Session):
    expiry = datetime.utcnow() - timedelta(hours=48)
    db.query(models.Announcement).filter(
        models.Announcement.pinned == False,
        models.Announcement.created_at < expiry
    ).delete()
    db.commit()


# ── GET all ───────────────────────────────────────────────────────────────────
# ?user_id=<id>  → broadcast + targeted for that user (mobile app)
# ?all=true      → everything including targeted (admin view)
# (no params)    → broadcast only
@router.get("/", response_model=list[schemas.AnnouncementOut])
async def get_announcements(
    user_id: Optional[int] = Query(None),
    all: Optional[bool] = Query(False),
    db: Session = Depends(get_db),
):
    delete_expired_announcements(db)
    q = db.query(models.Announcement)

    if all:
        # Admin view — return everything, no filter
        pass
    elif user_id:
        q = q.filter(
            (models.Announcement.target_user_id == None) |
            (models.Announcement.target_user_id == user_id)
        )
    else:
        # Mobile broadcast-only — cacheable
        cached = await cache_get("announcements:broadcast")
        if cached:
            return cached
        q = q.filter(models.Announcement.target_user_id == None)

    rows = q.order_by(
        models.Announcement.pinned.desc(),
        models.Announcement.created_at.desc()
    ).all()

    if not user_id and not all:
        serialized = [schemas.AnnouncementOut.from_orm(r).dict() for r in rows]
        await cache_set("announcements:broadcast", serialized, ttl=60)

    return rows


# ── POST — admin or imam (WITH WEBSOCKET) ─────────────────────────────────────
@router.post("/", response_model=schemas.AnnouncementOut, status_code=201)
async def post_announcement(
    data: schemas.AnnouncementCreate,
    background_tasks: BackgroundTasks,
    request: Request,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin_or_imam),
):
    await rate_limit(request, "announce")
    # ── 1. DB write (only blocking part) ──────────────────────────────────────
    db_user = db.query(models.User).filter(
        models.User.id == int(user["sub"])
    ).first()
    if not db_user:
        raise HTTPException(status_code=401, detail="User not found")

    ann = models.Announcement(
        title=data.title,
        body=data.body,
        pinned=data.pinned,
        image_url=data.image_url,
        audio_url=data.audio_url,
        posted_by=db_user.name,
        target_user_id=data.target_user_id,
    )
    db.add(ann)
    db.flush()
    await log_action(db, AuditAction.ANNOUNCEMENT_CREATED, "announcements", ann.id,
                     actor=user, request=request,
                     description=f"Announcement created: {ann.title}")
    db.commit()
    db.refresh(ann)

    # ── 2. Snapshot fields needed by background tasks ─────────────────────────
    ann_id       = ann.id
    ann_title    = ann.title or "New Announcement"
    ann_body     = ann.body  or "You have a new announcement."
    ann_pinned   = ann.pinned
    ann_posted   = ann.posted_by
    ann_image    = ann.image_url
    ann_audio    = ann.audio_url
    ann_created  = str(ann.created_at)
    ann_target   = ann.target_user_id
    fcm_data     = {"announcement_id": str(ann_id), "posted_by": ann_posted, "sender_user_id": str(user["sub"])}

    ws_payload = {
        "type": "new_announcement",
        "data": {
            "id": ann_id, "title": ann_title, "body": ann_body,
            "pinned": ann_pinned, "posted_by": ann_posted,
            "image_url": ann_image, "audio_url": ann_audio,
            "created_at": ann_created, "target_user_id": ann_target,
        },
    }

    # ── 3. Everything else in background (cache, WS, FCM) ────────────────────
    # Fresh DB session — request-scoped `db` is closed before background tasks run.
    # Sync Firebase/DB calls run in a thread so they never block the event loop.
    async def _post_send():
        import asyncio
        from app.database import SessionLocal
        bg_db = SessionLocal()
        try:
            try:
                await cache_invalidate("announcements:broadcast")
            except Exception as exc:
                logger.warning("[announcement] cache invalidate failed: %s", exc)
            try:
                await manager.broadcast("announcements", ws_payload)
            except Exception as exc:
                logger.warning("[announcement] ws broadcast failed: %s", exc)
            try:
                if ann_target:
                    await asyncio.to_thread(
                        notify_user, bg_db, ann_target, ann_title, ann_body, fcm_data
                    )
                else:
                    await asyncio.to_thread(
                        send_fcm_topic_notification,
                        ann_title, ann_body, "announcements", fcm_data,
                    )
            except Exception as exc:
                logger.warning("[announcement] fcm failed: %s", exc)
        finally:
            bg_db.close()

    background_tasks.add_task(_post_send)

    return ann


# ── DELETE ────────────────────────────────────────────────────────────────────
@router.delete("/{ann_id}")
async def delete_announcement(
    ann_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin_or_imam),
):
    ann = db.query(models.Announcement).filter(models.Announcement.id == ann_id).first()
    if not ann:
        raise HTTPException(status_code=404, detail="Announcement not found")

    if user["role"] == "imam" and ann.posted_by != user["name"]:
        raise HTTPException(status_code=403, detail="You can only delete your own announcements")

    await log_action(db, AuditAction.ANNOUNCEMENT_DELETED, "announcements", ann_id,
                     actor=user, request=request,
                     description=f"Announcement deleted: {ann.title}")
    db.delete(ann)
    db.commit()
    await cache_invalidate("announcements:broadcast")
    return {"message": "Deleted successfully"}