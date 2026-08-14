"""
collected_at (when money was actually received) vs created_at (when the row
was inserted) driving financial-period math: Finance Dashboard cash-flow /
Collector Payout, weekly/yearly collection trends, and Finance Timeline.

Exercises the exact 5 scenarios from the "historical chanda collection date"
fix: a collector/admin backdating an old family's payment must have it land
in the period it was really collected in, not the period it was entered in,
while a normal same-day payment behaves exactly as before.
"""
import os
import sys
from datetime import datetime, timedelta

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
from app.routes import chanda as chanda_routes
from app.routes import finance as finance_routes
from app.security import get_current_user


COLLECTOR = {"sub": "1", "name": "Test Collector", "role": "collector",
             "roles": ["collector"], "status": "ACTIVE"}
ADMIN = {"sub": "2", "name": "Test Admin", "role": "admin",
         "roles": ["admin"], "status": "ACTIVE"}


def _months_back(base: datetime, n: int) -> list[str]:
    out = []
    y, m = base.year, base.month
    for _ in range(n):
        m -= 1
        if m == 0:
            m, y = 12, y - 1
        out.append(f"{y}-{m:02d}")
    return list(reversed(out))


@pytest.fixture
def env():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False)
    db = Session()

    db.add(models.User(id=1, name="Test Collector", phone="9000000001", password="x", role="collector", is_active=True))
    db.add(models.User(id=2, name="Test Admin", phone="9000000002", password="x", role="admin", is_active=True))
    db.add(models.ApprovedHead(id=10, chanda_no="CH-010", name="Rahman", phone="9000000010", monthly_amount=300.0, is_active=True))
    db.commit()

    app = FastAPI()
    app.include_router(chanda_routes.router)
    app.include_router(finance_routes.router)

    def _db():
        yield db

    app.dependency_overrides[chanda_routes.get_db] = _db
    app.dependency_overrides[finance_routes.get_db] = _db

    current = {"user": COLLECTOR}
    app.dependency_overrides[get_current_user] = lambda: current["user"]

    yield TestClient(app), db, current
    db.close()


def _dashboard_for_month(client, month_key):
    return client.get("/finance/dashboard", params={"month": month_key}).json()


def test_1_normal_same_day_payment_counts_toward_current_month(env):
    """collection_date == created_at (today): counts normally, as before."""
    client, db, current = env
    now = datetime.utcnow()
    this_month = now.strftime("%Y-%m")

    current["user"] = COLLECTOR
    r = client.post("/chanda/collect", json={
        "member_id": 10, "amount": 300, "method": "cash",
        "months_list": [this_month],
    })
    assert r.status_code == 200, r.text

    current["user"] = ADMIN
    dash = _dashboard_for_month(client, this_month)
    assert dash["chanda"]["collected"] >= 0  # sanity: endpoint works
    assert dash["collection_periods"]["this_month"]["total"] == 300
    assert dash["collector_payout"]["amount"] == pytest.approx(45.0)  # 15% of 300


def test_2_and_3_historical_payment_entered_today_does_not_hit_current_month(env):
    """
    Scenario 2/3: today = now. Collector enters a family's Jan-Jul historical
    payment today, with collection_date backdated into a past month. Must NOT
    count toward this month's money-received or payout; must count toward the
    month it was actually collected.
    """
    client, db, current = env
    now = datetime.utcnow()
    this_month = now.strftime("%Y-%m")
    past_months = _months_back(now, 7)  # 7 months of historical coverage
    collection_month_dt = now.replace(day=1) - timedelta(days=1)  # last day of prior month
    collection_month_key = collection_month_dt.strftime("%Y-%m")
    collected_date = collection_month_dt.strftime("%Y-%m-%d")

    current["user"] = COLLECTOR
    r = client.post("/chanda/collect", json={
        "member_id": 10, "amount": 300 * 7, "method": "cash",
        "months_list": past_months,
        "collected_date": collected_date,
    })
    assert r.status_code == 200, r.text
    payment_id = r.json()["id"]

    row = db.query(models.PaymentEntry).filter_by(id=payment_id).first()
    assert row.collected_at.strftime("%Y-%m") == collection_month_key, \
        f"collected_at should be in {collection_month_key}, got {row.collected_at}"
    assert row.created_at.strftime("%Y-%m") == this_month, \
        "created_at must stay the real entry time, unaffected by collected_date"

    current["user"] = ADMIN
    this_month_dash = _dashboard_for_month(client, this_month)
    assert this_month_dash["collection_periods"]["this_month"]["total"] == 0, \
        "historical payment must NOT inflate this month's money received"
    assert this_month_dash["collector_payout"]["amount"] == 0, \
        "historical payment must NOT inflate this month's Collector Payout"

    collected_month_dash = _dashboard_for_month(client, collection_month_key)
    assert collected_month_dash["collection_periods"]["this_month"]["total"] == 2100
    assert collected_month_dash["collector_payout"]["amount"] == pytest.approx(315.0)  # 15% of 2100

    tl = client.get("/finance/timeline", params={"page": 1, "per_page": 50}).json()
    chanda = next(e for e in tl["entries"] if e["id"] == payment_id)
    assert chanda["collected_at"].startswith(collection_month_key)
    assert chanda["created_at"].startswith(this_month)


def test_4_backdated_but_actually_today_counts_normally(env):
    """collection_date explicitly set to today == created_at: must count as today."""
    client, db, current = env
    now = datetime.utcnow()
    this_month = now.strftime("%Y-%m")

    current["user"] = COLLECTOR
    r = client.post("/chanda/collect", json={
        "member_id": 10, "amount": 300, "method": "cash",
        "months_list": [this_month],
        "collected_date": now.strftime("%Y-%m-%d"),
    })
    assert r.status_code == 200, r.text

    current["user"] = ADMIN
    dash = _dashboard_for_month(client, this_month)
    assert dash["collection_periods"]["this_month"]["total"] == 300
    assert dash["collector_payout"]["amount"] == pytest.approx(45.0)


def test_6_unchanged_today_date_keeps_the_real_submission_time_not_midnight(env):
    """
    The mobile date picker always sends a date-only collected_date (no
    time-of-day), even when the collector never touched it - it just
    defaults to today. Regression: naively applying that as collected_at
    collapsed every same-day payment's time to midnight UTC (displays as
    5:30 AM IST on the Finance Dashboard's Recent Collections panel),
    destroying the real submission time for the common, unchanged case.
    """
    client, db, current = env
    now = datetime.utcnow()
    this_month = now.strftime("%Y-%m")

    current["user"] = COLLECTOR
    r = client.post("/chanda/collect", json={
        "member_id": 10, "amount": 300, "method": "cash",
        "months_list": [this_month],
        "collected_date": now.strftime("%Y-%m-%d"),  # today, unchanged from the picker's default
    })
    assert r.status_code == 200, r.text
    payment_id = r.json()["id"]

    row = db.query(models.PaymentEntry).filter_by(id=payment_id).first()
    assert row.collected_at == row.created_at, \
        f"unchanged 'today' must keep the real timestamp, not collapse to midnight: {row.collected_at} vs {row.created_at}"
    assert row.collected_at.hour != 0 or row.collected_at.minute != 0, \
        "collected_at must not be midnight for a live same-day payment (unless created_at genuinely is)"


def test_5_advance_payment_belongs_to_collection_month_not_coverage_month(env):
    """
    Advance Chanda: collection_date = today, coverage = today..+4 months ahead.
    The financial transaction belongs to the collection month (today), even
    though coverage extends far into the future. Coverage months themselves
    must be unaffected.
    """
    client, db, current = env
    now = datetime.utcnow()
    this_month = now.strftime("%Y-%m")
    future_months = []
    y, m = now.year, now.month
    for _ in range(5):
        future_months.append(f"{y}-{m:02d}")
        m += 1
        if m == 13:
            m, y = 1, y + 1

    current["user"] = COLLECTOR
    r = client.post("/chanda/collect", json={
        "member_id": 10, "amount": 300 * 5, "method": "cash",
        "months_list": future_months,
        "collected_date": now.strftime("%Y-%m-%d"),
    })
    assert r.status_code == 200, r.text
    payment_id = r.json()["id"]

    row = db.query(models.PaymentEntry).filter_by(id=payment_id).first()
    assert sorted(row.covered_months or []) == sorted(future_months), \
        "coverage months must remain exactly what was paid for"
    assert row.collected_at.strftime("%Y-%m") == this_month

    current["user"] = ADMIN
    dash = _dashboard_for_month(client, this_month)
    assert dash["collection_periods"]["this_month"]["total"] == 1500
    assert dash["collector_payout"]["amount"] == pytest.approx(225.0)  # 15% of 1500
