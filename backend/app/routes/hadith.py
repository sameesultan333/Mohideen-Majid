# backend/app/routes/hadith.py

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import date

from app.database import get_db
from app import models, schemas
from app.security import require_admin_or_imam, get_current_user
from app.websocket_manager import manager

router = APIRouter(prefix="/hadith", tags=["Hadith"])


# ─────────────────────────────────────────────
# 🕌 GET TODAY HADITH
# ─────────────────────────────────────────────
@router.get("/today", response_model=schemas.HadithOut)
def get_today_hadith(db: Session = Depends(get_db)):
    today = str(date.today())

    hadith = db.query(models.Hadith).filter(
        models.Hadith.date == today
    ).first()

    if not hadith:
        hadith = db.query(models.Hadith).order_by(
            models.Hadith.created_at.desc()
        ).first()

    if not hadith:
        raise HTTPException(404, "No hadith posted yet")

    return hadith


# ─────────────────────────────────────────────
# 📥 GET ALL
# ─────────────────────────────────────────────
@router.get("/", response_model=list[schemas.HadithOut])
def get_all_hadiths(db: Session = Depends(get_db)):
    return db.query(models.Hadith).order_by(
        models.Hadith.created_at.desc()
    ).all()


# ─────────────────────────────────────────────
# ✍️ POST HADITH
# ─────────────────────────────────────────────
@router.post("/", response_model=schemas.HadithOut)
async def post_hadith(
    data: schemas.HadithCreate,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin_or_imam),
):
    # ✅ FIX: Fetch user from DB
    db_user = db.query(models.User).filter(
        models.User.id == int(user["sub"])
    ).first()

    if not db_user:
        raise HTTPException(401, "User not found")

    hadith = models.Hadith(
        arabic=data.arabic,
        translation=data.translation,
        source=data.source,
        date=data.date or str(date.today()),
        posted_by=db_user.name,  # ✅ FIXED
        voice_url=data.voice_url,
        image_url=data.image_url
    )

    db.add(hadith)
    db.commit()
    db.refresh(hadith)

    # 🔥 REAL-TIME
    await manager.broadcast("hadith", {
        "type": "NEW_HADITH",
        "data": {
            "id": hadith.id,
            "translation": hadith.translation,
            "arabic": hadith.arabic,
            "image_url": hadith.image_url,
            "voice_url": hadith.voice_url,
            "created_at": str(hadith.created_at)
        }
    })

    return hadith


# ─────────────────────────────────────────────
# 💬 REPLY
# ─────────────────────────────────────────────
@router.post("/{hadith_id}/reply", response_model=schemas.ReplyOut)
def reply_to_hadith(
    hadith_id: int,
    payload: schemas.ReplyCreate,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    hadith = db.query(models.Hadith).filter(
        models.Hadith.id == hadith_id
    ).first()

    if not hadith:
        raise HTTPException(404, "Hadith not found")

    reply = models.Reply(
        hadith_id=hadith_id,
        text=payload.text,
        parent_reply_id=payload.parent_reply_id,
        user_id=int(user["sub"])
    )

    db.add(reply)
    db.commit()
    db.refresh(reply)

    return reply


# ─────────────────────────────────────────────
# 📖 GET REPLIES
# ─────────────────────────────────────────────
@router.get("/{hadith_id}/replies", response_model=list[schemas.ReplyOut])
def get_replies(hadith_id: int, db: Session = Depends(get_db)):
    return db.query(models.Reply).filter(
        models.Reply.hadith_id == hadith_id
    ).order_by(models.Reply.created_at.asc()).all()


# ─────────────────────────────────────────────
# ❌ DELETE
# ─────────────────────────────────────────────
@router.delete("/{hadith_id}")
def delete_hadith(
    hadith_id: int,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin_or_imam),
):
    h = db.query(models.Hadith).filter(
        models.Hadith.id == hadith_id
    ).first()

    if not h:
        raise HTTPException(404, "Hadith not found")

    # ✅ FIX: safer check
    db_user = db.query(models.User).filter(
        models.User.id == int(user["sub"])
    ).first()

    if user["role"] == "imam" and h.posted_by != db_user.name:
        raise HTTPException(403, "You can only delete your own hadiths")

    db.delete(h)
    db.commit()

    return {"message": "Deleted successfully"}