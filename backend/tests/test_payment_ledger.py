from app import models
from app.utils.payment_ledger import apply_coverage_to_collections


def test_reverse_coverage_reduces_paid_amount_and_updates_status():
    collection = models.ChandaCollection(
        month="2026-01",
        amount_due=100.0,
        total_paid=100.0,
        status="paid",
    )

    apply_coverage_to_collections([collection], {"2026-01": 100.0}, reverse=True)

    assert collection.total_paid == 0.0
    assert collection.status == "pending"
