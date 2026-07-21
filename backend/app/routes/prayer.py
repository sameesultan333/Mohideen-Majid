# backend/app/routes/prayer.py

from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app import models, schemas
from app.cache import cache_get, cache_set, cache_invalidate
from app.database import SessionLocal
from app.security import require_admin_or_imam, get_current_user
from app.websocket_manager import manager
from app.services.audit_service import AuditAction, log_action
from app.utils.fcm import send_fcm_prayer_times_update

router = APIRouter(
    prefix="/prayer",
    tags=["Prayer"],
)


# ------------------------------------------------------------------
# DATABASE
# ------------------------------------------------------------------

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ------------------------------------------------------------------
# GET PRAYER TIMINGS
# ------------------------------------------------------------------

@router.get("/version")
def get_prayer_version(db: Session = Depends(get_db)):
    """Lightweight endpoint — phones poll this every 6–12 h to detect changes."""
    prayer = db.query(models.PrayerTiming).first()
    if not prayer:
        raise HTTPException(status_code=404, detail="Prayer timings not configured.")
    return {
        "version":    prayer.schedule_version or 1,
        "updated_at": prayer.updated_at,
    }


@router.get("/")
async def get_prayer(db: Session = Depends(get_db)):
    cached = await cache_get("prayer:current")
    if cached:
        return cached

    prayer = db.query(models.PrayerTiming).first()
    if not prayer:
        return {
            "version": 0, "updated_at": None, "updated_by": None, "notes": None,
            "configured": False,
            "early":   {"imsak": None, "sunrise": None, "dhuha": None},
            "adhan":   {"fajr": None, "dhuhr": None, "asr": None, "maghrib": None, "isha": None},
            "prayer":  {"fajr": None, "dhuhr": None, "asr": None, "maghrib": None,
                        "isha": None, "jummah": None, "jummah_iqamah": None},
            "special": {"ishraq": None, "taraweeh": None, "sunset": None},
        }

    data = {
        "version":    prayer.schedule_version or 1,
        "updated_at": prayer.updated_at,
        "early": {
            "imsak":   prayer.imsak,
            "sunrise": prayer.sunrise,
            "dhuha":   prayer.dhuha,
        },
        "adhan": {
            "fajr":    prayer.fajr_adhan,
            "dhuhr":   prayer.dhuhr_adhan,
            "asr":     prayer.asr_adhan,
            "maghrib": prayer.maghrib_adhan,
            "isha":    prayer.isha_adhan,
        },
        "prayer": {
            "fajr":          prayer.fajr,
            "dhuhr":         prayer.dhuhr,
            "asr":           prayer.asr,
            "maghrib":       prayer.maghrib,
            "isha":          prayer.isha,
            "jummah":        prayer.jummah,
            "jummah_iqamah": prayer.jummah_iqamah,
        },
        "special": {
            "ishraq":   prayer.ishraq,
            "taraweeh": prayer.taraweeh,
            "sunset":   prayer.sunset,
        },
        "notes":      prayer.notes,
        "updated_by": prayer.updated_by,
    }
    await cache_set("prayer:current", data, ttl=300)
    return data


# ------------------------------------------------------------------
# CREATE / UPDATE PRAYER TIMINGS
# ------------------------------------------------------------------

@router.put("/")
async def update_prayer(
    payload: schemas.PrayerUpdate,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_or_imam),
):
    prayer = db.query(models.PrayerTiming).first()

    if prayer:

        # Early
        prayer.imsak = payload.imsak
        prayer.sunrise = payload.sunrise
        prayer.dhuha = payload.dhuha

        # Adhan
        prayer.fajr_adhan = payload.fajr_adhan
        prayer.dhuhr_adhan = payload.dhuhr_adhan
        prayer.asr_adhan = payload.asr_adhan
        prayer.maghrib_adhan = payload.maghrib_adhan
        prayer.isha_adhan = payload.isha_adhan

        # Prayer
        prayer.fajr = payload.fajr
        prayer.dhuhr = payload.dhuhr
        prayer.asr = payload.asr
        prayer.maghrib = payload.maghrib
        prayer.isha = payload.isha
        prayer.jummah = payload.jummah
        prayer.jummah_iqamah = payload.jummah_iqamah

        # Special
        prayer.ishraq = payload.ishraq
        prayer.taraweeh = payload.taraweeh
        prayer.sunset = payload.sunset

        # Optional
        prayer.notes = payload.notes

        # Audit — look up user name from DB
        user_obj = db.query(models.User).filter_by(id=int(current_user.get("sub", 0))).first()
        prayer.schedule_version = (prayer.schedule_version or 0) + 1
        prayer.updated_by = user_obj.name if user_obj else None
        prayer.updated_at = datetime.utcnow()

    else:

        user_obj = db.query(models.User).filter_by(id=int(current_user.get("sub", 0))).first()
        prayer = models.PrayerTiming(
            imsak=payload.imsak,
            sunrise=payload.sunrise,
            dhuha=payload.dhuha,

            fajr_adhan=payload.fajr_adhan,
            dhuhr_adhan=payload.dhuhr_adhan,
            asr_adhan=payload.asr_adhan,
            maghrib_adhan=payload.maghrib_adhan,
            isha_adhan=payload.isha_adhan,

            fajr=payload.fajr,
            dhuhr=payload.dhuhr,
            asr=payload.asr,
            maghrib=payload.maghrib,
            isha=payload.isha,
            jummah=payload.jummah,
            jummah_iqamah=payload.jummah_iqamah,

            taraweeh=payload.taraweeh,
            ishraq=payload.ishraq,
            sunset=payload.sunset,

            notes=payload.notes,

            updated_by=user_obj.name if user_obj else None,
            updated_at=datetime.utcnow(),
        )

        db.add(prayer)

    await log_action(
        db, AuditAction.PRAYER_TIMES_UPDATED, "prayer_timings", prayer.id,
        actor=current_user, request=request,
        description="Prayer times and iqamah updated",
    )

    db.commit()
    db.refresh(prayer)
    await cache_invalidate("prayer:current")

    response = {
        "version":    prayer.schedule_version or 1,
        "updated_at": prayer.updated_at,
        "early": {
            "imsak": prayer.imsak,
            "sunrise": prayer.sunrise,
            "dhuha": prayer.dhuha,
        },
        "adhan": {
            "fajr":    prayer.fajr_adhan,
            "dhuhr":   prayer.dhuhr_adhan,
            "asr":     prayer.asr_adhan,
            "maghrib": prayer.maghrib_adhan,
            "isha":    prayer.isha_adhan,
        },
        "prayer": {
            "fajr":          prayer.fajr,
            "dhuhr":         prayer.dhuhr,
            "asr":           prayer.asr,
            "maghrib":       prayer.maghrib,
            "isha":          prayer.isha,
            "jummah":        prayer.jummah,
            "jummah_iqamah": prayer.jummah_iqamah,
        },
        "special": {
            "ishraq":   prayer.ishraq,
            "taraweeh": prayer.taraweeh,
            "sunset":   prayer.sunset,
        },
        "notes":      prayer.notes,
        "updated_by": prayer.updated_by,
    }

    await manager.broadcast(
        "prayer",
        {
            "type": "prayer_updated",
            "data": response,
        },
    )

    # Push new times to all devices via FCM — run in background so a slow
    # network call to Google's servers never blocks this HTTP response.
    background_tasks.add_task(send_fcm_prayer_times_update, prayer)

    return {
        "message": "Prayer timings updated successfully.",
        "data": response,
    }