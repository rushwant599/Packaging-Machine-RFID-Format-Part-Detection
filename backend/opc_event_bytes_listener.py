from __future__ import annotations
import asyncio
import logging
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Awaitable, Callable, Deque, List, Optional, TYPE_CHECKING, Any

try:
    from asyncua import Client, ua
except ImportError:
    Client = Any
    ua = Any

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class EventBytesRecord:
    timestamp: str
    payload: str


# OPC UA Event Bytes Listener
class _BytesOnlyHandler:
    
    # Initialization
    def __init__(self, on_event: Callable[[str], Awaitable[None]] | Callable[[str], None]):
        self._on_event = on_event

    # Event Notification
    async def event_notification(self, events): 
        if not isinstance(events, (list, tuple)):
            events = [events]
        for ev in events:
            payload = self._extract_payload(ev)
            if payload:
                try:
                    res = self._on_event(payload)
                    if asyncio.iscoroutine(res):
                        await res
                except Exception:
                    logger.exception("Fehler im Event Callback")

    # Extrahiere den Payload aus dem Event
    @staticmethod
    def _extract_payload(ev) -> Optional[str]:
        candidates = []
        if hasattr(ev, "EventFields"):
            try:
                candidates = getattr(ev, "EventFields") or []
            except Exception:
                candidates = []
        if not candidates:
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

# API
class OPCUAEventBytesListener:
    # Initialization
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
        self._client: Any = None
        self._subscription = None
        self._events: Deque[EventBytesRecord] = deque(maxlen=max_events)
        self._callbacks: List[Callable[[EventBytesRecord], None] | Callable[[EventBytesRecord], Awaitable[None]]] = []
        self._task: Optional[asyncio.Task] = None
        self._running = asyncio.Event()

    # Add callback
    def add_callback(
        self, cb: Callable[[EventBytesRecord], None] | Callable[[EventBytesRecord], Awaitable[None]]
    ):
        self._callbacks.append(cb)

    # Get stored events
    def get_events(self, limit: Optional[int] = None) -> List[EventBytesRecord]:
        if limit is None or limit >= len(self._events):
            return list(self._events)
        return list(self._events)[-limit:]

    # Start listener
    async def start(self):
        if self._task and not self._task.done():
            logger.warning("EventListener bereits gestartet")
            return
        if self.suppress_asyncua_logs:
            for name, level in [
                ("asyncua", logging.WARNING),
                ("asyncua.common.subscription", logging.ERROR),
            ]:
                logging.getLogger(name).setLevel(level)
        self._running.set()
        self._task = asyncio.create_task(self._run(), name="OPCUAEventBytesListener")

    # Stop listener
    async def stop(self):
        self._running.clear()
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        await self._cleanup()

    # Check if listener is running
    def is_running(self) -> bool:
        return self._task is not None and not self._task.done() and self._running.is_set()

    # Main Event-Loop
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
                    while self._running.is_set():
                        await asyncio.sleep(1)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"EventListener Fehler: {e}")
                await asyncio.sleep(5)
            finally:
                await self._cleanup()

    # Cleanup
    async def _cleanup(self):
        if self._subscription:
            try:
                await self._subscription.delete()
            except Exception:
                pass
            self._subscription = None
        self._client = None

    # Internal event payload handler
    async def _on_raw_payload(self, payload: str):
        record = EventBytesRecord(timestamp=datetime.now(timezone.utc).isoformat(), payload=payload)
        self._events.append(record)
        for cb in list(self._callbacks):
            try:
                res = cb(record)
                if asyncio.iscoroutine(res):
                    await res
            except Exception:
                logger.exception("Callback Fehler ignoriert")
