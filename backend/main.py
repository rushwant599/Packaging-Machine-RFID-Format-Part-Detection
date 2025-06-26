from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel
import os
from pathlib import Path
import logging
from dotenv import load_dotenv

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

if __name__ == "__main__":
    import uvicorn
    logger.info(f"Starting RFID Backend on {BACKEND_HOST}:{BACKEND_PORT}")
    uvicorn.run("main:app", host=BACKEND_HOST, port=BACKEND_PORT, reload=DEBUG)
