"""
An approved rollback sets PaymentEntry.status = "rejected" (same string a
failed-verification payment gets), which made it indistinguishable in
user/collector-facing history: it showed up labeled "Rejected" instead of
disappearing, and its amount stayed listed in an already-bundled cash
submission's transaction list. rollback_status == "approved" is the actual
marker for "this money was reversed, not that the payment was invalid" -
these tests confirm every user/collector-facing read excludes it while a
genuine (non-rollback) rejected payment still shows normally.
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
from app.routes import user_pay, finance
from app.services.cash_submission_service import get_submission_transactions
from app.security import get_current_user


COLLECTOR = {"sub": "1", "name": "Test Collector", "role": "collector",
             "roles": ["collector"], "status": "ACTIVE"}
ADMIN = {"sub": "2", "name": "Test Admin", "role": "admin", "roles": ["admin"], "status": "ACTIVE"}
MEMBER = {"sub": "3", "name": "Member", "role": "member", "roles": ["member"], "status": "ACTIVE"}


@pytest.fixture
def env():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False)
    db = Session()

    db.add(models.User(id=1, name="Test Collector", phone="9000000001", password="x", role="collector", is_active=True))
    db.add(models.User(id=2, name="Test Admin", phone="9000000002", password="x", role="admin", is_active=True))
    db.add(models.User(id=3, name="Member", phone="9000000003", password="x", role="member",
                       family_id=10, is_active=True))
    db.add(models.ApprovedHead(id=10, chanda_no="CH-010", name="Rahman", phone="9000000003",
                               monthly_amount=300.0, is_active=True, user_id=3))
    db.commit()

    now = datetime.utcnow()

    # A genuinely rolled-back payment: status=rejected, rollback_status=approved.
    rolled_back = models.PaymentEntry(
        head_id=10, paid_by_user_id=3, collector_id=1, amount=300, method="cash",
        created_at=now, collected_by="Test Collector", collected_at=now,
        status="rejected", rollback_status="approved", created_by="collector",
        covered_months=["2026-01"], submission_id=None,
    )
    # A normal, never-rolled-back rejected payment (failed verification) -
    # must keep showing as "Rejected", this is a different, legitimate state.
    normal_rejected = models.PaymentEntry(
        head_id=10, paid_by_user_id=3, collector_id=1, amount=150, method="cash",
        created_at=now, collected_by="Test Collector", collected_at=now,
        status="rejected", rollback_status=None, created_by="collector",
        covered_months=["2026-02"],
    )
    # A live, verified payment - must always show.
    live = models.PaymentEntry(
        head_id=10, paid_by_user_id=3, collector_id=1, amount=300, method="cash",
        created_at=now, collected_by="Test Collector", collected_at=now,
        status="verified", rollback_status=None, created_by="collector",
        covered_months=["2026-03"],
    )
    db.add_all([rolled_back, normal_rejected, live])
    db.commit()

    app = FastAPI()
    app.include_router(user_pay.router)
    app.include_router(finance.router)

    def _db():
        yield db

    app.dependency_overrides[user_pay.get_db] = _db
    app.dependency_overrides[finance.get_db] = _db

    current = {"user": MEMBER}
    app.dependency_overrides[get_current_user] = lambda: current["user"]

    yield TestClient(app), db, current, {"rolled_back": rolled_back, "normal_rejected": normal_rejected, "live": live}
    db.close()


def test_user_payment_history_excludes_approved_rollback_but_keeps_normal_rejected(env):
    client, db, current, rows = env
    current["user"] = MEMBER

    resp = client.get("/user/payments")
    assert resp.status_code == 200, resp.text
    ids = [p["id"] for p in resp.json()]

    assert rows["rolled_back"].id not in ids, "approved rollback must not appear in user history"
    assert rows["normal_rejected"].id in ids, "a genuine (non-rollback) rejection must still show"
    assert rows["live"].id in ids


def test_collector_history_excludes_approved_rollback(env):
    client, db, current, rows = env
    current["user"] = COLLECTOR

    resp = client.get("/finance/collector/history")
    assert resp.status_code == 200, resp.text
    ids = [e["id"] for e in resp.json()["entries"] if e["entry_type"] == "chanda"]

    assert rows["rolled_back"].id not in ids
    assert rows["normal_rejected"].id in ids
    assert rows["live"].id in ids


def test_family_statement_excludes_approved_rollback(env):
    client, db, current, rows = env
    current["user"] = COLLECTOR

    resp = client.get("/finance/reports/family/10")
    assert resp.status_code == 200, resp.text
    ids = [p["id"] for p in resp.json()["payments"]]

    assert rows["rolled_back"].id not in ids
    assert rows["normal_rejected"].id in ids
    assert rows["live"].id in ids


def test_cash_submission_transactions_excludes_approved_rollback_even_if_already_bundled(env):
    client, db, current, rows = env

    submission = models.CollectorCashSubmission(
        collector_id=1, start_date=datetime.utcnow(), end_date=datetime.utcnow(),
        submitted_amount=450, cash_amount=450, online_amount=0, categories=["chanda"],
        status="approved", submitted_at=datetime.utcnow(),
    )
    db.add(submission)
    db.flush()
    rows["rolled_back"].submission_id = submission.id
    rows["live"].submission_id = submission.id
    db.commit()

    txns = get_submission_transactions(db, submission)
    ids = [t["id"] for t in txns]
    assert rows["rolled_back"].id not in ids, "must not appear even once bundled into a finalized submission"
    assert rows["live"].id in ids
