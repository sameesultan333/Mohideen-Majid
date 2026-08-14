# backend/app/services/cash_submission_service.py
"""
CashSubmissionService — handles collector cash submission lifecycle:
  preview (unsubmitted totals) → submit (locks transactions) →
  admin approves / rejects → collector sees history.

Submitted amounts are always derived server-side from the collector's
unsubmitted Donation / PaymentEntry rows — never typed in by the collector.
"""

from __future__ import annotations

import logging
from datetime import datetime
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models
from app.models import CashSubmissionStatus
from app.services.audit_service import AuditAction, log_action
from app.utils.fcm import notify_user

logger = logging.getLogger("mohideen.cash_submission")

VALID_CATEGORIES = {"chanda", "donation"}

# methods that count as "online" rather than physical cash-in-hand
ONLINE_METHODS = {"upi", "gpay", "online", "bank", "cheque"}


def _is_cash(method: Optional[str]) -> bool:
    return (method or "cash").strip().lower() not in ONLINE_METHODS


def _unsubmitted_query(db: Session, collector_id: int, categories: list[str]):
    """Return (payment_entries, donations) unsubmitted-for-this-collector querysets."""
    payments = []
    donations = []
    if "chanda" in categories:
        payments = (
            db.query(models.PaymentEntry)
            .filter(
                models.PaymentEntry.collector_id == collector_id,
                models.PaymentEntry.submission_id.is_(None),
                models.PaymentEntry.status == "verified",
            )
            .all()
        )
    if "donation" in categories:
        donations = (
            db.query(models.Donation)
            .filter(
                models.Donation.collector_id == collector_id,
                models.Donation.submission_id.is_(None),
            )
            .all()
        )
    return payments, donations


def _summarize(payments, donations) -> dict:
    cash_amount = Decimal("0")
    online_amount = Decimal("0")
    for p in payments:
        amt = Decimal(str(p.amount or 0))
        if _is_cash(p.method):
            cash_amount += amt
        else:
            online_amount += amt
    for d in donations:
        amt = Decimal(str(d.amount or 0))
        if _is_cash(d.method):
            cash_amount += amt
        else:
            online_amount += amt

    return {
        "cash_amount": cash_amount,
        "online_amount": online_amount,
        "total_amount": cash_amount + online_amount,
        "transaction_count": len(payments) + len(donations),
    }


class CashSubmissionService:

    @staticmethod
    def preview(db: Session, collector_id: int, categories: list[str]) -> dict:
        """Read-only breakdown of what a submission would contain right now."""
        categories = [c for c in categories if c in VALID_CATEGORIES] or list(VALID_CATEGORIES)
        payments, donations = _unsubmitted_query(db, collector_id, categories)
        summary = _summarize(payments, donations)
        summary["categories"] = categories
        summary["transactions"] = _serialize_transactions(payments, donations)
        return summary

    @staticmethod
    async def submit(
        db: Session,
        actor: dict,
        request: Request,
        *,
        start_date: datetime,
        end_date: datetime,
        categories: list[str],
        receiving_admin_id: Optional[int] = None,
        notes: Optional[str] = None,
        expected_amount: Optional[Decimal] = None,
    ) -> models.CollectorCashSubmission:
        collector_id = int(actor["sub"])
        categories = [c for c in categories if c in VALID_CATEGORIES] or list(VALID_CATEGORIES)

        payments, donations = _unsubmitted_query(db, collector_id, categories)
        summary = _summarize(payments, donations)

        if summary["transaction_count"] == 0:
            raise HTTPException(400, "No unsubmitted collections found for the selected categories.")

        submission = models.CollectorCashSubmission(
            collector_id=collector_id,
            start_date=start_date,
            end_date=end_date,
            submitted_amount=summary["total_amount"],
            cash_amount=summary["cash_amount"],
            online_amount=summary["online_amount"],
            categories=categories,
            expected_amount=expected_amount,
            receiving_admin_id=receiving_admin_id,
            notes=notes,
            status=CashSubmissionStatus.PENDING,
            submitted_at=datetime.utcnow(),
        )
        db.add(submission)
        db.flush()

        # Lock the included transactions into this submission so they can
        # never be pulled into a future submission.
        for p in payments:
            p.submission_id = submission.id
        for d in donations:
            d.submission_id = submission.id

        await log_action(
            db, AuditAction.CASH_SUBMITTED, "collector_cash_submissions", submission.id,
            actor=actor, request=request,
            description=(
                f"Cash submission ₹{summary['total_amount']} "
                f"(cash ₹{summary['cash_amount']} + online ₹{summary['online_amount']}) "
                f"for {start_date.date()} – {end_date.date()}, {summary['transaction_count']} transactions"
            ),
            new_values={
                "submitted_amount": str(summary["total_amount"]),
                "cash_amount": str(summary["cash_amount"]),
                "online_amount": str(summary["online_amount"]),
                "categories": categories,
                "transaction_count": summary["transaction_count"],
                "start_date": str(start_date.date()),
                "end_date": str(end_date.date()),
            },
        )
        db.commit()
        return submission

    @staticmethod
    async def approve(
        db: Session,
        submission: models.CollectorCashSubmission,
        actor: dict,
        request: Request,
        approved_amount: Optional[Decimal] = None,
        notes: Optional[str] = None,
    ) -> models.CollectorCashSubmission:
        if submission.status != CashSubmissionStatus.PENDING:
            raise HTTPException(400, "Only pending submissions can be approved.")

        old_status = submission.status
        submission.status = CashSubmissionStatus.APPROVED
        submission.approved_by_id = int(actor["sub"])
        submission.approved_at = datetime.utcnow()
        submission.approved_amount = approved_amount or submission.submitted_amount
        if notes:
            submission.notes = (submission.notes or "") + f"\n[Admin note] {notes}"

        await log_action(
            db, AuditAction.CASH_APPROVED, "collector_cash_submissions", submission.id,
            actor=actor, request=request,
            description=f"Approved cash submission #{submission.id} — ₹{submission.approved_amount}",
            old_values={"status": old_status},
            new_values={"status": CashSubmissionStatus.APPROVED,
                        "approved_amount": str(submission.approved_amount)},
        )
        db.commit()

        try:
            notify_user(
                db, submission.collector_id,
                title="Cash Submission Approved",
                body=f"Your cash submission of ₹{submission.submitted_amount} has been approved.",
                data={"type": "cash_approved", "submission_id": str(submission.id)},
            )
        except Exception as exc:
            logger.warning("FCM push failed: %s", exc)

        return submission

    @staticmethod
    async def reject(
        db: Session,
        submission: models.CollectorCashSubmission,
        actor: dict,
        request: Request,
        reason: str,
    ) -> models.CollectorCashSubmission:
        if submission.status != CashSubmissionStatus.PENDING:
            raise HTTPException(400, "Only pending submissions can be rejected.")

        old_status = submission.status
        submission.status = CashSubmissionStatus.REJECTED
        submission.rejected_by_id = int(actor["sub"])
        submission.rejected_at = datetime.utcnow()
        submission.rejection_reason = reason

        # Unlock the transactions so they can be included in a future submission.
        db.query(models.PaymentEntry).filter_by(submission_id=submission.id).update(
            {"submission_id": None}
        )
        db.query(models.Donation).filter_by(submission_id=submission.id).update(
            {"submission_id": None}
        )

        await log_action(
            db, AuditAction.CASH_REJECTED, "collector_cash_submissions", submission.id,
            actor=actor, request=request,
            description=f"Rejected cash submission #{submission.id}. Reason: {reason}",
            old_values={"status": old_status},
            new_values={"status": CashSubmissionStatus.REJECTED, "rejection_reason": reason},
        )
        db.commit()

        try:
            notify_user(
                db, submission.collector_id,
                title="Cash Submission Rejected",
                body=f"Your cash submission was rejected. Reason: {reason}",
                data={"type": "cash_rejected", "submission_id": str(submission.id)},
            )
        except Exception as exc:
            logger.warning("FCM push failed: %s", exc)

        return submission


def _serialize_transactions(payments, donations) -> list[dict]:
    items = []
    for p in payments:
        items.append({
            "type": "chanda",
            "id": p.id,
            "date": (p.collected_at or p.created_at).isoformat() + "Z" if (p.collected_at or p.created_at) else None,
            "head_name": p.head.name if p.head else None,
            "amount": str(p.amount),
            "method": p.method,
            "receipt_id": p.receipt_id,
        })
    for d in donations:
        items.append({
            "type": "donation",
            "id": d.id,
            "date": (d.donation_date or d.created_at).isoformat() + "Z" if (d.donation_date or d.created_at) else None,
            "head_name": d.donor_name,
            "amount": str(d.amount),
            "method": d.method,
            "receipt_id": d.receipt_id,
        })
    items.sort(key=lambda x: x["date"] or "")
    return items


def get_submission_transactions(db: Session, submission: models.CollectorCashSubmission) -> list[dict]:
    payments = (
        db.query(models.PaymentEntry)
        .filter(
            models.PaymentEntry.submission_id == submission.id,
            # A payment can be rolled back after it was already bundled into
            # a submission (submission_id is never cleared by rollback). It
            # must not still appear in the collector's/admin's transaction
            # list for that submission. Note: this only fixes the displayed
            # list - `submission.submitted_amount`/`cash_amount` are a frozen
            # snapshot taken at submit time and are NOT retroactively reduced
            # here, since that batch may already represent cash physically
            # reconciled with an admin; adjusting a finalized submission's
            # total is a separate reconciliation decision, not a display bug.
            func.coalesce(models.PaymentEntry.rollback_status, "") != "approved",
        )
        .all()
    )
    donations = (
        db.query(models.Donation)
        .filter_by(submission_id=submission.id)
        .all()
    )
    return _serialize_transactions(payments, donations)
