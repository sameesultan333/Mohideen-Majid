"""
AdminActivity — persistent "an admin should know this happened" log for
families added directly (Collector/Admin) and users/families deactivated.
Deliberately separate from the self-registration approval flow
(User.status == PENDING_APPROVAL), which is untouched by any of this.
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
from app.models import UserStatus
from app.routes import admin as admin_routes
from app.routes import collector as collector_routes
from app.routes import staff as staff_routes
from app.routes import finance as finance_routes
from app.security import get_current_user


ADMIN = {"sub": "1", "name": "Test Admin", "role": "admin", "roles": ["admin"], "status": "ACTIVE"}
SUPERADMIN = {"sub": "1", "name": "Test Admin", "role": "superadmin", "roles": ["superadmin"], "status": "ACTIVE"}
COLLECTOR = {"sub": "2", "name": "Test Collector", "role": "collector", "roles": ["collector"], "status": "ACTIVE"}


@pytest.fixture
def env():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False)
    db = Session()

    db.add(models.User(id=1, name="Test Admin", phone="9000000001", password="x", role="admin", is_active=True))
    db.add(models.User(id=2, name="Test Collector", phone="9000000002", password="x", role="collector", is_active=True))
    db.add(models.User(id=3, name="Plain Member", phone="9000000003", password="x", role="member", is_active=True))
    db.commit()

    app = FastAPI()
    app.include_router(admin_routes.router)
    app.include_router(collector_routes.router)
    app.include_router(staff_routes.router)
    app.include_router(finance_routes.router)

    def _db():
        yield db

    for r in (admin_routes, collector_routes, staff_routes, finance_routes):
        app.dependency_overrides[r.get_db] = _db

    current = {"user": ADMIN}
    app.dependency_overrides[get_current_user] = lambda: current["user"]

    yield TestClient(app), db, current
    db.close()


# ── Family added ─────────────────────────────────────────────────────────────

def test_admin_adding_family_creates_activity(env):
    client, db, current = env
    current["user"] = ADMIN

    resp = client.post("/admin/families", json={"name": "New Family", "phone": "9876543210", "monthly_amount": 300})
    assert resp.status_code == 201, resp.text
    head_id = resp.json()["id"]

    a = db.query(models.AdminActivity).filter_by(head_id=head_id, activity_type="family_added").first()
    assert a is not None
    assert a.acknowledged is False
    assert a.performed_by_role == "admin"
    assert a.performed_by_name == "Test Admin"


def test_collector_adding_family_creates_activity(env):
    client, db, current = env
    current["user"] = COLLECTOR

    resp = client.post("/collector/families", json={"name": "Collector Family", "phone": "9876543211", "monthly_amount": 250})
    assert resp.status_code == 200, resp.text
    head_id = resp.json()["family"]["id"]

    a = db.query(models.AdminActivity).filter_by(head_id=head_id, activity_type="family_added").first()
    assert a is not None
    assert a.performed_by_role == "collector"
    assert a.performed_by_name == "Test Collector"


def test_family_is_immediately_active_no_approval_needed(env):
    client, db, current = env
    current["user"] = ADMIN
    resp = client.post("/admin/families", json={"name": "Active Family", "phone": "9876543212", "monthly_amount": 300})
    head_id = resp.json()["id"]
    head = db.query(models.ApprovedHead).filter_by(id=head_id).first()
    assert head.is_active is True
    assert db.query(models.User).filter_by(phone="9876543212").first() is None


def test_duplicate_activity_not_created_for_same_head(env):
    client, db, current = env
    current["user"] = ADMIN
    resp = client.post("/admin/families", json={"name": "No Dup Family", "phone": "9876543215", "monthly_amount": 300})
    head_id = resp.json()["id"]
    head = db.query(models.ApprovedHead).filter_by(id=head_id).first()

    from app.routes.admin import _create_admin_activity
    _create_admin_activity(db, "family_added", ADMIN, head=head, role_label="admin")
    db.commit()

    rows = db.query(models.AdminActivity).filter_by(head_id=head_id, activity_type="family_added").all()
    assert len(rows) == 1


# ── User / family deactivated ─────────────────────────────────────────────────

def test_family_deactivation_creates_activity(env):
    client, db, current = env
    current["user"] = ADMIN
    resp = client.post("/admin/families", json={"name": "To Deactivate", "phone": "9876543220", "monthly_amount": 300})
    head_id = resp.json()["id"]

    from app.security import hash_password
    admin_user = db.query(models.User).filter_by(id=1).first()
    admin_user.password = hash_password("secret123")
    db.commit()

    resp = client.patch(f"/admin/families/{head_id}/deactivate", json={"password": "secret123", "reason": "Moved away"})
    assert resp.status_code == 200, resp.text

    a = db.query(models.AdminActivity).filter_by(head_id=head_id, activity_type="user_deactivated").first()
    assert a is not None
    assert a.reason == "Moved away"

    head = db.query(models.ApprovedHead).filter_by(id=head_id).first()
    assert head.is_active is False  # actual deactivation state untouched by acknowledgement (checked below)


def test_staff_disable_creates_activity_only_on_disabling_transition(env):
    client, db, current = env
    current["user"] = SUPERADMIN

    r1 = client.patch("/admin/staff/3/status")  # member -> disabled
    assert r1.status_code == 200, r1.text
    activities = db.query(models.AdminActivity).filter_by(user_id=3, activity_type="user_deactivated").all()
    assert len(activities) == 1

    r2 = client.patch("/admin/staff/3/status")  # disabled -> re-enabled: must NOT create another activity
    assert r2.status_code == 200, r2.text
    activities_after = db.query(models.AdminActivity).filter_by(user_id=3, activity_type="user_deactivated").all()
    assert len(activities_after) == 1


# ── Acknowledgement ────────────────────────────────────────────────────────────

def test_acknowledge_records_admin_and_removes_from_pending_list(env):
    client, db, current = env
    current["user"] = ADMIN
    resp = client.post("/admin/families", json={"name": "To Ack", "phone": "9876543213", "monthly_amount": 300})
    head_id = resp.json()["id"]
    activity_id = db.query(models.AdminActivity).filter_by(head_id=head_id).first().id

    pending_before = client.get("/admin/activity").json()
    assert any(a["id"] == activity_id for a in pending_before)

    notif_before = client.get("/finance/notifications").json()
    assert any(n.get("activity_id") == activity_id for n in notif_before)

    r = client.post(f"/admin/activity/{activity_id}/acknowledge")
    assert r.status_code == 200, r.text
    assert r.json()["acknowledged"] is True
    assert r.json()["acknowledged_by_name"] == "Test Admin"

    pending_after = client.get("/admin/activity").json()
    assert not any(a["id"] == activity_id for a in pending_after)

    notif_after = client.get("/finance/notifications").json()
    assert not any(n.get("activity_id") == activity_id for n in notif_after)

    # Acknowledging never touches the family itself.
    head = db.query(models.ApprovedHead).filter_by(id=head_id).first()
    assert head is not None and head.is_active is True


def test_acknowledged_activity_shows_who_in_acknowledged_filter(env):
    client, db, current = env
    current["user"] = COLLECTOR
    resp = client.post("/collector/families", json={"name": "Ack Filter Family", "phone": "9876543214", "monthly_amount": 300})
    head_id = resp.json()["family"]["id"]
    activity_id = db.query(models.AdminActivity).filter_by(head_id=head_id).first().id

    current["user"] = SUPERADMIN
    client.post(f"/admin/activity/{activity_id}/acknowledge")

    acknowledged = client.get("/admin/activity", params={"status": "acknowledged"}).json()
    match = next((a for a in acknowledged if a["id"] == activity_id), None)
    assert match is not None
    assert match["acknowledged_by_name"] == "Test Admin"
    assert match["status"] == "acknowledged"


# ── Existing registration flow untouched ───────────────────────────────────────

def test_existing_pending_registration_flow_is_untouched(env):
    client, db, current = env
    current["user"] = ADMIN

    db.add(models.User(
        id=4, name="Self Registered", phone="9876543299", password="x",
        role="head", status=UserStatus.PENDING_APPROVAL, is_active=True,
        registered_at=datetime.utcnow(),
    ))
    db.commit()

    resp = client.post("/admin/families", json={"name": "Direct Family", "phone": "9876543216", "monthly_amount": 300})
    assert resp.status_code == 201, resp.text

    pending_regs = client.get("/admin/pending-registrations").json()
    names = [u["name"] for u in pending_regs]
    assert "Self Registered" in names
    assert "Direct Family" not in names

    # And registration events never land in AdminActivity either.
    activity_types = {a.activity_type for a in db.query(models.AdminActivity).all()}
    assert "registration_pending" not in activity_types
