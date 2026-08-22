@echo off
echo =======================================
echo   Music Guessing Game
echo   http://localhost:8000
echo =======================================
echo.
echo Press Ctrl+C to stop the server.
echo.
start http://localhost:8000
python server.py || python3 server.py
pause
