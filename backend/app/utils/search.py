"""
Forgiving text search for list endpoints.

Mirrors admin/src/utils/search.ts so server-side and client-side search behave
the same way: both the query and the searched columns are reduced to letters and
digits, making the match case-, space- and punctuation-insensitive.

    "sa mohideen"  -> matches "S.A. Mohideen Arif"
    "98419 74095"  -> matches "9841974095"

Every whitespace-separated token must match, in any order, so "arif mohideen"
finds "Mohideen Arif". A token must fit inside a single column; tokens are never
matched across a concatenation of two columns.

The POSIX class [:alnum:] keeps non-ASCII letters, so Tamil names still match.
"""

from sqlalchemy import and_, func, or_, true
from sqlalchemy.sql.elements import ColumnElement

_STRIP_PATTERN = "[^[:alnum:]]"


def normalize_search(value: object) -> str:
    """Lowercase and strip everything that is not a letter or digit."""
    return "".join(ch for ch in str(value or "").lower() if ch.isalnum())


def search_tokens(query: str | None) -> list[str]:
    """Split a raw query into normalized tokens, dropping empties."""
    if not query:
        return []
    return [token for token in (normalize_search(t) for t in query.split()) if token]


def _normalized(column) -> ColumnElement:
    return func.regexp_replace(
        func.lower(func.coalesce(column, "")), _STRIP_PATTERN, "", "g"
    )


def search_filter(query: str | None, *columns) -> ColumnElement:
    """Build an AND-of-tokens, OR-of-columns criterion for `query`.

    Returns a always-true criterion when the query has no usable tokens, so it
    can be applied unconditionally.
    """
    tokens = search_tokens(query)
    if not tokens or not columns:
        return true()

    normalized = [_normalized(column) for column in columns]
    return and_(*[
        or_(*[col.like(f"%{token}%") for col in normalized])
        for token in tokens
    ])
