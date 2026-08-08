"""Correcting a mistyped monthly amount must clear the phantom balance.

Reported case: a family paying 100/month was recorded at a rate of 150, so every
month sat at `partial` with a 50 balance. Changing the rate to 100 in the admin
UI updated the family but left the balances, because only rows at status
"pending" were re-priced - and these were "partial".
"""

import os
import sys

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app import models
from app.utils.payment_ledger import apply_rate_to_open_months


def _db():
    engine = create_engine("sqlite:///:memory:")
    models.Base.metadata.create_all(engine, tables=[models.ChandaCollection.__table__])
    return sessionmaker(bind=engine)()


def _balance(cols):
    return sum(max(c.amount_due - (c.total_paid or 0), 0) for c in cols)


def test_lowering_rate_clears_partial_balances():
    db = _db()
    try:
        for m in range(1, 9):
            db.add(models.ChandaCollection(
                head_id=1, month=f"2026-{m:02d}",
                amount_due=150.0, total_paid=100.0, status="partial",
            ))
        db.commit()

        cols = db.query(models.ChandaCollection).all()
        assert _balance(cols) == 400.0          # 8 months x 50 phantom balance

        apply_rate_to_open_months(db, 1, 100.0, current_month="2026-08")
        db.commit()

        cols = db.query(models.ChandaCollection).all()
        assert _balance(cols) == 0.0
        assert all(c.status == "paid" for c in cols)
        assert all(c.amount_due == 100.0 for c in cols)
    finally:
        db.close()


def test_settled_past_months_are_never_repriced():
    db = _db()
    try:
        db.add(models.ChandaCollection(
            head_id=1, month="2026-01", amount_due=150.0, total_paid=150.0, status="paid",
        ))
        db.add(models.ChandaCollection(
            head_id=1, month="2026-08", amount_due=150.0, total_paid=100.0, status="partial",
        ))
        db.commit()

        apply_rate_to_open_months(db, 1, 100.0, current_month="2026-08")
        db.commit()

        settled = db.query(models.ChandaCollection).filter_by(month="2026-01").one()
        open_month = db.query(models.ChandaCollection).filter_by(month="2026-08").one()
        # Money really collected at the old rate stays as recorded.
        assert settled.amount_due == 150.0 and settled.status == "paid"
        assert open_month.amount_due == 100.0 and open_month.status == "paid"
    finally:
        db.close()


def test_raising_rate_reopens_a_future_advance_month():
    db = _db()
    try:
        db.add(models.ChandaCollection(
            head_id=1, month="2026-11", amount_due=100.0,
            total_paid=100.0, status="paid", is_advance=True,
        ))
        db.commit()

        apply_rate_to_open_months(db, 1, 150.0, current_month="2026-08")
        db.commit()

        col = db.query(models.ChandaCollection).filter_by(month="2026-11").one()
        # Cash received is untouched; the shortfall against the new rate shows.
        assert col.total_paid == 100.0
        assert col.amount_due == 150.0
        assert col.status == "partial"
    finally:
        db.close()
