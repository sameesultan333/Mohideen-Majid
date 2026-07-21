# backend/app/services/registration_service.py
"""
RegistrationApprovalService — orchestrates everything that happens when an
admin approves or rejects a pending registration.

Keeps the admin route handler thin; all business logic lives here.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional

from fastapi import Request
from sqlalchemy.orm import Session

from app import models
from app.models import UserStatus
from app.services.audit_service import AuditAction, log_action
from app.utils.fcm import notify_user

logger = logging.getLogger("mohideen.registration")


def _normalize_phone(phone: str) -> str:
    digits = "".join(c for c in phone if c.isdigit())
    if digits.startswith("00"):
        digits = digits[2:]
    if len(digits) >= 12 and digits.startswith("91"):
        digits = digits[2:]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    return digits[:10] if len(digits) >= 10 else digits


class RegistrationApprovalService:

    @staticmethod
    async def approve(
        db: Session,
        pending_user: models.User,
        actor: dict,
        request: Request,
        *,
        family_action: str,                      # "create" | "none"
        new_chanda_no: Optional[str] = None,     # for "create" (auto-generated if None)
        active_from_month: Optional[str] = None, # YYYY-MM — chanda records start here
        role: str = "head",
        chanda_amount: float = 300.0,
        phone_override: Optional[str] = None,
        admin_notes: Optional[str] = None,
    ) -> models.User:
        if phone_override:
            phone_override = _normalize_phone(phone_override)
        """
        Approve a PENDING_APPROVAL user.

        family_action controls how the family is resolved:
          "create"  — create a new ApprovedHead for this user
          "none"    — approve without linking to any family (e.g. staff roles)
        """
        old_status = pending_user.status

        # ── 1. Resolve / create family ────────────────────────────────────────
        head: Optional[models.ApprovedHead] = None

        if family_action == "create":
            # Auto-generate chanda_no if not supplied
            if new_chanda_no:
                new_chanda_no = new_chanda_no.strip().upper()
            if not new_chanda_no:
                max_row = db.query(models.ApprovedHead).order_by(
                    models.ApprovedHead.id.desc()
                ).first()
                next_num = (max_row.id + 1) if max_row else 1
                new_chanda_no = f"CH{next_num:04d}"
            elif db.query(models.ApprovedHead).filter_by(chanda_no=new_chanda_no).first():
                raise ValueError(f"Chanda number '{new_chanda_no}' is already in use.")

            # Derive registration_date from active_from_month (YYYY-MM) or default to today
            reg_date = None
            if active_from_month:
                try:
                    from datetime import date as _date
                    y, m = active_from_month.split("-")
                    reg_date = _date(int(y), int(m), 1)
                except Exception:
                    pass
            if reg_date is None:
                reg_date = datetime.utcnow().date()

            head = models.ApprovedHead(
                chanda_no=new_chanda_no,
                name=pending_user.name,
                phone=phone_override or pending_user.phone,
                monthly_amount=chanda_amount,
                registration_date=reg_date,
                is_registered=True,
                is_active=True,
                user_id=pending_user.id,
            )
            db.add(head)
            db.flush()

        # ── 2. Update the user ────────────────────────────────────────────────
        actor_id = int(actor["sub"]) if actor and actor.get("sub") else None

        pending_user.status = UserStatus.ACTIVE
        pending_user.is_active = True
        pending_user.is_registered = True
        pending_user.role = role
        pending_user.admin_notes = admin_notes
        pending_user.approved_by_id = actor_id
        pending_user.approved_at = datetime.utcnow()
        pending_user.rejection_reason = None

        if phone_override:
            pending_user.phone = phone_override

        if head:
            pending_user.family_id = head.id
            head.is_registered = True
            head.user_id = pending_user.id
            if chanda_amount:
                head.monthly_amount = chanda_amount
            if phone_override:
                head.phone = phone_override

        db.flush()

        # ── 3. Generate pending chanda months from active_from_month to now ──────
        if head:
            try:
                RegistrationApprovalService._generate_months_from(db, head)
            except Exception as exc:
                logger.warning("Could not generate pending months for family %s: %s", head.id, exc, exc_info=True)

        # ── 4. Audit ──────────────────────────────────────────────────────────
        await log_action(
            db, AuditAction.USER_APPROVED, "users", pending_user.id,
            actor=actor, request=request,
            description=f"Approved registration: {pending_user.name} → {role}",
            old_values={"status": old_status, "family_id": None},
            new_values={"status": UserStatus.ACTIVE, "role": role, "family_id": head.id if head else None},
        )

        db.commit()

        # ── 5. Push notification ──────────────────────────────────────────────
        try:
            notify_user(
                db, pending_user.id,
                title="Registration Approved",
                body="Your account has been approved. You now have full access.",
                data={"type": "registration_approved"},
            )
        except Exception as exc:
            logger.warning("FCM push failed for user %s: %s", pending_user.id, exc)

        return pending_user

    @staticmethod
    async def reject(
        db: Session,
        pending_user: models.User,
        actor: dict,
        request: Request,
        reason: str,
    ) -> models.User:
        old_status = pending_user.status

        pending_user.status = UserStatus.REJECTED
        pending_user.is_active = False
        pending_user.rejection_reason = reason
        pending_user.approved_by_id = int(actor["sub"]) if actor and actor.get("sub") else None
        pending_user.approved_at = datetime.utcnow()

        await log_action(
            db, AuditAction.USER_REJECTED, "users", pending_user.id,
            actor=actor, request=request,
            description=f"Rejected registration: {pending_user.name}. Reason: {reason}",
            old_values={"status": old_status},
            new_values={"status": UserStatus.REJECTED, "rejection_reason": reason},
        )

        db.commit()

        try:
            notify_user(
                db, pending_user.id,
                title="Registration Update",
                body=f"Your registration was not approved. Reason: {reason}",
                data={"type": "registration_rejected"},
            )
        except Exception as exc:
            logger.warning("FCM push failed for user %s: %s", pending_user.id, exc)

        return pending_user

    @staticmethod
    def _generate_months_from(db: Session, head: models.ApprovedHead) -> None:
        """
        Generate ChandaCollection rows from head's registration_date to the current
        month (IST). Rows that already exist are skipped (idempotent).
        """
        from app.utils.timezones import india_month_key, utc_now, add_months
        from app.utils.payment_ledger import set_collection_status, sync_generated_month

        start_dt = head.registration_date or head.created_at
        if not start_dt:
            return
        current_month = india_month_key(utc_now())
        cursor = india_month_key(start_dt) if hasattr(start_dt, "year") else india_month_key(
            datetime.strptime(str(start_dt)[:10], "%Y-%m-%d")
        )
        monthly_amount = round(float(head.monthly_amount or 0), 2)
        while cursor <= current_month:
            existing = db.query(models.ChandaCollection).filter_by(
                head_id=head.id, month=cursor
            ).first()
            if not existing:
                col = models.ChandaCollection(
                    head_id=head.id,
                    month=cursor,
                    amount_due=monthly_amount,
                    total_paid=0,
                    status="pending",
                    rate_snapshot=monthly_amount,
                )
                db.add(col)
                db.flush()
                try:
                    sync_generated_month(db, col)
                    set_collection_status(col)
                except Exception:
                    pass
            cursor = add_months(cursor, 1)
