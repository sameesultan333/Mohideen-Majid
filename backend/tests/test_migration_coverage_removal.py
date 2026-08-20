"""
Removing one month's Excel-migration coverage from a family must be dynamic
(any month, not a July-specific fix), must recalculate authoritative state
(ChandaCollection.total_paid/status) rather than patch a dashboard number,
must never touch normal payment-rollback machinery, and must never delete
the underlying PaymentEntry - financial history stays auditable.
"""
import os
import sys
from datetime import datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


@compiles(JSONB, "sqlite")
def _jsonb_as_json(type_, compiler, **kw):  # noqa: ARG001
    return "JSON"

from app import models
from app.database import Base
from app.routes import admin as admin_routes
from app.routes import chanda as chanda_routes
from app.routes import finance as finance_routes
from app.security import get_current_user

ADMIN = {"sub": "1", "name": "Test Admin", "role": "admin", "roles": ["admin"], "status": "ACTIVE"}
COLLECTOR = {"sub": "2", "name": "Test Collector", "role": "collector", "roles": ["collector"], "status": "ACTIVE"}


@pytest.fixture
def env():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False)
    db = Session()

    db.add(models.User(id=1, name="Test Admin", phone="9000000001", password="x", role="admin", is_active=True))
    db.add(models.User(id=2, name="Test Collector", phone="9000000002", password="x", role="collector", is_active=True))
    db.add(models.ApprovedHead(id=10, chanda_no="CH-010", name="Farhana", phone="9000000010",
                               monthly_amount=100.0, is_active=True))
    db.commit()

    app = FastAPI()
    app.include_router(admin_routes.router)
    app.include_router(chanda_routes.router)
    app.include_router(finance_routes.router)

    def _db():
        yield db

    for r in (admin_routes, chanda_routes, finance_routes):
        app.dependency_overrides[r.get_db] = _db

    current = {"user": ADMIN}
    app.dependency_overrides[get_current_user] = lambda: current["user"]

    yield TestClient(app), db, current
    db.close()


MONTHS = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"]


def _seed_lump_sum_migration(db, months=MONTHS, amount_per_month=100.0):
    """Mirrors _create_migration_record's output shape: one PaymentEntry,
    multi-key coverage_map, plus a paid ChandaCollection row per month."""
    coverage_map = {}
    for m in months:
        col = models.ChandaCollection(head_id=10, month=m, amount_due=amount_per_month,
                                      total_paid=amount_per_month, status="paid")
        db.add(col)
        coverage_map[m] = amount_per_month

    payment = models.PaymentEntry(
        head_id=10, amount=sum(coverage_map.values()), method="cash",
        created_at=datetime(2026, 8, 1), collected_by="migration", collected_at=datetime(2026, 1, 1),
        status="verified", created_by="migration", verified_by="migration",
        purpose="Monthly Chanda", months_covered=len(coverage_map),
        covered_months=sorted(coverage_map.keys()), coverage_map=coverage_map,
        payment_source="import", receipt_status="historical_import", rollback_status=None,
    )
    db.add(payment)
    db.commit()
    return payment


def test_remove_first_month_january(env):
    client, db, current = env
    payment = _seed_lump_sum_migration(db)

    resp = client.delete("/admin/families/10/migration-coverage/2026-01")
    assert resp.status_code == 200, resp.text
    assert resp.json()["new_status"] == "pending"
    assert resp.json()["removed_amount"] == 100.0

    jan = db.query(models.ChandaCollection).filter_by(head_id=10, month="2026-01").first()
    assert jan.status == "pending"
    assert jan.total_paid == 0

    for m in MONTHS[1:]:
        col = db.query(models.ChandaCollection).filter_by(head_id=10, month=m).first()
        assert col.status == "paid", f"{m} must be untouched"

    db.refresh(payment)
    assert "2026-01" not in payment.covered_months
    assert set(payment.covered_months) == set(MONTHS[1:])
    assert payment.amount == pytest.approx(600.0)


def test_remove_middle_month_does_not_affect_neighbors(env):
    client, db, current = env
    payment = _seed_lump_sum_migration(db)

    resp = client.delete("/admin/families/10/migration-coverage/2026-04")
    assert resp.status_code == 200, resp.text

    april = db.query(models.ChandaCollection).filter_by(head_id=10, month="2026-04").first()
    assert april.status == "pending" and april.total_paid == 0

    march = db.query(models.ChandaCollection).filter_by(head_id=10, month="2026-03").first()
    may = db.query(models.ChandaCollection).filter_by(head_id=10, month="2026-05").first()
    assert march.status == "paid" and march.total_paid == 100.0
    assert may.status == "paid" and may.total_paid == 100.0

    db.refresh(payment)
    assert "2026-04" not in payment.covered_months
    assert len(payment.covered_months) == 6


def test_remove_final_covered_month_july(env):
    """The exact scenario from the request: Jan-Jul covered, July removed."""
    client, db, current = env
    payment = _seed_lump_sum_migration(db)

    resp = client.delete("/admin/families/10/migration-coverage/2026-07")
    assert resp.status_code == 200, resp.text

    july = db.query(models.ChandaCollection).filter_by(head_id=10, month="2026-07").first()
    assert july.status == "pending"
    assert july.total_paid == 0

    for m in ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]:
        col = db.query(models.ChandaCollection).filter_by(head_id=10, month=m).first()
        assert col.status == "paid", f"{m} must remain covered"

    db.refresh(payment)
    assert payment.covered_months == ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]
    # Payment row is never deleted, even after losing coverage for one month.
    assert db.query(models.PaymentEntry).filter_by(id=payment.id).first() is not None


def test_removing_the_only_covered_month_leaves_a_zero_value_record_not_a_deletion(env):
    client, db, current = env
    payment = _seed_lump_sum_migration(db, months=["2026-01"], amount_per_month=100.0)

    resp = client.delete("/admin/families/10/migration-coverage/2026-01")
    assert resp.status_code == 200, resp.text

    db.refresh(payment)
    assert payment.covered_months == []
    assert payment.coverage_map == {}
    assert payment.amount == 0
    assert db.query(models.PaymentEntry).filter_by(id=payment.id).first() is not None, \
        "must never delete the PaymentEntry - financial history stays auditable"


def test_removed_month_now_counts_as_pending_outstanding_and_defaulter_eligible(env):
    """Verifies the fix flows through the SAME authoritative-state functions
    every dashboard/collector/family-detail screen already reads - not a
    hand-patched number."""
    client, db, current = env
    _seed_lump_sum_migration(db)

    resp = client.delete("/admin/families/10/migration-coverage/2026-07")
    assert resp.status_code == 200, resp.text

    stmt = client.get("/finance/reports/family/10").json()
    july_row = next(c for c in stmt["collections"] if c["month"] == "2026-07")
    assert july_row["status"] == "pending"
    assert july_row["is_migration_covered"] is False, \
        "no longer migration-covered once the coverage is removed"

    june_row = next(c for c in stmt["collections"] if c["month"] == "2026-06")
    assert june_row["is_migration_covered"] is True

    # Family-level outstanding must include July now.
    assert stmt["summary"]["total_outstanding"] > 0


def test_collector_cannot_remove_migration_coverage(env):
    """Backend must reject this outright (403), not merely hide the button -
    a Collector who calls the endpoint directly must still be refused."""
    client, db, current = env
    _seed_lump_sum_migration(db)
    current["user"] = COLLECTOR

    resp = client.delete("/admin/families/10/migration-coverage/2026-07")
    assert resp.status_code == 403, resp.text

    july = db.query(models.ChandaCollection).filter_by(head_id=10, month="2026-07").first()
    assert july.status == "paid", "rejected request must leave the collection state untouched"


def test_no_migration_coverage_for_month_returns_404(env):
    client, db, current = env
    _seed_lump_sum_migration(db)

    resp = client.delete("/admin/families/10/migration-coverage/2027-01")
    assert resp.status_code == 404


def test_does_not_touch_normal_payment_rollback_machinery(env):
    """A completely separate, real (non-migration) verified payment for a
    DIFFERENT month must be untouched, and removing migration coverage must
    never create/modify a PaymentRollbackRequest."""
    client, db, current = env
    _seed_lump_sum_migration(db)

    real_payment = models.PaymentEntry(
        head_id=10, amount=100.0, method="upi", created_at=datetime(2026, 9, 1),
        collected_by="Collector Joe", collected_at=datetime(2026, 9, 1),
        status="verified", created_by="collector",
        covered_months=["2026-09"], coverage_map={"2026-09": 100.0},
        payment_source="app", rollback_status=None,
    )
    col_sep = models.ChandaCollection(head_id=10, month="2026-09", amount_due=100.0,
                                      total_paid=100.0, status="paid")
    db.add_all([real_payment, col_sep])
    db.commit()

    resp = client.delete("/admin/families/10/migration-coverage/2026-07")
    assert resp.status_code == 200, resp.text

    db.refresh(real_payment)
    assert real_payment.status == "verified"
    assert real_payment.rollback_status is None
    sep = db.query(models.ChandaCollection).filter_by(head_id=10, month="2026-09").first()
    assert sep.status == "paid" and sep.total_paid == 100.0

    assert db.query(models.PaymentRollbackRequest).count() == 0
