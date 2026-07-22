from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app import models
from app.database import SessionLocal
from app.security import get_current_user

router = APIRouter(prefix="/user", tags=["Device Tokens"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class RegisterDeviceBody(BaseModel):
    token: str
    platform: str = "android"   # android | ios | web
    device_name: str | None = None
    app_version: str | None = None


@router.post("/register-device")
def register_device(
    body: RegisterDeviceBody,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    user_id = int(current_user["sub"])
    now = datetime.utcnow()

    # Account-switch guard: if this token belongs to a DIFFERENT user (old login),
    # remove those stale rows so the upsert below lands cleanly.
    db.query(models.DeviceToken).filter(
        models.DeviceToken.token == body.token,
        models.DeviceToken.user_id != user_id,
    ).delete(synchronize_session=False)

    # Atomic upsert — handles concurrent calls from the same device without
    # ever raising UniqueViolation, even if two requests arrive simultaneously.
    stmt = (
        pg_insert(models.DeviceToken.__table__)
        .values(
            user_id=user_id,
            token=body.token,
            platform=body.platform,
            device_name=body.device_name,
            app_version=body.app_version,
            is_active=True,
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_update(
            index_elements=["user_id", "token"],
            set_={
                "is_active": True,
                "platform": body.platform,
                "device_name": body.device_name,
                "app_version": body.app_version,
                "updated_at": now,
            },
        )
    )
    db.execute(stmt)
    db.commit()
    return {"status": "registered"}


@router.delete("/deregister-device")
def deregister_device(
    body: RegisterDeviceBody,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    user_id = int(current_user["sub"])
    (
        db.query(models.DeviceToken)
        .filter_by(user_id=user_id, token=body.token)
        .update({"is_active": False})
    )
    db.commit()
    return {"status": "deregistered"}


def deactivate_all_tokens_for_user(db: Session, user_id: int) -> None:
    """Deactivate every device/push token for a user in one shot — used by
    self-service account deletion so no further notifications are ever sent.
    Caller is responsible for committing."""
    db.query(models.DeviceToken).filter_by(user_id=user_id).update({"is_active": False})
