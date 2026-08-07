"""Regression tests: ungenerated future months must never be pending.

Reported bug: with only Jan–Aug generated and the member paid through Jul, the
apps listed Aug *and* Sep–Dec as pending. Sep–Dec rows exist only because the
historical Excel import writes a row per month column in the sheet — they are
not generated months and must be invisible to every pending/outstanding path.
"""

import os
import sys

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app import models
from app.utils.chanda_months import (
    current_month_key,
    is_generated_month,
    is_visible_month,
    pending_month_filter,
    visible_month_filter,
)


def _session_with_full_year(current_month: str, paid_through: str):
    """One family with Jan–Dec rows; paid through `paid_through`, rest pending."""
    engine = create_engine("sqlite:///:memory:")
    models.Base.metadata.create_all(engine, tables=[models.ChandaCollection.__table__])
    db = sessionmaker(bind=engine)()
    year = current_month.split("-")[0]
    for m in range(1, 13):
        key = f"{year}-{m:02d}"
        paid = 2000.0 if key <= paid_through else 0.0
        db.add(models.ChandaCollection(
            head_id=1, month=key, amount_due=2000.0,
            total_paid=paid, status="paid" if paid else "pending",
        ))
    db.commit()
    return db


def _months(cols):
    return [c.month for c in cols]


def test_is_generated_month_excludes_future():
    assert is_generated_month("2026-08", current_month="2026-08")
    assert is_generated_month("2026-07", current_month="2026-08")
    assert not is_generated_month("2026-09", current_month="2026-08")
    assert not is_generated_month("2026-12", current_month="2026-08")


def test_is_visible_month_keeps_advance_payments():
    # Unpaid future month → hidden. Same month, paid in advance → shown.
    assert not is_visible_month("2026-12", 0, current_month="2026-08")
    assert is_visible_month("2026-12", 2000.0, current_month="2026-08")
    assert is_visible_month("2026-03", 0, current_month="2026-08")


def test_pending_query_returns_only_generated_months():
    db = _session_with_full_year("2026-08", paid_through="2026-07")
    try:
        pending = (
            db.query(models.ChandaCollection)
            .filter(
                models.ChandaCollection.status != "paid",
                pending_month_filter("2026-08"),
            )
            .order_by(models.ChandaCollection.month)
            .all()
        )
        # August only — September through December are not generated.
        assert _months(pending) == ["2026-08"]
    finally:
        db.close()


def test_outstanding_ignores_ungenerated_future_months():
    db = _session_with_full_year("2026-08", paid_through="2026-07")
    try:
        cols = (
            db.query(models.ChandaCollection)
            .filter(pending_month_filter("2026-08"))
            .all()
        )
        outstanding = sum(max(c.amount_due - c.total_paid, 0) for c in cols)
        # One month due (Aug), not five (Aug–Dec).
        assert outstanding == 2000.0
        assert sum(1 for c in cols if c.status == "paid") == 7
    finally:
        db.close()


def test_advance_paid_months_stay_visible_but_never_pending():
    """Excel shows this family paid through December while only Jan–Aug exist."""
    db = _session_with_full_year("2026-08", paid_through="2026-12")
    try:
        visible = (
            db.query(models.ChandaCollection)
            .filter(visible_month_filter("2026-08"))
            .order_by(models.ChandaCollection.month)
            .all()
        )
        # All twelve stay visible — Sep–Dec because they were paid in advance.
        assert len(visible) == 12
        assert all(c.status == "paid" for c in visible)

        pending = (
            db.query(models.ChandaCollection)
            .filter(
                models.ChandaCollection.status != "paid",
                pending_month_filter("2026-08"),
            )
            .all()
        )
        assert pending == []
    finally:
        db.close()


def test_mixed_family_shows_advance_but_hides_blank_future_months():
    """Paid Jan–Jul, skipped Aug, then paid Nov in advance."""
    engine = create_engine("sqlite:///:memory:")
    models.Base.metadata.create_all(engine, tables=[models.ChandaCollection.__table__])
    db = sessionmaker(bind=engine)()
    try:
        for m in range(1, 13):
            key = f"2026-{m:02d}"
            paid = 2000.0 if (m <= 7 or m == 11) else 0.0
            db.add(models.ChandaCollection(
                head_id=1, month=key, amount_due=2000.0,
                total_paid=paid, status="paid" if paid else "pending",
            ))
        db.commit()

        visible = (
            db.query(models.ChandaCollection)
            .filter(visible_month_filter("2026-08"))
            .order_by(models.ChandaCollection.month)
            .all()
        )
        # Jan–Aug generated, plus Nov because it was paid. Sep/Oct/Dec are gone.
        assert _months(visible) == [f"2026-{m:02d}" for m in range(1, 9)] + ["2026-11"]

        pending = (
            db.query(models.ChandaCollection)
            .filter(
                models.ChandaCollection.status != "paid",
                pending_month_filter("2026-08"),
            )
            .all()
        )
        assert _months(pending) == ["2026-08"]
    finally:
        db.close()


def test_current_month_key_is_generated():
    assert is_generated_month(current_month_key())
