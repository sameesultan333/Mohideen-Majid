"""
Covers the identity/role architecture fixes:

  - Staff Management no longer hides a staff member the moment they're also
    linked to a Chanda Head (the actual cause of "one person, two identities"
    - the old list_staff filtered out anyone with family_id set at all).
  - assign_family now links both directions (User.family_id AND
    ApprovedHead.user_id) and adds the "head" role without touching existing
    staff roles, with explicit collision guards instead of silent merging.
  - "Remove from committee" removes only the staff role, keeping the
    account, login, family_id and payment history intact - distinct from
    Delete and Disable.
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
from app.routes import user as user_routes
from app.security import get_current_user


SUPERADMIN = {"sub": "1", "name": "Super", "role": "superadmin", "roles": ["superadmin"], "status": "ACTIVE"}


@pytest.fixture
def env():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False)
    db = Session()

    db.add(models.User(id=1, name="Super", phone="9000000001",
                       password="x", role="superadmin", is_active=True))
    db.add(models.User(id=2, name="Aslam (Admin)", phone="9000000002",
                       password="x", role="admin", is_active=True))
    db.add(models.ApprovedHead(id=10, chanda_no="CH-010", name="Aslam",
                               phone="9000000002", monthly_amount=200.0, is_active=True))
    db.commit()

    app = FastAPI()
    app.include_router(staff_routes.router)
    app.include_router(user_routes.router)

    def _db():
        yield db

    app.dependency_overrides[staff_routes.get_db] = _db
    app.dependency_overrides[user_routes.get_db] = _db

    current = {"user": SUPERADMIN}
    app.dependency_overrides[get_current_user] = lambda: current["user"]

    yield TestClient(app), db, current
    db.close()


# ── item 2: staff must not disappear once linked to a Chanda Head ────────────

def test_staff_list_still_shows_member_after_linking_to_head(env):
    client, db, current = env
    before = client.get("/admin/staff/").json()
    assert any(s["id"] == 2 for s in before), "admin not in staff list before linking"

    client.patch("/users/2/assign-family", json={"head_id": 10})

    after = client.get("/admin/staff/").json()
    match = next((s for s in after if s["id"] == 2), None)
    assert match is not None, "staff member vanished from the list after gaining a family_id - the exact bug"
    assert match["family_id"] == 10
    assert match["chanda_no"] == "CH-010"
    assert "head" in match["roles"]
    assert "admin" in match["roles"]
    assert match["role"] == "admin"  # primary role untouched


# ── item 2/3: assign_family links both directions, keeps existing roles ──────

def test_assign_family_links_both_directions(env):
    client, db, current = env
    resp = client.patch("/users/2/assign-family", json={"head_id": 10})
    assert resp.status_code == 200, resp.text

    u = db.query(models.User).filter_by(id=2).first()
    head = db.query(models.ApprovedHead).filter_by(id=10).first()
    assert u.family_id == 10
    assert head.user_id == 2
    assert head.is_registered is True
    assert u.role == "admin", "admin role must survive becoming a Chanda Head"

    role_rows = {r.role for r in db.query(models.UserRoleEntry).filter_by(user_id=2).all()}
    assert "head" in role_rows


def test_dismiss_family_flag_clears_head_phone_without_touching_family_id(env):
    """Some 'not linked to a family' flags are just staff who left the
    committee and were never meant to be a Chanda payer - forcing a pick
    from the existing-heads dropdown would create a false link. Dismissing
    must only clear head_phone, leaving role/family_id/everything else."""
    client, db, current = env
    db.add(models.User(id=5, name="Ex Staff No Family", phone="9000000005",
                       password="x", role="member", head_phone="9000000005", is_active=True))
    db.commit()

    resp = client.patch("/users/5/dismiss-family-flag")
    assert resp.status_code == 200, resp.text

    u = db.query(models.User).filter_by(id=5).first()
    assert u.head_phone is None
    assert u.family_id is None
    assert u.role == "member"


def test_assign_family_promotes_plain_member_to_head(env):
    """A staff member removed from the committee with no other relationship
    falls back to the neutral "member" placeholder. Linking them to a Chanda
    Head afterward (the "Fix" flow on the Users page) must promote the
    primary role to "head" - "member" carries no real privilege, so leaving
    it in place after the link is what made the account look like it was
    still "just a member" everywhere except the detail view."""
    client, db, current = env
    db.add(models.User(id=4, name="Ex Staff", phone="9000000004",
                       password="x", role="member", is_active=True))
    db.commit()

    resp = client.patch("/users/4/assign-family", json={"head_id": 10})
    assert resp.status_code == 200, resp.text

    u = db.query(models.User).filter_by(id=4).first()
    assert u.role == "head"

    listing = client.get("/admin/staff/").json()
    assert not any(s["id"] == 4 for s in listing)


def test_assign_family_refuses_to_relink_a_claimed_head(env):
    client, db, current = env
    db.add(models.User(id=3, name="Other Person", phone="9000000003",
                       password="x", role="member", is_active=True))
    db.commit()

    r1 = client.patch("/users/2/assign-family", json={"head_id": 10})
    assert r1.status_code == 200

    r2 = client.patch("/users/3/assign-family", json={"head_id": 10})
    assert r2.status_code == 400, "must refuse rather than silently reassign an already-claimed head"

    head = db.query(models.ApprovedHead).filter_by(id=10).first()
    assert head.user_id == 2, "original link must be untouched after the refused second attempt"


def test_assign_family_refuses_to_relink_a_user_already_in_a_family(env):
    client, db, current = env
    db.add(models.ApprovedHead(id=11, chanda_no="CH-011", name="Other Family",
                               phone="9000000099", monthly_amount=100.0, is_active=True))
    db.commit()

    r1 = client.patch("/users/2/assign-family", json={"head_id": 10})
    assert r1.status_code == 200
    r2 = client.patch("/users/2/assign-family", json={"head_id": 11})
    assert r2.status_code == 400

    u = db.query(models.User).filter_by(id=2).first()
    assert u.family_id == 10, "must not have silently moved to the second family"


# ── item 4: removing staff role keeps the account, login, and head link ──────

def test_remove_staff_role_keeps_account_and_head_link(env):
    client, db, current = env
    client.patch("/users/2/assign-family", json={"head_id": 10})

    resp = client.patch("/admin/staff/2/remove-role")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["removed_role"] == "admin"
    assert body["new_role"] == "head"

    u = db.query(models.User).filter_by(id=2).first()
    assert u is not None, "account must still exist"
    assert u.password == "x", "login/password must be untouched"
    assert u.family_id == 10, "Chanda Head link must survive leaving the committee"
    assert u.is_active is True, "must not be disabled"
    assert u.role == "head"

    role_rows = {r.role for r in db.query(models.UserRoleEntry).filter_by(user_id=2).all()}
    assert "admin" not in role_rows
    assert "head" in role_rows

    # No longer staff by role, so correctly drops off the staff list -
    # they are now an ordinary Chanda Head, not deleted.
    staff_list = client.get("/admin/staff/").json()
    assert not any(s["id"] == 2 for s in staff_list)


def test_remove_staff_role_falls_back_to_member_when_nothing_else_remains(env):
    """A staff member with no family_id and no other role simply becomes an
    ordinary mosque-app member - not refused, not deleted, not disabled."""
    client, db, current = env
    resp = client.patch("/admin/staff/2/remove-role")
    assert resp.status_code == 200, resp.text
    assert resp.json()["new_role"] == "member"

    u = db.query(models.User).filter_by(id=2).first()
    assert u.role == "member"
    assert u.is_active is True
    assert u.password == "x", "login must still work"


def test_remove_staff_role_picks_next_highest_role_when_multiple_remain(env):
    client, db, current = env
    db.add(models.UserRoleEntry(user_id=2, role="collector"))
    db.commit()

    resp = client.patch("/admin/staff/2/remove-role")
    assert resp.status_code == 200, resp.text
    assert resp.json()["new_role"] == "collector"
