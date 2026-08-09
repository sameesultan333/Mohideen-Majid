import asyncio
import contextlib
import os
import time as _time

from app.logging_config import configure_logging
configure_logging()

from datetime import datetime as _datetime

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.encoders import ENCODERS_BY_TYPE
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from app.database import SessionLocal, engine
from app import models

# Every timestamp column in this app is written with datetime.utcnow() —
# naive (no tzinfo), but semantically always UTC. FastAPI's default
# datetime encoder just calls .isoformat() on it, which produces a string
# with NO 'Z'/offset suffix (e.g. "2026-07-21T22:24:48"). Browsers and RN's
# `new Date(...)` treat an ISO string with no timezone designator as LOCAL
# time, not UTC — so every timestamp shown anywhere (audit log, payments,
# prayer times, receipts, etc.) silently renders as if it were already in
# the viewer's timezone, off by exactly their UTC offset. Registering this
# override once, globally, fixes it everywhere without touching any of the
# ~30 individual model columns or any frontend code.
def _isoformat_as_utc(dt: _datetime) -> str:
    return dt.isoformat() + "Z" if dt.tzinfo is None else dt.isoformat()


ENCODERS_BY_TYPE[_datetime] = _isoformat_as_utc
from app.routes import (
    admin,
    audit,
    auth,
    prayer,
    announcement,
    hadith,
    questions,
    donations,
    payments,
    user,
    upload,
    chanda,
    user_pay,
    expenses,
    finance,
    staff,
    funds,
    devices,
    collector as collector_routes,
)
from app.websocket_manager import manager
from app.utils.content_cleanup import run_content_cleanup
from app.scheduler import create_scheduler
from app.audit_middleware import AuditMiddleware
from app.redis_client import init_redis, close_redis, get_async_redis
from time import time

receipt_connection_tracker = {}
CLEANUP_INTERVAL_SECONDS = 60 * 60

# -----------------------------
# DB INIT
# -----------------------------

def _repair_missing_primary_keys() -> None:
    """Restore primary keys that a legacy schema is missing, before create_all.

    A table left over from an older schema can exist without a PRIMARY KEY. Any
    table created afterwards that references it then fails with

        InvalidForeignKey: there is no unique constraint matching given keys
        for referenced table "approved_heads"

    because Postgres will not point a foreign key at a non-unique column. That
    happens during create_all, at import time, so the worker dies before serving
    a single request — the whole service stays down rather than degrading.

    Adding the PK back is safe and idempotent: it runs only when the table
    exists AND has no primary key AND its id values are unique and non-null, so
    a healthy database is untouched and bad data is never silently papered over.
    """
    import logging as _l
    log = _l.getLogger(__name__)

    # Every table the models define with a single-column primary key. Derived
    # from the metadata rather than hardcoded: the first fix named only
    # approved_heads and users, and the next boot failed on payment_entries
    # instead — a legacy schema can be missing the key on any number of tables,
    # and each one blocks every table that references it.
    candidates = []
    for tbl in models.Base.metadata.sorted_tables:
        pk_cols = list(tbl.primary_key.columns)
        if len(pk_cols) == 1:
            candidates.append((tbl.name, pk_cols[0].name))

    for table, pk_col in candidates:
        try:
            with engine.begin() as conn:
                exists = conn.execute(
                    text("SELECT to_regclass(:t)"), {"t": f"public.{table}"}
                ).scalar()
                if not exists:
                    continue

                has_pk = conn.execute(text("""
                    SELECT COUNT(*) FROM pg_constraint
                    WHERE conrelid = to_regclass(:t) AND contype = 'p'
                """), {"t": f"public.{table}"}).scalar()
                if has_pk:
                    continue

                # Only safe if the column can actually be a key.
                bad = conn.execute(text(f"""
                    SELECT COUNT(*) FROM (
                        SELECT {pk_col} FROM {table}
                        WHERE {pk_col} IS NULL
                        UNION ALL
                        SELECT {pk_col} FROM {table}
                        GROUP BY {pk_col} HAVING COUNT(*) > 1
                    ) AS problems
                """)).scalar()
                if bad:
                    log.error(
                        "[db] %s has no primary key and %s is not unique/non-null "
                        "— refusing to add one automatically", table, pk_col)
                    continue

                conn.execute(text(f"ALTER TABLE {table} ADD PRIMARY KEY ({pk_col})"))
                log.warning("[db] restored missing PRIMARY KEY on %s(%s)", table, pk_col)
        except Exception as exc:
            # Never let the repair itself stop the app from booting.
            log.warning("[db] primary-key check failed for %s: %s", table, exc)


def _repair_stale_sequences() -> None:
    """
    Advance any identity sequence that has fallen behind its table's max(id).

    A SERIAL column draws ids from a sequence. Restoring a dump, or inserting
    rows with explicit ids (which the Excel importer does), does NOT advance
    that sequence, so it hands back an id that already exists and the INSERT
    fails with

        duplicate key value violates unique constraint "<table>_pkey"

    The row is never written. From the outside this looks exactly like "new
    collections stop appearing": reads are perfect, writes silently go nowhere.
    It is the same class of latent-schema damage _repair_missing_primary_keys
    already handles at boot, so it belongs in the same place rather than in a
    script someone has to remember to run against production.

    Only ever moves a sequence FORWARD, and only when it is already behind, so
    it is safe to run on every boot and a no-op on a healthy database.
    """
    import logging as _l
    log = _l.getLogger(__name__)

    if engine.dialect.name != "postgresql":
        return
    try:
        with engine.begin() as conn:
            rows = conn.execute(text("""
                SELECT c.relname, a.attname,
                       pg_get_serial_sequence(c.relname, a.attname) AS seq
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                JOIN pg_attribute a ON a.attrelid = c.oid
                WHERE n.nspname = 'public'
                  AND c.relkind = 'r'
                  AND a.attnum > 0
                  AND NOT a.attisdropped
                  AND pg_get_serial_sequence(c.relname, a.attname) IS NOT NULL
            """)).fetchall()

            repaired = 0
            for table, column, seq in rows:
                try:
                    max_id = conn.execute(
                        text(f'SELECT COALESCE(MAX("{column}"), 0) FROM "{table}"')
                    ).scalar() or 0
                    last_value, is_called = conn.execute(
                        text(f'SELECT last_value, is_called FROM {seq}')
                    ).fetchone()
                    next_id = last_value + 1 if is_called else last_value
                    if next_id <= max_id:
                        conn.execute(text("SELECT setval(:s, :v, true)"),
                                     {"s": seq, "v": max_id})
                        log.warning(
                            "[db] sequence %s was behind (next=%s, max id=%s) - advanced to %s",
                            seq, next_id, max_id, max_id,
                        )
                        repaired += 1
                except Exception as exc:
                    log.warning("[db] sequence check failed for %s.%s: %s", table, column, exc)

            if repaired:
                log.warning("[db] repaired %s stale sequence(s)", repaired)
    except Exception as exc:
        # Never let the repair itself stop the app from booting.
        log.warning("[db] sequence repair skipped: %s", exc)


_repair_missing_primary_keys()
models.Base.metadata.create_all(bind=engine)
# After create_all, so a table created on this very boot is included.
_repair_stale_sequences()


def ensure_columns():
    statements = [
        # users
        "ALTER TABLE announcements ADD COLUMN IF NOT EXISTS posted_by_user_id INTEGER REFERENCES users(id)",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT TRUE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMP WITHOUT TIME ZONE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS address TEXT",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS expo_token TEXT",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS family_id INTEGER REFERENCES approved_heads(id)",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS head_phone VARCHAR",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITHOUT TIME ZONE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS password VARCHAR",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_registered BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS registered_at TIMESTAMP WITHOUT TIME ZONE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP WITHOUT TIME ZONE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP WITHOUT TIME ZONE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS invitation_created_by INTEGER REFERENCES users(id)",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS invitation_created_at TIMESTAMP WITHOUT TIME ZONE",

        # payment_entries
        "ALTER TABLE payment_entries ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')",
        "ALTER TABLE payment_entries ADD COLUMN IF NOT EXISTS months_covered INTEGER DEFAULT 0",
        "ALTER TABLE payment_entries ADD COLUMN IF NOT EXISTS covered_months JSON",
        "ALTER TABLE payment_entries ADD COLUMN IF NOT EXISTS coverage_map JSON",
        "ALTER TABLE payment_entries ADD COLUMN IF NOT EXISTS paid_by_user_id INTEGER REFERENCES users(id)",

        # user_sessions
        "ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS login_type VARCHAR(32)",

        # approved_heads
        "ALTER TABLE approved_heads ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE",
        "ALTER TABLE approved_heads ADD COLUMN IF NOT EXISTS monthly_amount FLOAT DEFAULT 0",
        "ALTER TABLE approved_heads ADD COLUMN IF NOT EXISTS address TEXT",
        "ALTER TABLE approved_heads ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id)",
        "ALTER TABLE approved_heads ADD COLUMN IF NOT EXISTS is_registered BOOLEAN DEFAULT FALSE",
        "ALTER TABLE approved_heads ADD COLUMN IF NOT EXISTS registration_date TIMESTAMP WITHOUT TIME ZONE",

        # approved_heads — deactivation / 30-day restore window / permanent archive
        "ALTER TABLE approved_heads ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMP WITHOUT TIME ZONE",
        "ALTER TABLE approved_heads ADD COLUMN IF NOT EXISTS deactivated_until TIMESTAMP WITHOUT TIME ZONE",
        "ALTER TABLE approved_heads ADD COLUMN IF NOT EXISTS deactivated_by_id INTEGER REFERENCES users(id)",
        "ALTER TABLE approved_heads ADD COLUMN IF NOT EXISTS deactivation_reason TEXT",
        "ALTER TABLE approved_heads ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE approved_heads ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITHOUT TIME ZONE",

        # payment_entries — new audit columns
        "ALTER TABLE payment_entries ADD COLUMN IF NOT EXISTS verified_by_user_id INTEGER REFERENCES users(id)",
        "ALTER TABLE payment_entries ADD COLUMN IF NOT EXISTS payment_source VARCHAR DEFAULT 'app'",
        "ALTER TABLE payment_entries ADD COLUMN IF NOT EXISTS receipt_status VARCHAR",
        "ALTER TABLE payment_entries ADD COLUMN IF NOT EXISTS rollback_status VARCHAR",

        # payment rollback requests
        """CREATE TABLE IF NOT EXISTS payment_rollback_requests (
            id SERIAL PRIMARY KEY,
            payment_entry_id INTEGER NOT NULL REFERENCES payment_entries(id),
            requested_by_id INTEGER NOT NULL REFERENCES users(id),
            requested_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
            reason TEXT,
            status VARCHAR NOT NULL DEFAULT 'pending',
            approved_by_id INTEGER REFERENCES users(id),
            approved_at TIMESTAMP WITHOUT TIME ZONE,
            decision_note TEXT,
            original_amount FLOAT,
            original_receipt_id VARCHAR,
            original_covered_months JSON,
            payment_source VARCHAR
        )""",

        # expenses — new columns
        "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS receipt_image TEXT",
        "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS receipt_id VARCHAR UNIQUE",
        "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS created_by_id INTEGER REFERENCES users(id)",
        "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS approved_by TEXT",
        "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS approved_by_id INTEGER REFERENCES users(id)",
        "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITHOUT TIME ZONE",

        # expense_categories table
        """CREATE TABLE IF NOT EXISTS expense_categories (
            id          SERIAL PRIMARY KEY,
            name        VARCHAR(100) NOT NULL UNIQUE,
            description TEXT,
            is_active   BOOLEAN NOT NULL DEFAULT TRUE,
            created_at  TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
        )""",

        # expenses — enterprise columns
        "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES expense_categories(id)",
        "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITHOUT TIME ZONE",
        "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS deleted_by TEXT",

        # chanda_collections — retire the "partial" status.
        # Collection status is now two-valued (paid | pending): a month counts as
        # paid only once the full amount is received, and anything short of that
        # is pending. Rows written before that change still hold 'partial', which
        # no longer satisfies the response schema and made GET /chanda/members
        # fail with ResponseValidationError. The money itself is untouched — it
        # stays in total_paid — so this only relabels the status.
        # Idempotent: once migrated the UPDATE matches nothing.
        "UPDATE chanda_collections SET status = 'pending' WHERE status = 'partial'",

        # indexes for performance
        "CREATE INDEX IF NOT EXISTS idx_expenses_category_id  ON expenses(category_id)",
        "CREATE INDEX IF NOT EXISTS idx_expenses_created_at   ON expenses(created_at)",
        "CREATE INDEX IF NOT EXISTS idx_expenses_is_deleted   ON expenses(is_deleted)",
        "CREATE INDEX IF NOT EXISTS idx_expenses_created_by_id ON expenses(created_by_id)",

        # donations — purpose link
        "ALTER TABLE donations ADD COLUMN IF NOT EXISTS purpose_id INTEGER REFERENCES donation_purposes(id)",

        # announcements — image + media + soft-active support
        "ALTER TABLE announcements ADD COLUMN IF NOT EXISTS image_url TEXT",
        "ALTER TABLE announcements ADD COLUMN IF NOT EXISTS audio_url TEXT",
        "ALTER TABLE announcements ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE",
        "ALTER TABLE announcements ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITHOUT TIME ZONE",
        "ALTER TABLE announcements ADD COLUMN IF NOT EXISTS target_user_id INTEGER REFERENCES users(id)",
        "CREATE INDEX IF NOT EXISTS idx_announcements_target_user_id ON announcements(target_user_id)",

        # chanda_collections — advance payment tracking
        "ALTER TABLE chanda_collections ADD COLUMN IF NOT EXISTS is_advance BOOLEAN DEFAULT FALSE",
        "ALTER TABLE chanda_collections ADD COLUMN IF NOT EXISTS advance_payment_id INTEGER REFERENCES payment_entries(id)",
        "ALTER TABLE chanda_collections ADD COLUMN IF NOT EXISTS rate_snapshot FLOAT",

        # payment_entries — rate snapshot + discount support
        "ALTER TABLE payment_entries ADD COLUMN IF NOT EXISTS monthly_rate_snapshot FLOAT",
        "ALTER TABLE payment_entries ADD COLUMN IF NOT EXISTS gross_amount FLOAT",
        "ALTER TABLE payment_entries ADD COLUMN IF NOT EXISTS discount_amount FLOAT DEFAULT 0",
        "ALTER TABLE payment_entries ADD COLUMN IF NOT EXISTS discount_reason VARCHAR",
        "ALTER TABLE payment_entries ADD COLUMN IF NOT EXISTS payment_token VARCHAR UNIQUE",

        # receipts — simplified unified receipt (drop old nullable FKs if they exist)
        "ALTER TABLE receipts ADD COLUMN IF NOT EXISTS transaction_id INTEGER",

        # prayer_timings — jummah iqamah column
        "ALTER TABLE prayer_timings ADD COLUMN IF NOT EXISTS jummah_iqamah VARCHAR",
        # prayer_timings — schedule version for phone-side change detection
        "ALTER TABLE prayer_timings ADD COLUMN IF NOT EXISTS schedule_version INTEGER DEFAULT 1",

        # finance_settings — new keys (logo, phone)
        "ALTER TABLE finance_settings ADD COLUMN IF NOT EXISTS key VARCHAR",

        # sms_queue — richer statuses (queued/sending/delivered/failed/expired)
        # status column already exists, just ensure new values are valid (no migration needed for VARCHAR)

        # sms_queue
        "CREATE TABLE IF NOT EXISTS sms_queue (id SERIAL PRIMARY KEY, phone VARCHAR NOT NULL, message TEXT NOT NULL, template_id VARCHAR, status VARCHAR DEFAULT 'pending', attempts INTEGER DEFAULT 0, last_error TEXT, scheduled_at TIMESTAMP DEFAULT NOW(), sent_at TIMESTAMP, created_at TIMESTAMP DEFAULT NOW(), created_by_id INTEGER REFERENCES users(id))",

        # funds table
        """CREATE TABLE IF NOT EXISTS funds (
            id                SERIAL PRIMARY KEY,
            name              VARCHAR(200) NOT NULL UNIQUE,
            description       TEXT,
            goal_amount       FLOAT,
            start_date        TIMESTAMP WITHOUT TIME ZONE,
            expected_end_date TIMESTAMP WITHOUT TIME ZONE,
            completed_at      TIMESTAMP WITHOUT TIME ZONE,
            status            VARCHAR(20) NOT NULL DEFAULT 'active',
            is_active         BOOLEAN NOT NULL DEFAULT TRUE,
            is_archived       BOOLEAN NOT NULL DEFAULT FALSE,
            created_by        TEXT,
            created_by_id     INTEGER REFERENCES users(id),
            created_at        TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
            updated_at        TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
            archived_at       TIMESTAMP WITHOUT TIME ZONE,
            archived_by       TEXT
        )""",
        "CREATE INDEX IF NOT EXISTS idx_funds_status ON funds(status)",
        "CREATE INDEX IF NOT EXISTS idx_funds_is_active ON funds(is_active)",

        # donations — fund + v2 columns
        "ALTER TABLE donations ADD COLUMN IF NOT EXISTS fund_id INTEGER REFERENCES funds(id)",
        "ALTER TABLE donations ADD COLUMN IF NOT EXISTS donor_type VARCHAR(20) DEFAULT 'walk_in'",
        "ALTER TABLE donations ADD COLUMN IF NOT EXISTS phone VARCHAR",
        "ALTER TABLE donations ADD COLUMN IF NOT EXISTS member_id INTEGER REFERENCES users(id)",
        "ALTER TABLE donations ADD COLUMN IF NOT EXISTS chanda_no VARCHAR",
        "ALTER TABLE donations ADD COLUMN IF NOT EXISTS donation_date TIMESTAMP WITHOUT TIME ZONE",
        "ALTER TABLE donations ADD COLUMN IF NOT EXISTS receipt_image TEXT",
        "ALTER TABLE donations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITHOUT TIME ZONE",
        "CREATE INDEX IF NOT EXISTS idx_donations_fund_id ON donations(fund_id)",
        "CREATE INDEX IF NOT EXISTS idx_donations_created_at ON donations(created_at)",
        "CREATE INDEX IF NOT EXISTS idx_donations_donor_type ON donations(donor_type)",

        # expenses — fund + vendor columns
        "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS fund_id INTEGER REFERENCES funds(id)",
        "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS vendor_name VARCHAR(200)",
        "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS expense_date TIMESTAMP WITHOUT TIME ZONE",
        "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITHOUT TIME ZONE",
        "CREATE INDEX IF NOT EXISTS idx_expenses_fund_id ON expenses(fund_id)",

        # device_tokens — FCM push targets
        """CREATE TABLE IF NOT EXISTS device_tokens (
            id           SERIAL PRIMARY KEY,
            user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token        VARCHAR NOT NULL,
            platform     VARCHAR(10) NOT NULL,
            device_name  VARCHAR,
            app_version  VARCHAR,
            is_active    BOOLEAN NOT NULL DEFAULT TRUE,
            created_at   TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
            updated_at   TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_device_tokens_user_id ON device_tokens(user_id)",
        "CREATE INDEX IF NOT EXISTS idx_device_tokens_token ON device_tokens(token)",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_device_tokens_user_token ON device_tokens(user_id, token)",

        # audit_logs — base columns (in case table pre-existed without them)
        "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS old_values JSONB",
        "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS new_values JSONB",
        "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS note TEXT",
        # audit_logs — enhanced enterprise fields
        "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS module VARCHAR(50)",
        "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS action_label VARCHAR(100)",
        "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_role VARCHAR(30)",
        "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_fullname VARCHAR(200)",
        "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS description TEXT",
        "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS browser VARCHAR(100)",
        "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS os_name VARCHAR(100)",
        "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS device_name VARCHAR(200)",
        "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS session_id INTEGER",
        "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS request_id VARCHAR(36)",
        "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS endpoint VARCHAR(300)",
        "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS http_method VARCHAR(10)",
        "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'success'",
        "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS failure_reason TEXT",
        "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS execution_time_ms INTEGER",
        "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS affected_record_type VARCHAR(100)",
        "CREATE INDEX IF NOT EXISTS idx_audit_logs_module ON audit_logs(module)",
        "CREATE INDEX IF NOT EXISTS idx_audit_logs_user_role ON audit_logs(user_role)",
        "CREATE INDEX IF NOT EXISTS idx_audit_logs_status ON audit_logs(status)",
        "CREATE INDEX IF NOT EXISTS idx_audit_logs_performed_by_id ON audit_logs(performed_by_id)",

        # Missing indexes identified in production audit
        "CREATE INDEX IF NOT EXISTS idx_donations_user_id ON donations(user_id)",
        "CREATE INDEX IF NOT EXISTS idx_payment_entries_collection_id ON payment_entries(collection_id)",
        "CREATE INDEX IF NOT EXISTS idx_payment_entries_head_id ON payment_entries(head_id)",
        "CREATE INDEX IF NOT EXISTS idx_payment_entries_created_at ON payment_entries(created_at)",
        "CREATE INDEX IF NOT EXISTS idx_payment_entries_status ON payment_entries(status)",
        "CREATE INDEX IF NOT EXISTS idx_chanda_collections_head_id ON chanda_collections(head_id)",
        "CREATE INDEX IF NOT EXISTS idx_chanda_collections_month ON chanda_collections(month)",
        "CREATE INDEX IF NOT EXISTS idx_chanda_collections_status ON chanda_collections(status)",
        "CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)",
        "CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active)",
        "CREATE INDEX IF NOT EXISTS idx_finance_transactions_created_at ON finance_transactions(created_at)",
        "CREATE INDEX IF NOT EXISTS idx_finance_transactions_type ON finance_transactions(transaction_type)",
        "CREATE INDEX IF NOT EXISTS idx_announcements_created_at ON announcements(created_at)",
        "CREATE INDEX IF NOT EXISTS idx_announcements_is_active ON announcements(is_active)",

        # ── v2 architecture migrations ────────────────────────────────────────

        # approved_heads — phone is now nullable; collector assignment
        "ALTER TABLE approved_heads ALTER COLUMN phone DROP NOT NULL",
        # Remove the old unique constraint on phone (NULL values must coexist)
        # Use DO block so it is idempotent
        """DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'approved_heads_phone_key'
            ) THEN
                ALTER TABLE approved_heads DROP CONSTRAINT approved_heads_phone_key;
            END IF;
        END $$""",
        # Partial unique index: unique only among non-NULL phones
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_approved_heads_phone_unique ON approved_heads(phone) WHERE phone IS NOT NULL",
        "ALTER TABLE approved_heads ADD COLUMN IF NOT EXISTS collector_id INTEGER REFERENCES users(id)",
        "ALTER TABLE approved_heads ADD COLUMN IF NOT EXISTS zone VARCHAR",

        # ── RBAC: multi-role table ──────────────────────────────────────────
        """
        CREATE TABLE IF NOT EXISTS user_roles (
            user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            role           VARCHAR(30) NOT NULL,
            assigned_at    TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            assigned_by_id INTEGER REFERENCES users(id),
            PRIMARY KEY (user_id, role)
        )
        """,
        # Back-fill from the existing single-role column (idempotent via ON CONFLICT DO NOTHING)
        """
        INSERT INTO user_roles (user_id, role, assigned_at)
        SELECT id, role, NOW() FROM users
        WHERE role IS NOT NULL AND role != ''
        ON CONFLICT DO NOTHING
        """,

        # users — lifecycle status
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE'",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS rejection_reason TEXT",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_notes TEXT",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_by_id INTEGER REFERENCES users(id)",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITHOUT TIME ZONE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE",
        "CREATE INDEX IF NOT EXISTS idx_users_status ON users(status)",

        # users — self-service account deletion (soft delete)
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITHOUT TIME ZONE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_reason TEXT",
        "CREATE INDEX IF NOT EXISTS idx_users_is_deleted ON users(is_deleted)",

        # collector_cash_submissions table
        """CREATE TABLE IF NOT EXISTS collector_cash_submissions (
            id                  SERIAL PRIMARY KEY,
            collector_id        INTEGER NOT NULL REFERENCES users(id),
            start_date          TIMESTAMP WITHOUT TIME ZONE NOT NULL,
            end_date            TIMESTAMP WITHOUT TIME ZONE NOT NULL,
            submitted_amount    NUMERIC(12,2) NOT NULL,
            expected_amount     NUMERIC(12,2),
            approved_amount     NUMERIC(12,2),
            receiving_admin_id  INTEGER REFERENCES users(id),
            notes               TEXT,
            status              VARCHAR(20) NOT NULL DEFAULT 'pending',
            rejection_reason    TEXT,
            approved_by_id      INTEGER REFERENCES users(id),
            approved_at         TIMESTAMP WITHOUT TIME ZONE,
            rejected_by_id      INTEGER REFERENCES users(id),
            rejected_at         TIMESTAMP WITHOUT TIME ZONE,
            submitted_at        TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
            created_at          TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
            updated_at          TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_cash_submissions_collector_id ON collector_cash_submissions(collector_id)",
        "CREATE INDEX IF NOT EXISTS idx_cash_submissions_status ON collector_cash_submissions(status)",
        "CREATE INDEX IF NOT EXISTS idx_cash_submissions_submitted_at ON collector_cash_submissions(submitted_at)",

        # collector_cash_submissions — category-based auto-aggregation (cash vs online split)
        "ALTER TABLE collector_cash_submissions ADD COLUMN IF NOT EXISTS cash_amount NUMERIC(12,2)",
        "ALTER TABLE collector_cash_submissions ADD COLUMN IF NOT EXISTS online_amount NUMERIC(12,2)",
        "ALTER TABLE collector_cash_submissions ADD COLUMN IF NOT EXISTS categories JSON",

        # donations / payment_entries — link to the collector who recorded them
        # and the submission (if any) they've been bundled/locked into.
        "ALTER TABLE donations ADD COLUMN IF NOT EXISTS collector_id INTEGER REFERENCES users(id)",
        "ALTER TABLE donations ADD COLUMN IF NOT EXISTS submission_id INTEGER REFERENCES collector_cash_submissions(id)",
        "CREATE INDEX IF NOT EXISTS idx_donations_collector_id ON donations(collector_id)",
        "CREATE INDEX IF NOT EXISTS idx_donations_submission_id ON donations(submission_id)",

        "ALTER TABLE payment_entries ADD COLUMN IF NOT EXISTS collector_id INTEGER REFERENCES users(id)",
        "ALTER TABLE payment_entries ADD COLUMN IF NOT EXISTS submission_id INTEGER REFERENCES collector_cash_submissions(id)",
        "CREATE INDEX IF NOT EXISTS idx_payment_entries_collector_id ON payment_entries(collector_id)",
        "CREATE INDEX IF NOT EXISTS idx_payment_entries_submission_id ON payment_entries(submission_id)",

        # approved_heads — street (cascading Zone -> Street filter)
        "ALTER TABLE approved_heads ADD COLUMN IF NOT EXISTS street VARCHAR",
        "CREATE INDEX IF NOT EXISTS idx_approved_heads_street ON approved_heads(street)",
    ]

    import logging as _log
    _mlog = _log.getLogger("mohideen.migration")
    for statement in statements:
        try:
            with engine.begin() as connection:
                connection.execute(text(statement))
        except Exception as _e:
            _mlog.warning("Migration statement skipped (%s): %.120s", type(_e).__name__, statement)


ensure_columns()


def backfill_user_status():
    """
    One-time backfill: derive UserStatus from existing boolean fields.
    Idempotent — skips rows that already have a non-default status.
    """
    with engine.begin() as conn:
        # ACTIVE: registered and currently active
        conn.execute(text("""
            UPDATE users SET status = 'ACTIVE'
            WHERE is_registered = TRUE AND is_active = TRUE
              AND status = 'ACTIVE'
        """))
        # DISABLED: previously active, now disabled
        conn.execute(text("""
            UPDATE users SET status = 'DISABLED'
            WHERE is_active = FALSE AND is_registered = TRUE
              AND status = 'ACTIVE'
        """))
        # IMPORTED: exists in DB but never self-registered (admin-created / Excel imported)
        conn.execute(text("""
            UPDATE users SET status = 'IMPORTED'
            WHERE is_registered = FALSE AND is_active = TRUE
              AND status = 'ACTIVE'
        """))
        # Clean up any "N/A" phone values in approved_heads
        conn.execute(text("""
            UPDATE approved_heads SET phone = NULL
            WHERE phone IN ('N/A', 'n/a', 'NA', 'na', '', 'None', 'none')
        """))


backfill_user_status()


def fix_sequences():
    """Reset PostgreSQL serial sequences to max(id) so INSERTs never collide."""
    tables = [
        "users", "approved_heads", "prayer_timings", "announcements",
        "hadiths", "questions", "answers", "replies", "donations",
        "expenses", "expense_categories", "funds", "chanda_collections",
        "payment_entries", "receipts", "user_sessions", "device_tokens",
        "audit_logs", "collector_cash_submissions",
    ]
    with engine.begin() as connection:
        for tbl in tables:
            try:
                connection.execute(text(
                    f"SELECT setval(pg_get_serial_sequence('{tbl}', 'id'), "
                    f"COALESCE((SELECT MAX(id) FROM {tbl}), 0) + 1, false)"
                ))
            except Exception:
                pass  # table may not exist yet; safe to skip


fix_sequences()


def audit_health_check():
    """
    Write and immediately delete a sentinel row to confirm audit_logs is writable.
    Prints the result to stderr so it shows up in the server console on every restart.
    """
    import sys as _sys
    try:
        with engine.begin() as conn:
            result = conn.execute(text("""
                INSERT INTO audit_logs (table_name, record_id, action, performed_at)
                VALUES ('_healthcheck', 0, 'STARTUP_PROBE', NOW())
                RETURNING id
            """))
            row = result.fetchone()
            inserted_id = row[0] if row else None
        if inserted_id:
            with engine.begin() as conn:
                conn.execute(text("DELETE FROM audit_logs WHERE id = :id"), {"id": inserted_id})
            print(f"[audit] startup health-check PASSED (probe id={inserted_id})", file=_sys.stderr, flush=True)
        else:
            print("[audit] startup health-check WARNING: INSERT returned no id", file=_sys.stderr, flush=True)
    except Exception as exc:
        print(f"[audit] startup health-check FAILED: {exc}", file=_sys.stderr, flush=True)


audit_health_check()


def seed_expense_categories():
    """Seed default expense categories if none exist."""
    defaults = [
        "Utilities", "Maintenance", "Construction", "Food", "Cleaning",
        "Salary", "Administration", "Stationery", "Other",
    ]
    db = SessionLocal()
    try:
        if db.query(models.ExpenseCategory).count() == 0:
            for name in defaults:
                db.add(models.ExpenseCategory(name=name, is_active=True))
            db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


seed_expense_categories()


# -----------------------------
# APP INIT
# -----------------------------
_IS_PROD = os.getenv("ENVIRONMENT", "development").lower() == "production"

app = FastAPI(
    title="Masjid API",
    version="2.0.0",
    redirect_slashes=True,
    # Disable interactive docs in production
    docs_url=None if _IS_PROD else "/docs",
    redoc_url=None if _IS_PROD else "/redoc",
    openapi_url=None if _IS_PROD else "/openapi.json",
)

_APP_START_TIME = _time.monotonic()


async def periodic_content_cleanup():
    while True:
        db = SessionLocal()
        try:
            run_content_cleanup(db)
        except Exception as exc:
            _logger.error("[cleanup] %s", exc)
        finally:
            db.close()

        await asyncio.sleep(CLEANUP_INTERVAL_SECONDS)


SESSION_CLEANUP_INTERVAL_SECONDS = 60 * 60 * 24  # once per day


async def periodic_session_cleanup():
    # APScheduler's job_session_cleanup already handles this daily.
    # This coroutine is kept as a safety fallback but runs less frequently.
    while True:
        await asyncio.sleep(SESSION_CLEANUP_INTERVAL_SECONDS)
        db = SessionLocal()
        try:
            from sqlalchemy import text as _text
            from datetime import datetime as _dt
            db.execute(
                _text("DELETE FROM user_sessions WHERE expires_at < :now AND is_active = FALSE"),
                {"now": _dt.utcnow()},
            )
            db.commit()
        except Exception as exc:
            import logging
            logging.getLogger(__name__).error("[session cleanup] %s", exc)
        finally:
            db.close()

# -----------------------------
# CORS
# -----------------------------
_raw_origins = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173",
)
_allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]

# In development also allow LAN IPs on port 5173
_origin_regex = None if _IS_PROD else r"http://192\.168\.\d+\.\d+:5173"

app.add_middleware(AuditMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_origin_regex=_origin_regex,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Refresh-Token", "X-Request-ID"],
)

# -----------------------------
# ROUTES
# -----------------------------
app.include_router(auth.router)
app.include_router(audit.router)
app.include_router(prayer.router)
app.include_router(announcement.router)
app.include_router(hadith.router)
app.include_router(questions.router)
app.include_router(donations.router)
app.include_router(payments.router)
app.include_router(user.router)
app.include_router(upload.router)  # ✅ IMPORTANT
app.include_router(admin.router)
app.include_router(chanda.router)
app.include_router(user_pay.router)
app.include_router(expenses.router)
app.include_router(finance.router)
app.include_router(staff.router)
app.include_router(funds.router)
app.include_router(devices.router)
app.include_router(collector_routes.router)
# -----------------------------
# STATIC FILES (UPLOADS)
# -----------------------------
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")


@app.on_event("startup")
async def startup_cleanup():
    # Redis — non-fatal if unavailable
    await init_redis()

    db = SessionLocal()
    try:
        run_content_cleanup(db)
    finally:
        db.close()

    app.state.cleanup_task = asyncio.create_task(periodic_content_cleanup())
    app.state.session_cleanup_task = asyncio.create_task(periodic_session_cleanup())

    scheduler = create_scheduler()
    if scheduler:
        scheduler.start()
        app.state.scheduler = scheduler


@app.on_event("shutdown")
async def shutdown_cleanup():
    for attr in ("cleanup_task", "session_cleanup_task"):
        task = getattr(app.state, attr, None)
        if task:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    scheduler = getattr(app.state, "scheduler", None)
    if scheduler and scheduler.running:
        scheduler.shutdown(wait=False)

    await close_redis()

# -----------------------------
# BASIC ROUTES
# -----------------------------
import logging as _logging
_logger = _logging.getLogger("mohideen.api")

@app.exception_handler(Exception)
async def unhandled_exception_handler(request, exc):
    _logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "An internal server error occurred. Please try again later."},
    )


@app.get("/")
def root():
    return {"message": "Masjid API running 🕌"}

@app.get("/health")
async def health():
    import shutil
    import psutil

    result: dict = {"status": "ok", "uptime_seconds": round(_time.monotonic() - _APP_START_TIME)}

    # ── Database ──────────────────────────────────────────────────────────────
    try:
        db = SessionLocal()
        db.execute(text("SELECT 1"))
        db.close()
        result["database"] = "ok"
    except Exception as exc:
        result["database"] = f"error: {exc}"
        result["status"] = "degraded"

    # ── Redis ─────────────────────────────────────────────────────────────────
    redis = get_async_redis()
    if redis:
        try:
            await redis.ping()
            result["redis"] = "ok"
        except Exception as exc:
            result["redis"] = f"error: {exc}"
            result["status"] = "degraded"
    else:
        result["redis"] = "unavailable"

    # ── Disk ──────────────────────────────────────────────────────────────────
    try:
        usage = shutil.disk_usage("/")
        pct = round(usage.used / usage.total * 100, 1)
        result["disk_used_pct"] = pct
        if pct > 90:
            result["status"] = "degraded"
    except Exception:
        pass

    # ── Memory ───────────────────────────────────────────────────────────────
    try:
        mem = psutil.virtual_memory()
        result["memory_used_pct"] = round(mem.percent, 1)
    except Exception:
        pass

    status_code = 200 if result["status"] == "ok" else 503
    return JSONResponse(content=result, status_code=status_code)


# -----------------------------
# WEBSOCKETS
# -----------------------------
@app.websocket("/ws/announcements")
async def announcements_ws(websocket: WebSocket):
    await manager.connect(websocket, "announcements")
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, "announcements")


@app.websocket("/ws/prayer")
async def prayer_ws(websocket: WebSocket):
    await manager.connect(websocket, "prayer")
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, "prayer")


@app.websocket("/ws/questions")
async def questions_ws(websocket: WebSocket):
    await manager.connect(websocket, "questions")
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, "questions")


@app.websocket("/ws/hadith")
async def hadith_ws(websocket: WebSocket):
    await manager.connect(websocket, "hadith")
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, "hadith")


@app.websocket("/ws/finance")
async def finance_ws(websocket: WebSocket):
    await manager.connect(websocket, "finance")
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, "finance")


@app.websocket("/ws/events")
async def events_ws(websocket: WebSocket):
    """Single unified event stream — replaces individual channels."""
    await manager.connect(websocket, "events")
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, "events")


@app.websocket("/ws/receipts/{receipt_id}")
async def receipt_ws(websocket: WebSocket, receipt_id: str):
    now = time()
    last = receipt_connection_tracker.get(receipt_id, 0)

    # 🚨 1 connection per second per receipt
    if now - last < 1:
        await websocket.close()
        return

    receipt_connection_tracker[receipt_id] = now

    channel = f"receipt:{receipt_id}"
    await manager.connect(websocket, channel)

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, channel)
