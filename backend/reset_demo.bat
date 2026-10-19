@echo off
REM Reset the Nourish demo database to its fresh first-load state.
REM Double-click this file, or run it from a terminal.
cd /d "%~dp0"
.venv\Scripts\python.exe reset_demo.py
echo.
echo Done. If the backend is running, stop and restart it to load the fresh database.
pause
