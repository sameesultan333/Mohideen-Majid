"""
The staff status-toggle endpoint has no staff-role restriction at the DB
query level - it works on any User row. This is what the Users page now
reuses to let a superadmin disable an ordinary "member" account (e.g. one
that just left the committee via remove-role and has no Chanda Head link),
since delete refuses whenever the account has linked payments/questions/etc.
and previously there was no way to lock such an account out at all.
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

SUPERADMIN = {"sub": "1", "name": "Super", "role": "superadmin", "roles": ["superadmin"], "status": "ACTIVE"}


@pytest.fixture
def env():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False)
    db = Session()

    db.add(models.User(id=1, name="Super", phone="9000000001", password="x", role="superadmin", is_active=True))
    db.add(models.User(id=2, name="Ordinary Member", phone="9000000002", password="x", role="member", is_active=True))
    db.commit()

    app = FastAPI()
    app.include_router(staff_routes.router)

    def _db():
        yield db

    app.dependency_overrides[staff_routes.get_db] = _db
    app.dependency_overrides[get_current_user] = lambda: SUPERADMIN

    yield TestClient(app), db
    db.close()


def test_plain_member_account_can_be_disabled_and_reenabled(env):
    client, db = env

    r1 = client.patch("/admin/staff/2/status")
    assert r1.status_code == 200, r1.text
    u = db.query(models.User).filter_by(id=2).first()
    assert u.is_active is False

    r2 = client.patch("/admin/staff/2/status")
    assert r2.status_code == 200, r2.text
    db.refresh(u)
    assert u.is_active is True
