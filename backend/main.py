from fastapi import FastAPI, File, UploadFile, HTTPException, WebSocket, WebSocketDisconnect, Form, Request
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
import base64
import secrets
import mimetypes
from datetime import datetime

# Local modules
from format_parser import FormatDataManager
from html_table_parser import MainTableRowExtractor
from simple_assignment_db import SimpleAssignmentManager
from config_manager import load_config, save_config
from opc_event_bytes_listener import OPCUAEventBytesListener
from dataclasses import asdict
from bs4 import BeautifulSoup

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


# Get configuration from environment
BACKEND_HOST = os.getenv("BACKEND_HOST", "127.0.0.1")
BACKEND_PORT = int(os.getenv("BACKEND_PORT", "8001"))
DEBUG = os.getenv("DEBUG", "false").lower() == "true"

# Basic process configuration logging
logger.info(f"Configuration loaded:")
logger.info(f"  - Host: {BACKEND_HOST}, Port: {BACKEND_PORT}, Debug: {DEBUG}")

# Initialize managers
opc_manager = None
format_manager = None
assignment_manager = None
opc_event_listener: OPCUAEventBytesListener | None = None

# Live Zeitfenster-Puffer für extrahierte Hex IDs aus Event-Bytes
# Struktur: { hex_id: {"first_seen": ts, "last_seen": ts, "count": n} }
_live_event_hex_ids: dict[str, dict] = {}

# WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    # Connect a new WebSocket client
    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"WebSocket connected. Total connections: {len(self.active_connections)}")

    # Disconnect a WebSocket client
    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        logger.info(f"WebSocket disconnected. Total connections: {len(self.active_connections)}")

    # Broadcast a value change to all connected clients
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

    # Broadcast a raw JSON payload (already containing type field).
    async def broadcast_json(self, payload: dict):
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
    global opc_manager, format_manager, assignment_manager, opc_event_listener
    # Startup
    logger.info("Starting RFID Parts Backend...")
    
    # Initialize Simple Assignment Database
    data_dir = Path(__file__).parent.parent / "data"
    data_dir.mkdir(exist_ok=True)
    assignment_manager = SimpleAssignmentManager(str(data_dir / "format_assignments.db"))
    await assignment_manager.initialize()
    
    #  PLC OPC UA Manager: Starte automatisch, wenn in Config aktiviert
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
    
    # RFID OPC UA Event Bytes Listener 
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

        # Callback für empfangene Events
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
                cutoff = now_ts - 8.0
                to_delete = [k for k, v in _live_event_hex_ids.items() if v["last_seen"] < cutoff]
                for k in to_delete:
                    _live_event_hex_ids.pop(k, None)
                ids = list(_live_event_hex_ids.keys())
                ids.sort(key=lambda x: _live_event_hex_ids[x]["last_seen"], reverse=True)
                if last_ids is None or ids != last_ids:
                    last_ids = ids.copy()
                    await websocket_manager.broadcast_json({
                        "type": "live_event_ids",
                        "ids": ids,
                        "count": len(ids),
                        "timestamp": now_ts
                    })
            except asyncio.CancelledError:
                break
            except Exception as e:  # noqa: BLE001
                logger.debug("Periodic live_event_ids broadcast error: %s", e)

    globals()["_live_event_broadcast_task"] = _a.create_task(_periodic_live_ids_broadcast())

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
    _task = globals().get("_live_event_broadcast_task")
    if _task:
        _task.cancel()
        try:
            await _task
        except (Exception, asyncio.CancelledError):  # noqa: BLE001
            pass
    if assignment_manager:
        await assignment_manager.close()

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
        ip = socket.gethostbyname(hostname)
        if ip and ip != "127.0.0.1":
            ips.add(ip)
    except Exception as e:  # noqa: BLE001
        logger.debug("Host IP detection failed: %s", e)
    possible = ["172.17.0.1", os.getenv("HOST_IP", "")]
    for p in possible:
        if p and p.count('.') == 3:
            ips.add(p)
    return list(ips)

# CORS Configuration for development and local access
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
    """Debug middleware to log CORS OPTIONS requests and headers."""
    if request.method == "OPTIONS":
        origin = request.headers.get("origin")
        acrm = request.headers.get("access-control-request-method")
        headers_list = {k.lower(): v for k, v in request.headers.items() if k.lower().startswith("access-control")}
        logger.info("CORS DEBUG OPTIONS path=%s origin=%s acrm=%s headers=%s", request.url.path, origin, acrm, headers_list)
    return await call_next(request)

# Path to store HTML cache under shared /data (also mapped as a volume)
CACHE_DIR = Path(__file__).parent.parent / "data"
CACHE_DIR.mkdir(exist_ok=True)
HTML_CACHE_PATH = CACHE_DIR / "customer-html-cache.html"
HTML_CACHE_ORIGINAL_PATH = CACHE_DIR / "customer-html-cache.original.html"
HTML_CACHE_INJECTED_COPY_PATH = CACHE_DIR / "customer-html-cache.injected.html"

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
    OPC_UA_EVENT_ENABLED: Optional[bool] = None
    OPC_UA_EVENT_SERVER_URL: Optional[str] = None
    OPC_UA_EVENT_TYPE: Optional[str] = None
    OPC_UA_EVENT_INTERVAL_MS: Optional[int] = None
    OPC_UA_EVENT_MAX_EVENTS: Optional[int] = None
    THEME_COLOR: Optional[str] = None

# API Endpoints
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
    if request.password == "a":
        return PasswordResponse(success=True, message="Password correct")
    else:
        return PasswordResponse(success=False, message="Falsches Passwort!")

@app.get("/api/customer-html")
async def get_customer_html(request: Request, original: bool = False):
    """Get cached customer HTML"""
    try:
        if original and HTML_CACHE_ORIGINAL_PATH.exists():
            with open(HTML_CACHE_ORIGINAL_PATH, "r", encoding="utf-8") as f:
                content = f.read()
            return HTMLResponse(content=content)
        if HTML_CACHE_PATH.exists():
            try:
                raw = HTML_CACHE_PATH.read_text(encoding="utf-8", errors="ignore")
                soup = BeautifulSoup(raw, "lxml")
            except Exception:
                try:
                    raw = HTML_CACHE_PATH.read_text(encoding="utf-8", errors="ignore")
                    soup = BeautifulSoup(raw, "html.parser")
                except Exception:
                    soup = None
            if soup is not None:
                try:
                    xf_proto = request.headers.get("x-forwarded-proto")
                    scheme = (xf_proto or request.url.scheme or "http").split(",")[0].strip()
                    host = request.headers.get("host") or request.url.netloc
                    if host:
                        desired_origin = f"{scheme}://{host}"
                        meta_origin = soup.find("meta", attrs={"name": "somic-backend-origin"})
                        if not meta_origin:
                            meta_origin = soup.new_tag('meta')
                            meta_origin['name'] = 'somic-backend-origin'
                            if soup.head:
                                soup.head.append(meta_origin)
                        meta_origin['content'] = desired_origin
                except Exception:
                    pass
                try:
                    script_tag = soup.find('script', attrs={'id': 'somic-rfid-inline'})
                    static_path = Path(__file__).parent / 'static' / 'somic-rfid.js'
                    if script_tag and static_path.exists():
                        script_code = static_path.read_text(encoding='utf-8', errors='ignore')
                        script_tag.string = script_code
                except Exception:
                    pass
                return HTMLResponse(content=str(soup))
            with open(HTML_CACHE_PATH, "r", encoding="utf-8") as f:
                content = f.read()
            return HTMLResponse(content=content)
        else:
            return HTMLResponse(content="", status_code=200)
    except Exception as e:
        logger.error(f"Error reading HTML cache: {e}")
        raise HTTPException(status_code=500, detail="Error reading HTML cache")

# Extract main table rows endpoint
@app.get("/api/main-table-rows")
async def get_main_table_rows(
    as_html: bool = True,
    strip_whitespace: bool = False,
    with_meta: bool = False,
    duplicate_caption: bool = False
):
    """Extract main table rows from cached HTML"""
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
        
        content = await file.read()
        html_text = content.decode("utf-8")

        def inject_rfid_column_and_ws(html: str) -> str:
            try:
                soup = BeautifulSoup(html, "lxml")
            except Exception:
                soup = BeautifulSoup(html, "html.parser")

            if soup.find('meta', attrs={'name': 'somic-rfid-injected'}):
                return str(soup)

            injected_any = False
            logger.info("inject_rfid: tables found=%d", len(soup.find_all('table')))
            tables = soup.find_all('table')
            for table in tables:
                table_classes = table.get('class') or []
                if 'main' not in table_classes:
                    continue
                header_tr = None
                header_tr = table.select_one('tr.caption[name="TableHead"]')
                if not header_tr:
                    thead = table.find('thead')
                    if thead and thead.find('tr'):
                        header_tr = thead.find('tr')
                if not header_tr:
                    for candidate in table.find_all('tr'):
                        if candidate.find('th'):
                            header_tr = candidate
                            break

                if header_tr:
                    headers = header_tr.find_all('th')
                    rfid_ths = [h for h in headers if ((h.get_text() or '').strip().lower() == 'rfid')]
                    if len(rfid_ths) > 1:
                        for extra in rfid_ths[1:]:
                            try:
                                extra.decompose()
                            except Exception:
                                pass
                        headers = header_tr.find_all('th')
                    has_rfid = any((h.get_text() or '').strip().lower() == 'rfid' for h in headers)
                    if not has_rfid:
                        new_th = soup.new_tag('th')
                        new_th.string = 'RFID'
                        new_th['style'] = 'padding:6px 8px;background:#adafb0'
                        if len(headers) >= 2:
                            headers[1].insert_after(new_th)
                        else:
                            header_tr.append(new_th)
                        injected_any = True
                        logger.debug("inject_rfid: inserted header in table (header_tr)")

                        for row in table.find_all('tr'):
                            row_classes = row.get('class') or []
                            if 'line' in row_classes:
                                for cell in row.find_all(['td', 'th']):
                                    if 'colspan' in cell.attrs:
                                        try:
                                            cs = int(cell['colspan'])
                                            cell['colspan'] = str(cs + 1)
                                            logger.debug("inject_rfid: incremented colspan on line row to %s", cell['colspan'])
                                        except Exception:
                                            pass

                rows = table.find_all('tr')
                for tr in rows:
                    has_class_attr = 'class' in tr.attrs
                    class_attr_empty = False
                    if has_class_attr:
                        val = tr.attrs.get('class')
                        if val is None or val == [] or (isinstance(val, list) and len(val) == 1 and val[0] == ''):
                            class_attr_empty = True
                    else:
                        class_attr_empty = True
                    first_td = tr.find('td')
                    if not first_td:
                        continue
                    td_classes = first_td.attrs.get('class') or []
                    if not (('value' in td_classes) and ('index' in td_classes)):
                        continue
                    if not class_attr_empty:
                        continue

                    header_ths = table.find_all('thead th') if table.find('thead') else []
                    ftl_idx = None
                    for idx, h in enumerate(header_ths):
                        txt = (h.get_text() or '').lower().replace('.', '').strip()
                        if txt == 'ftl':
                            ftl_idx = idx
                            break

                    tds = tr.find_all('td')
                    if ftl_idx is not None and ftl_idx < len(tds):
                        ftl_text = (tds[ftl_idx].get_text() or '').strip()
                    else:
                        ftl_text = (tds[3].get_text() if len(tds) > 3 else '') or ''

                    nr_text = (first_td.get_text() or '').strip()
                    if not nr_text:
                        continue
                    if not ftl_text:
                        logger.debug("inject_rfid: empty FTL for row nr=%s, injecting with NR-only key", nr_text)

                    key = f"{nr_text} {ftl_text}".strip()
                    existing_cells = tr.find_all('td')
                    already = False
                    if len(existing_cells) > 2 and (existing_cells[2].get_text() or '').strip() in ['✔', '✖', '–']:
                        already = True
                    if already:
                        logger.debug("inject_rfid: row %s already has rfid cell", key)
                        continue

                    new_td = soup.new_tag('td')
                    new_td.string = '–'
                    new_td['title'] = f'Kein RFID zugeordnet | Key={key}'
                    new_td['data-format-key'] = key
                    new_td['style'] = 'padding:6px 8px;border:1px solid #000000;font-weight:700;color:#666'

                    if len(existing_cells) > 2:
                        existing_cells[2].insert_before(new_td)
                    else:
                        tr.append(new_td)
                    injected_any = True
                    logger.debug("inject_rfid: injected td for key=%s", key)

            if injected_any:
                logger.info("inject_rfid: injected_any=true, adding script tag and meta")
                head = soup.find('head')
                if not head:
                    head = soup.new_tag('head')
                    if soup.html:
                        soup.html.insert(0, head)
                    else:
                        soup.insert(0, head)
                meta = soup.new_tag('meta')
                meta['name'] = 'somic-rfid-injected'
                meta['content'] = '1'
                head.append(meta)

                meta_legend = soup.new_tag('meta')
                meta_legend['name'] = 'somic-rfid-legend'
                meta_legend['content'] = '1'
                head.append(meta_legend)

                try:
                    backend_host = os.getenv('BACKEND_HOST', '127.0.0.1')
                    if backend_host in ('0.0.0.0', '::'):
                        backend_host = '127.0.0.1'
                    backend_port = int(os.getenv('BACKEND_PORT', '8001'))
                    backend_origin = f"http://{backend_host}:{backend_port}"
                    meta_origin = soup.new_tag('meta')
                    meta_origin['name'] = 'somic-backend-origin'
                    meta_origin['content'] = backend_origin
                    head.append(meta_origin)
                except Exception:
                    pass

                try:
                    static_path = Path(__file__).parent / 'static' / 'somic-rfid.js'
                    script_code = static_path.read_text(encoding='utf-8', errors='ignore')
                    inline = soup.new_tag('script')
                    inline['id'] = 'somic-rfid-inline'
                    inline.string = script_code
                    if soup.body:
                        soup.body.append(inline)
                    else:
                        soup.append(inline)
                except Exception:
                    script_tag = soup.new_tag('script', src='/static/somic-rfid.js')
                    if soup.body:
                        soup.body.append(script_tag)
                    else:
                        soup.append(script_tag)

            return str(soup)

        injected_html = inject_rfid_column_and_ws(html_text)

        try:
            with open(HTML_CACHE_ORIGINAL_PATH, "wb") as f_orig:
                f_orig.write(content)
            logger.info("Saved original HTML upload to %s (%d bytes)", HTML_CACHE_ORIGINAL_PATH, len(content))
        except Exception as we:  # noqa: BLE001
            logger.error("Failed to save original HTML to %s: %s", HTML_CACHE_ORIGINAL_PATH, we)

        with open(HTML_CACHE_PATH, "w", encoding="utf-8") as f:
            f.write(injected_html)
        try:
            with open(HTML_CACHE_INJECTED_COPY_PATH, "w", encoding="utf-8") as f_inj:
                f_inj.write(injected_html)
        except Exception as we:  # noqa: BLE001
            logger.debug("Optional write of injected copy failed (%s): %s", HTML_CACHE_INJECTED_COPY_PATH, we)

        return HTMLResponse(content=injected_html)
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

@app.get("/api/rfid-tags")
async def list_persisted_rfid_tags():
    """Alle persistierten RFID Tags aus der Datenbank."""
    if not assignment_manager:
        raise HTTPException(status_code=503, detail="Assignment manager not available")
    tags = await assignment_manager.list_rfid_tags()
    return {"success": True, "count": len(tags), "tags": tags}


@app.get("/api/rfid-tag-ids")
async def list_current_rfid_tag_ids_alias():
    """Alias endpoint to list RFID tag IDs only"""
    if not assignment_manager:
        raise HTTPException(status_code=503, detail="Assignment manager not available")
    tags = await assignment_manager.list_rfid_tags()
    tag_ids = [t["tag_id"] for t in tags]
    return {
        "success": True,
        "tagIds": tag_ids,
        "count": len(tag_ids),
        "source": "db"
    }

@app.websocket("/ws/opc-ua")
async def websocket_opc_ua_updates(websocket: WebSocket):
    """WebSocket endpoint for OPC UA event updates"""
    await websocket_manager.connect(websocket)
    try:
        if assignment_manager:
            assignments = await assignment_manager.get_all_assignments()
            await websocket.send_text(json.dumps({
                "type": "assignments_update",
                "assignments": assignments,
                "count": len(assignments),
                "timestamp": time.time()
            }))
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
            data = await websocket.receive_text()
            logger.info(f"Received WebSocket message: {data}")
            
    except WebSocketDisconnect:
        websocket_manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        websocket_manager.disconnect(websocket)

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
            "assignments": assignments,
            "assignments_list": assignments_list,
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
async def get_config():
    config = load_config()
    logger.info(f"Config GET: {config}")
    return config

@app.post("/api/config")
async def update_config(update: ConfigUpdate):
    """Update configuration settings"""
    global opc_manager, opc_event_listener
    config = load_config()
    
    try:
        logger.info(f"Received config update payload: {update.dict()}")
    except Exception:
        logger.info("Received config update payload (could not serialize)")
    changed = False

    opc_ua_enabled_before = config.get("OPC_UA_ENABLED", False)
    opc_ua_enabled_after = update.OPC_UA_ENABLED if update.OPC_UA_ENABLED is not None else opc_ua_enabled_before
    opc_ua_config_changed = False
    
    for key in [
        "OPC_UA_SERVER_URL", "OPC_UA_NODE_ID", "OPC_UA_ENABLED",
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
        
        if opc_ua_config_changed:
            await handle_opc_ua_config_change(config, opc_ua_enabled_before, opc_ua_enabled_after)
    await handle_opc_event_listener_config_change(config)
    
    return config

# Pictures Directory and Static Mounting
PICTURES_ENV_OVERRIDE = os.getenv("PICTURES_DIR", "").strip()
_pictures_static_mounted = False

DATA_DIR = (Path(__file__).parent.parent / "data").resolve()
PICTURES_DIR = (
    Path(PICTURES_ENV_OVERRIDE).expanduser().resolve()
    if PICTURES_ENV_OVERRIDE
    else (DATA_DIR / os.getenv("PICTURES_SUBDIR", "pictures"))
).resolve()

# Ensure pictures directory exists
def _ensure_pictures_dir() -> bool:
    try:
        PICTURES_DIR.mkdir(parents=True, exist_ok=True)
        return True
    except Exception as e:  # noqa: BLE001
        logger.error("Failed to ensure pictures directory %s: %s", PICTURES_DIR, e)
        return False

# Mount /pictures static route
def _mount_pictures_static() -> None:
    global _pictures_static_mounted
    if _pictures_static_mounted:
        return
    if not PICTURES_DIR.exists():
        if not _ensure_pictures_dir():
            logger.warning("/pictures static not mounted (directory unavailable): %s", PICTURES_DIR)
            return
    try:
        app.mount("/pictures", StaticFiles(directory=str(PICTURES_DIR)), name="pictures")
        static_dir = Path(__file__).parent / 'static'
        if static_dir.exists():
            app.mount('/static', StaticFiles(directory=str(static_dir)), name='static')
        _pictures_static_mounted = True
        logger.info("Mounted /pictures static directory: %s", PICTURES_DIR)
    except Exception as e:  # noqa: BLE001
        logger.error("Failed to mount /pictures static directory %s: %s", PICTURES_DIR, e)

_mount_pictures_static()

@app.get("/api/pictures")
def list_pictures(include_meta: bool = False, part: str | None = None):
    """List all pictures in the pictures directory."""
    try:
        if not PICTURES_DIR.exists():
            if not _ensure_pictures_dir():
                return JSONResponse({"success": False, "files": [], "count": 0, "message": "pictures directory unavailable"})
            _mount_pictures_static()
        entries = []
        for name in sorted(os.listdir(PICTURES_DIR)):
            if name.startswith('.'):
                continue
            full = PICTURES_DIR / name
            if not full.is_file():
                continue
            if part and not name.startswith(part + "_") and not name.startswith(part + "."):
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
    """List pictures associated with a specific format part."""
    try:
        if not PICTURES_DIR.exists():
            if not _ensure_pictures_dir():
                return {"success": False, "files": [], "count": 0}
        files = [f for f in os.listdir(PICTURES_DIR) if os.path.isfile(PICTURES_DIR / f) and (f.startswith(format_part + "_") or f.startswith(format_part + "."))]
        return {"success": True, "files": sorted(files), "count": len(files)}
    except Exception as e:  # noqa: BLE001
        logger.error("Error listing pictures for part %s: %s", format_part, e)
        raise HTTPException(status_code=500, detail="Error retrieving pictures for part")

# Helper to sanitize format part for filename usage
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
    """Upload a picture for a specific format part, either as a file upload or base64 string."""
    part_clean = _sanitize_part(format_part)

    if not (file or image_base64):
        raise HTTPException(status_code=400, detail="No image provided (file or image_base64 required)")

    if not PICTURES_DIR.exists():
        if not _ensure_pictures_dir():
            raise HTTPException(status_code=500, detail="Pictures directory unavailable")

    content: bytes
    content: bytes = b""
    ext = "jpg"
    if file:
        try:
            content = await file.read()
        except Exception as e:  # noqa: BLE001
            raise HTTPException(status_code=400, detail=f"Failed to read uploaded file: {e}")
        orig_name = file.filename or "upload"
        if "." in orig_name:
            ext_candidate = orig_name.rsplit(".", 1)[1].lower()
            if len(ext_candidate) <= 5:
                ext = ext_candidate
        elif file.content_type:
            guessed_ext = mimetypes.guess_extension(file.content_type) or ".jpg"
            ext = guessed_ext.lstrip('.')
    else:
        b64 = image_base64.strip()
        if not b64:
            raise HTTPException(status_code=400, detail="Empty base64 image string")
        if b64.startswith("data:"):
            try:
                header, b64data = b64.split(",", 1)
                if not b64data:
                    raise ValueError("No base64 data found in data URL")
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

# OPC UA Configuration Handling
async def handle_opc_ua_config_change(config, enabled_before, enabled_after):
    global opc_manager
    
    if enabled_before != enabled_after:
        if enabled_after:
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
            if opc_manager:
                await opc_manager.stop_monitoring()
                opc_manager = None
                logger.info("OPC UA client stopped and disabled live.")
    elif opc_manager and enabled_after:
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

# OPC UA Event Bytes Listener Handling
async def handle_opc_event_listener_config_change(config):
    global opc_event_listener
    enabled = config.get("OPC_UA_EVENT_ENABLED", False)
    if not enabled:
        if opc_event_listener:
            await opc_event_listener.stop()
            opc_event_listener = None
            logger.info("OPC UA Event Listener gestoppt (disabled)")
        return
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

# Statusabfrage für OPC UA Event Listener
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

# Hex ID Extraktion & Live Event IDs Endpoint
import re as _re
_HEX_ID_REGEX = _re.compile(r"Ausgabe:([0-9A-Fa-f]+)")

# Live Event Hex IDs Puffer
def extract_hex_ids_from_payload(payload: str):
    core = payload.replace('<STX>', '').replace('<ETX>', '')
    found = _HEX_ID_REGEX.findall(core)
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
    """Get live RFID event hex IDs seen within the specified time window."""
    if window_sec <= 0:
        window_sec = 8.0
    running = bool(opc_event_listener and opc_event_listener.is_running())
    now_ts = time.time()
    cutoff = now_ts - window_sec
    to_delete = [k for k, v in _live_event_hex_ids.items() if v["last_seen"] < cutoff]
    for k in to_delete:
        _live_event_hex_ids.pop(k, None)
    ids = list(_live_event_hex_ids.keys())
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

    logger.info(f"Starting RFID Backend on {host}:{port}")
    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        reload=debug,
        access_log=True,
        log_level="debug" if debug else "info"
    )
