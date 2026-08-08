"""A fund/donation receipt must reach the donor, never the staff who recorded it.

Reported bug: a collector recording a fund contribution from Mohamed received
Mohamed's own "contribution received" push on the collector's phone.

Cause: /donations/ stores the authenticated actor in donation.user_id (and in
collector_id and created_by_id), so for a staff-recorded donation user_id is the
COLLECTOR. The recipient resolver fell back to that field whenever the donor's
family had no linked app account. The fallback is only valid for a self-service
donation, where donor and actor are the same person — and there collector_id is
left null, which is what distinguishes the two.
"""

import os
import sys

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app import models
from app.utils.payment_notify import _donation_recipient_id, _rupees

DONOR_USER_ID = 42
COLLECTOR_USER_ID = 7


def _db(head_user_id=None, with_head=True):
    engine = create_engine("sqlite:///:memory:")
    models.Base.metadata.create_all(
        engine, tables=[models.ApprovedHead.__table__, models.Donation.__table__])
    db = sessionmaker(bind=engine)()
    if with_head:
        db.add(models.ApprovedHead(id=1, chanda_no="A1", name="Mohamed",
                                   monthly_amount=500.0, is_active=True,
                                   user_id=head_user_id))
        db.commit()
    return db


def _donation(*, user_id, collector_id, head_id=1, fund_id=3):
    return models.Donation(
        id=1, donor_name="Mohamed", user_id=user_id, collector_id=collector_id,
        head_id=head_id, fund_id=fund_id, amount=1000.0, method="cash",
        receipt_id="MM-DN-202608-000001",
    )


def test_collector_fund_collection_notifies_the_donor():
    db = _db(head_user_id=DONOR_USER_ID)
    try:
        d = _donation(user_id=COLLECTOR_USER_ID, collector_id=COLLECTOR_USER_ID)
        assert _donation_recipient_id(db, d) == DONOR_USER_ID
    finally:
        db.close()


def test_collector_collection_from_unlinked_donor_notifies_nobody():
    """The exact regression: no donor account must NOT mean 'send to collector'."""
    db = _db(head_user_id=None)
    try:
        d = _donation(user_id=COLLECTOR_USER_ID, collector_id=COLLECTOR_USER_ID)
        assert _donation_recipient_id(db, d) is None
    finally:
        db.close()


def test_admin_recorded_donation_never_notifies_the_admin():
    db = _db(head_user_id=None)
    try:
        d = _donation(user_id=COLLECTOR_USER_ID, collector_id=COLLECTOR_USER_ID)
        assert _donation_recipient_id(db, d) is None
    finally:
        db.close()


def test_self_donation_still_notifies_the_donor():
    """Self-service leaves collector_id null, so the fallback stays valid."""
    db = _db(with_head=False)
    try:
        d = _donation(user_id=DONOR_USER_ID, collector_id=None, head_id=None)
        assert _donation_recipient_id(db, d) == DONOR_USER_ID
    finally:
        db.close()


def test_walk_in_donor_with_no_account_notifies_nobody():
    db = _db(with_head=False)
    try:
        d = _donation(user_id=None, collector_id=COLLECTOR_USER_ID, head_id=None)
        assert _donation_recipient_id(db, d) is None
    finally:
        db.close()


def test_amount_formatting_is_indian_grouped():
    assert _rupees(1000) == "₹1,000"
    assert _rupees(125000) == "₹1,25,000"
