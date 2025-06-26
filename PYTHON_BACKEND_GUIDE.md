# RFID App - Unified Frontend + Backend Setup

## Overview

This project combines a Next.js frontend with a Python FastAPI backend in a unified setup that can be started with a single command and deployed with Docker.

## 🚀 Quick Start (One Command)

### Local Development

```bash
# Windows
start-all.bat

# Or with npm
npm run start:all
```

### Docker Deployment

```bash
# Using Docker Compose (Recommended)
docker-compose up --build

# Or using Docker directly
npm run docker:compose
```

## 📋 Service Overview

| Service | Port | URL | Description |
|---------|------|-----|-------------|
| Frontend | 3000 | http://localhost:3000 | Next.js React App |
| Backend | 8001 | http://localhost:8001 | Python FastAPI API |
| API Docs | 8001 | http://localhost:8001/docs | Auto-generated API docs |

## 🛠 Setup Instructions

### Prerequisites
- Node.js 20+
- Python 3.13+
- Docker (optional, for containerized deployment)

### Option 1: Automated Setup (Recommended)

**Windows:**
```bash
start-all.bat
```

This script will:
1. Create Python virtual environment
2. Install Python dependencies  
3. Install Node.js dependencies
4. Start both frontend and backend

### Option 2: Manual Setup

```bash
# 1. Install Node.js dependencies
npm install

# 2. Setup Python environment
python -m venv .venv
.venv\Scripts\activate  # Windows
source .venv/bin/activate  # Linux/Mac

# 3. Install Python dependencies
cd backend
pip install -r requirements.txt
cd ..

# 4. Start both services
npm run start:all
```

### Option 3: Docker Setup

```bash
# Build and run with Docker Compose
docker-compose up --build

# Or manually
docker build -t rfid-app .
docker run -p 3000:3000 -p 8001:8001 rfid-app
```

## 🔧 Development Commands

| Command | Description |
|---------|-------------|
| `npm run start:all` | Start both frontend and backend |
| `npm run dev` | Start frontend only (development) |
| `npm run backend` | Start backend only |
| `npm run docker:compose` | Docker build and run |
| `npm run docker:stop` | Stop Docker containers |

## 🐳 Docker Configuration

The project includes a multi-stage Dockerfile that:
- Builds the Python backend
- Builds the Next.js frontend
- Combines both in a single container
- Starts both services automatically

### Environment Variables

**Local Development (.env.local):**
```env
NEXT_PUBLIC_BACKEND_URL=http://localhost:8001
```

**Docker (.env.docker):**
```env
NODE_ENV=production
NEXT_PUBLIC_BACKEND_URL=http://localhost:8001
BACKEND_HOST=0.0.0.0
BACKEND_PORT=8001
```

## 📡 API Endpoints

### Health & Status
- `GET /` - Basic health check
- `GET /api/health` - Detailed health information

### Authentication
- `POST /api/verify-password` - Verify Somic password

### Customer HTML
- `GET /api/customer-html` - Get cached HTML
- `POST /api/customer-html` - Upload HTML file

### RFID Operations
- `POST /api/rfid/scan` - Process RFID tag scan
- `GET /api/rfid/tags` - Get all RFID tags

## 🔍 Testing the Setup

1. **Start the application:**
   ```bash
   start-all.bat  # or npm run start:all
   ```

2. **Verify services:**
   - Frontend: http://localhost:3000
   - Backend: http://localhost:8001/api/health
   - API Docs: http://localhost:8001/docs

3. **Test functionality:**
   - Go to http://localhost:3000/somic
   - Enter password "a"
   - Should successfully authenticate via Python backend

## 🚀 Production Deployment

### Docker Production

```bash
# Build production image
docker-compose up --build -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f
```

### Manual Production

```bash
# Build frontend
npm run build

# Set production environment
export NODE_ENV=production
export BACKEND_HOST=0.0.0.0

# Start services
npm run start:all
```

## 🔧 Configuration

### CORS Settings
The backend is configured to accept requests from:
- `http://localhost:3000`
- `http://localhost:3001` 
- `http://127.0.0.1:3000`
- `http://127.0.0.1:3001`

### Port Configuration
- Frontend: 3000 (configurable)
- Backend: 8001 (configurable via environment)

## 🐛 Troubleshooting

### Port Already in Use
If ports are occupied:
```bash
# Check what's using the port
netstat -ano | findstr :3000
netstat -ano | findstr :8001

# Kill the process if needed
taskkill /PID <process_id> /F
```

### Python Virtual Environment Issues
```bash
# Recreate virtual environment
rmdir /s .venv
python -m venv .venv
.venv\Scripts\activate
pip install -r backend/requirements.txt
```

### Docker Issues
```bash
# Clean Docker cache
docker system prune -a

# Rebuild from scratch
docker-compose down
docker-compose up --build --force-recreate
```

## 📝 Adding New Features

### Backend API Endpoint
1. Add endpoint in `backend/main.py`
2. Add TypeScript types in `src/lib/api-client.ts`
3. Use in React components

### Frontend Component
1. Create component in `src/components/`
2. Add API integration using `useAPI()` hook
3. Include in pages as needed

The unified setup ensures both frontend and backend stay in sync!
