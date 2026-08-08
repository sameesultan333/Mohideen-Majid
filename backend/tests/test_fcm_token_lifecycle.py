"""A transient FCM failure must never deactivate a device token.

Regression: notify_user() deactivated a token whenever the send returned falsy,
but the send returned False for ANY exception - network blip, FCM 5xx, quota,
timeout. One transient failure permanently silenced that device, so devices
dropped off the notification pipeline over time and never recovered.
"""

import os
import sys
import types

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app import models
from app.utils import fcm


def _db():
    engine = create_engine("sqlite:///:memory:")
    models.Base.metadata.create_all(engine, tables=[models.DeviceToken.__table__])
    db = sessionmaker(bind=engine)()
    db.add(models.DeviceToken(user_id=1, token="tok-abc", platform="android", is_active=True))
    db.commit()
    return db


def _patch_send(monkeypatch, result):
    monkeypatch.setattr(fcm, "send_fcm_device_notification",
                        lambda token, title, body, data=None: result)


def _token(db):
    return db.query(models.DeviceToken).filter_by(token="tok-abc").one()


def test_transient_failure_keeps_token_active(monkeypatch):
    db = _db()
    try:
        _patch_send(monkeypatch, fcm.SEND_RETRY)
        sent = fcm.notify_user(db, 1, "t", "b")
        assert sent == 0
        # The device must still be reachable next time.
        assert _token(db).is_active is True
    finally:
        db.close()


def test_unregistered_token_is_deactivated(monkeypatch):
    db = _db()
    try:
        _patch_send(monkeypatch, fcm.SEND_TOKEN_DEAD)
        sent = fcm.notify_user(db, 1, "t", "b")
        assert sent == 0
        assert _token(db).is_active is False
    finally:
        db.close()


def test_successful_send_keeps_token_and_counts(monkeypatch):
    db = _db()
    try:
        _patch_send(monkeypatch, fcm.SEND_OK)
        assert fcm.notify_user(db, 1, "t", "b") == 1
        assert _token(db).is_active is True
    finally:
        db.close()


def test_send_classifies_unregistered_as_dead(monkeypatch):
    """messaging.UnregisteredError -> dead; any other exception -> retry."""
    class FakeUnregistered(Exception):
        pass

    fake = types.SimpleNamespace(
        Message=lambda **kw: object(),
        Notification=lambda **kw: object(),
        AndroidConfig=lambda **kw: object(),
        AndroidNotification=lambda **kw: object(),
        APNSConfig=lambda **kw: object(),
        APNSPayload=lambda **kw: object(),
        Aps=lambda **kw: object(),
        UnregisteredError=FakeUnregistered,
    )

    fake.send = lambda m: (_ for _ in ()).throw(FakeUnregistered("gone"))
    monkeypatch.setattr(fcm, "messaging", fake)
    assert fcm.send_fcm_device_notification("t", "a", "b") == fcm.SEND_TOKEN_DEAD

    fake.send = lambda m: (_ for _ in ()).throw(ConnectionError("network down"))
    monkeypatch.setattr(fcm, "messaging", fake)
    assert fcm.send_fcm_device_notification("t", "a", "b") == fcm.SEND_RETRY
