"""
Every route that *creates* something is `async def`, and publish_sync used to
raise RuntimeError there and swallow it — so payment_collected, donation_created
and registration_approved never reached a subscriber. The Finance Timeline
therefore never showed a new collection, however often the client reconnected.
"""
import anyio
import pytest

from app.websocket_manager import ConnectionManager


class FakeWS:
    def __init__(self):
        self.sent = []

    async def accept(self):
        pass

    async def send_json(self, message):
        self.sent.append(message)


async def _subscribe(manager, channel):
    ws = FakeWS()
    await manager.connect(ws, channel)
    return ws


def test_publish_from_async_route_reaches_subscribers():
    async def main():
        manager = ConnectionManager()
        ws = await _subscribe(manager, "finance")

        async def collect_payment():          # mirrors chanda.py collect_payment
            manager.publish_sync("finance", "payment_collected", {"payment_id": 7})

        await collect_payment()
        await anyio.sleep(0.05)               # let the scheduled task run
        return ws.sent

    sent = anyio.run(main)
    assert [m["type"] for m in sent] == ["payment_collected"], sent
    assert sent[0]["payment_id"] == 7


def test_publish_from_sync_route_still_reaches_subscribers():
    async def main():
        manager = ConnectionManager()
        ws = await _subscribe(manager, "finance")

        def verify_payment():                 # mirrors chanda.py verify_payment
            manager.publish_sync("finance", "payment_verified", {"payment_id": 9})

        await anyio.to_thread.run_sync(verify_payment)
        await anyio.sleep(0.05)
        return ws.sent

    sent = anyio.run(main)
    assert [m["type"] for m in sent] == ["payment_verified"], sent


def test_events_channel_also_receives_async_publish():
    """publish() fans out to /ws/events as well as the named channel."""
    async def main():
        manager = ConnectionManager()
        events = await _subscribe(manager, "events")

        async def add_donation():
            manager.publish_sync("finance", "donation_created", {"donation_id": 3})

        await add_donation()
        await anyio.sleep(0.05)
        return events.sent

    sent = anyio.run(main)
    assert [m["type"] for m in sent] == ["donation_created"], sent


def test_broadcast_sync_from_async_route():
    """The receipt channel used broadcast_sync from async collect_payment too."""
    async def main():
        manager = ConnectionManager()
        ws = await _subscribe(manager, "receipt:CH-1")

        async def collect_payment():
            manager.broadcast_sync("receipt:CH-1", {"type": "receipt_update"})

        await collect_payment()
        await anyio.sleep(0.05)
        return ws.sent

    sent = anyio.run(main)
    assert [m["type"] for m in sent] == ["receipt_update"], sent


def test_no_loop_at_all_does_not_raise():
    """Scripts and migrations publish with nothing listening; must not crash."""
    manager = ConnectionManager()
    manager.publish_sync("finance", "payment_collected", {"payment_id": 1})
