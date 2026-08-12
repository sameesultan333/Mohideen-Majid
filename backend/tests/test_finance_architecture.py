"""
Covers the finance-architecture changes:

  - _cash_flow() date bounds (the ₹5,100 bug: default/today/week/year queries
    used to have no upper bound and picked up every future-dated row).
  - historical/import rows excluded from live cash-flow, weekly/yearly totals,
    recent-payments, and Collector Payout.
  - the "not yet generated month" outstanding figure, which used to be
    hardcoded to 0 regardless of what due/collected actually were.
  - Collector Payout = 15% of eligible live Chanda received that month.
  - the new migration-import path: one PaymentEntry per migrated family, not
    one per covered month.
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


ADMIN = {"sub": "2", "name": "Test Admin", "role": "admin", "roles": ["admin"], "status": "ACTIVE"}
SUPERADMIN = {"sub": "3", "name": "Super", "role": "superadmin", "roles": ["superadmin"], "status": "ACTIVE"}


@pytest.fixture
def env():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False)
    db = Session()

    db.add(models.User(id=2, name="Test Admin", phone="9000000002",
                       password="x", role="admin", is_active=True))
    db.add(models.User(id=3, name="Super", phone="9000000003",
                       password="x", role="superadmin", is_active=True))
    db.add(models.ApprovedHead(id=10, chanda_no="CH-010", name="Rahman",
                               phone="9000000010", monthly_amount=1000.0,
                               is_active=True))
    db.commit()

    app = FastAPI()
    app.include_router(chanda_routes.router)
    app.include_router(finance_routes.router)
    app.include_router(admin_routes.router)

    def _db():
        yield db

    app.dependency_overrides[chanda_routes.get_db] = _db
    app.dependency_overrides[finance_routes.get_db] = _db
    app.dependency_overrides[admin_routes.get_db] = _db

    current = {"user": ADMIN}
    app.dependency_overrides[get_current_user] = lambda: current["user"]

    yield TestClient(app), db, current
    db.close()


_receipt_seq = iter(range(1, 100000))


def _mk_payment(db, *, head_id=10, amount, created_at, payment_source="app",
                 covered_months=None, status="verified", method="cash"):
    p = models.PaymentEntry(
        head_id=head_id, amount=amount, method=method,
        created_at=created_at, collected_at=created_at,
        status=status, created_by="collector", collected_by="Test Collector",
        receipt_id=f"MM-CH-{created_at.strftime('%Y%m%d%H%M%S%f')}-{next(_receipt_seq)}",
        purpose="Monthly Chanda", months_covered=1,
        covered_months=covered_months or [created_at.strftime("%Y-%m")],
        payment_source=payment_source,
        receipt_status="historical_import" if payment_source == "import" else None,
    )
    db.add(p)
    db.commit()
    return p


# ── The ₹5,100 bug: unbounded default-month query ────────────────────────────

def test_default_dashboard_call_does_not_leak_future_months(env):
    """GET /finance/dashboard with NO ?month= must only sum August, not
    everything from August onward. This is the exact bug: 16 August rows
    (₹1,800) plus 29 future-dated import rows (₹3,300) used to sum to ₹5,100
    on the unparameterized call."""
    client, db, current = env

    aug = [
        _mk_payment(db, amount=200, created_at=datetime(2026, 8, 1)),
        _mk_payment(db, amount=100, created_at=datetime(2026, 8, 5)),
    ]
    # Future-dated import fragments — same shape the real migration produces.
    for i, month in enumerate([9, 10, 11, 12], start=1):
        _mk_payment(db, amount=500, created_at=datetime(2026, month, 1),
                    payment_source="import")

    client.get  # noqa
    resp = client.get("/finance/dashboard")  # no month param — the buggy path
    assert resp.status_code == 200, resp.text
    cf = resp.json()["collection_periods"]["this_month"]
    assert cf["cash"] == 300.0, f"leaked future months into default-month cash: {cf}"


def test_explicit_month_still_bounded_correctly(env):
    client, db, current = env
    _mk_payment(db, amount=200, created_at=datetime(2026, 8, 1))
    _mk_payment(db, amount=500, created_at=datetime(2026, 9, 1))

    resp = client.get("/finance/dashboard", params={"month": "2026-08"})
    cf = resp.json()["collection_periods"]["this_month"]
    assert cf["cash"] == 200.0


def test_today_this_week_this_year_are_also_bounded(env):
    """These three were also called with no upper bound previously."""
    client, db, current = env
    now = datetime.utcnow()
    _mk_payment(db, amount=100, created_at=now)
    # A payment dated a year from now must never count as "today"/"this week"/"this year".
    far_future = datetime(now.year + 2, 1, 1)
    _mk_payment(db, amount=99999, created_at=far_future)

    resp = client.get("/finance/dashboard")
    cp = resp.json()["collection_periods"]
    assert cp["today"]["cash"] < 99999
    assert cp["this_week"]["cash"] < 99999
    assert cp["this_year"]["cash"] < 99999


# ── Historical/import exclusion ───────────────────────────────────────────────

def test_import_rows_excluded_from_cash_flow(env):
    client, db, current = env
    _mk_payment(db, amount=1000, created_at=datetime(2026, 8, 1), payment_source="app")
    _mk_payment(db, amount=12000, created_at=datetime(2026, 8, 1), payment_source="import")

    resp = client.get("/finance/dashboard", params={"month": "2026-08"})
    cf = resp.json()["collection_periods"]["this_month"]
    assert cf["cash"] == 1000.0, f"historical import counted as live cash: {cf}"


def test_import_rows_excluded_from_recent_payments(env):
    client, db, current = env
    for i in range(12):
        _mk_payment(db, amount=100, created_at=datetime(2026, 8, i + 1), payment_source="import")
    live = _mk_payment(db, amount=555, created_at=datetime(2026, 8, 20), payment_source="app")

    resp = client.get("/finance/dashboard", params={"month": "2026-08"})
    ids = [p["id"] for p in resp.json()["recent_payments"]]
    assert live.id in ids
    assert all(p["amount"] != 100 for p in resp.json()["recent_payments"])


def test_import_rows_excluded_from_weekly_and_yearly(env):
    client, db, current = env
    current["user"] = ADMIN
    now = datetime.utcnow()
    _mk_payment(db, amount=1000, created_at=now, payment_source="app")
    _mk_payment(db, amount=50000, created_at=now, payment_source="import")

    weekly = client.get("/finance/collections/weekly").json()
    assert sum(d["amount"] for d in weekly) == 1000.0

    yearly = client.get("/finance/collections/yearly", params={"year": now.year}).json()
    assert sum(yearly["months"]) == 1000.0


# ── September "outstanding = 0" bug ───────────────────────────────────────────

def test_ungenerated_month_outstanding_reflects_real_shortfall(env):
    """A month that has not been generated yet must still show a real
    projected outstanding figure when there are real advance collections
    against it, not a hardcoded 0 next to nonzero due/covered numbers."""
    client, db, current = env
    # Advance payment covering a future month gives it one ChandaCollection row.
    from app.utils.payment_ledger import build_coverage_map, apply_coverage_to_collections
    col = models.ChandaCollection(head_id=10, month="2026-09", amount_due=1000.0,
                                   total_paid=200.0, status="pending")
    db.add(col)
    db.commit()

    resp = client.get("/finance/dashboard", params={"month": "2026-09"})
    chanda = resp.json()["chanda"]
    assert chanda["due"] > 0
    assert chanda["collected"] > 0
    assert chanda["outstanding"] == pytest.approx(chanda["due"] - chanda["collected"]), (
        f"outstanding did not reflect due-collected: {chanda}"
    )
    assert chanda["outstanding"] > 0


# ── Collector Payout ───────────────────────────────────────────────────────────

def test_collector_payout_is_15_percent_of_live_chanda(env):
    client, db, current = env
    _mk_payment(db, amount=1000, created_at=datetime(2026, 8, 1), payment_source="app")
    _mk_payment(db, amount=2000, created_at=datetime(2026, 8, 5), payment_source="app")
    _mk_payment(db, amount=12000, created_at=datetime(2026, 8, 10), payment_source="app")
    # Must not affect it.
    _mk_payment(db, amount=99999, created_at=datetime(2026, 8, 1), payment_source="import")

    resp = client.get("/finance/dashboard", params={"month": "2026-08"})
    payout = resp.json()["collector_payout"]
    assert payout["eligible_live_chanda"] == 15000.0
    assert payout["amount"] == pytest.approx(2250.0)


def test_collector_payout_excludes_rejected_and_rollback(env):
    client, db, current = env
    _mk_payment(db, amount=1000, created_at=datetime(2026, 8, 1), payment_source="app")
    rejected = _mk_payment(db, amount=50000, created_at=datetime(2026, 8, 1), payment_source="app")
    rejected.status = "rejected"
    rejected.rollback_status = "approved"
    db.commit()

    resp = client.get("/finance/dashboard", params={"month": "2026-08"})
    payout = resp.json()["collector_payout"]
    assert payout["eligible_live_chanda"] == 1000.0
    assert payout["amount"] == pytest.approx(150.0)


def test_collector_payout_excludes_donations(env):
    """Donations live in a separate table entirely and must never be
    mistaken for Chanda when computing payout."""
    client, db, current = env
    _mk_payment(db, amount=1000, created_at=datetime(2026, 8, 1), payment_source="app")
    db.add(models.Donation(donor_name="X", amount=99999, method="cash",
                           recorded_by="Test Collector",
                           created_at=datetime(2026, 8, 1)))
    db.commit()

    resp = client.get("/finance/dashboard", params={"month": "2026-08"})
    payout = resp.json()["collector_payout"]
    assert payout["eligible_live_chanda"] == 1000.0


# ── New migration import: one PaymentEntry, not one per month ────────────────

def test_migration_import_creates_a_single_payment_entry(env):
    client, db, current = env
    current["user"] = SUPERADMIN

    # 13 months (June 2026 .. June 2027 inclusive) x monthly_amount 1000 = 13000,
    # exactly matching total_paid, so this proves the full-coverage path.
    csv = (
        "chanda_no,name,monthly_amount,total_paid,coverage_start,coverage_end,collection_date\n"
        "CH-900,Migrated Family,1000,13000,2026-06,2027-06,2026-07-15\n"
    )
    resp = client.post(
        "/admin/upload-heads",
        files={"file": ("migration.csv", csv, "text/csv")},
        params={"year": 2026},
    )
    assert resp.status_code == 200, resp.text

    head = db.query(models.ApprovedHead).filter_by(chanda_no="CH-900").first()
    assert head is not None

    payments = db.query(models.PaymentEntry).filter_by(head_id=head.id).all()
    assert len(payments) == 1, f"expected exactly 1 PaymentEntry, got {len(payments)}: {[p.amount for p in payments]}"

    p = payments[0]
    assert p.amount == 13000.0
    assert p.payment_source == "import"
    assert p.receipt_status == "historical_import"
    assert p.covered_months[0] == "2026-06"
    assert p.covered_months[-1] == "2027-06"
    assert len(p.covered_months) == 13  # June 2026 .. June 2027 inclusive
    assert p.collected_at.strftime("%Y-%m-%d") == "2026-07-15"  # mosque-supplied date preserved

    # Coverage established across the whole range.
    cols = {
        c.month: c.status
        for c in db.query(models.ChandaCollection).filter_by(head_id=head.id).all()
    }
    assert cols["2026-06"] == "paid"
    assert cols["2027-06"] == "paid"

    # And it must not leak into live cash-flow for any of the covered months.
    for m in ("2026-06", "2026-08", "2027-01", "2027-06"):
        cf = client.get("/finance/dashboard", params={"month": m}).json()
        cf_cash = cf["collection_periods"]["this_month"]["cash"]
        assert cf_cash == 0.0, f"migration import leaked into live cash for {m}: {cf_cash}"


def test_migration_import_partial_amount_does_not_fabricate_full_coverage(env):
    """total_paid that is short of the range's full dues must leave the
    shortfall genuinely unpaid, not silently mark every stated month as paid
    just because a range was named in the sheet."""
    client, db, current = env
    current["user"] = SUPERADMIN
    csv = (
        "chanda_no,name,monthly_amount,total_paid,coverage_start,coverage_end\n"
        "CH-905,Partial Family,1000,12000,2026-06,2027-06\n"  # 13 months owed, only 12 paid
    )
    resp = client.post(
        "/admin/upload-heads",
        files={"file": ("partial.csv", csv, "text/csv")},
        params={"year": 2026},
    )
    assert resp.status_code == 200, resp.text
    head = db.query(models.ApprovedHead).filter_by(chanda_no="CH-905").first()
    payments = db.query(models.PaymentEntry).filter_by(head_id=head.id).all()
    assert len(payments) == 1
    assert payments[0].amount == 12000.0

    cols = {c.month: c.status for c in db.query(models.ChandaCollection).filter_by(head_id=head.id).all()}
    paid = [m for m, s in cols.items() if s == "paid"]
    assert len(paid) == 12
    assert cols["2027-06"] == "pending"  # the unfunded 13th month stays honestly unpaid


def test_migration_import_rejects_invalid_range(env):
    client, db, current = env
    current["user"] = SUPERADMIN
    csv = (
        "chanda_no,name,monthly_amount,total_paid,coverage_start,coverage_end\n"
        "CH-901,Bad Range,1000,5000,2026-08,2026-01\n"
    )
    resp = client.post(
        "/admin/upload-heads",
        files={"file": ("bad.csv", csv, "text/csv")},
        params={"year": 2026},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert any("coverage_start" in e for e in body["errors"]), body["errors"]
    # Family is still created even though the migration payment was rejected.
    assert db.query(models.ApprovedHead).filter_by(chanda_no="CH-901").first() is not None
    assert db.query(models.PaymentEntry).filter_by(
        head_id=db.query(models.ApprovedHead).filter_by(chanda_no="CH-901").first().id
    ).count() == 0


def test_bare_month_name_columns_are_no_longer_accepted(env):
    """The old month-grid columns (a bare "august" meaning "August of
    whatever `year` was passed") are removed entirely, not kept as a second
    option. That ambiguity is exactly what silently dropped every 2027 month
    for a family imported as "June 2026 - June 2027". A sheet using the old
    header now creates the family (chanda_no/name/monthly_amount still work)
    but produces no payment at all, rather than a payment that might land in
    the wrong year with no way to tell."""
    client, db, current = env
    current["user"] = SUPERADMIN
    csv = "chanda_no,name,monthly_amount,august\nCH-902,Old Style,300,300\n"
    resp = client.post(
        "/admin/upload-heads",
        files={"file": ("old.csv", csv, "text/csv")},
        params={"year": 2026},
    )
    assert resp.status_code == 200, resp.text
    head = db.query(models.ApprovedHead).filter_by(chanda_no="CH-902").first()
    assert head is not None
    payments = db.query(models.PaymentEntry).filter_by(head_id=head.id).all()
    assert len(payments) == 0, f"bare month-name column should be inert now: {payments}"


def test_year_boundary_coverage_range(env):
    """The exact scenario reported: December 2026 -> June 2027 must create
    ALL months as one financial transaction, correctly split across the
    calendar-year boundary with no special-casing."""
    client, db, current = env
    current["user"] = SUPERADMIN
    csv = (
        "chanda_no,name,monthly_amount,total_paid,coverage_start,coverage_end\n"
        "CH-903,Year Crosser,200,1400,2026-12,2027-06\n"  # Dec..Jun = 7 months x 200
    )
    resp = client.post(
        "/admin/upload-heads",
        files={"file": ("cross.csv", csv, "text/csv")},
        params={"year": 2026},
    )
    assert resp.status_code == 200, resp.text
    head = db.query(models.ApprovedHead).filter_by(chanda_no="CH-903").first()
    payments = db.query(models.PaymentEntry).filter_by(head_id=head.id).all()
    assert len(payments) == 1
    assert payments[0].covered_months == [
        "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06",
    ]
    cols = {c.month: c.status for c in db.query(models.ChandaCollection).filter_by(head_id=head.id).all()}
    for m in payments[0].covered_months:
        assert cols[m] == "paid", f"{m} not marked paid: {cols}"

    # And none of it is live cash in any of those months.
    for m in ("2026-12", "2027-01", "2027-06"):
        cf = client.get("/finance/dashboard", params={"month": m}).json()
        assert cf["collection_periods"]["this_month"]["cash"] == 0.0
        assert cf["collector_payout"]["amount"] == 0.0


# ── street filter: /chanda/members must carry street ─────────────────────────

def test_head_out_schema_includes_street(env):
    """MemberWithCollection.member (HeadOut) used to omit `street` entirely,
    so GET /chanda/members - which serializes through this exact schema -
    always sent street: undefined to the client. The collector app's street
    filter reads m.member.street to decide who matches the selected street,
    so with the field always undefined, no member could ever match: picking
    any street from the dropdown (correctly populated by a separate
    /admin/streets query) silently filtered out everyone.

    get_members() itself uses a Postgres-only DISTINCT ON / = ANY() raw
    query that SQLite cannot run, so this is verified at the schema layer
    directly rather than through the endpoint."""
    from app import schemas

    client, db, current = env
    head = db.query(models.ApprovedHead).filter_by(id=10).first()
    head.street = "Gandhi Street"
    db.commit()
    db.refresh(head)

    out = schemas.HeadOut.model_validate(head)
    assert out.street == "Gandhi Street", (
        f"HeadOut dropped street entirely: {out.model_dump()}"
    )


# ── Year-qualified month-header importer ──────────────────────────────────────

def test_year_qualified_headers_create_exact_per_month_amounts(env):
    """The critical case: Chanda No. 1017-style family, January 2026 through
    June 2027, each month with its own amount from the sheet — not an even
    split, not derived from monthly_amount x months."""
    client, db, current = env
    current["user"] = SUPERADMIN

    cols = ["chanda_no", "name", "monthly_amount",
            "January 2026", "February 2026", "March 2026", "April 2026",
            "May 2026", "June 2026", "July 2026", "August 2026",
            "September 2026", "October 2026", "November 2026", "December 2026",
            "January 2027", "February 2027", "March 2027", "April 2027",
            "May 2027", "June 2027"]
    # March 2026 deliberately 0, everything else 200 — proves amounts are
    # preserved exactly, not assumed uniform.
    vals = ["T-1017", "S. Seyad Naseer", "200",
            "200", "200", "0", "200", "200", "200", "200", "200",
            "200", "200", "200", "200",
            "200", "200", "200", "200", "200", "200"]
    csv = ",".join(cols) + "\n" + ",".join(vals) + "\n"

    resp = client.post("/admin/upload-heads", files={"file": ("y.csv", csv, "text/csv")},
                        params={"year": 2026})
    assert resp.status_code == 200, resp.text
    body = resp.json()

    head = db.query(models.ApprovedHead).filter_by(chanda_no="T-1017").first()
    assert head is not None

    payments = db.query(models.PaymentEntry).filter_by(head_id=head.id).all()
    assert len(payments) == 1, f"expected exactly 1 PaymentEntry, got {len(payments)}"
    p = payments[0]

    expected_months = [f"2026-{m:02d}" for m in range(1, 13) if m != 3] + [f"2027-{m:02d}" for m in range(1, 7)]
    assert sorted(p.covered_months) == sorted(expected_months), p.covered_months
    assert "2026-03" not in p.covered_months, "0-amount month must not be covered"
    assert p.amount == 200.0 * 17  # 18 months minus the one ₹0 month
    assert p.coverage_map["2026-01"] == 200.0
    assert p.coverage_map.get("2026-03") is None

    # January-June 2027 specifically present and paid.
    cols27 = {c.month: c.status for c in db.query(models.ChandaCollection)
              .filter(models.ChandaCollection.head_id == head.id,
                      models.ChandaCollection.month.like("2027-%")).all()}
    for m in ("2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06"):
        assert cols27.get(m) == "paid", f"{m} missing or not paid: {cols27}"

    # March 2026 stays pending — 0 must not fabricate a paid month.
    mar = db.query(models.ChandaCollection).filter_by(head_id=head.id, month="2026-03").first()
    assert mar is not None and mar.status == "pending"

    # Report reflects it.
    cov = body["coverage_import"]
    assert cov["families_with_coverage"] == 1
    assert cov["coverage_records_created"] == 17
    assert cov["by_month"]["2027-06"] == 1


def test_reimporting_same_file_does_not_double_count(env):
    """Idempotency: running the identical file twice must not add a second
    PaymentEntry or double the total_paid on any month."""
    client, db, current = env
    current["user"] = SUPERADMIN
    csv = ("chanda_no,name,monthly_amount,January 2026,February 2026\n"
           "T-500,Repeat Family,300,300,300\n")

    r1 = client.post("/admin/upload-heads", files={"file": ("a.csv", csv, "text/csv")}, params={"year": 2026})
    assert r1.status_code == 200, r1.text
    head = db.query(models.ApprovedHead).filter_by(chanda_no="T-500").first()

    r2 = client.post("/admin/upload-heads", files={"file": ("b.csv", csv, "text/csv")}, params={"year": 2026})
    assert r2.status_code == 200, r2.text

    payments = db.query(models.PaymentEntry).filter_by(head_id=head.id).all()
    assert len(payments) == 1, f"re-import created a duplicate payment: {len(payments)}"

    col = db.query(models.ChandaCollection).filter_by(head_id=head.id, month="2026-01").first()
    assert col.total_paid == 300.0, f"total_paid doubled on re-import: {col.total_paid}"

    assert r2.json()["coverage_import"]["skipped_already_paid"] == 2


def test_partial_reimport_only_adds_new_months(env):
    """A file re-imported after a month was already paid, with a NEW month
    added, must only create the new month - not touch the old one again."""
    client, db, current = env
    current["user"] = SUPERADMIN
    csv1 = "chanda_no,name,monthly_amount,January 2026\nT-600,Grower,100,100\n"
    r1 = client.post("/admin/upload-heads", files={"file": ("a.csv", csv1, "text/csv")}, params={"year": 2026})
    assert r1.status_code == 200, r1.text
    head = db.query(models.ApprovedHead).filter_by(chanda_no="T-600").first()

    csv2 = "chanda_no,name,monthly_amount,January 2026,February 2026\nT-600,Grower,100,100,100\n"
    r2 = client.post("/admin/upload-heads", files={"file": ("b.csv", csv2, "text/csv")}, params={"year": 2026})
    assert r2.status_code == 200, r2.text

    payments = db.query(models.PaymentEntry).filter_by(head_id=head.id).order_by(models.PaymentEntry.id).all()
    assert len(payments) == 2, "the new month should create a second, separate payment entry"
    assert payments[1].covered_months == ["2026-02"]
    assert payments[1].amount == 100.0

    jan = db.query(models.ChandaCollection).filter_by(head_id=head.id, month="2026-01").first()
    assert jan.total_paid == 100.0, "January must not be double-counted on the second import"


def test_bare_month_name_without_year_is_reported_not_guessed(env):
    client, db, current = env
    current["user"] = SUPERADMIN
    csv = "chanda_no,name,monthly_amount,January\nT-700,No Year,100,100\n"
    resp = client.post("/admin/upload-heads", files={"file": ("c.csv", csv, "text/csv")}, params={"year": 2026})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["coverage_import"]["ignored_month_columns_no_year"] == ["january"]
    assert any("January" in e for e in body["errors"])
    head = db.query(models.ApprovedHead).filter_by(chanda_no="T-700").first()
    assert db.query(models.PaymentEntry).filter_by(head_id=head.id).count() == 0


def test_year_qualified_does_not_leak_into_live_cash_or_payout(env):
    client, db, current = env
    current["user"] = SUPERADMIN
    csv = "chanda_no,name,monthly_amount,August 2026\nT-800,Historical,500,5000\n"
    resp = client.post("/admin/upload-heads", files={"file": ("d.csv", csv, "text/csv")}, params={"year": 2026})
    assert resp.status_code == 200, resp.text

    d = client.get("/finance/dashboard", params={"month": "2026-08"}).json()
    assert d["collection_periods"]["this_month"]["cash"] == 0.0
    assert d["collector_payout"]["amount"] == 0.0
