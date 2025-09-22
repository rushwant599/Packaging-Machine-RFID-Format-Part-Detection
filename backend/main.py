from fastapi import FastAPI, File, UploadFile, HTTPException, WebSocket, WebSocketDisconnect, Form
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel
from fastapi.staticfiles import StaticFiles
from typing import Optional, List
import asyncio
import time
import os
import logging
from pathlib import Path
from contextlib import asynccontextmanager
from dotenv import load_dotenv
import json

# Local modules
from opc_client import OPCUAManager
from rfu_ivsingle_inventory import AsyncRFUInventoryClient, RFUInventoryError
from format_parser import FormatDataManager
from html_table_parser import MainTableRowExtractor
from simple_assignment_db import SimpleAssignmentManager
from config_manager import load_config, save_config
from opc_event_bytes_listener import OPCUAEventBytesListener
from dataclasses import asdict

# Load environment variables
env_path = Path(__file__).parent / ".env"
root_env_local = Path(__file__).parent.parent / ".env.local"
root_env_example = Path(__file__).parent.parent / ".env.example"

# Load in priority order (later files override earlier ones)
load_dotenv(env_path)  # backend/.env
load_dotenv(root_env_example)  # root/.env.example (fallback)
load_dotenv(root_env_local)  # root/.env.local (highest priority)
load_dotenv("../.env.docker")  # Docker env if available

logger = logging.getLogger(__name__)
logger.info(f"Environment files loaded:")
logger.info(f"  - backend/.env: {env_path.exists()}")
logger.info(f"  - root/.env.example: {root_env_example.exists()}")
logger.info(f"  - root/.env.local: {root_env_local.exists()}")
logger.info(f"  - ../.env.docker: {Path('../.env.docker').exists()}")

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def log_startup_banner():
    banner = r"""
 ::::::::   ::::::::  ::::    ::::  ::::::::::: ::::::::       :::     :::   ::: ::::    ::: :::    ::: 
:+:    :+: :+:    :+: +:+:+: :+:+:+     :+:    :+:    :+:      :+:     :+:   :+: :+:+:   :+: :+:    :+: 
+:+        +:+    +:+ +:+ +:+:+ +:+     +:+    +:+             +:+      +:+ +:+  :+:+:+  +:+  +:+  +:+  
+#++:++#++ +#+    +:+ +#+  +:+  +#+     +#+    +#+             +#+       +#++:   +#+ +:+ +#+   +#++:+   
       +#+ +#+    +#+ +#+       +#+     +#+    +#+             +#+        +#+    +#+  +#+#+#  +#+  +#+  
#+#    #+# #+#    #+# #+#       #+#     #+#    #+#    #+#      #+#        #+#    #+#   #+#+# #+#    #+# 
 ########   ########  ###       ### ########### ########       ########## ###    ###    #### ###    ### 
                      ..                                      
                    --..            .:.                     
                    -*+.           .*=:                     
                    -#@+           +@=..                    
                    --%@*.       .-%@:                      
                    ::-#@%-.    .=+#+#:                     
                    .-.-*===:  .-+*#@#%-.                   
                     =.:*=:-==-=-=+=#%*#-.                  
                    .+++++=+:++-=---*@@+=-.                 
                  .-=+---:-=....:---%@+:=-:                
               .:+==-.:+.+--:..::...-*-:::=:.               
              .-#+=-..#=-*=:.:..:....=-===#+.               
              .++:...=::+=-......:...::::+%#=..             
             .:++=...-#=-=--:..-+=..-.:.=#*=-*+.            
             .+--....=+-:.:..::...=-.::.-#=-+++=.           
             -:.:::-..:..+-.-:.=:..-:..::-+=-...*:.         
           .+#--===:.:=+:.:.... .-..=.+.:=+..::.-*-.        
          .:***%*=-::=:=---==-=:-:.:.-+::--.::=*=+*=.       
          ..-+++--=-:--###++**+=-+.=:.=:++::..::::.:..      
           ..:=+*++=+***-----:--:+...:++*-.:..:..:-=..      
             ..:+:::::::=+=:.....=--*+#+:.:-:...=+:..       
                 ......#:..:##*+==+=...-=.:.:.:.....        
                       .+=..-=-:..:-:.:=-*-.....:...        
                        :*+.:.........: ...:.:......        
                         ..=...-:.#.-*......::..            
                          ..    ......     
    """
    logger.warning("\n" + banner)

# Get configuration from environment
BACKEND_HOST = os.getenv("BACKEND_HOST", "127.0.0.1")
BACKEND_PORT = int(os.getenv("BACKEND_PORT", "8001"))
DEBUG = os.getenv("DEBUG", "true").lower() == "true"

# OPC UA Configuration
OPC_UA_ENABLED = os.getenv("OPC_UA_ENABLED", "false").lower() == "true"
OPC_UA_SERVER_URL = os.getenv("OPC_UA_SERVER_URL", "opc.tcp://localhost:4840")
OPC_UA_NODE_ID = os.getenv("OPC_UA_NODE_ID", "ns=2;i=1")

logger.info(f"Configuration loaded:")
logger.info(f"  - Host: {BACKEND_HOST}, Port: {BACKEND_PORT}, Debug: {DEBUG}")
logger.info(f"  - OPC UA Enabled: {OPC_UA_ENABLED}")
logger.info(f"  - OPC UA Server: {OPC_UA_SERVER_URL}")
logger.info(f"  - OPC UA Node: {OPC_UA_NODE_ID}")

# Initialize managers
opc_manager = None
# rfid_opc_manager deprecated (removed functionality)
rfid_opc_manager = None
format_manager = None
assignment_manager = None
# OPC UA Event Listener (Bytes Payload)
opc_event_listener: OPCUAEventBytesListener | None = None

# Live Zeitfenster-Puffer für extrahierte Hex IDs aus Event-Bytes
# Struktur: { hex_id: {"first_seen": ts, "last_seen": ts, "count": n} }
_live_event_hex_ids: dict[str, dict] = {}

# Live RFID Inventory (Direct Socket) State
async_rfu_client: AsyncRFUInventoryClient | None = None
_rfid_poll_task = None
_current_rfid_full: list[dict] = []  # letzter vollständiger Satz Tags (detailliert)
_current_rfid_epcs: list[str] = []   # nur EPC Strings
_last_rfid_timestamp: float | None = None
_current_rfid_seen: dict[str, dict] = {}  # per EPC: aggregation with first_seen, last_seen, read_count, last_rssi, last_power, antenna
_rfid_retention_sec: float = 10.0
_live_event_broadcast_task = None

# WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"WebSocket connected. Total connections: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        logger.info(f"WebSocket disconnected. Total connections: {len(self.active_connections)}")

    async def broadcast_value_change(self, data: dict):
        """Broadcast value change to all connected clients"""
        if not self.active_connections:
            return
            
        message = json.dumps({
            "type": "value_change",
            "data": data,
            "timestamp": data.get("timestamp")
        })
        
        # Send to all connected clients
        disconnected = []
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except Exception as e:
                logger.error(f"Error sending WebSocket message: {e}")
                disconnected.append(connection)
        
        # Remove disconnected connections
        for conn in disconnected:
            self.disconnect(conn)

    async def broadcast_json(self, payload: dict):
        """Broadcast a raw JSON payload (already containing type field)."""
        if not self.active_connections:
            return
        message = json.dumps(payload)
        disconnected = []
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except Exception as e:  # noqa: BLE001
                logger.error(f"Error sending WebSocket JSON message: {e}")
                disconnected.append(connection)
        for conn in disconnected:
            self.disconnect(conn)

# Global connection manager
websocket_manager = ConnectionManager()

# FastAPI lifespan context manager
@asynccontextmanager
async def lifespan(app: FastAPI):
    global opc_manager, rfid_opc_manager, format_manager, assignment_manager, async_rfu_client, _rfid_poll_task, _current_rfid_full, _current_rfid_epcs, _last_rfid_timestamp, opc_event_listener
    
    # Startup
    log_startup_banner()
    logger.info("Starting RFID Parts Backend...")
    
    # Initialize Simple Assignment Database
    data_dir = Path(__file__).parent.parent / "data"
    data_dir.mkdir(exist_ok=True)
    assignment_manager = SimpleAssignmentManager(str(data_dir / "format_assignments.db"))
    await assignment_manager.initialize()
    
    # OPC UA Manager: Starte automatisch, wenn in Config aktiviert
    from config_manager import load_config
    config = load_config()
    opc_manager = None
    if config.get("OPC_UA_ENABLED", False):
        from opc_client import OPCUAManager
        OPC_UA_SERVER_URL = config.get("OPC_UA_SERVER_URL", "opc.tcp://localhost:4840")
        OPC_UA_NODE_ID = config.get("OPC_UA_NODE_ID", "ns=2;i=1")
        opc_manager = OPCUAManager(OPC_UA_SERVER_URL, OPC_UA_NODE_ID, enabled=True)
        async def value_change_callback(new_value):
            await websocket_manager.broadcast_value_change(new_value)
        opc_manager.add_value_change_callback(value_change_callback)
        await opc_manager.start_monitoring()
        logger.info("OPC UA client auto-started from config.")
    
    # RFID OPC UA Manager deprecated: no auto start
    rfid_opc_manager = None
    if config.get("RFID_OPC_ENABLED"):
        logger.warning("RFID_OPC_ENABLED is set but RFID OPC client is deprecated and will not start.")
    
    
    # OPC UA Event Bytes Listener (neu)
    opc_event_listener = None
    if config.get("OPC_UA_EVENT_ENABLED", False):
        evt_url = config.get("OPC_UA_EVENT_SERVER_URL", config.get("OPC_UA_SERVER_URL", "opc.tcp://localhost:4840"))
        evt_type = config.get("OPC_UA_EVENT_TYPE", "ns=4;i=6050")
        evt_interval = int(config.get("OPC_UA_EVENT_INTERVAL_MS", 500))
        evt_max = int(config.get("OPC_UA_EVENT_MAX_EVENTS", 500))
        opc_event_listener = OPCUAEventBytesListener(
            server_url=evt_url,
            event_type=evt_type,
            publishing_interval_ms=evt_interval,
            max_events=evt_max,
        )

        async def _event_cb(rec):  # rec: EventBytesRecord
            await websocket_manager.broadcast_value_change({
                "type": "opc_event",
                "timestamp": rec.timestamp,
                "payload": rec.payload
            })
            if rec.payload:
                now_ts = time.time()
                for hx in extract_hex_ids_from_payload(rec.payload):
                    # Persist in DB
                    if assignment_manager:
                        await assignment_manager.record_rfid_tag(hx)
                    # Update live window buffer
                    meta = _live_event_hex_ids.get(hx)
                    if meta:
                        meta["last_seen"] = now_ts
                        meta["count"] += 1
                    else:
                        _live_event_hex_ids[hx] = {"first_seen": now_ts, "last_seen": now_ts, "count": 1}
                # Broadcast updated live_event_ids snapshot (pruned within a default window e.g. 8s)
                try:
                    cutoff = now_ts - 8.0
                    to_delete = [k for k, v in _live_event_hex_ids.items() if v["last_seen"] < cutoff]
                    for k in to_delete:
                        _live_event_hex_ids.pop(k, None)
                    ids = list(_live_event_hex_ids.keys())
                    ids.sort(key=lambda x: _live_event_hex_ids[x]["last_seen"], reverse=True)
                    await websocket_manager.broadcast_json({
                        "type": "live_event_ids",
                        "ids": ids,
                        "count": len(ids),
                        "timestamp": now_ts
                    })
                except Exception as be:  # noqa: BLE001
                    logger.error(f"Broadcast live_event_ids failed: {be}")

        opc_event_listener.add_callback(_event_cb)
        await opc_event_listener.start()
        logger.info("OPC UA Event Listener gestartet (%s / %s)", evt_url, evt_type)

    # Periodically broadcast current live_event_ids snapshot so clients update without manual refresh
    import asyncio as _a
    async def _periodic_live_ids_broadcast():
        last_ids: list[str] | None = None
        while True:
            try:
                await _a.sleep(1.0)
                now_ts = time.time()
                # Prune default 8s window
                cutoff = now_ts - 8.0
                to_delete = [k for k, v in _live_event_hex_ids.items() if v["last_seen"] < cutoff]
                for k in to_delete:
                    _live_event_hex_ids.pop(k, None)
                ids = list(_live_event_hex_ids.keys())
                ids.sort(key=lambda x: _live_event_hex_ids[x]["last_seen"], reverse=True)
                # Broadcast if changed (or on first run)
                if last_ids is None or ids != last_ids:
                    last_ids = ids.copy()
                    await websocket_manager.broadcast_json({
                        "type": "live_event_ids",
                        "ids": ids,
                        "count": len(ids),
                        "timestamp": now_ts
                    })
            except asyncio.CancelledError:
                # Task was cancelled during shutdown, exit gracefully
                break
            except Exception as e:  # noqa: BLE001
                logger.debug("Periodic live_event_ids broadcast error: %s", e)

    globals()["_live_event_broadcast_task"] = _a.create_task(_periodic_live_ids_broadcast())

    # Direct RFID Inventory (Socket) falls aktiviert
    if config.get("RFID_INVENTORY_ENABLED", False) and config.get("RFID_READER_IP"):
        reader_ip = config.get("RFID_READER_IP")
        reader_port = int(config.get("RFID_READER_PORT", 2111))
        reader_ant = config.get("RFID_READER_ANT", "F")
        interval = float(config.get("RFID_INVENTORY_INTERVAL_SEC", 1))
        retention = float(config.get("RFID_CURRENT_RETENTION_SEC", 10))
        globals()["_rfid_retention_sec"] = retention
        async_rfu_client = AsyncRFUInventoryClient(ip=reader_ip, port=reader_port, ant=reader_ant)

        async def _poll_loop():
            nonlocal interval, retention
            import asyncio as _a
            logger.info("Start direct RFID inventory polling ip=%s port=%s ant=%s interval=%.2fs", reader_ip, reader_port, reader_ant, interval)
            try:
                async with async_rfu_client:
                    async for result in async_rfu_client.poll_loop(interval=interval, limit=0, full=True):
                        now = time.time()
                        # Update aggregation + persistence
                        # result: list of tag dicts containing at least 'epc', maybe 'rssi_dbm', 'power_dbm', 'antenna'
                        for tag in result:
                            epc = tag.get("epc")
                            if not epc:
                                continue
                            seen_entry = _current_rfid_seen.get(epc)
                            if seen_entry is None:
                                _current_rfid_seen[epc] = {
                                    "epc": epc,
                                    "first_seen": now,
                                    "last_seen": now,
                                    "read_count": 1,
                                    "antenna": tag.get("antenna"),
                                    "last_rssi": tag.get("rssi_dbm"),
                                    "last_power": tag.get("power_dbm")
                                }
                                # Persist first time
                                if assignment_manager:
                                    await assignment_manager.record_rfid_tag(epc)
                            else:
                                seen_entry["last_seen"] = now
                                seen_entry["read_count"] += 1
                                if tag.get("rssi_dbm") is not None:
                                    seen_entry["last_rssi"] = tag.get("rssi_dbm")
                                if tag.get("power_dbm") is not None:
                                    seen_entry["last_power"] = tag.get("power_dbm")
                        # Retention filter + prune
                        cutoff = now - retention
                        to_delete = [k for k, v in _current_rfid_seen.items() if v["last_seen"] < cutoff]
                        for k in to_delete:
                            _current_rfid_seen.pop(k, None)
                        # Build current live lists from retained entries
                        live_entries = list(_current_rfid_seen.values())
                        _current_rfid_full = [
                            {
                                "epc": e["epc"],
                                "first_seen": e["first_seen"],
                                "last_seen": e["last_seen"],
                                "read_count": e["read_count"],
                                "antenna": e.get("antenna"),
                                "last_rssi": e.get("last_rssi"),
                                "last_power": e.get("last_power")
                            } for e in live_entries
                        ]
                        _current_rfid_epcs = [e["epc"] for e in live_entries]
                        _last_rfid_timestamp = now
                        if _current_rfid_epcs:
                            await websocket_manager.broadcast_value_change({
                                "type": "rfid_inventory",
                                "tags": _current_rfid_epcs,
                                "count": len(_current_rfid_epcs),
                                "timestamp": now
                            })
            except RFUInventoryError as e:
                logger.error("RFID inventory polling stopped (protocol error): %s", e)
            except Exception as e:  # noqa: BLE001
                logger.exception("RFID inventory polling crashed: %s", e)
            finally:
                logger.info("RFID inventory polling task ended")

        _rfid_poll_task = asyncio.create_task(_poll_loop())
    else:
        logger.info("Direct RFID inventory disabled or missing IP in config.")

    # Initialize format data manager (store cache under /data)
    cache_dir = Path(__file__).parent.parent / "data"
    cache_dir.mkdir(exist_ok=True)
    html_cache_path = cache_dir / "customer-html-cache.html"
    format_manager = FormatDataManager(str(html_cache_path))
    
    yield
    
    # Shutdown
    logger.info("Shutting down RFID Parts Backend...")
    if opc_manager:
        await opc_manager.stop_monitoring()
    if opc_event_listener:
        await opc_event_listener.stop()
    # Stop direct RFID inventory
    if _rfid_poll_task:
        _rfid_poll_task.cancel()
        try:
            await _rfid_poll_task
        except (Exception, asyncio.CancelledError):  # noqa: BLE001
            pass
    if _live_event_broadcast_task:
        _live_event_broadcast_task.cancel()
        try:
            await _live_event_broadcast_task
        except (Exception, asyncio.CancelledError):  # noqa: BLE001
            pass
    if assignment_manager:
        await assignment_manager.close()
    if opc_manager:
        await opc_manager.stop_monitoring()

app = FastAPI(title="RFID Parts Backend", version="1.0.0", lifespan=lifespan)

# Allow all hosts (we're behind nginx / container)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["*"])

class ForwardedProtoMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        proto = request.headers.get("x-forwarded-proto")
        if proto:
            request.scope["scheme"] = proto
        return await call_next(request)

app.add_middleware(ForwardedProtoMiddleware)

import socket

def _collect_local_ips():
    ips = set()
    try:
        hostname = socket.gethostname()
        # Primäre Host-IP
        ip = socket.gethostbyname(hostname)
        if ip and ip != "127.0.0.1":
            ips.add(ip)
    except Exception as e:  # noqa: BLE001
        logger.debug("Host IP detection failed: %s", e)
    # Zusätzliche heuristik: Docker default gateway häufig 172.17.0.1
    possible = ["172.17.0.1", os.getenv("HOST_IP", "")]  # HOST_IP optional vom Deployment mitgeben
    for p in possible:
        if p and p.count('.') == 3:
            ips.add(p)
    return list(ips)

_default_cors_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "http://0.0.0.0:3000",
    "http://0.0.0.0:3001",
]

extra_env = os.getenv("CORS_EXTRA_ORIGINS", "")
extra_origins = [o.strip() for o in extra_env.split(',') if o.strip()]

origins = list(dict.fromkeys(_default_cors_origins + extra_origins))  # de-dupe preserving order

if os.getenv("CORS_INCLUDE_LOCAL_IP", "true").lower() == "true":
    for ip in _collect_local_ips():
        for port in (3000, 3001):
            origins.append(f"http://{ip}:{port}")

# De-duplicate after adding IPs
origins = list(dict.fromkeys(origins))

# Private Netze standardmäßig erlauben (falls nicht explizit deaktiviert)
allow_private_regex = r"^http://(?:(?:localhost)|(?:127\.0\.0\.1)|(?:10(?:\.\d{1,3}){3})|(?:192\.168(?:\.\d{1,3}){2})|(?:172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})):30(?:00|01)$"
if os.getenv("CORS_ALLOW_PRIVATE_RANGES", "true").lower() in ("0","false","no"):
    allow_private_regex = None
    logger.info("CORS private range regex disabled by env")
else:
    logger.info("CORS private range regex enabled (covers 10.x.x.x / 192.168.x.x / 172.16-31.x.x)")

logger.info("CORS allow_origins: %s", origins)
if allow_private_regex:
    logger.info("CORS allow_origin_regex: %s", allow_private_regex)

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=allow_private_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# Debug Middleware um CORS-Probleme (400) zu analysieren
@app.middleware("http")
async def _cors_debug_logger(request, call_next):  # noqa: D401
    if request.method == "OPTIONS":
        origin = request.headers.get("origin")
        acrm = request.headers.get("access-control-request-method")
        headers_list = {k.lower(): v for k, v in request.headers.items() if k.lower().startswith("access-control")}
        logger.info("CORS DEBUG OPTIONS path=%s origin=%s acrm=%s headers=%s", request.url.path, origin, acrm, headers_list)
    return await call_next(request)
# -------------------------------------------------------------------------------

# Path to store HTML cache under shared /data (also mapped as a volume)
CACHE_DIR = Path(__file__).parent.parent / "data"
CACHE_DIR.mkdir(exist_ok=True)
HTML_CACHE_PATH = CACHE_DIR / "customer-html-cache.html"

# Pydantic models for request/response
class PasswordRequest(BaseModel):
    password: str

class PasswordResponse(BaseModel):
    success: bool
    message: str

class RFIDData(BaseModel):
    tag_id: str
    customer_name: str
    part_number: str
    description: str

class FormatPartAssignmentRequest(BaseModel):
    format_part: str
    rfid_tag_id: str

class FormatPartAssignmentResponse(BaseModel):
    success: bool
    message: str

class FormatParseResponse(BaseModel):
    success: bool
    message: str
    data: dict = None
    formatParts: list = None
    formatCount: int = 0

class ConfigUpdate(BaseModel):
    OPC_UA_SERVER_URL: Optional[str] = None
    OPC_UA_NODE_ID: Optional[str] = None
    OPC_UA_ENABLED: Optional[bool] = None    
    RFID_INVENTORY_ENABLED: Optional[bool] = None
    RFID_READER_IP: Optional[str] = None
    RFID_READER_PORT: Optional[int] = None
    RFID_READER_ANT: Optional[str] = None
    RFID_CURRENT_RETENTION_SEC: Optional[int] = None
    RFID_INVENTORY_INTERVAL_SEC: Optional[int] = None
    # OPC UA Event Listener
    OPC_UA_EVENT_ENABLED: Optional[bool] = None
    OPC_UA_EVENT_SERVER_URL: Optional[str] = None
    OPC_UA_EVENT_TYPE: Optional[str] = None
    OPC_UA_EVENT_INTERVAL_MS: Optional[int] = None
    OPC_UA_EVENT_MAX_EVENTS: Optional[int] = None
    THEME_COLOR: Optional[str] = None

@app.get("/")
async def root():
    """Health check endpoint"""
    return {"message": "RFID Parts Backend is running", "status": "healthy"}

@app.get("/api/health")
async def health_check():
    """Detailed health check"""
    health_data = {
        "status": "healthy",
        "version": "1.0.0",
        "cache_file_exists": HTML_CACHE_PATH.exists()
    }
    
    # Add OPC UA status if enabled
    if opc_manager:
        opc_status = await opc_manager.get_status()
        health_data["opc_ua"] = {
            "enabled": opc_status["enabled"],
            "available": opc_status["available"],
            "connection_status": opc_status["connection_status"],
            "has_value": opc_status["current_value"] is not None,
            "last_updated": opc_status["last_updated"]
        }
    else:
        health_data["opc_ua"] = {
            "enabled": False,
            "available": False,
            "connection_status": "disabled",
            "has_value": False,
            "last_updated": None
        }

    if rfid_opc_manager:
        rfid_opc_status = await rfid_opc_manager.get_status()
        health_data["rfid_opc"] = {
            "enabled": rfid_opc_status["enabled"],
            "available": rfid_opc_status["available"],
            "connection_status": rfid_opc_status["connection_status"],
            "has_value": rfid_opc_status["current_value"] is not None,
            "last_updated": rfid_opc_status["last_updated"]
        }
    else:
        health_data["rfid_opc"] = {
            "enabled": False,
            "available": False,
            "connection_status": "disabled",
            "has_value": False,
            "last_updated": None
        }
    
    # Add Event Listener status
    if opc_event_listener:
        health_data["opc_event_listener"] = {
            "enabled": True,
            "running": opc_event_listener.is_running(),
            "configured_type": config.get("OPC_UA_EVENT_TYPE") if (config := load_config()) else None
        }
    else:
        health_data["opc_event_listener"] = {"enabled": False, "running": False}
    return health_data

@app.post("/api/verify-password")
async def verify_password(request: PasswordRequest):
    """Verify password for Somic access"""
    # You can implement more sophisticated password verification here
    # For now, keeping the same logic as your Next.js app
    if request.password == "a":
        return PasswordResponse(success=True, message="Password correct")
    else:
        return PasswordResponse(success=False, message="Falsches Passwort!")

@app.get("/api/customer-html")
async def get_customer_html():
    """Get cached customer HTML"""
    try:
        if HTML_CACHE_PATH.exists():
            with open(HTML_CACHE_PATH, "r", encoding="utf-8") as f:
                content = f.read()
            return HTMLResponse(content=content)
        else:
            return HTMLResponse(content="", status_code=200)
    except Exception as e:
        logger.error(f"Error reading HTML cache: {e}")
        raise HTTPException(status_code=500, detail="Error reading HTML cache")

@app.get("/api/main-table-rows")
async def get_main_table_rows(
    as_html: bool = True,
    strip_whitespace: bool = False,
    with_meta: bool = False,
    duplicate_caption: bool = False
):
    """Extract all <tr> rows from the cached <table class="main">.

    Query Params:
        as_html: Return raw HTML (default) or plain text.
        strip_whitespace: Trim whitespace around HTML rows.
        with_meta: Include class meta + flags (adds rowsMeta output format when true).
        duplicate_caption: After every row with classes 'caption line' append all rows having only class 'caption'.
    """
    if not HTML_CACHE_PATH.exists():
        raise HTTPException(status_code=404, detail="customer-html-cache.html not found. Upload a file first.")
    try:
        extractor = MainTableRowExtractor(str(HTML_CACHE_PATH))
        rows = extractor.extract_rows(
            as_html=as_html,
            strip_whitespace=strip_whitespace,
            with_meta=with_meta,
            duplicate_caption=duplicate_caption
        )
        resp = {
            "success": True,
            "count": len(rows),
            "as_html": as_html,
            "with_meta": with_meta,
            "duplicate_caption": duplicate_caption,
        }
        if with_meta:
            resp["rowsMeta"] = rows
        else:
            resp["rows"] = rows
        return resp
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="HTML cache file not found")
    except Exception as e:
        logger.exception("Error extracting main table rows: %s", e)
        raise HTTPException(status_code=500, detail="Error extracting rows")

@app.post("/api/customer-html")
async def upload_customer_html(file: UploadFile = File(...)):
    """Upload and cache customer HTML"""
    try:
        if not file:
            raise HTTPException(status_code=400, detail="No file uploaded")
        
        # Read the uploaded file
        content = await file.read()
        
        # Save to cache file
        with open(HTML_CACHE_PATH, "wb") as f:
            f.write(content)
        
        # Return the content as HTML
        return HTMLResponse(content=content.decode("utf-8"))
    except Exception as e:
        logger.error(f"Error uploading HTML file: {e}")
        raise HTTPException(status_code=500, detail="Error processing uploaded file")
    

# Format Data Endpoints (using FormatDataManager)
@app.get("/api/format-data")
async def get_format_data():
    """Parse and return format data from customer HTML cache"""
    try:
        if not format_manager.file_exists():
            return FormatParseResponse(
                success=False,
                message="Customer HTML cache file not found. Please upload a file first.",
                data={}
            )
        
        # Parse the format data
        format_data = format_manager.get_format_data()
        
        if not format_data:
            return FormatParseResponse(
                success=False,
                message="No format data found in the HTML file",
                data={}
            )
        
        return FormatParseResponse(
            success=True,
            message="Format data parsed successfully",
            data=format_data,
            formatParts=format_data.get('formatParts', []),
            formatCount=len(format_data.get('formats', {}))
        )
        
    except Exception as e:
        logger.error(f"Error parsing format data: {e}")
        raise HTTPException(status_code=500, detail="Internal server error while parsing format data")

@app.get("/api/format-parts")
async def get_format_parts():
    """Get only the format parts list"""
    try:
        return format_manager.get_format_parts()
    except Exception as e:
        logger.error(f"Error getting format parts: {e}")
        return {"formatParts": [], "error": str(e)}

@app.get("/api/formats")
async def get_formats():
    """Get the complete formats data"""
    try:
        return format_manager.get_formats()
    except Exception as e:
        logger.error(f"Error getting formats: {e}")
        return {"formats": {}, "error": str(e)}

@app.get("/api/format-parts-per-format")
async def get_format_parts_per_format():
    """Get format parts grouped by format"""
    try:
        return format_manager.get_format_parts_per_format()
    except Exception as e:
        logger.error(f"Error getting format parts per format: {e}")
        return {"formatPartsPerFormat": {}, "error": str(e)}

@app.get("/api/format-parts-per-format-with-index")
async def get_format_parts_per_format_with_index():
    """Get combined valueIndex + part entries grouped by format"""
    try:
        return format_manager.get_format_parts_per_format_with_index()
    except Exception as e:
        logger.error(f"Error getting format parts per format with index: {e}")
        return {"formatPartsPerFormatWithIndex": {}, "error": str(e)}

# OPC UA API Endpoints
@app.get("/api/opc-ua/status")
async def get_opc_ua_status():
    """Get OPC UA connection status and configuration"""
    if not opc_manager:
        return {
            "enabled": False,
            "available": False,
            "connection_status": "disabled",
            "server_url": None,
            "node_id": None,
            "last_updated": None,
            "current_value": None
        }
    
    return await opc_manager.get_status()

@app.get("/api/opc-ua/value")
async def get_opc_ua_value():
    """Get current OPC UA node value"""
    if not opc_manager:
        raise HTTPException(status_code=400, detail="OPC UA is disabled")
    
    status = await opc_manager.get_status()
    
    if not status["available"]:
        raise HTTPException(status_code=500, detail="OPC UA library not available")
    
    if status["connection_status"] != "connected":
        raise HTTPException(status_code=503, detail=f"OPC UA not connected: {status['connection_status']}")
    
    current_value = await opc_manager.get_current_value()
    if current_value is None:
        raise HTTPException(status_code=404, detail="No value available yet")
    
    return {
        "success": True,
        "data": current_value,
        "last_updated": status["last_updated"]
    }

@app.get("/api/rfid-opc-ua/status")
async def get_rfid_opc_ua_status():
    """Get RFID OPC UA connection status"""
    if not rfid_opc_manager:
        return {
            "enabled": False,
            "available": False,
            "connection_status": "disabled"
        }
    
    return await rfid_opc_manager.get_status()

@app.get("/api/rfid-opc-ua/value")
async def get_rfid_opc_ua_value():
    """Get current RFID OPC UA node value"""
    if not rfid_opc_manager:
        raise HTTPException(status_code=400, detail="RFID OPC UA is disabled")
    
    status = await rfid_opc_manager.get_status()
    
    if status["connection_status"] != "connected":
        raise HTTPException(status_code=503, detail="RFID OPC UA not connected")
    
    current_value = await rfid_opc_manager.get_current_value()
    if current_value is None:
        raise HTTPException(status_code=404, detail="No RFID value available")
    
    return {
        "success": True,
        "data": current_value,
        "last_updated": status["last_updated"]
    }

@app.get("/api/rfid-tags")
async def list_persisted_rfid_tags():
    """Alle persistierten RFID Tags aus der Datenbank.

    Gibt Metadaten (first_seen, last_seen, read_count) zurück; keine Live-RSSI Werte.
    """
    if not assignment_manager:
        raise HTTPException(status_code=503, detail="Assignment manager not available")
    tags = await assignment_manager.list_rfid_tags()
    return {"success": True, "count": len(tags), "tags": tags}

@app.get("/api/current-rfid-tag-ids")
async def list_current_rfid_tag_ids():
    """Aktuell lesbare Tag-IDs basierend auf Retention-Window.

    Nutzt den direkten Inventory-Puffer. Es erfolgt kein Fallback auf Datenbank,
    weil nur die gerade (innerhalb der Retention) gesehenen Tags interessant sind.
    """
    global _current_rfid_epcs, _last_rfid_timestamp, _rfid_retention_sec
    # Optional: Soft refresh retention filtering (prune by timestamp now)
    now = time.time()
    cutoff = now - _rfid_retention_sec
    # Prune global seen dict again (in case Poll loop paused)
    for epc, meta in list(_current_rfid_seen.items()):
        if meta["last_seen"] < cutoff:
            _current_rfid_seen.pop(epc, None)
    _current_rfid_epcs = [e for e in _current_rfid_seen.keys()]
    if not _current_rfid_epcs:
        return {"success": True, "tagIds": [], "count": 0, "timestamp": _last_rfid_timestamp, "retention_sec": _rfid_retention_sec}
    return {
        "success": True,
        "tagIds": _current_rfid_epcs,
        "count": len(_current_rfid_epcs),
        "timestamp": _last_rfid_timestamp,
        "retention_sec": _rfid_retention_sec
    }

# Alias-Endpunkt damit Aufruf /api/rfid-tag-ids (ohne "current-") funktioniert
@app.get("/api/rfid-tag-ids")
async def list_current_rfid_tag_ids_alias():
    """Nur die persistierten Tag-IDs (gleiche Quelle wie /api/rfid-tags, aber ohne Metadaten).

    Hintergrund Wunsch: statt des Live-Retention Puffers ("current") sollen hier ausschließlich
    die dauerhaft gespeicherten Tags zurückkommen. Live-EPCs bleiben über /api/current-rfid-tag-ids verfügbar.
    """
    if not assignment_manager:
        raise HTTPException(status_code=503, detail="Assignment manager not available")
    tags = await assignment_manager.list_rfid_tags()  # enthält Metadaten
    tag_ids = [t["tag_id"] for t in tags]
    return {
        "success": True,
        "tagIds": tag_ids,
        "count": len(tag_ids),
        "source": "db"
    }

# Einfacher Status-Endpunkt für das direkte Inventory (Debug-Hilfe)
@app.get("/api/rfid-inventory/status")
async def rfid_inventory_status():
    running = _rfid_poll_task is not None and not _rfid_poll_task.done()
    return {
        "running": running,
        "tag_count": len(_current_rfid_epcs),
        "last_timestamp": _last_rfid_timestamp,
        "retention_sec": _rfid_retention_sec,
        "reader": None if not async_rfu_client else {
            "ip": async_rfu_client.ip,
            "port": async_rfu_client.port,
            "ant": async_rfu_client.ant
        }
    }


# WebSocket endpoint for OPC UA updates
@app.websocket("/ws/opc-ua")
async def websocket_opc_ua_updates(websocket: WebSocket):
    """WebSocket endpoint for OPC UA event updates"""
    await websocket_manager.connect(websocket)
    # Initial Snapshots: Assignments & Live Event IDs
    try:
        if assignment_manager:
            assignments = await assignment_manager.get_all_assignments()
            await websocket.send_text(json.dumps({
                "type": "assignments_update",
                "assignments": assignments,
                "count": len(assignments),
                "timestamp": time.time()
            }))
        # Live Event IDs snapshot
        if _live_event_hex_ids:
            now_ts = time.time()
            ids_snapshot = list(_live_event_hex_ids.keys())
            await websocket.send_text(json.dumps({
                "type": "live_event_ids",
                "ids": ids_snapshot,
                "count": len(ids_snapshot),
                "timestamp": now_ts
            }))
    except Exception as e:  # noqa: BLE001
        logger.error(f"Error sending initial WS snapshot: {e}")

    try:
        while True:
            # Wait for a message from the client (optional, if you want to receive messages)
            data = await websocket.receive_text()
            logger.info(f"Received WebSocket message: {data}")
            
            # You can add logic here to handle incoming WebSocket messages if needed
            
    except WebSocketDisconnect:
        websocket_manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        websocket_manager.disconnect(websocket)


# Format Part Assignment API Endpoints
@app.get("/api/format-assignments")
async def get_format_assignments():
    """Get all format part to RFID tag assignments"""
    if not assignment_manager:
        raise HTTPException(status_code=500, detail="Assignment manager not initialized")
    
    try:
        assignments = await assignment_manager.get_all_assignments()
        assignments_list = await assignment_manager.get_assignments_list()
        
        return {
            "success": True,
            "assignments": assignments,  # Dict format for frontend compatibility
            "assignments_list": assignments_list,  # List format with metadata
            "count": len(assignments)
        }
    except Exception as e:
        logger.error(f"Error getting format assignments: {e}")
        raise HTTPException(status_code=500, detail="Error retrieving assignments")

@app.post("/api/format-assignments")
async def assign_rfid_to_format_part(assignment: FormatPartAssignmentRequest):
    """Assign an RFID tag to a format part"""
    if not assignment_manager:
        raise HTTPException(status_code=500, detail="Assignment manager not initialized")
    
    try:
        success = await assignment_manager.assign_rfid_to_part(
            format_part=assignment.format_part,
            rfid_tag_id=assignment.rfid_tag_id
        )
        
        if success:
            # Broadcast updated assignments snapshot
            try:
                assignments = await assignment_manager.get_all_assignments()
                await websocket_manager.broadcast_json({
                    "type": "assignments_update",
                    "assignments": assignments,
                    "count": len(assignments),
                    "timestamp": time.time()
                })
            except Exception as be:  # noqa: BLE001
                logger.error(f"Broadcast assignments failed: {be}")
            return FormatPartAssignmentResponse(success=True, message=f"Successfully assigned {assignment.rfid_tag_id} to {assignment.format_part}")
        else:
            raise HTTPException(status_code=500, detail="Failed to create assignment")
            
    except Exception as e:
        logger.error(f"Error creating format assignment: {e}")
        raise HTTPException(status_code=500, detail="Error creating assignment")

@app.delete("/api/format-assignments/{format_part}")
async def unassign_rfid_from_format_part(format_part: str):
    """Remove RFID assignment from a format part"""
    if not assignment_manager:
        raise HTTPException(status_code=500, detail="Assignment manager not initialized")
    
    try:
        success = await assignment_manager.unassign_rfid_from_part(format_part)
        
        if success:
            try:
                assignments = await assignment_manager.get_all_assignments()
                await websocket_manager.broadcast_json({
                    "type": "assignments_update",
                    "assignments": assignments,
                    "count": len(assignments),
                    "timestamp": time.time()
                })
            except Exception as be:  # noqa: BLE001
                logger.error(f"Broadcast assignments failed: {be}")
            return {"success": True, "message": f"Unassigned RFID from {format_part}"}
        else:
            raise HTTPException(status_code=404, detail="Assignment not found")
            
    except Exception as e:
        logger.error(f"Error removing assignment for {format_part}: {e}")
        raise HTTPException(status_code=500, detail="Error removing assignment")

@app.get("/api/format-assignments/{format_part}")
async def get_assignment_for_format_part(format_part: str):
    """Get RFID tag assigned to a specific format part"""
    if not assignment_manager:
        raise HTTPException(status_code=500, detail="Assignment manager not initialized")
    
    try:
        rfid_tag_id = await assignment_manager.get_assignment_for_part(format_part)
        
        return {
            "success": True,
            "format_part": format_part,
            "rfid_tag_id": rfid_tag_id
        }
            
    except Exception as e:
        logger.error(f"Error getting assignment for {format_part}: {e}")
        raise HTTPException(status_code=500, detail="Error retrieving assignment")

@app.get("/api/config")
def get_config():
    config = load_config()
    logger.info(f"Config GET: {config}")
    return config

@app.post("/api/config")
async def update_config(update: ConfigUpdate):
    global opc_manager, rfid_opc_manager, opc_event_listener
    config = load_config()
    # Log the raw incoming update payload for debugging
    try:
        logger.info(f"Received config update payload: {update.dict()}")
    except Exception:
        logger.info("Received config update payload (could not serialize)")
    changed = False

    
    # Track OPC UA changes
    opc_ua_enabled_before = config.get("OPC_UA_ENABLED", False)
    opc_ua_enabled_after = update.OPC_UA_ENABLED if update.OPC_UA_ENABLED is not None else opc_ua_enabled_before
    opc_ua_config_changed = False
    
    # RFID OPC deprecated: ignore toggles
    
    # Update all config values
    for key in [
    "OPC_UA_SERVER_URL", "OPC_UA_NODE_ID", "OPC_UA_ENABLED",
        "RFID_INVENTORY_ENABLED", "RFID_READER_IP", "RFID_READER_PORT", "RFID_READER_ANT",
        "RFID_CURRENT_RETENTION_SEC", "RFID_INVENTORY_INTERVAL_SEC",
        "OPC_UA_EVENT_ENABLED", "OPC_UA_EVENT_SERVER_URL", "OPC_UA_EVENT_TYPE",
        "OPC_UA_EVENT_INTERVAL_MS", "OPC_UA_EVENT_MAX_EVENTS",
        "THEME_COLOR"
    ]:
        value = getattr(update, key)
        if value is not None:
            logger.info(f"Config UPDATE: {key} = {value}")
            config[key] = value
            changed = True
            if key in ["OPC_UA_SERVER_URL", "OPC_UA_NODE_ID", "OPC_UA_ENABLED"]:
                opc_ua_config_changed = True
    
    if changed:
        save_config(config)
        logger.info(f"Config SAVED: {config}")
        
        # Handle OPC UA changes
        if opc_ua_config_changed:
            await handle_opc_ua_config_change(config, opc_ua_enabled_before, opc_ua_enabled_after)
    # RFID OPC changes ignored
    # Direct RFID inventory
    await handle_direct_rfid_inventory_config_change(config)
    # Event Listener config apply
    await handle_opc_event_listener_config_change(config)
    
    return config


PICTURES_ENV_OVERRIDE = os.getenv("PICTURES_DIR", "").strip()
_pictures_static_mounted = False

DATA_DIR = (Path(__file__).parent.parent / "data").resolve()
PICTURES_DIR = (
    Path(PICTURES_ENV_OVERRIDE).expanduser().resolve()
    if PICTURES_ENV_OVERRIDE
    else (DATA_DIR / os.getenv("PICTURES_SUBDIR", "pictures"))
).resolve()

def _ensure_pictures_dir() -> bool:
    try:
        PICTURES_DIR.mkdir(parents=True, exist_ok=True)
        return True
    except Exception as e:  # noqa: BLE001
        logger.error("Failed to ensure pictures directory %s: %s", PICTURES_DIR, e)
        return False

def _mount_pictures_static() -> None:
    """Mount /pictures static route if directory is available and not yet mounted."""
    global _pictures_static_mounted
    if _pictures_static_mounted:
        return
    if not PICTURES_DIR.exists():
        if not _ensure_pictures_dir():
            logger.warning("/pictures static not mounted (directory unavailable): %s", PICTURES_DIR)
            return
    try:
        app.mount("/pictures", StaticFiles(directory=str(PICTURES_DIR)), name="pictures")
        _pictures_static_mounted = True
        logger.info("Mounted /pictures static directory: %s", PICTURES_DIR)
    except Exception as e:  # noqa: BLE001
        logger.error("Failed to mount /pictures static directory %s: %s", PICTURES_DIR, e)

# Initial attempt at import time
_mount_pictures_static()

@app.get("/api/pictures")
def list_pictures(include_meta: bool = False, part: str | None = None):
    """List files in the persistent pictures directory.

    Query Params:
        include_meta: If true, return size & modified timestamp per file.
    Auto-heals: If directory was removed after startup, attempts recreation.
    """
    try:
        if not PICTURES_DIR.exists():
            if not _ensure_pictures_dir():
                return JSONResponse({"success": False, "files": [], "count": 0, "message": "pictures directory unavailable"})
            # Try (re)mount if we just re-created it
            _mount_pictures_static()
        entries = []
        for name in sorted(os.listdir(PICTURES_DIR)):
            if name.startswith('.'):
                continue
            full = PICTURES_DIR / name
            if not full.is_file():
                continue
            if part and not name.startswith(part + "_") and not name.startswith(part + "."):
                # Convention: either exact part as prefix with underscore timestamp or direct filename starting with part.
                continue
            if include_meta:
                stat = full.stat()
                entries.append({
                    "name": name,
                    "size": stat.st_size,
                    "modified": stat.st_mtime
                })
            else:
                entries.append(name)
        return JSONResponse({
            "success": True,
            "files": entries,
            "count": len(entries),
            "directory": str(PICTURES_DIR),
            "mounted": _pictures_static_mounted
        })
    except Exception as e:  # noqa: BLE001
        logger.error("Error retrieving pictures list (%s): %s", PICTURES_DIR, e)
        raise HTTPException(status_code=500, detail="Error retrieving pictures list")


@app.get("/api/pictures/by-part/{format_part}")
def list_pictures_for_part(format_part: str):
    """Return only pictures that belong to a given format part.

    A picture is considered belonging to a part if the filename starts with
    "{format_part}_" or "{format_part}." (for legacy direct naming)
    """
    try:
        if not PICTURES_DIR.exists():
            if not _ensure_pictures_dir():
                return {"success": False, "files": [], "count": 0}
        files = [f for f in os.listdir(PICTURES_DIR) if os.path.isfile(PICTURES_DIR / f) and (f.startswith(format_part + "_") or f.startswith(format_part + "."))]
        return {"success": True, "files": sorted(files), "count": len(files)}
    except Exception as e:  # noqa: BLE001
        logger.error("Error listing pictures for part %s: %s", format_part, e)
        raise HTTPException(status_code=500, detail="Error retrieving pictures for part")


def _sanitize_part(part: str) -> str:
    import re
    cleaned = re.sub(r"[^A-Za-z0-9_\-]", "_", part.strip())[:100]
    if not cleaned:
        raise HTTPException(status_code=400, detail="Invalid format part")
    return cleaned


@app.post("/api/pictures/{format_part}")
async def upload_picture(
    format_part: str,
    file: UploadFile | None = File(None),
    image_base64: str | None = Form(None),
):
    """Upload a picture for a specific format part.

    Supports either multipart file upload (preferred) or a base64 encoded
    data URL passed via form field `image_base64` (e.g. from a camera capture).
    The stored filename pattern: {format_part}_{timestamp}.{ext}
    """
    import base64
    import secrets
    import mimetypes
    from datetime import datetime

    part_clean = _sanitize_part(format_part)

    if not (file or image_base64):
        raise HTTPException(status_code=400, detail="No image provided (file or image_base64 required)")

    if not PICTURES_DIR.exists():
        if not _ensure_pictures_dir():
            raise HTTPException(status_code=500, detail="Pictures directory unavailable")

    # Determine content & extension
    content: bytes
    ext = "jpg"

    if file:
        try:
            content = await file.read()
        except Exception as e:  # noqa: BLE001
            raise HTTPException(status_code=400, detail=f"Failed to read uploaded file: {e}")
        # Guess extension from filename or content type
        orig_name = file.filename or "upload"
        if "." in orig_name:
            ext_candidate = orig_name.rsplit(".", 1)[1].lower()
            if len(ext_candidate) <= 5:
                ext = ext_candidate
        elif file.content_type:
            guessed_ext = mimetypes.guess_extension(file.content_type) or ".jpg"
            ext = guessed_ext.lstrip('.')
    else:
        # Handle base64 data URL or raw base64
        b64 = image_base64.strip()
        if b64.startswith("data:"):
            # data:image/png;base64,XXXX
            try:
                header, b64data = b64.split(",", 1)
                if ";base64" in header:
                    if "image/" in header:
                        mime = header.split(";")[0].split(":", 1)[1]
                        guessed_ext = mimetypes.guess_extension(mime) or ".png"
                        ext = guessed_ext.lstrip('.')
                    content = base64.b64decode(b64data)
                else:
                    raise ValueError("Not a base64 data URL")
            except Exception as e:  # noqa: BLE001
                raise HTTPException(status_code=400, detail=f"Invalid data URL: {e}")
        else:
            # Raw base64 assumed jpeg
            try:
                content = base64.b64decode(b64)
                ext = "jpg"
            except Exception as e:  # noqa: BLE001
                raise HTTPException(status_code=400, detail=f"Invalid base64 image: {e}")

    if not content:
        raise HTTPException(status_code=400, detail="Empty image content")

    timestamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    rand = secrets.token_hex(4)
    filename = f"{part_clean}_{timestamp}_{rand}.{ext}"
    dest = PICTURES_DIR / filename

    try:
        with open(dest, "wb") as f:
            f.write(content)
    except Exception as e:  # noqa: BLE001
        logger.error("Failed to write picture %s: %s", dest, e)
        raise HTTPException(status_code=500, detail="Failed to save image")

    logger.info("Uploaded picture for %s: %s (%d bytes)", part_clean, filename, len(content))

    return {"success": True, "filename": filename, "format_part": part_clean, "size": len(content)}


async def handle_direct_rfid_inventory_config_change(config):
    """Start/stop/restart des direkten RFID Inventory Pollings je nach Config.

    BUGFIX: Vorher wurde immer sofort gestoppt wegen eines unbeabsichtigten
    return hinter globalem Reset. Jetzt korrekt gesteuert.
    """
    global async_rfu_client, _rfid_poll_task, _current_rfid_full, _current_rfid_epcs, _last_rfid_timestamp, _current_rfid_seen, _rfid_retention_sec

    enabled = config.get("RFID_INVENTORY_ENABLED", False) and bool(config.get("RFID_READER_IP"))
    desired_ip = config.get("RFID_READER_IP", "")
    # Robust numerische Konvertierung um 500 bei leerem/ungültigem Input zu vermeiden
    def _to_int(val, default):
        try:
            if val is None: return default
            if isinstance(val, str) and val.strip() == "": return default
            return int(val)
        except Exception:
            logger.warning("RFID config invalid int '%s' -> fallback %s", val, default)
            return default
    def _to_float(val, default):
        try:
            if val is None: return default
            if isinstance(val, str) and val.strip() == "": return default
            return float(val)
        except Exception:
            logger.warning("RFID config invalid float '%s' -> fallback %s", val, default)
            return default

    desired_port = _to_int(config.get("RFID_READER_PORT", 2111), 2111)
    desired_ant = config.get("RFID_READER_ANT", "F")
    interval = _to_float(config.get("RFID_INVENTORY_INTERVAL_SEC", 1), 1.0)
    retention = _to_float(config.get("RFID_CURRENT_RETENTION_SEC", 10), 10.0)
    _rfid_retention_sec = retention

    restart = False
    if _rfid_poll_task and _rfid_poll_task.done():
        restart = True
    if async_rfu_client and enabled:
        if async_rfu_client.ip != desired_ip or async_rfu_client.port != desired_port or async_rfu_client.ant != desired_ant:
            restart = True

    if not enabled:
        # Stop & reset only when disabling
        if _rfid_poll_task:
            _rfid_poll_task.cancel()
            try:
                await _rfid_poll_task
            except Exception:  # noqa: BLE001
                pass
            _rfid_poll_task = None
        async_rfu_client = None
        _current_rfid_full = []
        _current_rfid_epcs = []
        _current_rfid_seen = {}
        _last_rfid_timestamp = None
        logger.info("Direct RFID inventory stopped (disabled)")
        return

    # Enabled path
    if enabled and (async_rfu_client is None or restart or _rfid_poll_task is None):
        if _rfid_poll_task:
            _rfid_poll_task.cancel()
            try:
                await _rfid_poll_task
            except Exception:  # noqa: BLE001
                pass
        async_rfu_client = AsyncRFUInventoryClient(ip=desired_ip, port=desired_port, ant=desired_ant)
        logger.info("(Re)starting direct RFID inventory ip=%s port=%s ant=%s interval=%.2fs retention=%.1fs", desired_ip, desired_port, desired_ant, interval, retention)

        async def _poll_loop():
            global _current_rfid_full, _current_rfid_epcs, _last_rfid_timestamp, _current_rfid_seen
            try:
                async with async_rfu_client:
                    async for result in async_rfu_client.poll_loop(interval=interval, limit=0, full=True):
                        now = time.time()
                        for tag in result:
                            epc = tag.get("epc")
                            if not epc:
                                continue
                            seen_entry = _current_rfid_seen.get(epc)
                            if seen_entry is None:
                                _current_rfid_seen[epc] = {
                                    "epc": epc,
                                    "first_seen": now,
                                    "last_seen": now,
                                    "read_count": 1,
                                    "antenna": tag.get("antenna"),
                                    "last_rssi": tag.get("rssi_dbm"),
                                    "last_power": tag.get("power_dbm")
                                }
                                if assignment_manager:
                                    await assignment_manager.record_rfid_tag(epc)
                            else:
                                seen_entry["last_seen"] = now
                                seen_entry["read_count"] += 1
                                if tag.get("rssi_dbm") is not None:
                                    seen_entry["last_rssi"] = tag.get("rssi_dbm")
                                if tag.get("power_dbm") is not None:
                                    seen_entry["last_power"] = tag.get("power_dbm")
                        # Retention prune
                        cutoff = now - _rfid_retention_sec
                        for epc_key, meta in list(_current_rfid_seen.items()):
                            if meta["last_seen"] < cutoff:
                                _current_rfid_seen.pop(epc_key, None)
                        live_entries = list(_current_rfid_seen.values())
                        _current_rfid_full = [
                            {
                                "epc": e["epc"],
                                "first_seen": e["first_seen"],
                                "last_seen": e["last_seen"],
                                "read_count": e["read_count"],
                                "antenna": e.get("antenna"),
                                "last_rssi": e.get("last_rssi"),
                                "last_power": e.get("last_power")
                            } for e in live_entries
                        ]
                        _current_rfid_epcs = [e["epc"] for e in live_entries]
                        _last_rfid_timestamp = now
                        if _current_rfid_epcs:
                            await websocket_manager.broadcast_value_change({
                                "type": "rfid_inventory",
                                "tags": _current_rfid_epcs,
                                "count": len(_current_rfid_epcs),
                                "timestamp": now
                            })
            except Exception as e:  # noqa: BLE001
                logger.exception("Direct RFID inventory poll loop error: %s", e)
            finally:
                logger.info("Direct RFID inventory poll loop ended")

        _rfid_poll_task = asyncio.create_task(_poll_loop())
    else:
        logger.info("Direct RFID inventory already running (no restart needed)")

# handle_rfid_opc_config_change removed (deprecated)

async def handle_opc_ua_config_change(config, enabled_before, enabled_after):
    global opc_manager
    
    if enabled_before != enabled_after:
        if enabled_after:
            # Enable OPC UA client
            from opc_client import OPCUAManager
            OPC_UA_SERVER_URL = config.get("OPC_UA_SERVER_URL", "opc.tcp://localhost:4840")
            OPC_UA_NODE_ID = config.get("OPC_UA_NODE_ID", "ns=2;i=1")
            opc_manager = OPCUAManager(OPC_UA_SERVER_URL, OPC_UA_NODE_ID, enabled=True)
            
            async def value_change_callback(new_value):
                await websocket_manager.broadcast_value_change(new_value)
            
            opc_manager.add_value_change_callback(value_change_callback)
            await opc_manager.start_monitoring()
            logger.info("OPC UA client enabled and started live.")
        else:
            # Disable OPC UA client
            if opc_manager:
                await opc_manager.stop_monitoring()
                opc_manager = None
                logger.info("OPC UA client stopped and disabled live.")
    elif opc_manager and enabled_after:
        # Restart with new config
        await opc_manager.stop_monitoring()
        from opc_client import OPCUAManager
        OPC_UA_SERVER_URL = config.get("OPC_UA_SERVER_URL", "opc.tcp://localhost:4840")
        OPC_UA_NODE_ID = config.get("OPC_UA_NODE_ID", "ns=2;i=1")
        opc_manager = OPCUAManager(OPC_UA_SERVER_URL, OPC_UA_NODE_ID, enabled=True)
        
        async def value_change_callback(new_value):
            await websocket_manager.broadcast_value_change(new_value)
        
        opc_manager.add_value_change_callback(value_change_callback)
        await opc_manager.start_monitoring()
        logger.info("OPC UA client restarted live with new config.")


async def handle_opc_event_listener_config_change(config):
    """Start/Stop/Restart für OPC UA Event Bytes Listener nach Config-Update."""
    global opc_event_listener
    enabled = config.get("OPC_UA_EVENT_ENABLED", False)
    if not enabled:
        if opc_event_listener:
            await opc_event_listener.stop()
            opc_event_listener = None
            logger.info("OPC UA Event Listener gestoppt (disabled)")
        return
    # Enabled -> prüfen ob Neustart nötig
    evt_url = config.get("OPC_UA_EVENT_SERVER_URL", config.get("OPC_UA_SERVER_URL", "opc.tcp://localhost:4840"))
    evt_type = config.get("OPC_UA_EVENT_TYPE", "ns=4;i=6050")
    evt_interval = int(config.get("OPC_UA_EVENT_INTERVAL_MS", 500))
    evt_max = int(config.get("OPC_UA_EVENT_MAX_EVENTS", 500))
    restart = False
    if opc_event_listener is None:
        restart = True
    else:
        if (opc_event_listener.server_url != evt_url or
            opc_event_listener.event_type != evt_type or
            opc_event_listener.publishing_interval_ms != evt_interval or
            opc_event_listener.max_events != evt_max):
            restart = True
    if restart:
        if opc_event_listener:
            await opc_event_listener.stop()
        opc_event_listener = OPCUAEventBytesListener(
            server_url=evt_url,
            event_type=evt_type,
            publishing_interval_ms=evt_interval,
            max_events=evt_max,
        )
        async def _event_cb(rec):
            await websocket_manager.broadcast_value_change({
                "type": "opc_event",
                "timestamp": rec.timestamp,
                "payload": rec.payload
            })
            if rec.payload:
                now_ts = time.time()
                for hx in extract_hex_ids_from_payload(rec.payload):
                    if assignment_manager:
                        await assignment_manager.record_rfid_tag(hx)
                    meta = _live_event_hex_ids.get(hx)
                    if meta:
                        meta["last_seen"] = now_ts
                        meta["count"] += 1
                    else:
                        _live_event_hex_ids[hx] = {"first_seen": now_ts, "last_seen": now_ts, "count": 1}
        opc_event_listener.add_callback(_event_cb)
        await opc_event_listener.start()
        logger.info("OPC UA Event Listener (re)started (%s / %s)", evt_url, evt_type)

# Neue Endpunkte für Event Listener
@app.get("/api/opc-ua/events")
async def get_opc_ua_events(limit: int = 1000):
    if not opc_event_listener or not opc_event_listener.is_running():
        return {"success": False, "events": [], "running": False}
    events = opc_event_listener.get_events(limit=limit)
    return {"success": True, "count": len(events), "events": [asdict(e) for e in events]}

@app.get("/api/opc-ua/events/status")
async def get_opc_ua_events_status():
    cfg = load_config()
    return {
        "enabled": cfg.get("OPC_UA_EVENT_ENABLED", False),
        "running": bool(opc_event_listener and opc_event_listener.is_running()),
        "configured_type": cfg.get("OPC_UA_EVENT_TYPE"),
        "server_url": cfg.get("OPC_UA_EVENT_SERVER_URL", cfg.get("OPC_UA_SERVER_URL")),
        "max_events": cfg.get("OPC_UA_EVENT_MAX_EVENTS"),
        "interval_ms": cfg.get("OPC_UA_EVENT_INTERVAL_MS")
    }

# --- Hex ID Extraktion & Live Event IDs Endpoint ---
import re as _re
HEX_ID_REGEX = _re.compile(r"Ausgabe:([0-9A-Fa-f]+)")

def extract_hex_ids_from_payload(payload: str):
    core = payload.replace('<STX>', '').replace('<ETX>', '')
    found = HEX_ID_REGEX.findall(core)
    seen = set()
    ordered = []
    for f in found:
        fu = f.upper()
        if fu not in seen:
            seen.add(fu)
            ordered.append(fu)
    return ordered

@app.get("/api/live-event-ids")
async def get_live_event_ids(window_sec: float = 5.0):
    """Liefert einzigartige Hex IDs aus den jüngsten Event-Bytes innerhalb eines Zeitfensters.

    window_sec: Konfigurierbares Zeitfenster (Standard 8s). Werte <0 werden auf Default gesetzt.
    Es wird ein eigener Zeitpuffer (_live_event_hex_ids) genutzt, der bei jedem Event aktualisiert
    und hier bereinigt wird. So muss nicht der gesamte Event-Ring erneut geparst werden.
    """
    if window_sec <= 0:
        window_sec = 8.0
    running = bool(opc_event_listener and opc_event_listener.is_running())
    now_ts = time.time()
    cutoff = now_ts - window_sec
    # Prune alte Einträge
    to_delete = [k for k, v in _live_event_hex_ids.items() if v["last_seen"] < cutoff]
    for k in to_delete:
        _live_event_hex_ids.pop(k, None)
    # Ergebnis sammeln
    ids = list(_live_event_hex_ids.keys())
    # Optional sort: neueste zuerst
    ids.sort(key=lambda x: _live_event_hex_ids[x]["last_seen"], reverse=True)
    return {
        "success": True,
        "running": running,
        "count": len(ids),
        "window_sec": window_sec,
        "ids": ids,
        "meta": {k: _live_event_hex_ids[k] for k in ids}
    }

if __name__ == "__main__":
    import uvicorn

    # Docker-kompatible Konfiguration
    host = os.getenv("BACKEND_HOST", "0.0.0.0")  # 0.0.0.0 für Docker
    port = int(os.getenv("BACKEND_PORT", "8001"))
    debug = os.getenv("DEBUG", "false").lower() == "true"

    log_startup_banner()
    logger.info(f"Starting RFID Backend on {host}:{port}")
    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        reload=debug,
        access_log=True,
        log_level="debug" if debug else "info"
    )
