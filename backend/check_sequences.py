"""
Report identity sequences that have fallen behind their table's max(id).

Why this matters
----------------
A Postgres SERIAL column draws new ids from a sequence. Restoring a dump, or
inserting rows with explicit ids, does NOT advance that sequence. It then hands
out an id that already exists and every INSERT fails with

    duplicate key value violates unique constraint "<table>_pkey"

The row is never written. To a user this looks like "new records stop appearing"
— payments seem to succeed in the UI but nothing reaches the Finance Timeline —
while everything already in the table reads back perfectly.

Read-only by default. Pass --fix to advance each stale sequence to max(id),
which is safe and idempotent: it only ever moves a sequence forward.

    python check_sequences.py          # report
    python check_sequences.py --fix    # repair
"""

import sys

from sqlalchemy import text

from app.database import engine

FIX = "--fix" in sys.argv


def main() -> int:
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT
                c.relname            AS table_name,
                a.attname            AS column_name,
                pg_get_serial_sequence(c.relname, a.attname) AS seq
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            JOIN pg_attribute a ON a.attrelid = c.oid
            WHERE n.nspname = 'public'
              AND c.relkind = 'r'
              AND a.attnum > 0
              AND NOT a.attisdropped
              AND pg_get_serial_sequence(c.relname, a.attname) IS NOT NULL
            ORDER BY c.relname
        """)).fetchall()

    stale, healthy = [], 0
    for table, column, seq in rows:
        with engine.connect() as conn:
            max_id = conn.execute(text(f"SELECT COALESCE(MAX({column}), 0) FROM {table}")).scalar()
            last = conn.execute(text("SELECT last_value, is_called FROM " + seq)).fetchone()
        last_value, is_called = last[0], last[1]
        # Next id the sequence will hand out.
        next_id = last_value + 1 if is_called else last_value
        if next_id <= max_id:
            stale.append((table, column, seq, max_id, next_id))
        else:
            healthy += 1

    print(f"sequences checked: {len(rows)}  healthy: {healthy}  STALE: {len(stale)}")
    if not stale:
        print("\nNothing to do — every sequence is ahead of its table's max id.")
        return 0

    print("\nStale — the next INSERT into these tables will fail with a duplicate key:")
    print(f"  {'table':<32} {'max(id)':>9} {'next id':>9}")
    for table, column, _seq, max_id, next_id in stale:
        print(f"  {table:<32} {max_id:>9} {next_id:>9}")

    if not FIX:
        print("\nDRY RUN — nothing changed. Re-run with --fix to advance these sequences.")
        return 0

    for table, column, seq, max_id, _ in stale:
        with engine.begin() as conn:
            conn.execute(text("SELECT setval(:s, :v)"), {"s": seq, "v": max_id})
        print(f"  advanced {seq} -> {max_id}")
    print(f"\nRepaired {len(stale)} sequence(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
