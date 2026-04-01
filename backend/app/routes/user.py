# backend/app/routes/users.py

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app import models, schemas
from app.security import require_admin, require_superadmin

router = APIRouter(prefix="/users", tags=["Users"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ── GET all users — admin/superadmin only ────────────────────────────────────────
@router.get("/", response_model=list[schemas.UserOut])
def get_users(
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    return db.query(models.User).order_by(models.User.created_at.desc()).all()


# ── GET single user ──────────────────────────────────────────────────────────────
@router.get("/{user_id}", response_model=schemas.UserOut)
def get_user(
    user_id: int,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    u = db.query(models.User).filter(models.User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    return u


# ── CHANGE ROLE — superadmin only ───────────────────────────────────────────────
@router.put("/{user_id}/role")
def change_role(
    user_id: int,
    data: schemas.UserRoleUpdate,
    db: Session = Depends(get_db),
    user: dict = Depends(require_superadmin),
):
    valid_roles = ["superadmin", "admin", "imam", "member"]
    if data.role not in valid_roles:
        raise HTTPException(status_code=400, detail=f"Role must be one of: {valid_roles}")

    u = db.query(models.User).filter(models.User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")

    # Prevent demoting yourself
    if str(u.id) == user["sub"] and data.role != "superadmin":
        raise HTTPException(status_code=400, detail="You cannot demote yourself")

    u.role = data.role
    db.commit()
    return {"message": f"Role updated to {data.role}", "user_id": user_id}


# ── DELETE user — superadmin only ───────────────────────────────────────────────
@router.delete("/{user_id}")
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    user: dict = Depends(require_superadmin),
):
    if str(user_id) == user["sub"]:
        raise HTTPException(status_code=400, detail="You cannot delete yourself")

    u = db.query(models.User).filter(models.User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")

    db.delete(u)
    db.commit()
    return {"message": "User deleted"}