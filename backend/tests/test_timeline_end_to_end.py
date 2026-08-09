"""
End-to-end: a collector records a payment, the admin's Finance Timeline shows it.

This is the whole path the "new collections never appear" report is about, driven
through the real routers rather than by reasoning about them: POST /chanda/collect
then GET /finance/timeline, same app, same models, same session.
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


# The models use Postgres JSONB, which SQLite cannot render. JSON is the same
# shape for the purposes of this test.
@compiles(JSONB, "sqlite")
def _jsonb_as_json(type_, compiler, **kw):  # noqa: ARG001
    return "JSON"

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app import models
from app.database import Base
from app.routes import chanda as chanda_routes
from app.routes import finance as finance_routes
from app.security import get_current_user


COLLECTOR = {"sub": "1", "name": "Test Collector", "role": "collector",
             "roles": ["collector"], "status": "ACTIVE"}
ADMIN = {"sub": "2", "name": "Test Admin", "role": "admin",
         "roles": ["admin"], "status": "ACTIVE"}


@pytest.fixture
def env():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False)
    db = Session()

    db.add(models.User(id=1, name="Test Collector", phone="9000000001",
                       password="x", role="collector", is_active=True))
    db.add(models.User(id=2, name="Test Admin", phone="9000000002",
                       password="x", role="admin", is_active=True))
    db.add(models.ApprovedHead(id=10, chanda_no="CH-010", name="Rahman",
                               phone="9000000010", monthly_amount=300.0,
                               is_active=True))
    db.commit()

    app = FastAPI()
    # Routers already carry their own /chanda and /finance prefixes.
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


def test_collected_payment_appears_in_finance_timeline(env):
    client, db, current = env

    current["user"] = COLLECTOR
    resp = client.post("/chanda/collect", json={
        "member_id": 10, "amount": 300, "method": "cash",
        "months_list": [datetime.utcnow().strftime("%Y-%m")],
    })
    assert resp.status_code == 200, resp.text
    payment_id = resp.json()["id"]

    # Row really is committed, not just returned.
    assert db.query(models.PaymentEntry).filter_by(id=payment_id).first() is not None

    current["user"] = ADMIN
    tl = client.get("/finance/timeline", params={"page": 1, "per_page": 50})
    assert tl.status_code == 200, tl.text

    entries = tl.json()["entries"]
    chanda = [e for e in entries if e["entry_type"] == "chanda"]
    assert chanda, f"timeline returned no chanda entries: {tl.json()}"
    assert chanda[0]["id"] == payment_id
    assert chanda[0]["amount"] == 300
    assert chanda[0]["head_name"] == "Rahman"
    assert tl.json()["total"] >= 1


def test_newest_collection_sorts_to_the_top(env):
    """A new payment must land on page 1, not behind older rows."""
    client, db, current = env
    current["user"] = COLLECTOR

    # Distinct months: paying the same month twice has nothing left to allocate.
    now = datetime.utcnow()
    months = [f"{now.year + (now.month - 1 + i) // 12}-{(now.month - 1 + i) % 12 + 1:02d}"
              for i in range(3)]

    ids = []
    for i, month in enumerate(months):
        r = client.post("/chanda/collect", json={
            "member_id": 10, "amount": 300, "method": "cash",
            "months_list": [month], "payment_token": f"tok-{i}",
        })
        assert r.status_code == 200, r.text
        ids.append(r.json()["id"])

    current["user"] = ADMIN
    entries = client.get("/finance/timeline", params={"page": 1, "per_page": 50}).json()["entries"]
    chanda_ids = [e["id"] for e in entries if e["entry_type"] == "chanda"]
    assert ids[-1] in chanda_ids, f"newest payment {ids[-1]} missing from page 1: {chanda_ids}"


def test_new_collection_outranks_future_dated_migration_rows(env):
    """
    The Excel migration stamps created_at = the month covered. Importing
    paid-up-to-December while it is August writes rows dated months ahead, and
    a payment collected today then sorted underneath every one of them.
    """
    client, db, current = env

    now = datetime.utcnow()
    # Migration rows: some already past, some dated into the future.
    seeded = []
    for month_offset, tag in ((-2, "past"), (2, "future"), (4, "future")):
        m = now.month - 1 + month_offset
        when = datetime(now.year + m // 12, m % 12 + 1, 1)
        p = models.PaymentEntry(
            head_id=10, amount=300, method="cash",
            created_at=when, collected_at=when, verified_at=when,
            collected_by="migration", created_by="migration", status="verified",
            receipt_id=f"MM-CH-MIG-{month_offset}", purpose="Monthly Chanda",
            months_covered=1, covered_months=[when.strftime("%Y-%m")],
            payment_source="import", receipt_status="historical_import",
        )
        db.add(p)
        seeded.append((tag, when))
    db.commit()

    assert any(t == "future" and w > now for t, w in seeded), "no future row seeded"

    current["user"] = COLLECTOR
    r = client.post("/chanda/collect", json={
        "member_id": 10, "amount": 300, "method": "cash",
        "months_list": [now.strftime("%Y-%m")],
    })
    assert r.status_code == 200, r.text
    todays_id = r.json()["id"]

    current["user"] = ADMIN
    entries = client.get("/finance/timeline", params={"page": 1, "per_page": 50}).json()["entries"]
    chanda = [e for e in entries if e["entry_type"] == "chanda"]

    assert chanda[0]["id"] == todays_id, (
        "today's collection must be the top row, got order: "
        + str([(e["id"], e["created_at"], e["collected_by"]) for e in chanda])
    )

    # Future-dated migration rows sort after everything that has actually
    # happened, including the older past-dated migration row.
    order = [e["created_at"] for e in chanda]
    # Compare against the seeded dates, not a clock read taken before the
    # collection was posted — today's own row is a hair later than that.
    future_iso = [w.isoformat() + "Z" for t, w in seeded if t == "future"]
    past_iso   = [w.isoformat() + "Z" for t, w in seeded if t == "past"]

    assert min(order.index(f) for f in future_iso) > order.index(past_iso[0]), (
        f"future-dated migration rows are not below real activity: {order}"
    )
    assert order.index(past_iso[0]) > 0, f"today's row is not first: {order}"
