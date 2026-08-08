"""The payment confirmation must reach the member, never the staff who keyed it in.

Reported bug: a collector recording a member's Monthly Subscription received the
member's own "payment collected" push on the collector's phone.

Cause: /chanda/collect stores the COLLECTOR's user id in paid_by_user_id, and the
recipient resolver fell back to that field whenever the family had no linked app
account — which is most families during a trial. The fallback is only valid for
self-payments, where payer and recipient are the same person.
"""

import os
import sys

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app import models
from app.utils.payment_notify import _chanda_recipient_id

MEMBER_USER_ID = 42
COLLECTOR_USER_ID = 7


def _db(head_user_id):
    engine = create_engine("sqlite:///:memory:")
    models.Base.metadata.create_all(
        engine, tables=[models.ApprovedHead.__table__, models.PaymentEntry.__table__])
    db = sessionmaker(bind=engine)()
    db.add(models.ApprovedHead(id=1, chanda_no="A1", name="Mohammed Ali",
                               monthly_amount=500.0, is_active=True,
                               user_id=head_user_id))
    db.commit()
    return db


def _payment(created_by, paid_by_user_id):
    return models.PaymentEntry(
        id=1, head_id=1, amount=500.0, created_by=created_by,
        collected_by="Ahmed", paid_by_user_id=paid_by_user_id,
        purpose="Monthly Chanda", covered_months=["2026-08"],
    )


def test_collector_payment_notifies_the_member_not_the_collector():
    db = _db(head_user_id=MEMBER_USER_ID)
    try:
        pay = _payment("collector", paid_by_user_id=COLLECTOR_USER_ID)
        assert _chanda_recipient_id(db, pay) == MEMBER_USER_ID
    finally:
        db.close()


def test_collector_payment_for_unlinked_family_notifies_nobody():
    """The exact regression: no member account must NOT mean 'send to collector'."""
    db = _db(head_user_id=None)
    try:
        pay = _payment("collector", paid_by_user_id=COLLECTOR_USER_ID)
        assert _chanda_recipient_id(db, pay) is None
    finally:
        db.close()


def test_admin_payment_never_notifies_the_admin():
    db = _db(head_user_id=None)
    try:
        pay = _payment("admin", paid_by_user_id=COLLECTOR_USER_ID)
        assert _chanda_recipient_id(db, pay) is None
    finally:
        db.close()


def test_admin_payment_notifies_a_linked_member():
    db = _db(head_user_id=MEMBER_USER_ID)
    try:
        assert _chanda_recipient_id(db, _payment("admin", None)) == MEMBER_USER_ID
    finally:
        db.close()


def test_self_payment_still_notifies_the_payer():
    """The fallback remains valid here: payer and recipient are the same person."""
    db = _db(head_user_id=None)
    try:
        pay = _payment("user", paid_by_user_id=MEMBER_USER_ID)
        assert _chanda_recipient_id(db, pay) == MEMBER_USER_ID
    finally:
        db.close()
