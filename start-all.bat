@echo off
echo ========================================
echo Starting RFID App - Frontend + Backend
echo ========================================

REM Check if virtual environment exists
if not exist ".venv" (
    echo Creating Python virtual environment...
    python -m venv .venv
)

REM Activate virtual environment
echo Activating Python environment...
call .venv\Scripts\activate.bat

REM Install Python dependencies
echo Installing Python dependencies...
cd backend
pip install -r requirements.txt
cd ..

REM Install Node.js dependencies
echo Installing Node.js dependencies...
npm install

REM Start both services
echo Starting both services...
npm run start:all

pause
