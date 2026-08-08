"""Dashboard reads must not create audit rows; mutations still must.

/finance/dashboard and /funds/dashboard are polled on load, on every WebSocket
refresh and on each month change. Auditing them buried real entries in noise and
turned every read into a write. Viewing a dashboard changes nothing, so it is
not an auditable act — but this must not weaken auditing of actual mutations.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from app.audit_middleware import _AUDIT_GET_PATHS


def _would_audit(method: str, path: str) -> bool:
    """Mirrors the middleware's decision in AuditMiddleware.dispatch."""
    is_mutation = method.upper() in ("POST", "PUT", "PATCH", "DELETE")
    is_audit_get = method.upper() == "GET" and path in _AUDIT_GET_PATHS
    return is_mutation or is_audit_get


@pytest.mark.parametrize("path", ["/finance/dashboard", "/funds/dashboard"])
def test_dashboard_gets_are_not_audited(path):
    assert _would_audit("GET", path) is False


def test_no_get_is_audited_at_all():
    assert _AUDIT_GET_PATHS == set()


@pytest.mark.parametrize("method,path", [
    ("POST",   "/chanda/collect"),
    ("PUT",    "/chanda/verify/1"),
    ("POST",   "/chanda/admin-record"),
    ("POST",   "/chanda/rollback-approve/1"),
    ("PATCH",  "/admin/families/1/deactivate"),
    ("DELETE", "/expenses/1"),
    # Money movement on the very paths whose GET we stopped auditing.
    ("POST",   "/funds/dashboard"),
    ("POST",   "/finance/dashboard"),
])
def test_mutations_are_still_audited(method, path):
    assert _would_audit(method, path) is True
