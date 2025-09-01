from __future__ import annotations

import argparse
import asyncio
import logging
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Awaitable, Callable, Deque, List, Optional, TYPE_CHECKING, Any

try:  # pragma: no cover - Import zur Laufzeit optional
    from asyncua import Client, ua  # type: ignore
except ImportError:  # pragma: no cover
    Client = Any  # type: ignore
    ua = Any  # type: ignore

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class EventBytesRecord:
    timestamp: str  # ISO UTC
    payload: str


class _BytesOnlyHandler:  # interne Handler-Klasse die asyncua Subscription verwendet
    def __init__(self, on_event: Callable[[str], Awaitable[None]] | Callable[[str], None]):
        self._on_event = on_event

    async def event_notification(self, events):  # von asyncua gerufen
        if not isinstance(events, (list, tuple)):
            events = [events]
        for ev in events:
            payload = self._extract_payload(ev)
            if payload:
                try:
                    res = self._on_event(payload)
                    if asyncio.iscoroutine(res):
                        await res  # type: ignore
                except Exception:  # pragma: no cover - defensive
                    logger.exception("Fehler im Event Callback")

    @staticmethod
    def _extract_payload(ev) -> Optional[str]:
        # Sammle potentielle EventFields
        candidates = []
        if hasattr(ev, "EventFields"):
            try:
                candidates = getattr(ev, "EventFields") or []
            except Exception:
                candidates = []
        if not candidates:
            # Fallback: alle public Attribute
            for k, v in ev.__dict__.items():
                if k.startswith("_"):
                    continue
                candidates.append(v)

        flat: List = []
        for c in candidates:
            if isinstance(c, list):
                flat.extend(c)
            else:
                flat.append(c)

        for item in flat:
            val = getattr(item, "Value", item)
            try:
                if isinstance(val, (bytes, bytearray)):
                    try:
                        s = val.decode("utf-8", "ignore")
                    except Exception:
                        s = val.hex()
                else:
                    s = str(val)
            except Exception:
                continue
            if "Ausgabe:" in s or "\x02" in s or "<STX>" in s:
                s = s.replace("\x02", "<STX>").replace("\x03", "<ETX>")
                return s
        return None


class OPCUAEventBytesListener:
    def __init__(
        self,
        server_url: str,
        event_type: str,
        publishing_interval_ms: int = 500,
        max_events: int = 1000,
        suppress_asyncua_logs: bool = True,
    ):
        self.server_url = server_url
        self.event_type = event_type
        self.publishing_interval_ms = publishing_interval_ms
        self.max_events = max_events
        self.suppress_asyncua_logs = suppress_asyncua_logs
        # Typ bewusst als Any, da asyncua optional ist
        self._client: Any = None
        self._subscription = None
        self._events: Deque[EventBytesRecord] = deque(maxlen=max_events)
        self._callbacks: List[Callable[[EventBytesRecord], None] | Callable[[EventBytesRecord], Awaitable[None]]] = []
        self._task: Optional[asyncio.Task] = None
        self._running = asyncio.Event()

    # Öffentliche API
    def add_callback(
        self, cb: Callable[[EventBytesRecord], None] | Callable[[EventBytesRecord], Awaitable[None]]
    ):
        self._callbacks.append(cb)

    def get_events(self, limit: Optional[int] = None) -> List[EventBytesRecord]:
        if limit is None or limit >= len(self._events):
            return list(self._events)
        return list(self._events)[-limit:]

    async def start(self):
        if self._task and not self._task.done():
            logger.warning("EventListener bereits gestartet")
            return
        if self.suppress_asyncua_logs:
            # Unterdrücke laute Detail-Logs der Bibliothek (PublishResult etc.)
            for name, level in [
                ("asyncua", logging.WARNING),
                ("asyncua.common.subscription", logging.ERROR),
            ]:
                logging.getLogger(name).setLevel(level)
        self._running.set()
        self._task = asyncio.create_task(self._run(), name="OPCUAEventBytesListener")

    async def stop(self):
        self._running.clear()
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        await self._cleanup()

    def is_running(self) -> bool:
        return self._task is not None and not self._task.done() and self._running.is_set()

    # Intern
    async def _run(self):
        if Client is None:
            logger.error("asyncua nicht installiert - EventListener deaktiviert")
            return
        while self._running.is_set():
            try:
                logger.info(f"[EventBytesListener] Connecting to {self.server_url}")
                async with Client(url=self.server_url) as client:
                    self._client = client
                    handler = _BytesOnlyHandler(self._on_raw_payload)
                    sub = await client.create_subscription(self.publishing_interval_ms, handler)
                    self._subscription = sub
                    server_node = client.get_node(ua.ObjectIds.Server)
                    nodeid = ua.NodeId.from_string(self.event_type)
                    try:
                        await sub.subscribe_events(server_node, evtypes=[nodeid])
                        logger.info(f"Subscribed to event type {self.event_type}")
                    except Exception as e:
                        logger.warning(f"Explizite EventType Subscription fehlgeschlagen ({e}) - fallback any event")
                        await sub.subscribe_events(server_node)
                    # idle loop
                    while self._running.is_set():
                        await asyncio.sleep(1)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"EventListener Fehler: {e}")
                await asyncio.sleep(5)
            finally:
                await self._cleanup()

    async def _cleanup(self):
        if self._subscription:
            try:
                await self._subscription.delete()
            except Exception:
                pass
            self._subscription = None
        self._client = None

    async def _on_raw_payload(self, payload: str):
        record = EventBytesRecord(timestamp=datetime.now(timezone.utc).isoformat(), payload=payload)
        self._events.append(record)
        # Callbacks
        for cb in list(self._callbacks):
            try:
                res = cb(record)
                if asyncio.iscoroutine(res):
                    await res  # type: ignore
            except Exception:  # pragma: no cover
                logger.exception("Callback Fehler ignoriert")


# --- CLI Support (optional) -------------------------------------------------

def _parse_args():  # pragma: no cover - nur bei direkter CLI Nutzung
    parser = argparse.ArgumentParser(description="OPC UA Event Bytes Listener (integrierte Version)")
    parser.add_argument("--url", required=True)
    parser.add_argument("--event-type", required=True, help="NodeId des EventType z.B. ns=4;i=6050")
    parser.add_argument("--interval", type=int, default=500, help="Publishing Interval ms")
    parser.add_argument("--max-events", type=int, default=1000)
    return parser.parse_args()


async def _cli_async(args):  # pragma: no cover
    listener = OPCUAEventBytesListener(
        server_url=args.url,
        event_type=args.event_type,
        publishing_interval_ms=args.interval,
        max_events=args.max_events,
    )

    async def print_cb(ev: EventBytesRecord):
        print(f"{ev.timestamp} {ev.payload}", flush=True)

    listener.add_callback(print_cb)
    await listener.start()
    try:
        while True:
            await asyncio.sleep(3600)
    except KeyboardInterrupt:
        pass
    finally:
        await listener.stop()


def _cli_entry():  # pragma: no cover
    logging.basicConfig(level=logging.INFO)
    args = _parse_args()
    asyncio.run(_cli_async(args))


if __name__ == "__main__":  # pragma: no cover
    _cli_entry()
