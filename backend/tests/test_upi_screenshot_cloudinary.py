"""
UPI/donation payment-proof screenshots submitted through POST /user/pay must
go to Cloudinary only - Render's local filesystem is wiped on every deploy/
restart, which silently orphaned proof_image rows pointing at it. Unlike the
shared /upload/image, /upload/screenshot, /upload/audio endpoints (which keep
falling back to local disk for their other callers - Hadith, Q&A,
Announcements), this endpoint must fail loudly instead of ever writing a
payment record with a screenshot nobody can view again after the next deploy.
"""
import os
import sys
from unittest.mock import patch

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
from app.routes import user_pay
from app.security import get_current_user

MEMBER = {"sub": "1", "name": "Test Member", "role": "member", "roles": ["member"], "status": "ACTIVE"}

# Minimal valid 1x1 JPEG bytes (magic header + tail) for _verify_magic to pass.
_FAKE_JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 50


@pytest.fixture
def env():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False)
    db = Session()

    db.add(models.User(id=1, name="Test Member", phone="9000000001", password="x",
                       role="member", family_id=10, is_active=True))
    db.add(models.ApprovedHead(id=10, chanda_no="CH-010", name="Test Member", phone="9000000001",
                               monthly_amount=100.0, is_active=True, user_id=1))
    db.commit()

    app = FastAPI()
    app.include_router(user_pay.router)

    def _db():
        yield db

    app.dependency_overrides[user_pay.get_db] = _db
    app.dependency_overrides[get_current_user] = lambda: MEMBER

    yield TestClient(app), db
    db.close()


def test_chanda_payment_refused_when_cloudinary_not_configured(env):
    """Must not silently fall back to local disk - and must not create a payment row at all."""
    client, db = env
    with patch.object(user_pay, "_CLOUDINARY_AVAILABLE", False):
        resp = client.post(
            "/user/pay",
            data={"amount": "100", "purpose": "Monthly Chanda"},
            files={"file": ("proof.jpg", _FAKE_JPEG, "image/jpeg")},
        )
    assert resp.status_code == 503, resp.text
    assert db.query(models.PaymentEntry).count() == 0, "no broken payment record with a missing screenshot"


def test_donation_payment_refused_when_cloudinary_not_configured(env):
    client, db = env
    with patch.object(user_pay, "_CLOUDINARY_AVAILABLE", False):
        resp = client.post(
            "/user/pay",
            data={"amount": "50", "purpose": "Donation"},
            files={"file": ("proof.jpg", _FAKE_JPEG, "image/jpeg")},
        )
    assert resp.status_code == 503, resp.text
    assert db.query(models.PaymentEntry).count() == 0


def test_chanda_payment_uses_cloudinary_url_when_available(env):
    client, db = env
    with patch.object(user_pay, "_CLOUDINARY_AVAILABLE", True), \
         patch.object(user_pay, "_upload_to_cloudinary",
                      return_value={"url": "https://res.cloudinary.com/demo/image/upload/v1/masjid/payments/abc123.jpg",
                                    "public_id": "masjid/payments/abc123"}):
        resp = client.post(
            "/user/pay",
            data={"amount": "100", "purpose": "Monthly Chanda"},
            files={"file": ("proof.jpg", _FAKE_JPEG, "image/jpeg")},
        )
    assert resp.status_code == 200, resp.text
    payment_id = resp.json()["payment_id"]
    payment = db.query(models.PaymentEntry).filter_by(id=payment_id).first()
    assert payment.proof_image == "https://res.cloudinary.com/demo/image/upload/v1/masjid/payments/abc123.jpg"
    assert payment.proof_image.startswith("http"), "existing frontends already render any http(s) proof_image as-is"


def test_cloudinary_upload_exception_refuses_cleanly(env):
    """A Cloudinary failure (network blip, quota, bad creds) must be a clear
    error to the client, never a silent local-disk fallback."""
    client, db = env
    with patch.object(user_pay, "_CLOUDINARY_AVAILABLE", True), \
         patch.object(user_pay, "_upload_to_cloudinary", side_effect=RuntimeError("cloudinary down")):
        resp = client.post(
            "/user/pay",
            data={"amount": "100", "purpose": "Monthly Chanda"},
            files={"file": ("proof.jpg", _FAKE_JPEG, "image/jpeg")},
        )
    assert resp.status_code == 502, resp.text
    assert db.query(models.PaymentEntry).count() == 0
