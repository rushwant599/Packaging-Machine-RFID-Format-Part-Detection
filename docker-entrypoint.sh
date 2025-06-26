#!/bin/bash

# Docker entrypoint script to start both frontend and backend

echo "Starting RFID App with Frontend and Backend..."

# Function to handle shutdown
cleanup() {
    echo "Shutting down services..."
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    exit 0
}

# Set up signal handlers
trap cleanup SIGTERM SIGINT

# Start Python backend in background
echo "Starting Python Backend on port 8001..."
cd /app/backend
python main.py &
BACKEND_PID=$!

# Wait a moment for backend to start
sleep 3

# Start Next.js frontend in background
echo "Starting Next.js Frontend on port 3000..."
cd /app
npm start &
FRONTEND_PID=$!

# Wait for both processes
echo "Both services started. Backend PID: $BACKEND_PID, Frontend PID: $FRONTEND_PID"
echo "Frontend: http://localhost:3000"
echo "Backend: http://localhost:8001"
echo "API Docs: http://localhost:8001/docs"

# Keep the script running and wait for either process to exit
wait $BACKEND_PID $FRONTEND_PID
