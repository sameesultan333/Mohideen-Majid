# backend/app/utils/payment_notify.py
"""
Single source of truth for the "payment received" push notification sent to
a member whenever a Chanda payment or a Donation/Fund contribution is
successfully recorded — regardless of whether a collector, an admin, or the
member themselves recorded it. Every payment-success code path should call
one of the two functions below instead of building its own notify_user() call.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app import models
from app.utils.fcm import notify_user
from app.utils.timezones import month_key_to_full_label


def _target_user_id(db: Session, head_id: int | None, fallback_user_id: int | None) -> int | None:
    """Resolve who to notify: the family head's own app account if this was
    recorded by staff (collector/admin) against a family, otherwise whoever
    is directly attached to the record (self-service payments)."""
    if head_id:
        head = db.query(models.ApprovedHead).filter_by(id=head_id).first()
        if head and head.user_id:
            return head.user_id
    return fallback_user_id


def notify_chanda_payment(db: Session, payment: models.PaymentEntry) -> None:
    user_id = _target_user_id(db, payment.head_id, payment.paid_by_user_id)
    if not user_id:
        return

    months = payment.covered_months or []
    months_label = ", ".join(month_key_to_full_label(m) for m in months) if months else None

    body_lines = ["Your Chanda contribution has been successfully received."]
    if months_label:
        body_lines.append(f"Covered Months: {months_label}")
    if payment.receipt_id:
        body_lines.append(f"Receipt: {payment.receipt_id}")
    body_lines.append("Please view your receipt from the Chanda History section inside your profile.")

    notify_user(
        db, user_id,
        title="Payment Received",
        body="\n".join(body_lines),
        data={
            "type": "payment_received",
            "payment_id": str(payment.id),
            "receipt_id": payment.receipt_id or "",
        },
    )


def notify_donation_payment(db: Session, donation: models.Donation) -> None:
    user_id = _target_user_id(db, donation.head_id, donation.user_id)
    if not user_id:
        return

    is_fund = bool(donation.fund_id)
    fund_name = donation.fund_rel.name if is_fund and donation.fund_rel else None

    if is_fund:
        title = "Fund Contribution Received"
        intro = (
            f"Your contribution to {fund_name} has been successfully received."
            if fund_name else
            "Your fund contribution has been successfully received."
        )
    else:
        title = "Donation Received"
        intro = "Your donation has been successfully received."

    body_lines = [intro]
    if donation.receipt_id:
        body_lines.append(f"Receipt: {donation.receipt_id}")
    body_lines.append("You can view the receipt anytime from your Profile.")

    notify_user(
        db, user_id,
        title=title,
        body="\n".join(body_lines),
        data={
            "type": "fund_contribution_received" if is_fund else "donation_received",
            "donation_id": str(donation.id),
            "receipt_id": donation.receipt_id or "",
        },
    )
