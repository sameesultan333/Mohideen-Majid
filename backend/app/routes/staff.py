# backend/app/routes/staff.py

from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import SessionLocal
from app.security import require_superadmin
from app.websocket_manager import manager
from app.routes.finance import write_audit

router = APIRouter(prefix="/admin/staff", tags=["Staff"])

ROLE_ORDER = {"superadmin": 0, "admin": 1, "imam": 2, "collector": 3}
STAFF_ROLES = {"admin", "imam", "collector"}


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _normalize(phone: str) -> str | None:
    digits = "".join(filter(str.isdigit, str(phone)))
    return digits[-10:] if len(digits) >= 10 else None


def _actor_id(current_user: dict) -> int:
    return int(current_user["sub"])


# ─────────────────────────────────────────────────────────────
# GET /admin/staff
# ─────────────────────────────────────────────────────────────
@router.get("/", response_model=List[schemas.StaffOut], summary="List all staff")
def list_staff(
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_superadmin),
):
    """
    Returns every user whose role is superadmin / admin / imam / collector.
    Ordered: superadmin → admin → imam → collector, then alphabetically by name.
    """
    staff = (
        db.query(models.User)
        .filter(
            models.User.role.in_(["superadmin", "admin", "imam", "collector"]),
            models.User.family_id.is_(None),
        )
        .all()
    )
    staff.sort(key=lambda u: (ROLE_ORDER.get(u.role, 99), u.name.lower()))
    return staff


# ─────────────────────────────────────────────────────────────
# POST /admin/staff
# ─────────────────────────────────────────────────────────────
@router.post("/", response_model=schemas.StaffOut, status_code=201, summary="Create staff account")
def create_staff(
    data: schemas.StaffCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_superadmin),
):
    """
    Creates a new admin / imam / collector account.
    No password set here — staff self-register via the app to set their own password.
    """
    phone = _normalize(data.phone)
    if not phone:
        raise HTTPException(400, "Invalid phone number")

    if db.query(models.User).filter_by(phone=phone).first():
        raise HTTPException(400, f"Phone {phone} is already registered")

    staff = models.User(
        name=data.name.strip(),
        phone=phone,
        role=data.role,
        is_active=True,
        phone_verified=True,
        family_id=None,
        head_phone=None,
        password=None,
        created_at=datetime.utcnow(),
    )
    db.add(staff)
    db.commit()
    db.refresh(staff)

    write_audit(
        db, "users", staff.id, "create",
        new_values={"name": staff.name, "phone": staff.phone, "role": staff.role},
        performed_by_id=_actor_id(current_user),
        note=f"Created {staff.role.capitalize()} {staff.name}",
    )

    manager.publish_sync("admin", "staff_created", {
        "staff_id": staff.id,
        "name": staff.name,
        "role": staff.role,
    })

    return staff


# ─────────────────────────────────────────────────────────────
# PUT /admin/staff/{id}
# ─────────────────────────────────────────────────────────────
@router.put("/{staff_id}", response_model=schemas.StaffOut, summary="Edit staff")
def update_staff(
    staff_id: int,
    data: schemas.StaffUpdate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_superadmin),
):
    staff = db.query(models.User).filter_by(id=staff_id).first()
    if not staff:
        raise HTTPException(404, "Staff member not found")

    if staff.role == "superadmin" and staff_id != _actor_id(current_user):
        raise HTTPException(403, "Cannot edit another superadmin's account")

    old = {"name": staff.name, "phone": staff.phone, "role": staff.role, "is_active": staff.is_active}

    if data.name is not None:
        staff.name = data.name.strip()

    if data.phone is not None:
        phone = _normalize(data.phone)
        if not phone:
            raise HTTPException(400, "Invalid phone number")
        existing = db.query(models.User).filter(
            models.User.phone == phone,
            models.User.id != staff_id,
        ).first()
        if existing:
            raise HTTPException(400, f"Phone {phone} is already in use")
        staff.phone = phone

    if data.role is not None:
        # Prevent self-demotion and guard superadmin role
        if staff_id == _actor_id(current_user) and data.role != staff.role:
            raise HTTPException(400, "You cannot change your own role")
        staff.role = data.role

    if data.is_active is not None:
        if staff_id == _actor_id(current_user) and not data.is_active:
            raise HTTPException(400, "You cannot disable yourself")
        staff.is_active = data.is_active

    db.commit()
    db.refresh(staff)

    write_audit(
        db, "users", staff.id, "update",
        old_values=old,
        new_values={"name": staff.name, "phone": staff.phone, "role": staff.role, "is_active": staff.is_active},
        performed_by_id=_actor_id(current_user),
        note=f"Edited {staff.role.capitalize()} {staff.name}",
    )

    manager.publish_sync("admin", "staff_updated", {
        "staff_id": staff.id,
        "name": staff.name,
        "role": staff.role,
    })

    return staff


# ─────────────────────────────────────────────────────────────
# PATCH /admin/staff/{id}/status
# ─────────────────────────────────────────────────────────────
@router.patch("/{staff_id}/status", response_model=schemas.StaffOut, summary="Toggle staff active status")
def toggle_status(
    staff_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_superadmin),
):
    staff = db.query(models.User).filter_by(id=staff_id).first()
    if not staff:
        raise HTTPException(404, "Staff member not found")

    if staff_id == _actor_id(current_user):
        raise HTTPException(400, "You cannot disable yourself")

    old_status = staff.is_active
    staff.is_active = not old_status
    db.commit()
    db.refresh(staff)

    action = "Enabled" if staff.is_active else "Disabled"
    write_audit(
        db, "users", staff.id, "update",
        old_values={"is_active": old_status},
        new_values={"is_active": staff.is_active},
        performed_by_id=_actor_id(current_user),
        note=f"{action} {staff.role.capitalize()} {staff.name}",
    )

    manager.publish_sync("admin", "staff_status_changed", {
        "staff_id": staff.id,
        "name": staff.name,
        "is_active": staff.is_active,
    })

    return staff


# ─────────────────────────────────────────────────────────────
# DELETE /admin/staff/{id}
# ─────────────────────────────────────────────────────────────
@router.delete("/{staff_id}", status_code=200, summary="Delete staff account")
def delete_staff(
    staff_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_superadmin),
):
    staff = db.query(models.User).filter_by(id=staff_id).first()
    if not staff:
        raise HTTPException(404, "Staff member not found")

    if staff.role == "superadmin":
        raise HTTPException(403, "Cannot delete a superadmin account")

    if staff_id == _actor_id(current_user):
        raise HTTPException(400, "You cannot delete yourself")

    name, role = staff.name, staff.role

    # Revoke all sessions first
    db.query(models.UserSession).filter_by(user_id=staff_id).update(
        {"is_active": False, "revoked_at": datetime.utcnow()}
    )

    write_audit(
        db, "users", staff.id, "delete",
        old_values={"name": name, "phone": staff.phone, "role": role},
        performed_by_id=_actor_id(current_user),
        note=f"Deleted {role.capitalize()} {name}",
    )

    db.delete(staff)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete {name} — they have existing records (payments, "
                    "hadith, answers, etc.). Deactivate the account instead.",
        )

    manager.publish_sync("admin", "staff_deleted", {
        "staff_id": staff_id,
        "name": name,
        "role": role,
    })

    return {"message": f"{role.capitalize()} {name} deleted successfully"}
