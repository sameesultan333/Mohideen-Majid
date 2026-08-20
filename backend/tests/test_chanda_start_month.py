"""
Admin-controlled Chanda start month — ApprovedHead.registration_date (an
existing field, already used for this exact purpose elsewhere in the
codebase) now drives which months count as pending/outstanding, via a
validated PATCH endpoint that refuses to narrow the start month past any
verified, non-rolled-back payment, and via a family-aware exclusion in
chanda_months.py that both the scheduled and manual month generators respect.
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
from app.utils.chanda_months import pending_month_filter, current_month_key

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
    db.add(models.ApprovedHead(
        id=10, chanda_no="CH-010", name="Farhana", phone="9000000010",
        monthly_amount=100.0, is_active=True, registration_date=datetime(2026, 1, 1),
    ))
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


def _make_collection(db, month, amount_due=100.0, total_paid=0.0, status="pending"):
    col = models.ChandaCollection(head_id=10, month=month, amount_due=amount_due, total_paid=total_paid, status=status)
    db.add(col)
    db.commit()
    db.refresh(col)
    return col


def _make_payment(db, month, amount=100.0, status="verified", rollback_status=None):
    p = models.PaymentEntry(
        head_id=10, amount=amount, method="cash", status=status, rollback_status=rollback_status,
        created_by="admin", covered_months=[month], collection_id=None,
    )
    db.add(p)
    db.commit()
    return p


# 1. Family starts January → January counts normally.
def test_family_starting_january_counts_january_normally(env):
    client, db, current = env
    _make_collection(db, "2026-01", amount_due=100, total_paid=0, status="pending")

    rows = db.query(models.ChandaCollection).filter(
        models.ChandaCollection.head_id == 10, pending_month_filter("2026-06"),
    ).all()
    assert any(c.month == "2026-01" for c in rows), "January must count normally when start is January"


# 2. Family starts July → January–June don't count.
def test_changing_start_to_july_excludes_jan_through_june(env):
    client, db, current = env
    for m in ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]:
        _make_collection(db, m, amount_due=100, total_paid=0, status="pending")

    resp = client.patch("/admin/families/10/chanda-start-month", json={"start_month": "2026-07"})
    assert resp.status_code == 200, resp.text

    cols = {c.month: c.status for c in db.query(models.ChandaCollection).filter_by(head_id=10).all()}
    for m in ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]:
        assert cols[m] == "not_applicable", f"{m} should be not_applicable, got {cols[m]}"

    rows = db.query(models.ChandaCollection).filter(
        models.ChandaCollection.head_id == 10, pending_month_filter("2026-08"),
    ).all()
    counted_months = {c.month for c in rows}
    assert not (counted_months & {"2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"})


# 3. Existing July/August payments remain correct after the change.
def test_july_august_payments_remain_correct_after_start_month_change(env):
    client, db, current = env
    for m in ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]:
        _make_collection(db, m, amount_due=100, total_paid=0, status="pending")
    _make_collection(db, "2026-07", amount_due=100, total_paid=100, status="paid")
    _make_collection(db, "2026-08", amount_due=100, total_paid=100, status="paid")
    _make_payment(db, "2026-07")
    _make_payment(db, "2026-08")

    resp = client.patch("/admin/families/10/chanda-start-month", json={"start_month": "2026-07"})
    assert resp.status_code == 200, resp.text

    july = db.query(models.ChandaCollection).filter_by(head_id=10, month="2026-07").first()
    august = db.query(models.ChandaCollection).filter_by(head_id=10, month="2026-08").first()
    assert july.status == "paid" and july.total_paid == 100
    assert august.status == "paid" and august.total_paid == 100

    payments = db.query(models.PaymentEntry).filter_by(head_id=10).all()
    assert len(payments) == 2, "payments must never be deleted or altered by a start-month change"


# 4. Pre-start verified payment blocks changing the start month.
def test_verified_payment_before_new_start_blocks_the_change(env):
    client, db, current = env
    _make_collection(db, "2026-01", amount_due=100, total_paid=100, status="paid")
    for m in ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]:
        _make_collection(db, m, amount_due=100, total_paid=0, status="pending")
    _make_payment(db, "2026-01", status="verified")

    resp = client.patch("/admin/families/10/chanda-start-month", json={"start_month": "2026-07"})
    assert resp.status_code == 400, resp.text
    assert "2026-01" in resp.json()["detail"]
    assert "rollback" in resp.json()["detail"].lower()

    # Nothing changed.
    head = db.query(models.ApprovedHead).filter_by(id=10).first()
    assert head.registration_date.strftime("%Y-%m") == "2026-01"
    jan = db.query(models.ChandaCollection).filter_by(head_id=10, month="2026-01").first()
    assert jan.status == "paid"
    payments = db.query(models.PaymentEntry).filter_by(head_id=10).all()
    assert len(payments) == 1, "the payment must never be touched by a blocked change"


def test_collector_cannot_change_chanda_start_month(env):
    """Backend must reject this outright (403), not merely hide the UI
    control - a Collector who calls the endpoint directly must still fail."""
    client, db, current = env
    _make_collection(db, "2026-01", amount_due=100, total_paid=0, status="pending")
    current["user"] = COLLECTOR

    resp = client.patch("/admin/families/10/chanda-start-month", json={"start_month": "2026-07"})
    assert resp.status_code == 403, resp.text

    head = db.query(models.ApprovedHead).filter_by(id=10).first()
    assert head.registration_date.strftime("%Y-%m") == "2026-01", \
        "rejected request must leave the family's start month untouched"


# 5. Rejected/rolled-back payment does not count as a valid payment.
def test_rolled_back_payment_does_not_block_the_change(env):
    client, db, current = env
    _make_collection(db, "2026-01", amount_due=100, total_paid=0, status="pending")
    for m in ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]:
        _make_collection(db, m, amount_due=100, total_paid=0, status="pending")
    # This payment was rolled back - status=rejected, rollback_status=approved.
    # Collection totals were already reversed to 0 by the real rollback flow.
    _make_payment(db, "2026-01", status="rejected", rollback_status="approved")

    resp = client.patch("/admin/families/10/chanda-start-month", json={"start_month": "2026-07"})
    assert resp.status_code == 200, resp.text

    jan = db.query(models.ChandaCollection).filter_by(head_id=10, month="2026-01").first()
    assert jan.status == "not_applicable"
    # The rolled-back payment itself is still preserved, untouched.
    payments = db.query(models.PaymentEntry).filter_by(head_id=10).all()
    assert len(payments) == 1
    assert payments[0].status == "rejected"
    assert payments[0].rollback_status == "approved"


# 6. Monthly generator doesn't create pre-start months.
def test_scheduled_job_does_not_create_pre_start_months(env, monkeypatch):
    client, db, current = env
    head = db.query(models.ApprovedHead).filter_by(id=10).first()
    head.registration_date = datetime(2026, 7, 1)
    db.commit()

    engine = db.get_bind()
    from sqlalchemy.orm import sessionmaker as _sm
    _Session = _sm(bind=engine, autoflush=False)

    import app.database as db_module
    monkeypatch.setattr(db_module, "SessionLocal", _Session)

    import app.utils.timezones as tz
    from datetime import timezone as _tz
    monkeypatch.setattr(tz, "utc_now", lambda: datetime(2026, 3, 1, tzinfo=_tz.utc))

    from app import scheduler as sched_module
    sched_module.job_generate_chanda_month()

    col = db.query(models.ChandaCollection).filter_by(head_id=10, month="2026-03").first()
    assert col is None, "scheduler must not create a March row when Chanda start is July"


# 7. Manual generator doesn't create pre-start months.
def test_manual_generate_endpoint_does_not_create_pre_start_months(env):
    client, db, current = env
    head = db.query(models.ApprovedHead).filter_by(id=10).first()
    head.registration_date = datetime(2026, 7, 1)
    db.commit()

    resp = client.post("/chanda/generate", json={"month": "2026-03"})
    assert resp.status_code == 200, resp.text

    col = db.query(models.ChandaCollection).filter_by(head_id=10, month="2026-03").first()
    assert col is None, "manual generate must not create a pre-start month"

    resp2 = client.post("/chanda/generate", json={"month": "2026-07"})
    assert resp2.status_code == 200, resp2.text
    col2 = db.query(models.ChandaCollection).filter_by(head_id=10, month="2026-07").first()
    assert col2 is not None, "manual generate must still create the actual start month"


# 8. Outstanding excludes pre-start months.
def test_outstanding_excludes_pre_start_months(env):
    client, db, current = env
    for m in ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]:
        _make_collection(db, m, amount_due=100, total_paid=0, status="pending")
    _make_collection(db, "2026-07", amount_due=100, total_paid=0, status="pending")

    resp = client.patch("/admin/families/10/chanda-start-month", json={"start_month": "2026-07"})
    assert resp.status_code == 200, resp.text

    # The PATCH also backfills any months from July up to the real current
    # month (existing _auto_generate_months_for_head behavior, unchanged) -
    # so outstanding is 100 per pending month from July onward, never
    # inflated by Jan-Jun regardless of how many months that backfill adds.
    resp2 = client.get("/finance/reports/family/10")
    assert resp2.status_code == 200, resp2.text
    body = resp2.json()
    pending_from_july = [
        c for c in body["collections"]
        if c["month"] >= "2026-07" and c["status"] != "not_applicable"
    ]
    assert body["summary"]["total_outstanding"] == pytest.approx(100.0 * len(pending_from_july))
    assert body["summary"]["total_outstanding"] > 0


# 9. Pending excludes pre-start months.
def test_pending_count_excludes_pre_start_months(env):
    client, db, current = env
    for m in ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]:
        _make_collection(db, m, amount_due=100, total_paid=0, status="pending")
    _make_collection(db, "2026-07", amount_due=100, total_paid=0, status="pending")

    client.patch("/admin/families/10/chanda-start-month", json={"start_month": "2026-07"})

    resp = client.get("/finance/reports/family/10")
    body = resp.json()
    pending_from_july = [
        c for c in body["collections"]
        if c["month"] >= "2026-07" and c["status"] == "pending"
    ]
    assert body["summary"]["pending_months"] == len(pending_from_july)
    assert body["summary"]["pending_months"] >= 1
    not_applicable_months = [c["month"] for c in body["collections"] if c["status"] == "not_applicable"]
    assert set(not_applicable_months) == {"2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"}
