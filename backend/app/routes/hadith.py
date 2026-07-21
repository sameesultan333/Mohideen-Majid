# backend/app/routes/hadith.py



from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app import models, schemas
from app.cache import cache_get, cache_invalidate, cache_set
from app.database import get_db
from app.security import get_current_user, require_admin_or_imam
from app.services.audit_service import AuditAction, log_action
from app.utils.content_cleanup import run_content_cleanup
from app.websocket_manager import manager



router = APIRouter(prefix="/hadith", tags=["Hadith"])





# ─────────────────────────────────────────────

# 🕌 GET TODAY HADITH

# ─────────────────────────────────────────────

@router.get("/today", response_model=schemas.HadithOut)
async def get_today_hadith(db: Session = Depends(get_db)):
    today = str(date.today())
    cache_key = f"hadith:today:{today}"

    cached = await cache_get(cache_key)
    if cached:
        return cached

    run_content_cleanup(db)

    hadith = db.query(models.Hadith).filter(models.Hadith.date == today).first()
    if not hadith:
        hadith = db.query(models.Hadith).order_by(models.Hadith.created_at.desc()).first()
    if not hadith:
        raise HTTPException(404, "No hadith posted yet")

    await cache_set(cache_key, schemas.HadithOut.from_orm(hadith).dict(), ttl=600)
    return hadith





# ─────────────────────────────────────────────

# 📥 GET ALL

# ─────────────────────────────────────────────

@router.get("", response_model=list[schemas.HadithOut])
@router.get("/", response_model=list[schemas.HadithOut])
async def get_all_hadiths(db: Session = Depends(get_db)):
    cached = await cache_get("hadith:all")
    if cached:
        return cached

    run_content_cleanup(db)
    rows = db.query(models.Hadith).order_by(models.Hadith.created_at.desc()).all()
    await cache_set("hadith:all", [schemas.HadithOut.from_orm(r).dict() for r in rows], ttl=600)
    return rows





# ─────────────────────────────────────────────

# ✍️ POST HADITH

# ─────────────────────────────────────────────

@router.post("/", response_model=schemas.HadithOut)

async def post_hadith(

    data: schemas.HadithCreate,

    request: Request,

    db: Session = Depends(get_db),

    user: dict = Depends(require_admin_or_imam),

):

    run_content_cleanup(db)

    # ✅ FIX: Fetch user from DB

    db_user = db.query(models.User).filter(

        models.User.id == int(user["sub"])

    ).first()

    if not db_user:

        raise HTTPException(401, "User not found")

    # ✅ FIX: Require at least one content field
    if not data.has_content():
        raise HTTPException(400, "At least one of arabic, translation, voice_url, or image_url is required")



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
    db.flush()
    await log_action(db, AuditAction.HADITH_CREATED, "hadiths", hadith.id,
                     actor=user, request=request,
                     description=f"Hadith created by {db_user.name}")
    db.commit()
    db.refresh(hadith)
    await cache_invalidate("hadith:all", f"hadith:today:{hadith.date}")

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

    run_content_cleanup(db)

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

    run_content_cleanup(db)

    replies = db.query(models.Reply).filter(

        models.Reply.hadith_id == hadith_id

    ).order_by(models.Reply.created_at.asc()).all()

    # Reply has no ORM relationship to User (raw user_id FK only), and the
    # schema previously had no role field at all — the client's isImam
    # check (item.user?.role) was reading a field that could never exist,
    # so the Imam badge never showed on hadith discussion replies. Batch
    # the role lookup instead of querying per-reply.
    user_ids = {r.user_id for r in replies}
    role_by_user = {}
    if user_ids:
        role_by_user = dict(
            db.query(models.User.id, models.User.role)
            .filter(models.User.id.in_(user_ids))
            .all()
        )
    for r in replies:
        r.user_role = role_by_user.get(r.user_id)

    return replies





# ─────────────────────────────────────────────

# ❌ DELETE

# ─────────────────────────────────────────────

@router.delete("/{hadith_id}")
async def delete_hadith(

    hadith_id: int,

    request: Request,

    db: Session = Depends(get_db),

    user: dict = Depends(require_admin_or_imam),

):

    run_content_cleanup(db)

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



    await log_action(db, AuditAction.HADITH_DELETED, "hadiths", hadith_id,
                     actor=user, request=request,
                     description=f"Hadith deleted by {db_user.name if db_user else 'unknown'}")
    db.delete(h)
    db.commit()
    await cache_invalidate("hadith:all", f"hadith:today:{h.date}")

    return {"message": "Deleted successfully"}

