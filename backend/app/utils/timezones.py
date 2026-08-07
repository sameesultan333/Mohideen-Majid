from datetime import datetime, timezone, date as _date
from zoneinfo import ZoneInfo


INDIA_TZ = ZoneInfo("Asia/Kolkata")


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def utc_now_naive() -> datetime:
    return utc_now().replace(tzinfo=None)


def to_india(dt: datetime | _date | None = None) -> datetime:
    if isinstance(dt, _date) and not isinstance(dt, datetime):
        dt = datetime(dt.year, dt.month, dt.day, tzinfo=timezone.utc)
    value = dt or utc_now()
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(INDIA_TZ)


def india_month_key(dt: datetime | _date | None = None) -> str:
    return to_india(dt).strftime("%Y-%m")


def month_key_to_label(month_key: str) -> str:
    return datetime.strptime(month_key, "%Y-%m").strftime("%b %Y")


def month_key_to_full_label(month_key: str) -> str:
    return datetime.strptime(month_key, "%Y-%m").strftime("%B %Y")


def parse_frontend_datetime(value: datetime | None = None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def add_months(month_key: str, offset: int) -> str:
    year, month = map(int, month_key.split("-"))
    month_index = (year * 12 + (month - 1)) + offset
    new_year = month_index // 12
    new_month = (month_index % 12) + 1
    return f"{new_year:04d}-{new_month:02d}"
