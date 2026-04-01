# backend/app/routes/announcements.py

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app import models, schemas
from app.security import require_admin_or_imam
from datetime import datetime, timedelta

from app.websocket_manager import manager

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


# ── GET all — public ──────────────────────────────────────────────────────────
@router.get("/", response_model=list[schemas.AnnouncementOut])
def get_announcements(db: Session = Depends(get_db)):
    delete_expired_announcements(db)
    return db.query(models.Announcement).order_by(
        models.Announcement.pinned.desc(),
        models.Announcement.created_at.desc()
    ).all()


# ── POST — admin or imam (WITH WEBSOCKET) ─────────────────────────────────────
@router.post("/", response_model=schemas.AnnouncementOut, status_code=201)
async def post_announcement(   # 🔥 MUST BE async
    data: schemas.AnnouncementCreate,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin_or_imam),
):
    try:
        print("USER:", user)

        ann = models.Announcement(
            title=data.title,
            body=data.body,
            pinned=data.pinned,
            posted_by=user.get("name", "Unknown"),
        )

        db.add(ann)
        db.commit()
        db.refresh(ann)

        # 🔥 WEBSOCKET BROADCAST
        await manager.broadcast("announcements", {
            "type": "new_announcement",
            "data": {
                "id": ann.id,
                "title": ann.title,
                "body": ann.body,
                "pinned": ann.pinned,
                "posted_by": ann.posted_by,
                "created_at": str(ann.created_at),
            },
        })

        return ann

    except Exception as e:
        print("ERROR:", str(e))
        raise HTTPException(status_code=500, detail="Internal server error")


# ── DELETE ────────────────────────────────────────────────────────────────────
@router.delete("/{ann_id}")
def delete_announcement(
    ann_id: int,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin_or_imam),
):
    ann = db.query(models.Announcement).filter(models.Announcement.id == ann_id).first()
    if not ann:
        raise HTTPException(status_code=404, detail="Announcement not found")

    if user["role"] == "imam" and ann.posted_by != user["name"]:
        raise HTTPException(status_code=403, detail="You can only delete your own announcements")

    db.delete(ann)
    db.commit()
    return {"message": "Deleted successfully"}