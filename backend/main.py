from fastapi import FastAPI, File, UploadFile, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel
import os
import logging
from pathlib import Path
from contextlib import asynccontextmanager
from dotenv import load_dotenv
import json
from typing import List

# Local modules
from opc_client import OPCUAManager
from format_parser import FormatDataManager

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
format_manager = None

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

# Global connection manager
websocket_manager = ConnectionManager()

# FastAPI lifespan context manager
@asynccontextmanager
async def lifespan(app: FastAPI):
    global opc_manager, format_manager
    
    # Startup
    logger.info("Starting RFID Parts Backend...")
    
    # Initialize OPC UA manager
    if OPC_UA_ENABLED:
        opc_manager = OPCUAManager(OPC_UA_SERVER_URL, OPC_UA_NODE_ID, enabled=True)
        
        # Register callback for value changes
        async def value_change_callback(new_value):
            await websocket_manager.broadcast_value_change(new_value)
        
        opc_manager.add_value_change_callback(value_change_callback)
        await opc_manager.start_monitoring()
    
    # Initialize format data manager
    cache_dir = Path(__file__).parent.parent
    html_cache_path = cache_dir / "customer-html-cache.html"
    format_manager = FormatDataManager(str(html_cache_path))
    
    yield
    
    # Shutdown
    logger.info("Shutting down RFID Parts Backend...")
    if opc_manager:
        await opc_manager.stop_monitoring()

app = FastAPI(title="RFID Parts Backend", version="1.0.0", lifespan=lifespan)

# Configure CORS to allow requests from your Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000", 
        "http://127.0.0.1:3000", 
        "http://localhost:3001", 
        "http://127.0.0.1:3001",
        "http://0.0.0.0:3000",
        "http://0.0.0.0:3001"
    ],  # Next.js ports
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Path to store HTML cache (same as your Next.js app)
CACHE_DIR = Path(__file__).parent.parent
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

class FormatParseResponse(BaseModel):
    success: bool
    message: str
    data: dict = None
    formatParts: list = None
    formatCount: int = 0

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

@app.post("/api/rfid/scan")
async def process_rfid_scan(data: RFIDData):
    """Process RFID tag scan"""
    logger.info(f"Processing RFID scan: {data.tag_id}")
    
    # Here you can add your RFID processing logic
    # For example: validate tag, look up in database, update inventory, etc.
    
    return {
        "success": True,
        "message": f"RFID tag {data.tag_id} processed successfully",
        "data": {
            "tag_id": data.tag_id,
            "customer": data.customer_name,
            "part": data.part_number,
            "description": data.description,
            "timestamp": "2025-06-26T12:00:00Z"  # You can use datetime.now()
        }
    }

@app.get("/api/rfid/tags")
async def get_rfid_tags():
    """Get list of all RFID tags"""
    # This is a mock response - you would typically fetch from a database
    return [
        {
            "tag_id": "RFID001",
            "customer_name": "Customer A",
            "part_number": "PART-001",
            "description": "Sample part 1",
            "last_scanned": "2025-06-26T10:00:00Z"
        },
        {
            "tag_id": "RFID002", 
            "customer_name": "Customer B",
            "part_number": "PART-002",
            "description": "Sample part 2",
            "last_scanned": "2025-06-26T11:00:00Z"
        }
    ]

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

@app.post("/api/opc-ua/refresh")
async def refresh_opc_ua_value():
    """Force refresh of OPC UA node value"""
    if not opc_manager:
        raise HTTPException(status_code=400, detail="OPC UA is disabled")
    
    status = await opc_manager.get_status()
    
    if not status["available"]:
        raise HTTPException(status_code=500, detail="OPC UA library not available")
    
    if status["connection_status"] != "connected":
        raise HTTPException(status_code=503, detail="OPC UA not connected")
    
    try:
        value_data = await opc_manager.refresh_value()
        if value_data:
            return {
                "success": True,
                "message": "Value refreshed successfully",
                "data": value_data
            }
        else:
            raise HTTPException(status_code=500, detail="Failed to read node value")
    except Exception as e:
        logger.error(f"Error refreshing OPC UA value: {e}")
        raise HTTPException(status_code=500, detail=f"Error refreshing value: {str(e)}")

@app.post("/api/opc-ua/reconnect")
async def reconnect_opc_ua():
    """Force reconnection to OPC UA server"""
    if not opc_manager:
        raise HTTPException(status_code=400, detail="OPC UA is disabled")
    
    status = await opc_manager.get_status()
    
    if not status["available"]:
        raise HTTPException(status_code=500, detail="OPC UA library not available")
    
    try:
        success = await opc_manager.reconnect()
        
        if success:
            return {
                "success": True,
                "message": "Successfully reconnected to OPC UA server",
                "status": "connected"
            }
        else:
            new_status = await opc_manager.get_status()
            raise HTTPException(status_code=503, detail=f"Failed to reconnect: {new_status['connection_status']}")
            
    except Exception as e:
        logger.error(f"Error reconnecting to OPC UA: {e}")
        raise HTTPException(status_code=500, detail=f"Error reconnecting: {str(e)}")

# WebSocket endpoint for OPC UA updates
@app.websocket("/ws/opc-ua")
async def websocket_opc_ua_updates(websocket: WebSocket):
    """WebSocket endpoint for OPC UA event updates"""
    await websocket_manager.connect(websocket)
    
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

# Example: Trigger OPC UA value change broadcast (for testing)
@app.post("/api/test/broadcast-value-change")
async def test_broadcast_value_change():
    """Test endpoint to trigger a broadcast of OPC UA value change"""
    test_data = {
        "tag_id": "RFID001",
        "customer_name": "Customer A",
        "part_number": "PART-001",
        "description": "Sample part 1",
        "timestamp": "2025-06-26T12:00:00Z"
    }
    
    # Broadcast to all WebSocket clients
    await websocket_manager.broadcast_value_change(test_data)
    
    return {"success": True, "message": "Broadcast triggered", "data": test_data}

if __name__ == "__main__":
    import uvicorn
    logger.info(f"Starting RFID Backend on {BACKEND_HOST}:{BACKEND_PORT}")
    uvicorn.run("main:app", host=BACKEND_HOST, port=BACKEND_PORT, reload=DEBUG)
