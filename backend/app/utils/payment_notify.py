# backend/app/utils/payment_notify.py
"""
Single source of truth for the "payment received" push notification sent to
a member whenever a Chanda payment or a Donation/Fund contribution is
successfully recorded — regardless of whether a collector, an admin, or the
member themselves recorded it. Every payment-success code path should call
one of the two functions below instead of building its own notify_user() call.
"""

from __future__ import annotations

import logging
import time

from sqlalchemy.orm import Session

from app import models
from app.utils.fcm import notify_user
from app.utils.timezones import month_key_to_full_label

log = logging.getLogger(__name__)

# The member's phone should buzz just after they see the on-screen confirmation,
# not at the same instant — otherwise the push feels like a duplicate of the UI.
NOTIFY_DELAY_SECONDS = 2.5


def _rupees(amount: float | None) -> str:
    """₹5,000 — Indian digit grouping, no trailing .00 on whole amounts."""
    value = float(amount or 0)
    whole = int(value)
    formatted = f"{whole:,}" if value == whole else f"{value:,.2f}"
    # en-IN grouping: 12,34,567 rather than 1,234,567
    if len(str(abs(whole))) > 3:
        head, _, tail = formatted.partition(".")
        digits = head.replace(",", "").lstrip("-")
        sign = "-" if head.startswith("-") else ""
        last3, rest = digits[-3:], digits[:-3]
        groups = []
        while len(rest) > 2:
            groups.insert(0, rest[-2:])
            rest = rest[:-2]
        if rest:
            groups.insert(0, rest)
        head = sign + ",".join(groups + [last3])
        formatted = f"{head}.{tail}" if tail else head
    return f"₹{formatted}"


def _months_label(covered_months: list[str] | None) -> str | None:
    """"August 2026" for one month, "August 2026 - October 2026" for a range."""
    months = sorted(m for m in (covered_months or []) if m)
    if not months:
        return None
    if len(months) == 1:
        return month_key_to_full_label(months[0])
    return f"{month_key_to_full_label(months[0])} - {month_key_to_full_label(months[-1])}"


def _chanda_recipient_id(db: Session, payment: models.PaymentEntry) -> int | None:
    """Who should receive the "your payment was received" push.

    Always the member the payment was collected FROM — never the staff member
    who keyed it in.

    `paid_by_user_id` means different things per source: for a self-payment it
    is the member (correct recipient), but /chanda/collect stores the
    *collector's* own user id there. Falling back to it unconditionally meant a
    collector got the member's confirmation on their own phone whenever the
    family had no linked app account — which is most families during a trial.

    So the fallback only applies to self-payments, where payer and recipient are
    the same person. For a collector- or admin-recorded payment against a family
    with no app account there is simply nobody to notify, and we send nothing.
    """
    if payment.head_id:
        head = db.query(models.ApprovedHead).filter_by(id=payment.head_id).first()
        if head and head.user_id:
            return head.user_id

    if (payment.created_by or "").strip().lower() == "user":
        return payment.paid_by_user_id

    return None


def _build_chanda_message(payment: models.PaymentEntry) -> tuple[str, str]:
    """Title + body for a settled Chanda payment.

    Wording is chosen from `created_by`, which every payment path already sets
    ("collector" | "admin" | "user"), so the message can never drift out of sync
    with how the payment was actually recorded. Every value below is read from
    the payment row — nothing is hardcoded.
    """
    amount = _rupees(payment.amount)
    months_label = _months_label(payment.covered_months)
    receipt = payment.receipt_id
    source = (payment.created_by or "").strip().lower()

    lines = ["JazakAllahu Khairan.", ""]

    if source == "collector":
        title = "Monthly Subscription Collected"
        # Collector name comes from the DB (payment.collected_by), never a literal.
        collector = (payment.collected_by or "").strip()
        who = f"Collector {collector}" if collector else "Your collector"
        lines.append(f"{who} has successfully collected your Monthly Subscription.")
        lines += ["", "Amount:", amount]
    elif source == "admin":
        title = "Payment Recorded"
        lines.append("Your payment has been recorded successfully.")
        lines += ["", "Amount:", amount]
    else:
        title = "Payment Successful"
        lines.append(f"Your Monthly Subscription payment of {amount} has been received.")

    if months_label:
        lines += ["", "Covered Months:", months_label]
    if receipt:
        lines += ["", "Receipt No:" if source not in ("collector", "admin") else "Receipt:", receipt]

    return title, "\n".join(lines)


def notify_chanda_payment(db: Session, payment: models.PaymentEntry) -> None:
    user_id = _chanda_recipient_id(db, payment)
    if not user_id:
        return

    title, body = _build_chanda_message(payment)
    notify_user(
        db, user_id,
        title=title,
        body=body,
        data={
            "type": "payment_received",
            "payment_id": str(payment.id),
            "receipt_id": payment.receipt_id or "",
        },
    )


def notify_chanda_payment_later(payment_id: int, delay_seconds: float = NOTIFY_DELAY_SECONDS) -> None:
    """Background task: wait briefly, then push on a fresh DB session.

    Runs after the response is sent — the request-scoped session from get_db()
    is already closed by then, so this opens its own. Keeping the push out of
    the request means FCM latency never delays the payment API response.
    """
    from app.database import SessionLocal

    time.sleep(delay_seconds)
    db = SessionLocal()
    try:
        payment = db.query(models.PaymentEntry).filter_by(id=payment_id).first()
        if payment:
            notify_chanda_payment(db, payment)
    except Exception:
        log.warning("[notify] chanda payment push failed for id=%s", payment_id, exc_info=True)
    finally:
        db.close()


def _donation_recipient_id(db: Session, donation: models.Donation) -> int | None:
    """Who should receive the "your contribution was received" push.

    Always the donor — never the collector or admin who recorded it.

    donation.user_id is NOT reliably the donor: /donations/ sets it to the
    authenticated actor, so for a collector-recorded fund contribution it holds
    the *collector's* id. Falling back to it sent Mohamed's receipt to Ahmed's
    phone whenever the donor's family had no linked app account.

    collector_id separates the two: it is set only when staff recorded the
    donation, and left null on a self-service donation from the member's own
    app. So the fallback applies only to self-service, where donor and actor are
    the same person; for a staff-recorded donation against someone with no app
    account there is nobody to notify, and we send nothing.
    """
    if donation.head_id:
        head = db.query(models.ApprovedHead).filter_by(id=donation.head_id).first()
        if head and head.user_id:
            return head.user_id

    if donation.collector_id is None:
        return donation.user_id

    return None


def notify_donation_payment(db: Session, donation: models.Donation) -> None:
    user_id = _donation_recipient_id(db, donation)
    if not user_id:
        return

    # Every value below is read from the donation row — nothing is hardcoded.
    is_fund = bool(donation.fund_id)
    fund_name = donation.fund_rel.name if is_fund and donation.fund_rel else None
    amount = _rupees(donation.amount)

    lines = ["JazakAllahu Khairan.", ""]

    if is_fund:
        title = "Fund Contribution Received"
        lines.append(
            f"Your contribution of {amount} towards {fund_name} has been recorded successfully."
            if fund_name else
            f"Your fund contribution of {amount} has been recorded successfully."
        )
    else:
        title = "Donation Received"
        lines.append(f"Your donation of {amount} has been recorded successfully.")

    # Named only when staff actually collected it; a self-service donation has
    # no collector to credit.
    if donation.collector_id and (donation.recorded_by or "").strip():
        lines += ["", "Collected by:", donation.recorded_by.strip()]
    if donation.receipt_id:
        lines += ["", "Receipt No:", donation.receipt_id]

    body_lines = lines

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
