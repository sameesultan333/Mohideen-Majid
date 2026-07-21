import os
import firebase_admin
from firebase_admin import credentials, messaging

_cred_path = os.path.join(os.path.dirname(__file__), "..", "..", "serviceAccountKey.json")
if os.path.exists(_cred_path) and not firebase_admin._apps:
    cred = credentials.Certificate(_cred_path)
    firebase_admin.initialize_app(cred)
else:
    if not firebase_admin._apps:
        import logging as _l; _l.getLogger(__name__).warning("[FCM] service account not found at %s", _cred_path)


def _str_data(data: dict | None) -> dict:
    if not data:
        return {}
    return {k: str(v) for k, v in data.items()}


# ── Silent data push — deliver new prayer times to all devices ───────────────

def send_fcm_prayer_times_update(prayer) -> bool:
    """Send a silent FCM data message with the full prayer timetable to all devices.
    Phones save these times to AsyncStorage so AlarmManager stays correct even
    when the backend is down."""
    try:
        data = {
            "type":             "prayer_times_updated",
            "schedule_version": str(prayer.schedule_version or 1),
            "fajr_adhan":       prayer.fajr_adhan    or "",
            "dhuhr_adhan":   prayer.dhuhr_adhan   or "",
            "asr_adhan":     prayer.asr_adhan     or "",
            "maghrib_adhan": prayer.maghrib_adhan or "",
            "isha_adhan":    prayer.isha_adhan    or "",
            "fajr":          prayer.fajr          or "",
            "dhuhr":         prayer.dhuhr         or "",
            "asr":           prayer.asr           or "",
            "maghrib":       prayer.maghrib       or "",
            "isha":          prayer.isha          or "",
            "jummah":        prayer.jummah        or "",
            "jummah_iqamah": prayer.jummah_iqamah or "",
            "taraweeh":      prayer.taraweeh      or "",
            "sunrise":       prayer.sunrise       or "",
        }
        message = messaging.Message(
            data=data,
            # Data-only (no notification key) so Android never shows a banner.
            # priority="normal" avoids waking the device unnecessarily; the app
            # reads these times on next foreground launch anyway.
            android=messaging.AndroidConfig(priority="normal"),
            # Use a dedicated topic so this silent update is never mixed with
            # the announcements topic that drives visible push notifications.
            topic="prayer_times",
        )
        response = messaging.send(message)
        import logging as _l; _l.getLogger(__name__).info("[FCM] prayer times push sent")
        return True
    except Exception as exc:
        import logging as _l; _l.getLogger(__name__).warning("[FCM] prayer times push failed: %s", exc)
        return False


# ── Prayer data-only push (background handler → showAdhanNow / scheduleIqamah) ─

def send_fcm_prayer_data(
    prayer_key: str,
    prayer_name: str,
    notif_type: str,           # "adhan" or "iqamah"
    iqamah_time: str = "",
    topic: str = "announcements",
) -> bool:
    """Send a DATA-ONLY FCM for adhan/iqamah — no notification key so Android
    never auto-shows a banner. The JS setBackgroundMessageHandler in index.js
    receives this and calls NativeModules.IqamahScheduler.showAdhanNow (for
    the adhan sound) and scheduleIqamah (WorkManager, survives Samsung
    force-stop). Only ONE notification fires per prayer this way."""
    try:
        data = {
            "type":        "prayer_notification",
            "prayer_key":  prayer_key,
            "prayer_name": prayer_name,
            "notif_type":  notif_type,
            "iqamah_time": iqamah_time,
        }
        message = messaging.Message(
            data=_str_data(data),
            # HIGH priority wakes the device immediately (like an alarm).
            # No notification key = Android never auto-shows a banner.
            android=messaging.AndroidConfig(priority="high"),
            topic=topic,
        )
        messaging.send(message)
        import logging as _l; _l.getLogger(__name__).info(
            "[FCM] prayer data push: %s %s", prayer_name, notif_type)
        return True
    except Exception as exc:
        import logging as _l; _l.getLogger(__name__).warning(
            "[FCM] prayer data push failed: %s", exc)
        return False


# ── Prayer notification (topic + Android channel for custom sound) ────────────

def send_fcm_prayer_notification(
    title: str,
    body: str,
    channel_id: str,
    topic: str = "announcements",
    data: dict | None = None,
) -> bool:
    """Send prayer adhan/iqamah notification to a topic with correct Android channel.
    The channel_id determines which custom sound plays (prayer_adhan → adhan.mp3,
    prayer_iqamah → start_prayer.mp3). Works even when the app is force-stopped."""
    try:
        message = messaging.Message(
            notification=messaging.Notification(title=title, body=body),
            data=_str_data(data) if data else {},
            android=messaging.AndroidConfig(
                priority="high",
                notification=messaging.AndroidNotification(
                    channel_id=channel_id,
                    sound="default",
                ),
            ),
            apns=messaging.APNSConfig(
                payload=messaging.APNSPayload(
                    aps=messaging.Aps(sound="default"),
                ),
            ),
            topic=topic,
        )
        response = messaging.send(message)
        import logging as _l; _l.getLogger(__name__).info("[FCM] prayer %s sent", title)
        return True
    except Exception as exc:
        import logging as _l; _l.getLogger(__name__).warning("[FCM] prayer notification failed: %s", exc)
        return False


# ── Topic notification (announcements / role broadcasts) ─────────────────────

def send_fcm_topic_notification(
    title: str,
    body: str,
    topic: str = "announcements",
    data: dict | None = None,
) -> bool:
    try:
        message = messaging.Message(
            notification=messaging.Notification(title=title, body=body),
            data=_str_data(data),
            android=messaging.AndroidConfig(
                priority="high",
                notification=messaging.AndroidNotification(sound="default"),
            ),
            apns=messaging.APNSConfig(
                payload=messaging.APNSPayload(
                    aps=messaging.Aps(sound="default"),
                ),
            ),
            topic=topic,
        )
        response = messaging.send(message)
        import logging as _l; _l.getLogger(__name__).info("[FCM] topic %s sent", topic)
        return True
    except Exception as exc:
        import logging as _l; _l.getLogger(__name__).warning("[FCM] topic send failed: %s", exc)
        return False


# ── Single device token notification ─────────────────────────────────────────

def send_fcm_device_notification(
    token: str,
    title: str,
    body: str,
    data: dict | None = None,
) -> bool:
    try:
        message = messaging.Message(
            notification=messaging.Notification(title=title, body=body),
            data=_str_data(data),
            token=token,
            android=messaging.AndroidConfig(
                priority="high",
                notification=messaging.AndroidNotification(sound="default"),
            ),
            apns=messaging.APNSConfig(
                payload=messaging.APNSPayload(
                    aps=messaging.Aps(sound="default"),
                ),
            ),
        )
        response = messaging.send(message)
        import logging as _l; _l.getLogger(__name__).info("[FCM] device token sent")
        return True
    except messaging.UnregisteredError:
        import logging as _l; _l.getLogger(__name__).info("[FCM] token unregistered: %s", token[:20])
        return False
    except Exception as exc:
        import logging as _l; _l.getLogger(__name__).warning("[FCM] device send failed: %s", exc)
        return False


# ── Notify all active devices for a user ─────────────────────────────────────

def notify_user(db, user_id: int, title: str, body: str, data: dict | None = None) -> int:
    """Send to every active device token for user_id. Returns sent count."""
    from app import models  # lazy import to avoid circular deps

    tokens = (
        db.query(models.DeviceToken)
        .filter_by(user_id=user_id, is_active=True)
        .all()
    )
    sent = 0
    for dt in tokens:
        ok = send_fcm_device_notification(dt.token, title, body, data)
        if not ok and dt.token:
            # Token no longer valid — deactivate it
            dt.is_active = False
            db.commit()
        else:
            sent += 1
    return sent


# ── Notify all users with a given role ───────────────────────────────────────

def notify_role(db, role: str, title: str, body: str, data: dict | None = None) -> int:
    """Broadcast to all active-device users with the given role."""
    from app import models

    users = db.query(models.User).filter_by(role=role, is_active=True).all()
    sent = 0
    for u in users:
        sent += notify_user(db, u.id, title, body, data)
    return sent
