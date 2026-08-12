# backend/app/routes/users.py

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from pydantic import BaseModel
from app.database import SessionLocal
from app import models, schemas
from app.security import require_admin, require_superadmin


class AssignFamilyBody(BaseModel):
    head_id: int
    name: Optional[str] = None

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
    return (
        db.query(models.User)
        .filter(models.User.is_deleted == False)
        .order_by(models.User.created_at.desc())
        .all()
    )


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


# ── REPAIR broken member links (one-time fix for old bad registrations) ─────────
@router.post("/repair-member-links")
def repair_member_links(
    db: Session = Depends(get_db),
    user: dict = Depends(require_superadmin),
):
    """
    Fixes members created with the old buggy registration flow where
    head_phone was set to the member's own phone instead of their head's phone.
    Only fixes members where family_id is NULL and head_phone == phone.
    """
    broken = (
        db.query(models.User)
        .filter(
            models.User.role == "member",
            models.User.family_id.is_(None),
            models.User.head_phone == models.User.phone,
        )
        .all()
    )
    fixed = []
    for u in broken:
        # Can't auto-fix without knowing the real head — just flag them
        fixed.append({
            "id": u.id,
            "name": u.name,
            "phone": u.phone,
            "issue": "family_id is NULL and head_phone equals own phone — needs manual assignment",
        })
    return {"broken_count": len(fixed), "records": fixed}


# ── DISMISS a "not linked to a family" flag ──────────────────────────────────────
@router.patch("/{user_id}/dismiss-family-flag")
def dismiss_family_flag(
    user_id: int,
    db: Session = Depends(get_db),
    user: dict = Depends(require_superadmin),
):
    """
    Not every account with `head_phone == phone` and no `family_id` is a
    broken self-registration - some are simply staff who left the committee
    and were never meant to be a Chanda payer at all. Forcing an admin to
    pick *some* family for them just to clear the warning would create a
    false Chanda Head link. This clears `head_phone` so the account no
    longer matches the broken-registration heuristic, without touching
    family_id, role, or any payment/Chanda data.
    """
    u = db.query(models.User).filter_by(id=user_id).first()
    if not u:
        raise HTTPException(404, "User not found")
    u.head_phone = None
    db.commit()
    return {"ok": True, "user_id": u.id}


# ── ASSIGN member to a head ─────────────────────────────────────────────────────
@router.patch("/{user_id}/assign-family")
def assign_family(
    user_id: int,
    data: AssignFamilyBody,
    db: Session = Depends(get_db),
    user: dict = Depends(require_superadmin),
):
    """
    Link an existing login (member OR staff/admin) to a Chanda Head/family
    record, as one person rather than two disconnected identities.

    This used to only set `u.family_id` — the reverse link (`head.user_id`)
    was never written, so `ApprovedHead.is_registered`/`.user_id` kept
    reporting the family as unclaimed even after a user was pointed at it,
    and the person's roles never gained "head": anything that checked
    `head.user_id` or the role list independently of `family_id` (occupancy
    counts, registration status, role-gated screens) still disagreed with
    what `family_id` said. A staff account linked this way also silently lost
    nothing - their existing admin/imam/collector role(s) are untouched;
    "head" is added alongside them, never replacing them.

    Refuses instead of silently merging when either side is already linked to
    someone else - a mismatch there means the wrong two records were picked,
    and guessing which one to overwrite is exactly the kind of unverified
    identity merge this must never do.
    """
    u = db.query(models.User).filter_by(id=user_id).first()
    if not u:
        raise HTTPException(404, "User not found")
    head = db.query(models.ApprovedHead).filter_by(id=data.head_id).first()
    if not head:
        raise HTTPException(404, "Head not found")

    if u.family_id and u.family_id != head.id:
        raise HTTPException(
            400,
            f"{u.name} is already linked to a different family (id {u.family_id}). "
            "Unlink first if this is really the same person.",
        )
    if head.user_id and head.user_id != u.id:
        other = db.query(models.User).filter_by(id=head.user_id).first()
        raise HTTPException(
            400,
            f"This family is already claimed by {other.name if other else 'another user'}. "
            "Unlink that account first if this is really the same person.",
        )

    u.family_id = head.id
    u.head_phone = head.phone
    if data.name:
        u.name = data.name
    elif u.name == u.phone:
        u.name = head.name  # fallback: use head name if member name is still phone number

    head.user_id = u.id
    head.is_registered = True

    # Adds "head" alongside whatever roles the account already has (staff,
    # admin, ...) - never replaces u.role, which is why an admin who is also
    # a Chanda Head keeps full admin access after this call.
    if not db.query(models.UserRoleEntry).filter_by(user_id=u.id, role="head").first():
        db.add(models.UserRoleEntry(user_id=u.id, role="head", assigned_by_id=int(user["sub"])))

    # "member" is a neutral placeholder, not a real privilege - it's what an
    # account gets by default or after leaving the committee with no other
    # relationship. Once that account is linked to a Chanda Head, "head" is
    # the meaningful primary role, so promote it here. Any actual privileged
    # role (admin/imam/collector/superadmin) is left exactly as-is, matching
    # the admin+head example above - it must never be demoted by this call.
    if u.role == "member":
        u.role = "head"

    db.commit()
    return {"ok": True, "user_id": u.id, "family_id": head.id, "head_name": head.name}


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
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail="Cannot delete this user — they have existing payments, questions, "
                    "hadith, or other linked records. Deactivate the account instead.",
        )
    return {"message": "User deleted"}