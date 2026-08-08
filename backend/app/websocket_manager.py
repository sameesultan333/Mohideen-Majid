import asyncio
import logging

import anyio
from fastapi import WebSocket

log = logging.getLogger(__name__)

# Tasks scheduled from async callers. asyncio only holds a weak reference to a
# running task, so without a strong reference here the garbage collector can
# cancel a broadcast mid-flight.
_pending: set[asyncio.Task] = set()


def _run_coro_sync(coro_fn, *args) -> None:
    """
    Run a manager coroutine from a `def` that may be sync or async.

    `anyio.from_thread.run` only works from a worker thread. Called from an
    `async def` route it raises RuntimeError, and every *_sync wrapper below
    swallowed that — so an event published from an async route was silently
    dropped and never reached a single subscriber. Every route that *creates*
    something (collect_payment, user_pay, add_donation, approve_registration)
    is `async def`, which is why new collections and donations never appeared
    live while edits and verifications did.

    Scheduling on the already-running loop keeps both kinds of caller working
    without changing any route.
    """
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop is not None:
        task = loop.create_task(coro_fn(*args))
        _pending.add(task)
        task.add_done_callback(_pending.discard)
        return

    try:
        anyio.from_thread.run(coro_fn, *args)
    except RuntimeError:
        # No loop and no worker-thread token — nothing is listening anyway
        # (scripts, migrations, tests). Log rather than vanish.
        log.debug("broadcast dropped: no event loop available", exc_info=True)


FINANCE_EVENTS = {
    "chanda_generated", "payment_collected", "payment_verified",
    "donation_created", "donation_updated", "donation_deleted",
    "expense_created", "expense_updated", "expense_deleted",
    "family_created", "family_updated", "family_deleted",
    "monthly_amount_updated", "receipt_generated", "finance_dashboard_updated",
}
RELIGIOUS_EVENTS = {
    "prayer_updated",
    "announcement_created", "announcement_updated", "announcement_deleted",
    "hadith_created", "hadith_updated", "hadith_deleted",
    "question_created", "answer_created", "answer_updated", "answer_deleted",
}
ADMIN_EVENTS = {
    "user_created", "user_updated", "staff_created", "role_changed", "settings_updated",
}
ALL_EVENTS = FINANCE_EVENTS | RELIGIOUS_EVENTS | ADMIN_EVENTS

# Maps channel names to their valid event sets
CHANNEL_EVENTS: dict[str, set[str]] = {
    "finance":       FINANCE_EVENTS,
    "prayer":        {"prayer_updated"},
    "announcements": {e for e in RELIGIOUS_EVENTS if "announcement" in e},
    "hadith":        {e for e in RELIGIOUS_EVENTS if "hadith" in e or "answer" in e},
    "questions":     {e for e in RELIGIOUS_EVENTS if "question" in e},
    "admin":         ADMIN_EVENTS,
}


class ConnectionManager:
    def __init__(self):
        self.channels: dict[str, list[WebSocket]] = {
            "announcements": [],
            "prayer": [],
            "questions": [],
            "hadith": [],
            "finance": [],
            "admin": [],
            "events": [],   # unified channel — receives every event
        }

    async def connect(self, websocket: WebSocket, channel: str):
        await websocket.accept()
        if channel not in self.channels:
            self.channels[channel] = []
        self.channels[channel].append(websocket)

    def disconnect(self, websocket: WebSocket, channel: str):
        if channel in self.channels and websocket in self.channels[channel]:
            self.channels[channel].remove(websocket)

    async def broadcast(self, channel: str, message: dict):
        if channel not in self.channels:
            return
        dead = []
        for ws in self.channels[channel]:
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.channels[channel].remove(ws)

    # ── Canonical API ────────────────────────────────────────────────────

    async def publish(self, channel: str, event: str, payload: dict):
        """
        Broadcast a typed event.
        Always goes to the unified /ws/events channel.
        Also goes to the named channel for targeted subscribers.
        """
        message = {"type": event, "channel": channel, **payload}
        await self.broadcast("events", message)
        await self.broadcast(channel, message)

    def publish_sync(self, channel: str, event: str, payload: dict):
        """Sync wrapper for publish — safe from sync *and* async handlers."""
        _run_coro_sync(self.publish, channel, event, payload)

    # ── Backward-compat aliases ──────────────────────────────────────────

    async def emit(self, event_type: str, payload: dict):
        """Legacy — routes event to correct channel automatically."""
        if event_type in FINANCE_EVENTS:
            channel = "finance"
        elif event_type in ADMIN_EVENTS:
            channel = "admin"
        elif "announcement" in event_type:
            channel = "announcements"
        elif "hadith" in event_type or "answer" in event_type:
            channel = "hadith"
        elif "question" in event_type:
            channel = "questions"
        elif "prayer" in event_type:
            channel = "prayer"
        else:
            channel = "events"
        await self.publish(channel, event_type, payload)

    def emit_sync(self, event_type: str, payload: dict):
        """Legacy sync wrapper — prefer publish_sync for new code."""
        _run_coro_sync(self.emit, event_type, payload)

    def broadcast_sync(self, channel: str, message: dict):
        """Legacy — prefer publish_sync for new code."""
        _run_coro_sync(self.broadcast, channel, message)


manager = ConnectionManager()
