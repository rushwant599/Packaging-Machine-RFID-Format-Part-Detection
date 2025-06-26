from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel
import os
import re
import json
from pathlib import Path
import logging
from dotenv import load_dotenv
from bs4 import BeautifulSoup

# Load environment variables
env_path = Path(__file__).parent / ".env"
load_dotenv(env_path)
load_dotenv("../.env.docker")  # Load Docker env if available

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="RFID Parts Backend", version="1.0.0")

# Get configuration from environment
BACKEND_HOST = os.getenv("BACKEND_HOST", "127.0.0.1")
BACKEND_PORT = int(os.getenv("BACKEND_PORT", "8001"))
DEBUG = os.getenv("DEBUG", "true").lower() == "true"

logger.info(f"Configuration - Host: {BACKEND_HOST}, Port: {BACKEND_PORT}, Debug: {DEBUG}")

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
    return {
        "status": "healthy",
        "version": "1.0.0",
        "cache_file_exists": HTML_CACHE_PATH.exists()
    }

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

# HTML Format Data Parser Functions
def _read_html_file(filepath):
    """Read HTML file content"""
    if not os.path.isfile(filepath):
        raise FileNotFoundError(f"Die Datei '{filepath}' wurde nicht gefunden.")
    with open(filepath, 'r', encoding='utf-8') as file:
        return file.read()


def _extract_script_content(soup):
    """Extract script content from FormatData element"""
    script_element = soup.find(id="FormatData")
    if not script_element:
        return None
    script_content = script_element.get_text(strip=True)
    return re.sub(r'[\u0000-\u001F\u007F-\u009F]', '', script_content)


def _extract_formats_json(script_content):
    """Extract formats JSON from script content"""
    match = re.search(r'var\s+formats\s*=\s*({[\s\S]*?});', script_content)
    if not match:
        return None
    return match.group(1)


def _collect_format_parts(formats_data):
    """Collect all unique format parts"""
    format_parts_set = set()
    for fmt in formats_data.values():
        data_items = fmt.get("data", [])
        if not isinstance(data_items, list):
            continue
        for item in data_items:
            part = item.get("formatPart")
            if not part:
                continue
            part = part.strip()
            if part == "FTL." or re.match(r'^-+$', part):
                continue
            format_parts_set.add(part)
    return sorted(format_parts_set)


def _collect_format_parts_per_format(formats_data):
    """Collect format parts grouped by format"""
    format_parts_per_format = {}
    for format_name, fmt in formats_data.items():
        data_items = fmt.get("data", [])
        if not isinstance(data_items, list):
            continue
        format_parts = set()
        for item in data_items:
            part = item.get("formatPart")
            if not part:
                continue
            part = part.strip()
            if part == "FTL." or re.match(r'^-+$', part):
                continue
            format_parts.add(part)
        format_parts_per_format[format_name] = sorted(format_parts)
    return format_parts_per_format


def parse_format_data_from_file(filepath):
    """Parse format data from HTML file"""
    html_content = _read_html_file(filepath)
    soup = BeautifulSoup(html_content, 'html.parser')
    format_data = {}

    script_content = _extract_script_content(soup)
    if not script_content:
        return format_data

    formats_json_str = _extract_formats_json(script_content)
    if not formats_json_str:
        return format_data

    try:
        formats_data = json.loads(formats_json_str)
        format_data['formats'] = formats_data
        format_data['formatParts'] = _collect_format_parts(formats_data)
        format_data['formatPartsPerFormat'] = _collect_format_parts_per_format(formats_data)
    except json.JSONDecodeError as e:
        raise ValueError("Fehler beim Parsen von JSON nach Sanitize: " + str(e))

    return format_data

@app.get("/api/format-data")
async def get_format_data():
    """Parse and return format data from customer HTML cache"""
    try:
        if not HTML_CACHE_PATH.exists():
            return FormatParseResponse(
                success=False,
                message="Customer HTML cache file not found. Please upload a file first.",
                data={}
            )
        
        # Parse the format data
        format_data = parse_format_data_from_file(str(HTML_CACHE_PATH))
        
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
        
    except FileNotFoundError as e:
        logger.error(f"File not found: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        logger.error(f"JSON parsing error: {e}")
        raise HTTPException(status_code=400, detail=f"Format parsing error: {str(e)}")
    except Exception as e:
        logger.error(f"Error parsing format data: {e}")
        raise HTTPException(status_code=500, detail="Internal server error while parsing format data")

@app.get("/api/format-parts")
async def get_format_parts():
    """Get only the format parts list"""
    try:
        if not HTML_CACHE_PATH.exists():
            return {"formatParts": [], "message": "No HTML file uploaded"}
        
        format_data = parse_format_data_from_file(str(HTML_CACHE_PATH))
        format_parts = format_data.get('formatParts', [])
        
        return {
            "formatParts": format_parts,
            "count": len(format_parts),
            "message": f"Found {len(format_parts)} unique format parts"
        }
        
    except Exception as e:
        logger.error(f"Error getting format parts: {e}")
        return {"formatParts": [], "error": str(e)}

@app.get("/api/formats")
async def get_formats():
    """Get the complete formats data"""
    try:
        if not HTML_CACHE_PATH.exists():
            return {"formats": {}, "message": "No HTML file uploaded"}
        
        format_data = parse_format_data_from_file(str(HTML_CACHE_PATH))
        formats = format_data.get('formats', {})
        
        return {
            "formats": formats,
            "formatNames": list(formats.keys()),
            "count": len(formats),
            "message": f"Found {len(formats)} formats"
        }
        
    except Exception as e:
        logger.error(f"Error getting formats: {e}")
        return {"formats": {}, "error": str(e)}

@app.get("/api/format-parts-per-format")
async def get_format_parts_per_format():
    """Get format parts grouped by format"""
    try:
        if not HTML_CACHE_PATH.exists():
            return {"formatPartsPerFormat": {}, "message": "No HTML file uploaded"}
        
        format_data = parse_format_data_from_file(str(HTML_CACHE_PATH))
        format_parts_per_format = format_data.get('formatPartsPerFormat', {})
        
        return {
            "formatPartsPerFormat": format_parts_per_format,
            "formatCount": len(format_parts_per_format),
            "message": f"Found parts for {len(format_parts_per_format)} formats"
        }
        
    except Exception as e:
        logger.error(f"Error getting format parts per format: {e}")
        return {"formatPartsPerFormat": {}, "error": str(e)}

if __name__ == "__main__":
    import uvicorn
    logger.info(f"Starting RFID Backend on {BACKEND_HOST}:{BACKEND_PORT}")
    uvicorn.run("main:app", host=BACKEND_HOST, port=BACKEND_PORT, reload=DEBUG)
