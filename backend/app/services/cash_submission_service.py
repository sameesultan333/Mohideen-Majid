# backend/app/services/cash_submission_service.py
"""
CashSubmissionService — handles collector cash submission lifecycle:
  submit → admin approves / rejects → collector sees history.
"""

from __future__ import annotations

import logging
from datetime import datetime
from decimal import Decimal
from typing import Optional

from fastapi import Request
from sqlalchemy.orm import Session

from app import models
from app.models import CashSubmissionStatus
from app.services.audit_service import AuditAction, log_action
from app.utils.fcm import notify_user

logger = logging.getLogger("mohideen.cash_submission")


class CashSubmissionService:

    @staticmethod
    async def submit(
        db: Session,
        actor: dict,
        request: Request,
        *,
        start_date: datetime,
        end_date: datetime,
        submitted_amount: Decimal,
        receiving_admin_id: Optional[int] = None,
        notes: Optional[str] = None,
        expected_amount: Optional[Decimal] = None,
    ) -> models.CollectorCashSubmission:
        collector_id = int(actor["sub"])

        submission = models.CollectorCashSubmission(
            collector_id=collector_id,
            start_date=start_date,
            end_date=end_date,
            submitted_amount=submitted_amount,
            expected_amount=expected_amount,
            receiving_admin_id=receiving_admin_id,
            notes=notes,
            status=CashSubmissionStatus.PENDING,
            submitted_at=datetime.utcnow(),
        )
        db.add(submission)
        db.flush()

        await log_action(
            db, AuditAction.CASH_SUBMITTED, "collector_cash_submissions", submission.id,
            actor=actor, request=request,
            description=f"Cash submission ₹{submitted_amount} for {start_date.date()} – {end_date.date()}",
            new_values={
                "submitted_amount": str(submitted_amount),
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
            from fastapi import HTTPException
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
            from fastapi import HTTPException
            raise HTTPException(400, "Only pending submissions can be rejected.")

        old_status = submission.status
        submission.status = CashSubmissionStatus.REJECTED
        submission.rejected_by_id = int(actor["sub"])
        submission.rejected_at = datetime.utcnow()
        submission.rejection_reason = reason

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
