# backend/app/routes/admin.py

from datetime import datetime, timedelta
from typing import List, Optional

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import SessionLocal
from app.models import UserStatus
from app.security import require_admin, require_superadmin, require_admin_or_collector, verify_password
from app.services.audit_service import AuditAction, log_action
from app.services.registration_service import RegistrationApprovalService
from app.services.chanda_number_service import generate_next_chanda_no
from app.utils.fcm import notify_user
from app.utils.payment_ledger import generate_receipt_id
from app.websocket_manager import manager
from app.routes.finance import write_audit, write_ledger

router = APIRouter(prefix="/admin", tags=["Admin"])

HISTORICAL_MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4,
    "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12,
}


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def normalize(phone: str) -> str | None:
    """Normalize a phone string to exactly 10 digits, or return None if invalid.

    Strict rules — never silently truncate:
      10 digits           → return as-is
      11 digits, starts 0 → strip leading 0 (e.g. "09150003309" → "9150003309")
      anything else       → None  (caller decides whether to skip or error)
    """
    digits = "".join(filter(str.isdigit, str(phone)))
    if len(digits) == 10:
        return digits
    if len(digits) == 11 and digits.startswith("0"):
        return digits[1:]
    return None


def _actor_id(current_user: dict) -> int:
    return int(current_user["sub"])


def _create_historical_records(db: Session, head: models.ApprovedHead, payments: dict, year: int):
    now = datetime.utcnow()
    for month_label, amount_raw in payments.items():
        month_num = HISTORICAL_MONTHS.get(month_label.strip().lower())
        if month_num is None:
            continue
        try:
            import math as _math
            amount_paid = float(amount_raw) if amount_raw is not None else 0
            if _math.isnan(amount_paid) or _math.isinf(amount_paid):
                amount_paid = 0
        except (ValueError, TypeError):
            amount_paid = 0

        month_key       = f"{year}-{month_num:02d}"
        collection_date = datetime(year, month_num, 1)

        existing = db.query(models.ChandaCollection).filter_by(
            head_id=head.id, month=month_key
        ).first()
        if existing:
            continue

        status = (
            "paid"    if amount_paid >= head.monthly_amount else
            "partial" if amount_paid > 0 else
            "pending"
        )
        collection = models.ChandaCollection(
            head_id=head.id, month=month_key,
            amount_due=head.monthly_amount, total_paid=amount_paid,
            status=status, created_at=collection_date,
        )
        db.add(collection)
        db.flush()

        if amount_paid > 0:
            payment = models.PaymentEntry(
                collection_id=collection.id, head_id=head.id,
                amount=amount_paid, method="cash",
                created_at=collection_date, collected_by="migration",
                collected_at=collection_date, status="verified",
                created_by="migration", verified_by="migration",
                verified_at=collection_date,
                receipt_id=generate_receipt_id(db, prefix="CH", created_at=now),
                purpose="Monthly Chanda", months_covered=1,
                covered_months=[month_key], coverage_map={month_key: amount_paid},
            )
            db.add(payment)
            db.flush()
            write_ledger(
                db, "chanda", "income", amount_paid,
                family_id=head.id, payment_entry_id=payment.id,
                month=month_key, note="Historical migration",
            )


# ─────────────────────────────────────────────────────────────
# EXCEL IMPORT  (Swagger/backend only — never exposed in UI)
# ─────────────────────────────────────────────────────────────

@router.post("/upload-heads")
async def upload_heads(
    request: Request,
    file: UploadFile = File(...),
    year: int = datetime.utcnow().year,
    db: Session = Depends(get_db),
    current_user=Depends(require_superadmin),
):
    try:
        df = pd.read_csv(file.file) if file.filename.endswith(".csv") else pd.read_excel(file.file)
        df.columns = df.columns.str.strip().str.lower()
    except Exception as e:
        raise HTTPException(400, f"Invalid file: {e}")

    df = df.rename(columns={
        "chanda number":         "chanda_no",
        "chanda no":             "chanda_no",
        "head name":             "name",
        "monthly chanda amount": "monthly_amount",
    })
    # phone is now optional — only chanda_no + name + monthly_amount are required
    missing = {"chanda_no", "name", "monthly_amount"} - set(df.columns)
    if missing:
        raise HTTPException(400, f"Missing columns: {missing}")

    # Use chanda_no as the stable identifier — phone may be NULL
    # ── Pre-scan: map every chanda_no → {row, name, address} of its FIRST occurrence ──
    # Used later to emit rich duplicate-skip messages without a second file pass.
    import math as _math
    first_occurrence: dict[str, dict] = {}   # chanda_no → {row, name, address}
    for _idx, _row in df.iterrows():
        _cn = str(_row.get("chanda_no", "")).strip().upper()
        if _cn and _cn not in first_occurrence:
            first_occurrence[_cn] = {
                "row":     int(_idx) + 2,
                "name":    str(_row.get("name", "")).strip(),
                "address": str(_row.get("address", "")).strip() or None,
            }

    # Records that existed in the DB BEFORE this import started.
    preexisting_chanda = {h.chanda_no for h in db.query(models.ApprovedHead.chanda_no).all()}
    # Records inserted during THIS import run — kept separate so a duplicate chanda_no
    # in the Excel file is caught as a validation error, not silently treated as an update.
    imported_chanda: set[str] = set()
    # Phones already in DB before this import — these are "owned" by existing families
    existing_phones: dict[str, dict] = {
        h.phone: {"chanda_no": h.chanda_no, "name": h.name}
        for h in db.query(models.ApprovedHead).filter(models.ApprovedHead.phone.isnot(None)).all()
    }
    # Tracks phones seen so far IN THIS import batch (new phones being claimed)
    seen_in_batch: dict[str, dict] = {}

    inserted = updated = skipped = 0
    errors: list[str] = []

    # Detailed duplicate phone report
    phone_duplicates: list[dict] = []
    chanda_duplicates: list[dict] = []
    no_phone_count = 0
    phones_removed_count = 0

    for idx, row in df.iterrows():
        row_num = idx + 2  # 1-based + header row
        chanda_no = str(row.get("chanda_no", "")).strip().upper()
        name      = str(row.get("name", "")).strip()

        # phone is optional; store NULL rather than "N/A" / blank
        raw_phone = row.get("phone", None)
        phone = None
        if raw_phone is None or (isinstance(raw_phone, float) and not _math.isfinite(raw_phone)):
            phone_str = None  # NaN / Inf / missing cell
        elif isinstance(raw_phone, (int, float)):
            # pandas reads unformatted numeric phone columns as float64.
            # str(9150003309.0) → "9150003309.0" → digits "91500033090" (11!) → [-10:] corrupts.
            # Cast to int first to get "9150003309" with no decimal point.
            phone_str = str(int(raw_phone))
        else:
            phone_str = str(raw_phone).strip()
        if phone_str and phone_str.lower() not in ("", "n/a", "na", "none", "null", "-", "nan"):
            phone = normalize(phone_str) or None
            if phone_str.lower() not in ("", "n/a", "na", "none", "null", "-", "nan") and phone is None:
                # normalize() rejected it — digit count was wrong after parsing
                errors.append(f"Row {row_num}: invalid phone '{phone_str}' (must be 10 digits) — imported without phone")

        if phone is None:
            no_phone_count += 1

        address  = str(row.get("address", "")).strip() or None
        raw_zone = row.get("zone", None)
        zone = (
            str(raw_zone).strip().title()
            if raw_zone and str(raw_zone).strip().lower() not in ("", "nan", "none", "null", "n/a")
            else None
        )
        try:
            _raw = row.get("monthly_amount", 0)
            monthly_amount = float(_raw) if _raw is not None else 0
            if _math.isnan(monthly_amount) or _math.isinf(monthly_amount):
                monthly_amount = 0
        except (ValueError, TypeError):
            monthly_amount = 0

        if not chanda_no or not name:
            skipped += 1
            errors.append(f"Row {row_num}: missing chanda_no or name")
            continue
        if monthly_amount <= 0:
            skipped += 1
            errors.append(f"Row {row_num}: monthly_amount must be > 0 (got {monthly_amount})")
            continue

        # ── Phone duplicate handling ──────────────────────────────────────────
        # If the phone was already claimed (by DB or earlier in this batch),
        # record a detailed duplicate entry and import this family without phone.
        if phone:
            owner = existing_phones.get(phone) or seen_in_batch.get(phone)
            if owner:
                phone_duplicates.append({
                    "phone": phone,
                    "row": row_num,
                    "duplicate_chanda_no": chanda_no,
                    "duplicate_name": name,
                    "kept_chanda_no": owner["chanda_no"],
                    "kept_name": owner["name"],
                    "reason": "Duplicate phone number",
                    "action": "Imported with phone = NULL",
                })
                phones_removed_count += 1
                phone = None  # strip phone; family still imports normally

        # ── Duplicate chanda_no within this file → skip ──────────────────────
        if chanda_no in imported_chanda:
            first = first_occurrence.get(chanda_no, {})
            chanda_duplicates.append({
                "chanda_no":        chanda_no,
                "first_row":        first.get("row"),
                "first_name":       first.get("name"),
                "first_address":    first.get("address"),
                "duplicate_row":    row_num,
                "duplicate_name":   name,
                "duplicate_address": address,
                "reason":           "Duplicate Chanda Number in import file",
                "action":           "Skipped",
            })
            skipped += 1
            continue

        # ── Update pre-existing family (existed before this import) ──────────
        if chanda_no in preexisting_chanda:
            existing_head = db.query(models.ApprovedHead).filter_by(chanda_no=chanda_no).first()
            if existing_head:
                # Only fill in phone if the family has none and the number is free
                if phone and not existing_head.phone:
                    existing_head.phone = phone
                    existing_phones[phone] = {"chanda_no": chanda_no, "name": name}
                if monthly_amount > 0:
                    existing_head.monthly_amount = monthly_amount
                if zone and not existing_head.zone:
                    existing_head.zone = zone
                updated += 1
            continue

        # ── Insert new family ─────────────────────────────────────────────────
        head = models.ApprovedHead(
            chanda_no=chanda_no, name=name, phone=phone,
            address=address, zone=zone, monthly_amount=monthly_amount,
        )
        db.add(head)
        db.flush()

        historical = {
            label: row.get(label)
            for label in HISTORICAL_MONTHS
            if label in df.columns
        }
        if historical:
            _create_historical_records(db, head, historical, year)

        if phone:
            seen_in_batch[phone] = {"chanda_no": chanda_no, "name": name}
        imported_chanda.add(chanda_no)
        inserted += 1

    db.commit()

    unique_phones = len(seen_in_batch) + sum(
        1 for p in existing_phones if p not in seen_in_batch
    )

    invalid_rows = skipped - len(chanda_duplicates)

    await log_action(
        db, AuditAction.EXCEL_IMPORTED, "approved_heads", 0,
        actor=current_user, request=request,
        description=(
            f"Excel import: {inserted} inserted, {updated} updated, {skipped} skipped "
            f"({len(chanda_duplicates)} duplicate chanda_no, {invalid_rows} invalid rows), "
            f"{len(phone_duplicates)} phone duplicates stripped"
        ),
        new_values={
            "inserted": inserted, "updated": updated, "skipped": skipped,
            "total_rows": len(df), "year": year,
            "chanda_duplicates": len(chanda_duplicates),
            "phone_duplicates": len(phone_duplicates),
        },
    )
    return {
        "message":    "Upload completed",
        "inserted":   inserted,
        "updated":    updated,
        "skipped":    skipped,
        "total_rows": len(df),
        "skipped_breakdown": {
            "duplicate_chanda_numbers": len(chanda_duplicates),
            "invalid_rows":             invalid_rows,
        },
        "errors":     errors[:50],
        "phone_stats": {
            "unique_phones_imported":     len(seen_in_batch),
            "duplicate_phone_entries":    len(phone_duplicates),
            "families_imported_no_phone": phones_removed_count,
            "families_without_phone_na":  no_phone_count,
        },
        "phone_duplicates":  phone_duplicates,
        "chanda_duplicates": chanda_duplicates,
    }


# ─────────────────────────────────────────────────────────────
# FAMILY MANAGEMENT
# ─────────────────────────────────────────────────────────────

@router.get("/families")
def list_families(
    search: Optional[str] = None,
    active_only: bool = False,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin_or_collector),
):
    q = db.query(models.ApprovedHead).filter(models.ApprovedHead.is_deleted.is_(False))
    if active_only:
        q = q.filter_by(is_active=True)
    if search:
        term = f"%{search}%"
        q = q.filter(
            models.ApprovedHead.name.ilike(term)
            | models.ApprovedHead.phone.ilike(term)
            | models.ApprovedHead.chanda_no.ilike(term)
        )
    return q.order_by(models.ApprovedHead.chanda_no).all()


@router.post("/families", status_code=201)
def add_family(
    data: schemas.AddFamily,
    year: int = datetime.utcnow().year,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    if data.chanda_no and data.chanda_no.strip():
        chanda_no = data.chanda_no.strip().upper()
        if db.query(models.ApprovedHead).filter_by(chanda_no=chanda_no).first():
            raise HTTPException(400, f"Chanda number {chanda_no} already exists")
    else:
        chanda_no = generate_next_chanda_no(db)

    phone = normalize(data.phone)
    if not phone:
        raise HTTPException(400, "Invalid phone number")
    if db.query(models.ApprovedHead).filter_by(phone=phone).first():
        raise HTTPException(400, "Phone number already registered")

    head = models.ApprovedHead(
        chanda_no=chanda_no, name=data.name.strip(),
        phone=phone, address=data.address,
        zone=data.zone.strip().title() if data.zone else None,
        street=data.street.strip().title() if data.street else None,
        monthly_amount=data.monthly_amount,
        registration_date=data.registration_date,
    )
    db.add(head)
    db.flush()

    if data.historical_payments:
        _create_historical_records(db, head, data.historical_payments, year)

    write_audit(db, "approved_heads", head.id, "create",
                new_values={"chanda_no": chanda_no, "name": head.name},
                performed_by_id=_actor_id(current_user))

    db.commit()
    db.refresh(head)

    # Auto-generate pending month records from registration_date to current month
    # so the collector immediately sees the correct pending months for new families.
    _auto_generate_months_for_head(db, head)
    db.commit()

    manager.publish_sync("finance", "family_created", {"family_id": head.id, "name": head.name})
    return head


def _auto_generate_months_for_head(db: Session, head: models.ApprovedHead) -> None:
    """Generate chanda records from head's registration_date up to current month."""
    from app.utils.timezones import india_month_key, utc_now, add_months
    from app.utils.payment_ledger import set_collection_status, sync_generated_month

    start_dt = head.registration_date or head.created_at
    if not start_dt:
        return
    current_month = india_month_key(utc_now())
    cursor = india_month_key(start_dt)
    monthly_amount = round(float(head.monthly_amount or 0), 2)
    while cursor <= current_month:
        existing = db.query(models.ChandaCollection).filter_by(
            head_id=head.id, month=cursor
        ).first()
        if not existing:
            col = models.ChandaCollection(
                head_id=head.id, month=cursor,
                amount_due=monthly_amount, total_paid=0, status="pending",
            )
            db.add(col)
            db.flush()
            sync_generated_month(db, col)
            set_collection_status(col)
        cursor = add_months(cursor, 1)


@router.put("/families/{family_id}")
def edit_family(
    family_id: int,
    data: schemas.EditFamily,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    head = db.query(models.ApprovedHead).filter_by(id=family_id).first()
    if not head:
        raise HTTPException(404, "Family not found")

    old = {"name": head.name, "phone": head.phone,
           "monthly_amount": head.monthly_amount, "chanda_no": head.chanda_no}

    if data.name            is not None: head.name           = data.name.strip()
    if data.address         is not None: head.address        = data.address
    if data.zone            is not None: head.zone           = data.zone.strip().title() or None
    if data.street          is not None: head.street         = data.street.strip().title() or None
    if data.registration_date is not None: head.registration_date = data.registration_date
    if data.monthly_amount  is not None:
        if data.monthly_amount <= 0:
            raise HTTPException(400, "Monthly amount must be > 0")
        head.monthly_amount = data.monthly_amount
        # Apply the new rate to all pending (unpaid) month records so
        # collector screen, member app, and dashboard stay consistent.
        pending_cols = (
            db.query(models.ChandaCollection)
            .filter(
                models.ChandaCollection.head_id == head.id,
                models.ChandaCollection.status == "pending",
            )
            .all()
        )
        for col in pending_cols:
            col.amount_due = data.monthly_amount
        manager.publish_sync("finance", "monthly_amount_updated", {"family_id": head.id, "amount": head.monthly_amount})
    if data.chanda_no is not None:
        new_no = data.chanda_no.strip().upper()
        if db.query(models.ApprovedHead).filter(
            models.ApprovedHead.chanda_no == new_no,
            models.ApprovedHead.id != family_id,
        ).first():
            raise HTTPException(400, "Chanda number already in use")
        head.chanda_no = new_no
    if data.phone is not None:
        new_phone = normalize(data.phone)
        if not new_phone:
            raise HTTPException(400, "Invalid phone number")
        if db.query(models.ApprovedHead).filter(
            models.ApprovedHead.phone == new_phone,
            models.ApprovedHead.id   != family_id,
        ).first():
            raise HTTPException(400, "Phone number already in use")
        head.phone = new_phone

    write_audit(db, "approved_heads", head.id, "update",
                old_values=old,
                new_values={"name": head.name, "phone": head.phone,
                            "monthly_amount": head.monthly_amount},
                performed_by_id=_actor_id(current_user))
    db.commit()
    db.refresh(head)
    manager.publish_sync("finance", "family_updated", {"family_id": head.id})
    return head


@router.patch("/families/{family_id}/activate")
def activate_family(
    family_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    """Restore a deactivated family. No password required — restoring isn't
    destructive, unlike deactivation."""
    head = db.query(models.ApprovedHead).filter_by(id=family_id).first()
    if not head:
        raise HTTPException(404, "Family not found")
    head.is_active = True
    head.deactivated_at = None
    head.deactivated_until = None
    head.deactivated_by_id = None
    head.deactivation_reason = None
    write_audit(db, "approved_heads", head.id, AuditAction.FAMILY_RESTORED,
                new_values={"is_active": True},
                performed_by_id=_actor_id(current_user),
                note=f"Restored {head.name} ({head.chanda_no})")
    db.commit()
    manager.publish_sync("finance", "family_updated", {"family_id": head.id, "is_active": True})
    return {"message": f"Family {head.chanda_no} activated"}


@router.patch("/families/{family_id}/deactivate")
def deactivate_family(
    family_id: int,
    payload: schemas.ConfirmPassword,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    """Deactivate a family — sensitive/destructive action, requires the
    acting admin to re-enter their own current password. The family is
    restorable for 30 days before the scheduled archive job permanently
    hides it (see job_family_archive_expired in scheduler.py)."""
    actor = db.query(models.User).filter_by(id=_actor_id(current_user)).first()
    if not actor or not actor.password or not verify_password(payload.password, actor.password):
        raise HTTPException(401, "Incorrect password")

    head = db.query(models.ApprovedHead).filter_by(id=family_id).first()
    if not head:
        raise HTTPException(404, "Family not found")
    now = datetime.utcnow()
    head.is_active = False
    head.deactivated_at = now
    head.deactivated_until = now + timedelta(days=30)
    head.deactivated_by_id = actor.id
    head.deactivation_reason = payload.reason
    write_audit(db, "approved_heads", head.id, AuditAction.FAMILY_DEACTIVATED,
                new_values={"is_active": False, "reason": payload.reason},
                performed_by_id=actor.id,
                note=f"Deactivated {head.name} ({head.chanda_no}) by {actor.name}"
                     + (f" — reason: {payload.reason}" if payload.reason else ""))
    db.commit()
    manager.publish_sync("finance", "family_updated", {"family_id": head.id, "is_active": False})
    return {"message": f"Family {head.chanda_no} deactivated"}


@router.delete("/families/{family_id}")
def disable_family(
    family_id: int,
    payload: schemas.ConfirmPassword,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    """Alias for deactivate — kept for backward compat."""
    return deactivate_family(family_id, payload, db, current_user)


@router.get("/families/{family_id}/history")
def family_payment_history(
    family_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    head = db.query(models.ApprovedHead).filter_by(id=family_id).first()
    if not head:
        raise HTTPException(404, "Family not found")

    collections = (
        db.query(models.ChandaCollection)
        .filter_by(head_id=head.id)
        .order_by(models.ChandaCollection.month)
        .all()
    )
    payments = (
        db.query(models.PaymentEntry)
        .filter_by(head_id=head.id)
        .order_by(models.PaymentEntry.created_at)
        .all()
    )
    return {"family": head, "collections": collections, "payments": payments}


# ─────────────────────────────────────────────────────────────
# MEMBER MANAGEMENT
# ─────────────────────────────────────────────────────────────

@router.get("/families/{family_id}/members")
def list_members(
    family_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    head = db.query(models.ApprovedHead).filter_by(id=family_id).first()
    if not head:
        raise HTTPException(404, "Family not found")
    q = db.query(models.User).filter(
        models.User.family_id == family_id,
        models.User.role.notin_(STAFF_ROLES | {"superadmin"}),
    )
    # Exclude the family head themselves — they are the head, not a member
    if head.user_id:
        q = q.filter(models.User.id != head.user_id)
    return q.all()


@router.put("/members/{member_id}")
def edit_member(
    member_id: int,
    data: schemas.UpdateUser,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    member = db.query(models.User).filter_by(id=member_id).first()
    if not member:
        raise HTTPException(404, "Member not found")

    old = {"name": member.name, "phone": member.phone}
    if data.name      is not None: member.name      = data.name.strip()
    if data.is_active is not None: member.is_active = data.is_active
    if data.phone     is not None:
        new_phone = normalize(data.phone)
        if not new_phone:
            raise HTTPException(400, "Invalid phone number")
        if db.query(models.User).filter(
            models.User.phone == new_phone, models.User.id != member_id
        ).first():
            raise HTTPException(400, "Phone already in use")
        member.phone = new_phone

    write_audit(db, "users", member.id, "update",
                old_values=old, new_values={"name": member.name},
                performed_by_id=_actor_id(current_user))
    db.commit()
    db.refresh(member)
    manager.publish_sync("admin", "user_updated", {"user_id": member.id})
    return member


@router.delete("/members/{member_id}")
def remove_member(
    member_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    member = db.query(models.User).filter_by(id=member_id).first()
    if not member:
        raise HTTPException(404, "Member not found")
    if member.role == "head":
        raise HTTPException(400, "Cannot remove a family head — deactivate the family instead.")
    write_audit(db, "users", member.id, "delete",
                old_values={"name": member.name, "phone": member.phone},
                performed_by_id=_actor_id(current_user))
    db.delete(member)
    db.commit()
    return {"message": "Member removed"}


# ─────────────────────────────────────────────────────────────
# STAFF MANAGEMENT  (admin / imam / collector)
# ─────────────────────────────────────────────────────────────

STAFF_ROLES = {"admin", "imam", "collector", "modhin", "watchman"}


@router.get("/search-users")
def search_users(
    q: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin_or_collector),
):
    """Search users + family heads — used by announcement user picker.
    Returns registered users (with their user id) AND unregistered heads
    (user_id = None, can_push = False).
    """
    term = f"%{q}%" if q else "%"

    # 1. Registered users (staff + app-registered members)
    user_rows = (
        db.query(models.User)
        .filter(models.User.is_active == True)
        .filter(models.User.name.ilike(term) | models.User.phone.ilike(term))
        .order_by(models.User.name)
        .limit(20)
        .all()
    )
    seen_phones = {u.phone for u in user_rows}
    results = [
        {"id": u.id, "name": u.name, "phone": u.phone, "role": u.role, "can_push": True}
        for u in user_rows
    ]

    # 2. Approved heads who have NOT registered (no users row yet)
    head_rows = (
        db.query(models.ApprovedHead)
        .filter(models.ApprovedHead.is_active == True)
        .filter(models.ApprovedHead.user_id == None)
        .filter(models.ApprovedHead.name.ilike(term) | models.ApprovedHead.phone.ilike(term))
        .order_by(models.ApprovedHead.name)
        .limit(20)
        .all()
    )
    for h in head_rows:
        if h.phone not in seen_phones:
            results.append({
                "id": None,        # no user account yet
                "name": h.name,
                "phone": h.phone,
                "role": "member",
                "can_push": False, # no device token — can't send push
            })

    # Sort combined list by name and cap at 20
    results.sort(key=lambda r: r["name"].lower())
    return results[:20]


@router.get("/search-member")
def search_member(
    q: str = "",
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    """Search ApprovedHead records by name, phone, or chanda_no for the staff creation flow."""
    q = q.strip()
    if not q or len(q) < 2:
        return []

    phone_q = normalize(q) or ""
    heads = (
        db.query(models.ApprovedHead)
        .filter(
            or_(
                models.ApprovedHead.name.ilike(f"%{q}%"),
                models.ApprovedHead.chanda_no.ilike(f"%{q}%"),
                models.ApprovedHead.phone == phone_q if phone_q else False,
            )
        )
        .filter(models.ApprovedHead.is_active == True)
        .limit(8)
        .all()
    )

    results = []
    for h in heads:
        user = db.query(models.User).filter_by(id=h.user_id).first() if h.user_id else None
        results.append({
            "head_id":   h.id,
            "name":      h.name,
            "phone":     h.phone,
            "chanda_no": h.chanda_no,
            "zone":      h.zone,
            "user_id":   h.user_id,
            "user_role": user.role if user else None,
        })
    return results


@router.get("/staff")
def list_staff(
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    users = (
        db.query(models.User)
        .filter(models.User.role.in_(STAFF_ROLES))
        .order_by(models.User.role, models.User.name)
        .all()
    )
    result = []
    for u in users:
        role_rows = db.query(models.UserRoleEntry).filter_by(user_id=u.id).all()
        all_roles = [r.role for r in role_rows] if role_rows else [u.role]
        result.append({
            "id": u.id,
            "name": u.name,
            "phone": u.phone,
            "role": u.role,
            "roles": all_roles,
            "is_active": u.is_active,
            "is_registered": u.is_registered,
            "created_at": u.created_at,
        })
    return result


@router.post("/staff", status_code=201)
def upsert_staff(
    data: schemas.StaffCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_superadmin),
):
    """
    Assign a staff role.

    Two flows:
    A) Mosque-member flow — supply user_id: updates that existing user's role.
       All chanda/donation/family history is preserved under the same account.
    B) Standalone flow — supply name + phone: creates or updates a user by phone.
       Used when the staff member is not a mosque member (e.g. a security guard).
    """
    if data.role not in STAFF_ROLES:
        raise HTTPException(400, f"Role must be one of: {sorted(STAFF_ROLES)}")

    # ── Flow A: assign role to existing user ─────────────────────────────────
    if data.user_id:
        user = db.query(models.User).filter_by(id=data.user_id).first()
        if not user:
            raise HTTPException(404, "User not found")
        old_role = user.role
        user.role = data.role
        if data.is_active is not None:
            user.is_active = data.is_active
        # ADD the new staff role to user_roles — never remove existing roles (e.g. "head")
        if not db.query(models.UserRoleEntry).filter_by(user_id=user.id, role=data.role).first():
            db.add(models.UserRoleEntry(user_id=user.id, role=data.role, assigned_by_id=_actor_id(current_user)))
        write_audit(db, "users", user.id, "update",
                    old_values={"role": old_role},
                    new_values={"role": user.role},
                    performed_by_id=_actor_id(current_user))
        db.commit()
        db.refresh(user)
        manager.publish_sync("admin", "staff_created", {"user_id": user.id, "role": user.role})
        return {
            "message": f"{user.name} is now {user.role}. All existing membership data is preserved.",
            "user": {"id": user.id, "name": user.name, "phone": user.phone, "role": user.role},
        }

    # ── Flow B: standalone staff creation ────────────────────────────────────
    if not data.name or not data.phone:
        raise HTTPException(400, "name and phone are required when not linking to an existing member")

    phone = normalize(data.phone)
    if not phone:
        raise HTTPException(400, "Invalid phone number")

    existing = db.query(models.User).filter_by(phone=phone).first()
    if existing:
        old = {"name": existing.name, "role": existing.role}
        existing.name = data.name.strip()
        existing.role = data.role
        if data.is_active is not None:
            existing.is_active = data.is_active
        if not db.query(models.UserRoleEntry).filter_by(user_id=existing.id, role=data.role).first():
            db.add(models.UserRoleEntry(user_id=existing.id, role=data.role, assigned_by_id=_actor_id(current_user)))
        write_audit(db, "users", existing.id, "update",
                    old_values=old,
                    new_values={"name": existing.name, "role": existing.role},
                    performed_by_id=_actor_id(current_user))
        db.commit()
        db.refresh(existing)
        manager.publish_sync("admin", "staff_created", {"user_id": existing.id, "role": existing.role})
        return {
            "message": f"{existing.role} updated",
            "user": {"id": existing.id, "name": existing.name, "phone": existing.phone, "role": existing.role},
        }

    user = models.User(
        name=data.name.strip(), phone=phone,
        role=data.role, head_phone=phone,
        is_active=True if data.is_active is None else data.is_active,
        is_registered=False,
        invitation_created_by=_actor_id(current_user),
        invitation_created_at=datetime.utcnow(),
    )
    db.add(user)
    db.flush()
    db.add(models.UserRoleEntry(user_id=user.id, role=data.role, assigned_by_id=_actor_id(current_user)))
    write_audit(db, "users", user.id, "create",
                new_values={"name": user.name, "phone": user.phone, "role": user.role},
                performed_by_id=_actor_id(current_user))
    db.commit()
    db.refresh(user)
    manager.publish_sync("admin", "staff_created", {"user_id": user.id, "role": user.role})
    return {
        "message": f"{user.role} created — they can register from the mobile app using their phone number.",
        "user": {"id": user.id, "name": user.name, "phone": user.phone, "role": user.role},
    }


@router.post("/users/{user_id}/reset-password")
async def admin_reset_password(
    user_id: int,
    data: schemas.AdminResetPasswordRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    """Admin resets a user's password to a temporary value and forces change on next login."""
    from app.security import hash_password, revoke_all_sessions
    from datetime import datetime

    temp_password = data.new_password if data.new_password else "12345678"
    if len(temp_password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters.")

    user = db.query(models.User).filter_by(id=user_id).first()
    if not user:
        raise HTTPException(404, "User not found.")
    if user.role == "superadmin":
        raise HTTPException(403, "Cannot reset a superadmin's password.")

    user.password = hash_password(temp_password)
    user.password_changed_at = datetime.utcnow()
    user.must_change_password = True
    revoke_all_sessions(db, user_id)
    await log_action(
        db, AuditAction.PASSWORD_RESET, "users", user.id,
        actor=current_user, request=request,
        description=f"Password reset by admin for {user.name} — must change on next login",
        new_values={"must_change_password": True},
    )
    db.commit()
    return {"message": f"Password reset for {user.name}. They must change it on next login."}


@router.patch("/staff/{user_id}/deactivate")
def deactivate_staff(
    user_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_superadmin),
):
    user = db.query(models.User).filter_by(id=user_id).first()
    if not user or user.role not in STAFF_ROLES:
        raise HTTPException(404, "Staff member not found")

    from app.security import revoke_all_sessions
    revoke_all_sessions(db, user_id)

    user.is_active = False
    write_audit(db, "users", user.id, "update",
                new_values={"is_active": False},
                performed_by_id=_actor_id(current_user),
                note="Staff deactivated — all sessions revoked")
    db.commit()
    manager.publish_sync("admin", "role_changed", {"user_id": user.id, "is_active": False})
    return {"message": f"{user.name} deactivated and all sessions revoked"}


# ─────────────────────────────────────────────────────────────
# DASHBOARD STATISTICS  (legacy — kept for backward compat)
# ─────────────────────────────────────────────────────────────
# ZONE LOOKUP
# ─────────────────────────────────────────────────────────────

@router.get("/zones")
def get_zones(
    db: Session = Depends(get_db),
    current_user=Depends(require_admin_or_collector),
):
    """Return distinct, sorted zone names for use in dropdown filters."""
    rows = (
        db.query(models.ApprovedHead.zone)
        .filter(models.ApprovedHead.zone.isnot(None))
        .distinct()
        .order_by(models.ApprovedHead.zone)
        .all()
    )
    return [r[0] for r in rows]


@router.get("/streets")
def get_streets(
    zone: str | None = None,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin_or_collector),
):
    """Return distinct, sorted street names for use in cascading Zone -> Street dropdown filters."""
    q = db.query(models.ApprovedHead.street).filter(models.ApprovedHead.street.isnot(None))
    if zone:
        q = q.filter(models.ApprovedHead.zone == zone)
    rows = q.distinct().order_by(models.ApprovedHead.street).all()
    return [r[0] for r in rows]


# Prefer  GET /finance/dashboard  for new frontend code.
# ─────────────────────────────────────────────────────────────

@router.get("/dashboard")
def dashboard_stats(
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    from app.utils.timezones import india_month_key, utc_now
    current_month = india_month_key(utc_now())

    total_families  = db.query(models.ApprovedHead).filter_by(is_active=True).count()
    registered      = db.query(models.ApprovedHead).filter_by(is_active=True, is_registered=True).count()
    total_members   = db.query(models.User).filter(
        models.User.role.in_(["head", "member"]), models.User.is_active == True,
    ).count()

    month_cols          = db.query(models.ChandaCollection).filter_by(month=current_month).all()
    pending_collections = sum(1 for c in month_cols if c.status != "paid")
    collected_month     = sum(c.total_paid   for c in month_cols)
    due_month           = sum(c.amount_due   for c in month_cols)

    donations_amt = sum(d.amount for d in db.query(models.Donation).all())
    expenses_amt  = sum(
        e.amount for e in db.query(models.Expense).filter(
            models.Expense.is_deleted == False,
            models.Expense.approved_at.isnot(None),
        ).all()
    )

    return {
        "current_month": current_month,
        "families":  {"total": total_families, "registered": registered, "unregistered": total_families - registered},
        "members":   {"total": total_members},
        "chanda":    {"pending_collections": pending_collections, "collected_this_month": round(collected_month, 2), "due_this_month": round(due_month, 2), "remaining_balance": round(max(due_month - collected_month, 0), 2)},
        "donations": {"count": db.query(models.Donation).count(), "total_amount": round(donations_amt, 2)},
        "expenses":  {"count": db.query(models.Expense).count(),  "total_amount": round(expenses_amt, 2)},
    }


# ─────────────────────────────────────────────────────────────
# PERSONAL NOTIFICATION  (send to a single member)
# ─────────────────────────────────────────────────────────────

class PersonalNotifBody(BaseModel):
    user_id: int
    title: str
    body: str
    image_url: Optional[str] = None


@router.post("/notify/personal")
def send_personal_notification(
    data: PersonalNotifBody,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    """Send a push notification to a single member by user_id."""
    from app.utils.fcm import notify_user

    target = db.query(models.User).filter_by(id=data.user_id, is_active=True).first()
    if not target:
        raise HTTPException(404, "User not found or inactive")

    extra: dict = {"type": "personal_notification"}
    if data.image_url:
        extra["image_url"] = data.image_url

    sent = notify_user(db, target.id, title=data.title, body=data.body, data=extra)

    write_audit(
        db, "users", target.id, "notify",
        new_values={"title": data.title, "body": data.body, "sent": sent},
        performed_by_id=_actor_id(current_user),
    )
    db.commit()
    return {"message": f"Notification sent to {target.name}", "sent": sent}


# ─────────────────────────────────────────────────────────────
# GENERATE PENDING MONTHS  (backfill from registration_date)
# ─────────────────────────────────────────────────────────────

@router.post("/families/{family_id}/generate-pending-months")
def generate_pending_months(
    family_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    """
    Generate chanda collection records for every month from the family's
    registration_date (or created_at) up to the current month.
    Existing records are never overwritten.
    """
    from app.utils.timezones import india_month_key, utc_now, add_months
    from app.utils.payment_ledger import set_collection_status, sync_generated_month

    head = db.query(models.ApprovedHead).filter_by(id=family_id).first()
    if not head:
        raise HTTPException(404, "Family not found")

    start_dt = head.registration_date or head.created_at
    if not start_dt:
        raise HTTPException(400, "Family has no registration_date or created_at")

    current_month = india_month_key(utc_now())
    cursor = india_month_key(start_dt)
    monthly_amount = round(float(head.monthly_amount or 0), 2)
    created = 0

    while cursor <= current_month:
        existing = db.query(models.ChandaCollection).filter_by(
            head_id=head.id, month=cursor
        ).first()
        if not existing:
            col = models.ChandaCollection(
                head_id=head.id, month=cursor,
                amount_due=monthly_amount, total_paid=0, status="pending",
            )
            db.add(col)
            db.flush()
            sync_generated_month(db, col)
            set_collection_status(col)
            created += 1
        cursor = add_months(cursor, 1)

    db.commit()
    return {"message": f"Generated {created} new month records for {head.name}", "created": created}


# ─────────────────────────────────────────────────────────────
# PENDING REGISTRATION MANAGEMENT
# ─────────────────────────────────────────────────────────────

class ApproveRegistrationRequest(BaseModel):
    family_action: str = "none"             # "create" | "none"
    new_chanda_no: Optional[str] = None     # for create (auto-generated if omitted)
    active_from_month: Optional[str] = None # YYYY-MM — chanda starts from this month
    role: str = "head"
    chanda_amount: Optional[float] = 300.0
    phone_override: Optional[str] = None
    admin_notes: Optional[str] = None


class RejectRegistrationRequest(BaseModel):
    reason: str


@router.get("/pending-registrations")
def list_pending_registrations(
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    """Return all users in PENDING_APPROVAL status."""
    users = (
        db.query(models.User)
        .filter(models.User.status == UserStatus.PENDING_APPROVAL)
        .order_by(models.User.registered_at.asc())
        .all()
    )
    return [
        {
            "id":            u.id,
            "name":          u.name,
            "phone":         u.phone,
            "role":          u.role,
            "status":        u.status,
            "address":       u.address,
            "registered_at": u.registered_at.isoformat() + "Z" if u.registered_at else None,
        }
        for u in users
    ]


@router.get("/pending-registrations/{user_id}")
def get_pending_registration(
    user_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    user = db.query(models.User).filter_by(id=user_id).first()
    if not user:
        raise HTTPException(404, "User not found")
    # Suggest possible existing families by name similarity
    suggestions = []
    if user.name:
        name_parts = user.name.split()
        for part in name_parts:
            if len(part) >= 3:
                matches = (
                    db.query(models.ApprovedHead)
                    .filter(models.ApprovedHead.name.ilike(f"%{part}%"))
                    .limit(5)
                    .all()
                )
                for m in matches:
                    if not any(s["id"] == m.id for s in suggestions):
                        suggestions.append({
                            "id": m.id, "name": m.name,
                            "chanda_no": m.chanda_no, "phone": m.phone,
                            "monthly_amount": m.monthly_amount,
                        })
    return {
        "user": {
            "id":            user.id,
            "name":          user.name,
            "phone":         user.phone,
            "role":          user.role,
            "status":        user.status,
            "registered_at": user.registered_at.isoformat() + "Z" if user.registered_at else None,
            "address":       user.address,
            "admin_notes":   user.admin_notes,
        },
        "family_suggestions": suggestions[:5],
    }


@router.post("/pending-registrations/{user_id}/approve")
async def approve_registration(
    user_id: int,
    data: ApproveRegistrationRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    user = db.query(models.User).filter_by(id=user_id).first()
    if not user:
        raise HTTPException(404, "User not found")
    if user.status != UserStatus.PENDING_APPROVAL:
        raise HTTPException(400, f"User is not pending approval (status: {user.status})")

    try:
        await RegistrationApprovalService.approve(
            db=db,
            pending_user=user,
            actor=current_user,
            request=request,
            family_action=data.family_action,
            new_chanda_no=data.new_chanda_no,
            active_from_month=data.active_from_month,
            role=data.role,
            chanda_amount=data.chanda_amount or 300.0,
            phone_override=data.phone_override,
            admin_notes=data.admin_notes,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    manager.publish_sync("admin", "registration_approved", {"user_id": user_id})
    return {"message": f"{user.name} approved and activated.", "user_id": user_id}


@router.post("/pending-registrations/{user_id}/reject")
async def reject_registration(
    user_id: int,
    data: RejectRegistrationRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    user = db.query(models.User).filter_by(id=user_id).first()
    if not user:
        raise HTTPException(404, "User not found")
    if user.status not in (UserStatus.PENDING_APPROVAL,):
        raise HTTPException(400, f"User cannot be rejected (status: {user.status})")

    await RegistrationApprovalService.reject(
        db=db,
        pending_user=user,
        actor=current_user,
        request=request,
        reason=data.reason,
    )

    manager.publish_sync("admin", "registration_rejected", {"user_id": user_id})
    return {"message": f"{user.name}'s registration rejected.", "user_id": user_id}


@router.patch("/users/{user_id}/enable")
async def enable_user(
    user_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    user = db.query(models.User).filter_by(id=user_id).first()
    if not user:
        raise HTTPException(404, "User not found")
    old_status = user.status
    user.status = UserStatus.ACTIVE
    user.is_active = True
    await log_action(db, AuditAction.USER_ENABLED, "users", user_id,
                     actor=current_user, request=request,
                     description=f"User enabled: {user.name}",
                     old_values={"status": old_status},
                     new_values={"status": UserStatus.ACTIVE})
    db.commit()
    return {"message": f"{user.name} enabled"}


@router.patch("/users/{user_id}/disable")
async def disable_user(
    user_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    from app.security import revoke_all_sessions
    user = db.query(models.User).filter_by(id=user_id).first()
    if not user:
        raise HTTPException(404, "User not found")
    old_status = user.status
    user.status = UserStatus.DISABLED
    user.is_active = False
    revoke_all_sessions(db, user_id)
    await log_action(db, AuditAction.USER_DISABLED, "users", user_id,
                     actor=current_user, request=request,
                     description=f"User disabled: {user.name}",
                     old_values={"status": old_status},
                     new_values={"status": UserStatus.DISABLED})
    db.commit()
    return {"message": f"{user.name} disabled and all sessions revoked"}


@router.patch("/users/{user_id}/assign-collector")
async def assign_collector(
    user_id: int,
    request: Request,
    collector_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    """Assign a collector to a family via the user's family_id."""
    user = db.query(models.User).filter_by(id=user_id).first()
    if not user or not user.family_id:
        raise HTTPException(404, "User or family not found")
    head = db.query(models.ApprovedHead).filter_by(id=user.family_id).first()
    if not head:
        raise HTTPException(404, "Family not found")

    old_collector = head.collector_id
    head.collector_id = collector_id if collector_id != 0 else None

    action = AuditAction.COLLECTOR_ASSIGNED if collector_id else AuditAction.COLLECTOR_REMOVED
    await log_action(db, action, "approved_heads", head.id,
                     actor=current_user, request=request,
                     description=f"Collector {'assigned to' if collector_id else 'removed from'} family {head.name}",
                     old_values={"collector_id": old_collector},
                     new_values={"collector_id": head.collector_id})

    if collector_id and user.id:
        try:
            notify_user(db, user.id,
                        title="Collector Assigned",
                        body="A collector has been assigned to your family.",
                        data={"type": "collector_assigned"})
        except Exception:
            pass

    db.commit()
    return {"message": "Collector assignment updated"}
