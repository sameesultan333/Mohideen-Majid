# backend/app/scheduler.py
"""
APScheduler background jobs for Mohideen Masjid.

Jobs:
  - Every minute   → FCM prayer notifications at adhan/iqamah times
  - 1st    00:05   → auto-generate chanda month for all active families
  - Daily  (configurable CHANDA_REMINDER_HOUR, default 09:00) → FCM chanda reminders
  - Daily  02:00   → session cleanup (expired inactive sessions)
  - Daily  03:00   → audit log cleanup (entries older than 2 years)
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta

log = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────
# JOB FUNCTIONS
# ─────────────────────────────────────────────────────────────

def job_generate_chanda_month():
    """Auto-generate chanda collections on the 1st of every month."""
    from app.database import SessionLocal
    from app import models
    from app.utils.timezones import india_month_key, utc_now
    from app.utils.payment_ledger import set_collection_status, sync_generated_month

    db = SessionLocal()
    try:
        month = india_month_key(utc_now())
        heads = db.query(models.ApprovedHead).filter_by(is_active=True).all()
        created = 0
        for head in heads:
            exists = db.query(models.ChandaCollection).filter_by(
                head_id=head.id, month=month
            ).first()
            if not exists:
                col = models.ChandaCollection(
                    head_id=head.id,
                    month=month,
                    amount_due=head.monthly_amount or 0,
                    total_paid=0,
                    status="pending",
                )
                db.add(col)
                db.flush()
                sync_generated_month(db, col)
                set_collection_status(col)
                created += 1
        db.commit()
        log.info(f"[scheduler] chanda month {month} generated for {created} families")
    except Exception as e:
        log.error(f"[scheduler] generate_chanda_month failed: {e}")
        db.rollback()
    finally:
        db.close()


def job_send_chanda_reminders():
    """Send FCM push notifications to members with 1+ pending chanda months."""
    import os
    from app.database import SessionLocal
    from app import models
    from app.utils.fcm import notify_user

    db = SessionLocal()
    try:
        settings = _get_settings(db)
        mosque = settings.get("mosque_name", "Mohideen Masjid")

        heads = db.query(models.ApprovedHead).filter_by(is_active=True).all()
        notified = 0
        for head in heads:
            pending = db.query(models.ChandaCollection).filter(
                models.ChandaCollection.head_id == head.id,
                models.ChandaCollection.status != "paid",
            ).all()
            if not pending:
                continue

            n = len(pending)
            months_word = "month" if n == 1 else "months"
            body = (
                f"You have {n} pending chanda {months_word}. "
                "Please pay or contact your collector."
            )
            title = "Chanda Reminder"

            # Find registered user for this head to send device notification
            user = db.query(models.User).filter_by(
                family_id=head.id, role="head", is_active=True
            ).first()
            if user:
                sent = notify_user(db, user.id, title, body, data={"type": "chanda_reminder"})
                if sent:
                    notified += 1

        db.commit()
        log.info(f"[scheduler] chanda reminders sent to {notified} families")
    except Exception as e:
        log.error(f"[scheduler] send_chanda_reminders failed: {e}")
        db.rollback()
    finally:
        db.close()


def job_session_cleanup():
    """Delete expired inactive sessions."""
    from app.database import SessionLocal
    from sqlalchemy import text

    db = SessionLocal()
    try:
        result = db.execute(
            text("DELETE FROM user_sessions WHERE expires_at < :now AND is_active = FALSE"),
            {"now": datetime.utcnow()},
        )
        db.commit()
        log.info(f"[scheduler] session cleanup: deleted {result.rowcount} sessions")
    except Exception as e:
        log.error(f"[scheduler] session_cleanup failed: {e}")
        db.rollback()
    finally:
        db.close()


def job_prayer_notifications():
    """Send FCM prayer notifications at adhan and iqamah times (runs every minute)."""
    from app.database import SessionLocal
    from app import models
    from app.utils.timezones import to_india
    from app.utils.fcm import send_fcm_prayer_data

    now = to_india(datetime.utcnow())
    hhmm = f"{now.hour:02d}:{now.minute:02d}"

    db = SessionLocal()
    try:
        timing = db.query(models.PrayerTiming).order_by(models.PrayerTiming.id.desc()).first()
        if not timing:
            return

        # (prayer_key, name, adhan_time, iqamah_time)
        prayers = [
            ("fajr",    "Fajr",    timing.fajr_adhan,    timing.fajr),
            ("dhuhr",   "Dhuhr",   timing.dhuhr_adhan,   timing.dhuhr),
            ("asr",     "Asr",     timing.asr_adhan,     timing.asr),
            ("maghrib", "Maghrib", timing.maghrib_adhan, timing.maghrib),
            ("isha",    "Isha",    timing.isha_adhan,    timing.isha),
        ]
        if now.weekday() == 4:
            prayers.append(("jummah", "Jumu'ah", timing.jummah, timing.jummah_iqamah))
        if timing.taraweeh:
            prayers.append(("taraweeh", "Taraweeh", None, timing.taraweeh))

        def _norm(t):
            """Normalise any stored time string to 24h 'HH:MM' for comparison."""
            if not t:
                return None
            s = t.strip()
            # 12h format: "5:30 AM" / "1:30 PM"
            m12 = re.match(r'^(\d{1,2}):(\d{2})\s*(AM|PM)$', s, re.IGNORECASE)
            if m12:
                h, mn, period = int(m12.group(1)), m12.group(2), m12.group(3).upper()
                if period == 'PM' and h != 12:
                    h += 12
                elif period == 'AM' and h == 12:
                    h = 0
                return f"{h:02d}:{mn}"
            # 24h without leading zero: "5:30" → "05:30"
            if len(s) == 4 and s[1] == ':':
                return '0' + s
            return s

        for key, name, adhan_time, iqamah_time in prayers:
            adhan_norm  = _norm(adhan_time)
            iqamah_norm = _norm(iqamah_time)

            # Send DATA-ONLY FCM (no notification key) so Android never
            # auto-shows a banner. The JS setBackgroundMessageHandler in
            # index.js receives this and calls showAdhanNow (adhan sound)
            # + scheduleIqamah via WorkManager. Only one notification fires.
            if adhan_norm and adhan_norm[:5] == hhmm:
                send_fcm_prayer_data(
                    prayer_key=key,
                    prayer_name=name,
                    notif_type="adhan",
                    iqamah_time=iqamah_time or "",
                )
                log.info(f"[scheduler] prayer data FCM: {name} Adhan at {hhmm}")

            if iqamah_norm and iqamah_norm[:5] == hhmm:
                send_fcm_prayer_data(
                    prayer_key=key,
                    prayer_name=name,
                    notif_type="iqamah",
                )
                log.info(f"[scheduler] prayer data FCM: {name} Iqamah at {hhmm}")

    except Exception as e:
        log.error(f"[scheduler] prayer_notifications failed: {e}")
    finally:
        db.close()


def job_audit_cleanup():
    """Delete audit logs older than 2 years."""
    from app.database import SessionLocal
    from sqlalchemy import text

    db = SessionLocal()
    cutoff = datetime.utcnow() - timedelta(days=730)
    try:
        result = db.execute(
            text("DELETE FROM audit_logs WHERE performed_at < :cutoff"),
            {"cutoff": cutoff},
        )
        db.commit()
        log.info(f"[scheduler] audit cleanup: deleted {result.rowcount} old entries")
    except Exception as e:
        log.error(f"[scheduler] audit_cleanup failed: {e}")
        db.rollback()
    finally:
        db.close()


# ─────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────

def _get_settings(db) -> dict:
    from app import models
    rows = db.query(models.FinanceSetting).all()
    return {r.key: r.value for r in rows}


# ─────────────────────────────────────────────────────────────
# SCHEDULER SETUP
# ─────────────────────────────────────────────────────────────

def create_scheduler():
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
        from apscheduler.triggers.cron import CronTrigger
    except ImportError:
        log.warning("[scheduler] APScheduler not installed — scheduled jobs disabled. Run: pip install apscheduler")
        return None

    scheduler = BackgroundScheduler(timezone="Asia/Kolkata")

    # Every minute — send FCM prayer notifications at adhan/iqamah times
    scheduler.add_job(
        job_prayer_notifications,
        CronTrigger(minute="*"),
        id="prayer_notifications",
        replace_existing=True,
    )

    # 1st of every month at 00:05 IST — auto-generate chanda
    scheduler.add_job(
        job_generate_chanda_month,
        CronTrigger(day=1, hour=0, minute=5),
        id="generate_chanda_month",
        replace_existing=True,
    )

    # Daily (configurable hour) — FCM chanda payment reminders
    import os as _os
    reminder_hour = int(_os.getenv("CHANDA_REMINDER_HOUR", "9"))
    scheduler.add_job(
        job_send_chanda_reminders,
        CronTrigger(hour=reminder_hour, minute=0),
        id="send_chanda_reminders",
        replace_existing=True,
    )

    # Daily 02:00 IST — session cleanup
    scheduler.add_job(
        job_session_cleanup,
        CronTrigger(hour=2, minute=0),
        id="session_cleanup",
        replace_existing=True,
    )

    # Daily 03:00 IST — audit log cleanup
    scheduler.add_job(
        job_audit_cleanup,
        CronTrigger(hour=3, minute=0),
        id="audit_cleanup",
        replace_existing=True,
    )

    return scheduler
