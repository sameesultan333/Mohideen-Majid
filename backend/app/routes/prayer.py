# backend/app/routes/prayer.py

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from datetime import datetime

from app.database import SessionLocal
from app import models, schemas
from app.security import require_admin_or_imam, get_current_user
from app.websocket_manager import manager
router = APIRouter(prefix="/prayer", tags=["Prayer"])


# ── DB Dependency ─────────────────────────────────────────────────────────────
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ── GET timings — public ──────────────────────────────────────────────────────
@router.get("/")
def get_prayer(db: Session = Depends(get_db)):
    data = db.query(models.PrayerTiming).first()

    if not data:
        raise HTTPException(status_code=404, detail="Not set")

    return {
        "early": {
            "imsak": data.imsak,
            "dhuha": data.dhuha,
        },
        "adhan": {
            "fajr": data.fajr_adhan,
            "dhuhr": data.dhuhr_adhan,
            "asr": data.asr_adhan,
            "maghrib": data.maghrib_adhan,
            "isha": data.isha_adhan,
        },
        "prayer": {
            "fajr": data.fajr,
            "dhuhr": data.dhuhr,
            "asr": data.asr,
            "maghrib": data.maghrib,
            "isha": data.isha,
            "jummah": data.jummah,
        },
        "special": {
            "taraweeh": data.taraweeh,
            "ishraq": data.ishraq,
        }
    }

# ── UPDATE timings — admin + imam ─────────────────────────────────────────────
@router.post("/update")
async def update_prayer(
    p: schemas.PrayerUpdate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_or_imam)
):
    data = db.query(models.PrayerTiming).first()

    if data:
        # Adhan
        data.fajr_adhan    = p.fajr_adhan
        data.dhuhr_adhan   = p.dhuhr_adhan
        data.asr_adhan     = p.asr_adhan
        data.maghrib_adhan = p.maghrib_adhan
        data.isha_adhan    = p.isha_adhan

        # Prayer
        data.fajr    = p.fajr
        data.dhuhr   = p.dhuhr
        data.asr     = p.asr
        data.maghrib = p.maghrib
        data.isha    = p.isha
        data.jummah  = p.jummah
        
        # Early
        data.imsak = p.imsak
        data.dhuha = p.dhuha
        # Special
        data.taraweeh = p.taraweeh
        data.ishraq   = p.ishraq

        data.updated_by = current_user.get("name")
        data.updated_at = datetime.utcnow()

    else:
        data = models.PrayerTiming(
            **p.dict(),
            updated_by=current_user.get("name"),
            updated_at=datetime.utcnow()
        )
        db.add(data)

    db.commit()
    db.refresh(data)

    # 🔥 WebSocket broadcast
    await manager.broadcast("prayer", {
        "type": "prayer_update",
        "data": p.dict(),
    })

    return {"message": "Prayer timings updated"}