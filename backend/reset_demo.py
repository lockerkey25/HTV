"""Reset the Nourish database to its fresh first-load state.

Deletes the SQLite file and re-seeds it: residents, menu, 30-day synthetic
history, and today's meals — exactly as it is the very first time the app runs.
Removes all data logged during a demo session (today's meals, weights, supplements).

IMPORTANT: stop the backend first — Windows locks the database file while it runs.

Usage:
    python reset_demo.py
"""
import sys

from app import config, db

if __name__ == "__main__":
    if config.DB_PATH.exists():
        try:
            config.DB_PATH.unlink()
        except PermissionError:
            print("ERROR: the database is in use.")
            print("Stop the backend (Ctrl+C in the uvicorn terminal), then run this again.")
            sys.exit(1)
        print(f"Deleted {config.DB_PATH}")
    db.init_db()
    print("Re-seeded database to fresh first-load state.")
    print("Now start the backend: .venv\\Scripts\\uvicorn app.main:app --host 0.0.0.0 --port 8000")
