#!/usr/bin/env bash
echo "======================================="
echo "  🎵 Music Guessing Game"
echo "  http://localhost:8000"
echo "======================================="
echo ""
echo "Press Ctrl+C to stop the server."
echo ""

# Open browser (macOS / Linux / WSL)
if command -v open &>/dev/null; then
    open "http://localhost:8000"
elif command -v xdg-open &>/dev/null; then
    xdg-open "http://localhost:8000"
elif command -v sensible-browser &>/dev/null; then
    sensible-browser "http://localhost:8000"
fi

# Start Python HTTP server with Apple Music local proxy
echo "Starting Music Guess server on http://localhost:8000..."
python3 server.py
