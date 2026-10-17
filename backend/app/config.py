"""Runtime configuration loaded from environment / backend/.env."""
import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
GEMINI_FALLBACK_MODEL = os.getenv("GEMINI_FALLBACK_MODEL", "gemini-3.5-flash-lite")

# "live" calls Gemini; "mock" returns deterministic fake estimates for offline dev.
MODE = os.getenv("NOURISH_MODE", "live").lower()
if not GEMINI_API_KEY:
    MODE = "mock"

DB_PATH = Path(os.getenv("NOURISH_DB", BACKEND_DIR / "data" / "nourish.db"))
CACHE_DIR = BACKEND_DIR / "cache"

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_IMAGE_SIDE = 1536  # enough detail for small leftovers; phone sends 1536 too
GEMINI_THINKING_LEVEL = os.getenv("GEMINI_THINKING_LEVEL", "MEDIUM")  # MINIMAL | LOW | MEDIUM | HIGH
