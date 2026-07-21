# backend/app/routes/collector.py
"""
Collector-specific routes:
  - Cash submission workflow
  - Scoped family management (assigned families only)
"""

from datetime import datetime
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import models
from app.database import SessionLocal
from app.security import require_collector, require_admin, get_current_user
from app.services.audit_service import AuditAction, log_action
from app.services.cash_submission_service import CashSubmissionService
from app.utils.fcm import notify_user

router = APIRouter(prefix="/collector", tags=["Collector"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ── Schemas ───────────────────────────────────────────────────────────────────

class CashSubmissionCreate(BaseModel):
    start_date: datetime
    end_date: datetime
    submitted_amount: Decimal
    receiving_admin_id: Optional[int] = None
    notes: Optional[str] = None
    expected_amount: Optional[Decimal] = None


class CashSubmissionApprove(BaseModel):
    approved_amount: Optional[Decimal] = None
    notes: Optional[str] = None


class CashSubmissionReject(BaseModel):
    reason: str


class FamilyCreate(BaseModel):
    chanda_no: str
    name: str
    phone: Optional[str] = None
    address: Optional[str] = None
    zone: Optional[str] = None
    monthly_amount: float
    registration_date: Optional[datetime] = None


class FamilyUpdate(BaseModel):
    name: Optional[str] = None
    chanda_no: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    zone: Optional[str] = None
    monthly_amount: Optional[float] = None
    registration_date: Optional[datetime] = None


# ── Cash Submissions (Collector side) ─────────────────────────────────────────

@router.post("/cash-submissions")
async def submit_cash(
    data: CashSubmissionCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_collector),
):
    if data.end_date < data.start_date:
        raise HTTPException(400, "end_date must be after start_date.")
    if data.submitted_amount <= 0:
        raise HTTPException(400, "submitted_amount must be positive.")

    submission = await CashSubmissionService.submit(
        db=db,
        actor=current_user,
        request=request,
        start_date=data.start_date,
        end_date=data.end_date,
        submitted_amount=data.submitted_amount,
        receiving_admin_id=data.receiving_admin_id,
        notes=data.notes,
        expected_amount=data.expected_amount,
    )

    # Notify the receiving admin if specified
    if data.receiving_admin_id:
        try:
            collector_name = current_user.get("name", "Collector")
            notify_user(
                db, data.receiving_admin_id,
                title="Cash Submission Received",
                body=f"{collector_name} submitted ₹{data.submitted_amount} for approval.",
                data={"type": "cash_submission", "submission_id": str(submission.id)},
            )
        except Exception:
            pass

    return {
        "id":               submission.id,
        "status":           submission.status,
        "submitted_amount": str(submission.submitted_amount),
        "start_date":       submission.start_date.isoformat(),
        "end_date":         submission.end_date.isoformat(),
        "submitted_at":     submission.submitted_at.isoformat(),
        "message":          "Cash submission created. Awaiting admin approval.",
    }


@router.get("/cash-submissions")
def list_my_submissions(
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_collector),
):
    collector_id = int(current_user["sub"])
    rows = (
        db.query(models.CollectorCashSubmission)
        .filter_by(collector_id=collector_id)
        .order_by(models.CollectorCashSubmission.submitted_at.desc())
        .all()
    )
    return [_serialize_submission(r) for r in rows]


# ── Cash Submissions (Admin side) ─────────────────────────────────────────────

@router.get("/admin/cash-submissions")
def admin_list_submissions(
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    q = db.query(models.CollectorCashSubmission)
    if status:
        q = q.filter_by(status=status)
    rows = q.order_by(models.CollectorCashSubmission.submitted_at.desc()).all()
    return [_serialize_submission(r, admin_view=True) for r in rows]


@router.patch("/admin/cash-submissions/{submission_id}/approve")
async def admin_approve_submission(
    submission_id: int,
    data: CashSubmissionApprove,
    request: Request,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    submission = db.query(models.CollectorCashSubmission).filter_by(id=submission_id).first()
    if not submission:
        raise HTTPException(404, "Submission not found.")

    updated = await CashSubmissionService.approve(
        db=db,
        submission=submission,
        actor=current_user,
        request=request,
        approved_amount=data.approved_amount,
        notes=data.notes,
    )
    return {"message": "Approved.", "submission": _serialize_submission(updated)}


@router.patch("/admin/cash-submissions/{submission_id}/reject")
async def admin_reject_submission(
    submission_id: int,
    data: CashSubmissionReject,
    request: Request,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    submission = db.query(models.CollectorCashSubmission).filter_by(id=submission_id).first()
    if not submission:
        raise HTTPException(404, "Submission not found.")

    updated = await CashSubmissionService.reject(
        db=db,
        submission=submission,
        actor=current_user,
        request=request,
        reason=data.reason,
    )
    return {"message": "Rejected.", "submission": _serialize_submission(updated)}


# ── Admin listing for collectors ──────────────────────────────────────────────

@router.get("/admins")
def list_admins(
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_collector),
):
    """Return id + name of all active admin/superadmin users (for 'submitted to' dropdown)."""
    admins = (
        db.query(models.User)
        .filter(
            models.User.role.in_(["admin", "superadmin"]),
            models.User.is_active == True,
        )
        .order_by(models.User.name)
        .all()
    )
    return [{"id": u.id, "name": u.name} for u in admins]


# ── Collector Family Management ────────────────────────────────────────────────

@router.get("/families")
def list_families(
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_collector),
):
    """Return all active families — collectors have full visibility."""
    families = (
        db.query(models.ApprovedHead)
        .filter_by(is_active=True)
        .order_by(models.ApprovedHead.name)
        .all()
    )
    return [_serialize_family(f) for f in families]


@router.post("/families")
async def create_family(
    data: FamilyCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_collector),
):
    """Create a new family (same rules as admin creation)."""
    from app.routes.admin import normalize as normalize_phone

    chanda_no = data.chanda_no.strip().upper()
    if not chanda_no:
        raise HTTPException(400, "chanda_no is required.")
    if db.query(models.ApprovedHead).filter_by(chanda_no=chanda_no).first():
        raise HTTPException(400, f"Chanda number '{chanda_no}' is already in use.")

    phone = None
    if data.phone:
        phone = normalize_phone(data.phone.strip())
        if phone is None:
            raise HTTPException(400, "Invalid phone number (must be 10 digits).")
        if db.query(models.ApprovedHead).filter_by(phone=phone).first():
            raise HTTPException(400, "Phone number is already registered to another family.")

    head = models.ApprovedHead(
        chanda_no=chanda_no,
        name=data.name.strip(),
        phone=phone,
        address=data.address,
        zone=data.zone.strip().title() if data.zone else None,
        monthly_amount=data.monthly_amount,
        registration_date=data.registration_date,
    )
    db.add(head)
    db.flush()

    # Auto-generate chanda months from registration_date to current month
    try:
        from app.routes.admin import _auto_generate_months_for_head
        _auto_generate_months_for_head(db, head)
    except Exception:
        pass

    await log_action(
        db, AuditAction.FAMILY_EDITED, "approved_heads", head.id,
        actor=current_user, request=request,
        description=f"Family created by collector: {head.name} ({chanda_no})",
    )
    db.commit()
    return {"message": "Family created.", "family": _serialize_family(head)}


@router.patch("/families/{family_id}")
async def update_family(
    family_id: int,
    data: FamilyUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_collector),
):
    """Collectors can edit any family's details."""
    from app.routes.admin import normalize as normalize_phone

    family = db.query(models.ApprovedHead).filter_by(id=family_id, is_active=True).first()
    if not family:
        raise HTTPException(404, "Family not found.")

    old_values = {
        "name": family.name,
        "chanda_no": family.chanda_no,
        "phone": family.phone,
        "address": family.address,
        "zone": family.zone,
        "monthly_amount": family.monthly_amount,
    }
    changed = {}

    if data.name is not None and data.name.strip():
        family.name = data.name.strip()
        changed["name"] = family.name

    if data.chanda_no is not None and data.chanda_no.strip():
        new_cn = data.chanda_no.strip().upper()
        if new_cn != family.chanda_no:
            conflict = db.query(models.ApprovedHead).filter(
                models.ApprovedHead.chanda_no == new_cn,
                models.ApprovedHead.id != family_id,
            ).first()
            if conflict:
                raise HTTPException(400, f"Chanda number '{new_cn}' is already in use.")
        family.chanda_no = new_cn
        changed["chanda_no"] = new_cn

    if data.phone is not None:
        if data.phone.strip():
            phone = normalize_phone(data.phone.strip())
            if phone is None:
                raise HTTPException(400, "Invalid phone number (must be 10 digits).")
            conflict = db.query(models.ApprovedHead).filter(
                models.ApprovedHead.phone == phone,
                models.ApprovedHead.id != family_id,
            ).first()
            if conflict:
                raise HTTPException(400, "Phone number is already in use by another family.")
            family.phone = phone
            changed["phone"] = phone
        else:
            family.phone = None
            changed["phone"] = None

    if data.address is not None:
        family.address = data.address.strip() or None
        changed["address"] = family.address

    if data.zone is not None:
        family.zone = data.zone.strip().title() or None
        changed["zone"] = family.zone

    if data.registration_date is not None:
        old_reg_date = family.registration_date
        family.registration_date = data.registration_date
        changed["registration_date"] = data.registration_date.isoformat()
        # Backfill any pending months newly covered by the earlier start date.
        # Idempotent — _auto_generate_months_for_head only creates months
        # that don't already exist, never duplicates or removes existing ones.
        if data.registration_date != old_reg_date:
            from app.routes.admin import _auto_generate_months_for_head
            db.flush()
            _auto_generate_months_for_head(db, family)

    if data.monthly_amount is not None and data.monthly_amount > 0:
        old_amount = family.monthly_amount
        family.monthly_amount = data.monthly_amount
        changed["monthly_amount"] = data.monthly_amount

        db.query(models.ChandaCollection).filter(
            models.ChandaCollection.head_id == family_id,
            models.ChandaCollection.status == "pending",
        ).update({"amount_due": data.monthly_amount, "rate_snapshot": data.monthly_amount})

        await log_action(
            db, AuditAction.CHANDA_AMOUNT_UPDATED, "approved_heads", family_id,
            actor=current_user, request=request,
            description=f"Chanda amount updated: {family.name} ₹{old_amount} → ₹{data.monthly_amount}",
            old_values={"monthly_amount": old_amount},
            new_values={"monthly_amount": data.monthly_amount},
        )

        if family.user_id:
            try:
                notify_user(
                    db, family.user_id,
                    title="Chanda Amount Updated",
                    body=f"Your monthly chanda amount has been updated to ₹{data.monthly_amount}.",
                    data={"type": "chanda_amount_updated"},
                )
            except Exception:
                pass

    if changed:
        action = AuditAction.PHONE_UPDATED if list(changed.keys()) == ["phone"] else AuditAction.FAMILY_EDITED
        await log_action(
            db, action, "approved_heads", family_id,
            actor=current_user, request=request,
            description=f"Family updated: {family.name}",
            old_values=old_values,
            new_values=changed,
        )

    db.commit()
    return {"message": "Family updated.", "family": _serialize_family(family)}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _serialize_submission(row: models.CollectorCashSubmission, admin_view: bool = False) -> dict:
    out = {
        "id":               row.id,
        "collector_id":     row.collector_id,
        "start_date":       row.start_date.isoformat() if row.start_date else None,
        "end_date":         row.end_date.isoformat() if row.end_date else None,
        "submitted_amount": str(row.submitted_amount),
        "expected_amount":  str(row.expected_amount) if row.expected_amount else None,
        "approved_amount":  str(row.approved_amount) if row.approved_amount else None,
        "notes":            row.notes,
        "status":           row.status,
        "rejection_reason": row.rejection_reason,
        "submitted_at":     row.submitted_at.isoformat() if row.submitted_at else None,
        "approved_at":      row.approved_at.isoformat() if row.approved_at else None,
        "rejected_at":      row.rejected_at.isoformat() if row.rejected_at else None,
    }
    out["receiving_admin_name"] = row.receiving_admin.name if row.receiving_admin else None
    if admin_view and row.collector:
        out["collector_name"] = row.collector.name
        out["collector_phone"] = row.collector.phone
    return out


def _serialize_family(family: models.ApprovedHead) -> dict:
    return {
        "id":             family.id,
        "chanda_no":      family.chanda_no,
        "name":           family.name,
        "phone":          family.phone,
        "address":        family.address,
        "zone":           family.zone,
        "monthly_amount": family.monthly_amount,
        "is_registered":  family.is_registered,
        "is_active":      family.is_active,
        "registration_date": family.registration_date.isoformat() if family.registration_date else None,
    }
