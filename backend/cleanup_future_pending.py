"""
Remove ungenerated future-month ChandaCollection rows left by the Excel import.

The import used to write one row per month column in the sheet, so months later
in the year landed in the DB as `pending` with total_paid = 0 before they were
ever generated. Those rows are what made Sep-Dec show as due for a member who
had paid through July.

Only rows that are ALL of the following are removed:
  * month is after the current India month (not generated yet)
  * total_paid is 0            → nothing was ever paid against it
  * no PaymentEntry references it

Months paid in advance are always kept. Nothing generated is ever touched.

Usage:
    python cleanup_future_pending.py            # dry run, prints what it would do
    python cleanup_future_pending.py --apply    # actually delete
"""

import sys

from app.database import SessionLocal
from app import models
from app.utils.chanda_months import current_month_key


def main(apply: bool) -> int:
    db = SessionLocal()
    try:
        current_month = current_month_key()

        candidates = (
            db.query(models.ChandaCollection)
            .filter(
                models.ChandaCollection.month > current_month,
                models.ChandaCollection.total_paid.is_(None)
                | (models.ChandaCollection.total_paid <= 0),
            )
            .order_by(models.ChandaCollection.month)
            .all()
        )

        # Never delete a row a payment points at, even if total_paid looks empty.
        referenced = {
            cid
            for (cid,) in db.query(models.PaymentEntry.collection_id)
            .filter(models.PaymentEntry.collection_id.isnot(None))
            .all()
        }
        doomed = [c for c in candidates if c.id not in referenced]
        skipped = len(candidates) - len(doomed)

        by_month: dict[str, int] = {}
        for c in doomed:
            by_month[c.month] = by_month.get(c.month, 0) + 1

        print(f"current month : {current_month}")
        print(f"total rows    : {db.query(models.ChandaCollection).count()}")
        print(f"removable     : {len(doomed)}")
        if skipped:
            print(f"kept (payment-linked): {skipped}")
        for month in sorted(by_month):
            print(f"   {month}  {by_month[month]:>5} rows")

        advance_kept = (
            db.query(models.ChandaCollection)
            .filter(
                models.ChandaCollection.month > current_month,
                models.ChandaCollection.total_paid > 0,
            )
            .count()
        )
        print(f"advance-paid future rows kept untouched: {advance_kept}")

        if not doomed:
            print("\nNothing to do.")
            return 0

        if not apply:
            print("\nDRY RUN — nothing was deleted. Re-run with --apply to delete.")
            return 0

        for c in doomed:
            db.delete(c)
        db.commit()
        print(f"\nDeleted {len(doomed)} rows.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main(apply="--apply" in sys.argv))
