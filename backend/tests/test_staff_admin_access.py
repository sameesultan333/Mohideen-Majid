"""
Admin (not just superadmin) can list and create staff accounts. Safe to open
up: schemas.STAFF_ROLE_VALUES excludes "superadmin" entirely, so this can
never be used by an admin to mint a superadmin account or self-escalate.
"""
import os
import sys

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
from app.routes import staff as staff_routes
from app.security import get_current_user

ADMIN = {"sub": "1", "name": "Test Admin", "role": "admin", "roles": ["admin"], "status": "ACTIVE"}


@pytest.fixture
def env():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False)
    db = Session()

    db.add(models.User(id=1, name="Test Admin", phone="9000000001", password="x", role="admin", is_active=True))
    db.add(models.User(id=2, name="Test Superadmin", phone="9000000002", password="x", role="superadmin", is_active=True))
    db.add(models.User(id=3, name="Existing Collector", phone="9000000003", password="x", role="collector", is_active=True))
    db.commit()

    app = FastAPI()
    app.include_router(staff_routes.router)

    def _db():
        yield db

    app.dependency_overrides[staff_routes.get_db] = _db
    app.dependency_overrides[get_current_user] = lambda: ADMIN

    yield TestClient(app), db
    db.close()


def test_admin_can_create_staff(env):
    client, db = env
    resp = client.post("/admin/staff/", json={"name": "New Collector", "phone": "9876543210", "role": "collector"})
    assert resp.status_code == 201, resp.text
    assert resp.json()["role"] == "collector"

    staff = db.query(models.User).filter_by(phone="9876543210").first()
    assert staff is not None and staff.role == "collector"


def test_admin_can_list_staff(env):
    client, db = env
    resp = client.get("/admin/staff/")
    assert resp.status_code == 200, resp.text


def test_admin_cannot_create_a_superadmin_via_this_endpoint(env):
    client, db = env
    resp = client.post("/admin/staff/", json={"name": "Sneaky", "phone": "9876543211", "role": "superadmin"})
    assert resp.status_code == 422, "superadmin is not a valid StaffCreate.role value"
    assert db.query(models.User).filter_by(phone="9876543211").first() is None


def test_admin_can_edit_staff(env):
    client, db = env
    resp = client.put("/admin/staff/3", json={"name": "Renamed Collector"})
    assert resp.status_code == 200, resp.text
    db.refresh(db.query(models.User).filter_by(id=3).first())
    assert db.query(models.User).filter_by(id=3).first().name == "Renamed Collector"


def test_admin_can_disable_and_enable_staff(env):
    client, db = env
    resp = client.patch("/admin/staff/3/status")
    assert resp.status_code == 200, resp.text
    assert db.query(models.User).filter_by(id=3).first().is_active is False

    resp2 = client.patch("/admin/staff/3/status")
    assert resp2.status_code == 200, resp2.text
    assert db.query(models.User).filter_by(id=3).first().is_active is True


def test_admin_can_delete_staff(env):
    client, db = env
    resp = client.delete("/admin/staff/3")
    assert resp.status_code == 200, resp.text
    assert db.query(models.User).filter_by(id=3).first() is None


def test_admin_cannot_edit_a_superadmin_account(env):
    client, db = env
    resp = client.put("/admin/staff/2", json={"name": "Hijacked"})
    assert resp.status_code == 403, resp.text
    assert db.query(models.User).filter_by(id=2).first().name == "Test Superadmin"


def test_admin_cannot_disable_a_superadmin_account(env):
    client, db = env
    resp = client.patch("/admin/staff/2/status")
    assert resp.status_code == 403, resp.text
    assert db.query(models.User).filter_by(id=2).first().is_active is True


def test_admin_cannot_delete_a_superadmin_account(env):
    client, db = env
    resp = client.delete("/admin/staff/2")
    assert resp.status_code == 403, resp.text
    assert db.query(models.User).filter_by(id=2).first() is not None


def test_admin_can_remove_staff_from_committee(env):
    client, db = env
    resp = client.patch("/admin/staff/3/remove-role")
    assert resp.status_code == 200, resp.text
    staff = db.query(models.User).filter_by(id=3).first()
    assert staff is not None, "account must still exist"
    assert staff.role == "member"


def test_admin_cannot_remove_a_superadmin_from_committee(env):
    client, db = env
    resp = client.patch("/admin/staff/2/remove-role")
    assert resp.status_code == 403, resp.text
    assert db.query(models.User).filter_by(id=2).first().role == "superadmin"
