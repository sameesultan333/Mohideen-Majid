# backend/app/scheduler.py
"""
APScheduler background jobs for Mohideen Masjid.

Jobs:
  - Every minute   → FCM prayer notifications at adhan/iqamah times
  - 1st    00:05   → auto-generate chanda month for all active families
  - Daily  (configurable CHANDA_REMINDER_HOUR, default 09:00) → FCM chanda reminders
  - Daily  02:00   → session cleanup (expired inactive sessions)
  - Daily  03:00   → audit log cleanup (entries older than 2 years)
  - Daily  04:00   → permanently archive families past their 30-day restore window
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta

log = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────
# JOB FUNCTIONS
# ─────────────────────────────────────────────────────────────


# Arbitrary constant lock key for this job. Any single int works - it just
# needs to be unique among this app's advisory locks so it can't collide
# with an unrelated one taken elsewhere.
_GENERATE_MONTH_LOCK_KEY = 837465123


def job_generate_chanda_month():
    """Auto-generate chanda collections on the 1st of every month.

    APScheduler is started unconditionally in every gunicorn worker's
    FastAPI startup handler (main.py) - there is no leader election, so on
    a multi-worker deployment every worker fires this job at 00:05 IST on
    the 1st. Without a lock, two workers both querying "which heads already
    have a row this month" in the same race window, both getting "none yet"
    for the same family, and both inserting produced real duplicate
    ChandaCollection rows - this is exactly what doubled 62 of 439 families'
    amount_due in September's generation. A Postgres advisory lock (session-
    scoped, released explicitly below rather than relying on pool behavior)
    makes only one worker actually do the work; the rest see the lock held
    and return immediately. The DB-level UniqueConstraint on
    (head_id, month) is the second, independent line of defense in case any
    other code path ever races this one.
    """
    from app.database import SessionLocal
    from app import models
    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError
    from app.utils.timezones import india_month_key, utc_now
    from app.utils.payment_ledger import set_collection_status, sync_generated_month

    db = SessionLocal()
    got_lock = False
    try:
        got_lock = db.execute(
            text("SELECT pg_try_advisory_lock(:key)"), {"key": _GENERATE_MONTH_LOCK_KEY}
        ).scalar()
        if not got_lock:
            log.info("[scheduler] generate_chanda_month: another worker already holds the lock, skipping")
            return

        month = india_month_key(utc_now())
        heads = db.query(models.ApprovedHead).filter_by(is_active=True).all()
        # One query for every head already holding this month, instead of an
        # existence check per family (421 round-trips on the 1st of the month).
        already_generated = {
            head_id
            for (head_id,) in db.query(models.ChandaCollection.head_id)
            .filter(models.ChandaCollection.month == month)
            .all()
        }
        created = 0
        for head in heads:
            if head.id in already_generated:
                continue
            # Never generate a month before the family's admin-set Chanda
            # start (registration_date) - see chanda_months.py / PATCH
            # /admin/families/{id}/chanda-start-month. This is the central
            # enforcement point for the automatic monthly job; the manual
            # "Generate Month" action (chanda.py::generate_month) has the
            # same check.
            start_dt = head.registration_date or head.created_at
            if start_dt and month < india_month_key(start_dt):
                continue
            col = models.ChandaCollection(
                head_id=head.id,
                month=month,
                amount_due=head.monthly_amount or 0,
                total_paid=0,
                status="pending",
            )
            # SAVEPOINT, not a plain flush: a bare db.rollback() on conflict
            # would discard every row already flushed earlier in this same
            # loop, not just this one. begin_nested() scopes the rollback to
            # just this head's insert attempt.
            try:
                with db.begin_nested():
                    db.add(col)
                    db.flush()
            except IntegrityError:
                # Belt-and-suspenders: the advisory lock above should already
                # make this unreachable, but if some other code path (e.g. a
                # manual "Generate Month" click) raced this exact head+month,
                # the UniqueConstraint catches it here instead of creating a
                # second row. Not our row to keep - the savepoint already
                # rolled back just this insert.
                continue
            sync_generated_month(db, col)
            set_collection_status(col)
            created += 1
        db.commit()
        log.info(f"[scheduler] chanda month {month} generated for {created} families")
    except Exception as e:
        log.error(f"[scheduler] generate_chanda_month failed: {e}")
        db.rollback()
    finally:
        if got_lock:
            try:
                db.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": _GENERATE_MONTH_LOCK_KEY})
                db.commit()
            except Exception:
                pass
        db.close()


def job_send_chanda_reminders():
    """Send FCM push notifications to members with 1+ pending chanda months.

    Generated months only — see utils/chanda_months.
    """
    from app.database import SessionLocal
    from app import models
    from sqlalchemy import func
    from app.utils.chanda_months import pending_month_filter
    from app.utils.fcm import notify_user

    db = SessionLocal()
    try:
        # Two aggregate queries rather than a pending-count and a user lookup per
        # family: at 421 families that loop issued ~1,200 round-trips per run.
        pending_by_head = dict(
            db.query(
                models.ChandaCollection.head_id,
                func.count(models.ChandaCollection.id),
            )
            .join(models.ApprovedHead, models.ApprovedHead.id == models.ChandaCollection.head_id)
            .filter(
                models.ApprovedHead.is_active.is_(True),
                models.ChandaCollection.status != "paid",
                pending_month_filter(),
            )
            .group_by(models.ChandaCollection.head_id)
            .all()
        )
        if not pending_by_head:
            log.info("[scheduler] chanda reminders: nobody pending")
            return

        users_by_head = {
            u.family_id: u
            for u in db.query(models.User).filter(
                models.User.family_id.in_(list(pending_by_head.keys())),
                models.User.role == "head",
                models.User.is_active.is_(True),
            ).all()
        }

        notified = 0
        for head_id, n in pending_by_head.items():
            user = users_by_head.get(head_id)
            if not user:
                continue
            months_word = "month" if n == 1 else "months"
            body = (
                f"You have {n} pending chanda {months_word}. "
                "Please pay or contact your collector."
            )
            if notify_user(db, user.id, "Chanda Reminder", body, data={"type": "chanda_reminder"}):
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

        is_friday = now.weekday() == 4

        # (prayer_key, name, adhan_time, iqamah_time)
        # Friday: Jumu'ah replaces Dhuhr entirely — never send a "Dhuhr" FCM
        # on Fridays, only "Jumu'ah", so users aren't told the wrong prayer
        # is starting.
        prayers = [
            ("fajr", "Fajr", timing.fajr_adhan, timing.fajr),
        ]
        if is_friday:
            prayers.append(("jummah", "Jumu'ah", timing.jummah, timing.jummah_iqamah))
        else:
            prayers.append(("dhuhr", "Dhuhr", timing.dhuhr_adhan, timing.dhuhr))
        prayers += [
            ("asr",     "Asr",     timing.asr_adhan,     timing.asr),
            ("maghrib", "Maghrib", timing.maghrib_adhan, timing.maghrib),
            ("isha",    "Isha",    timing.isha_adhan,    timing.isha),
        ]
        # Taraweeh only runs during Ramadan — gated on the taraweeh time
        # being configured at all (admin clears it outside Ramadan), so it
        # never fires for the other 11 months.
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


def job_family_archive_expired():
    """Permanently archive families whose 30-day restore window has passed.

    This NEVER physically deletes the ApprovedHead row (ChandaCollection/
    PaymentEntry history must keep resolving against it) — it only flips
    is_deleted=True, which hides the family from every list/query in the
    app from that point on. Mirrors the existing expenses.is_deleted
    soft-delete convention used elsewhere in this codebase.
    """
    from app.database import SessionLocal
    from app import models
    from app.routes.finance import write_audit
    from app.services.audit_service import AuditAction

    db = SessionLocal()
    try:
        now = datetime.utcnow()
        expired = db.query(models.ApprovedHead).filter(
            models.ApprovedHead.is_active.is_(False),
            models.ApprovedHead.deactivated_until.isnot(None),
            models.ApprovedHead.deactivated_until <= now,
            models.ApprovedHead.is_deleted.is_(False),
        ).all()
        for head in expired:
            head.is_deleted = True
            head.deleted_at = now
            write_audit(db, "approved_heads", head.id, AuditAction.FAMILY_ARCHIVED,
                        new_values={"is_deleted": True},
                        note=f"Auto-archived {head.name} ({head.chanda_no}) after 30-day restore window")
        db.commit()
        log.info(f"[scheduler] family archive: permanently archived {len(expired)} expired families")
    except Exception as e:
        log.error(f"[scheduler] family_archive_expired failed: {e}")
        db.rollback()
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

    # Daily 04:00 IST — permanently archive families past their 30-day restore window
    scheduler.add_job(
        job_family_archive_expired,
        CronTrigger(hour=4, minute=0),
        id="family_archive_expired",
        replace_existing=True,
    )

    return scheduler
