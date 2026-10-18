# Nourish

**Nutrition decline early-warning app for elderly care teams.**

Care staff (CNAs) use their phone to photograph a resident's meal tray before and after a meal. Gemini compares the two photos and estimates how much of each served item was eaten. Rule-based scoring then tracks intake, nutrient, and weight trends over time to flag early signs of malnutrition, sarcopenia, anemia, and other nutrition-linked conditions, with plain-language explanations staff can act on.

**Design principle:** rules decide what gets flagged; Gemini only describes what it sees and explains what the rules found. Staff confirm every AI estimate before it counts toward a resident's record.

---

## Table of contents
- [What it does](#what-it-does)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Project layout](#project-layout)
- [First-time setup](#first-time-setup)
  - [macOS / Linux](#macos--linux)
  - [Windows](#windows-powershell)
- [Running the app](#running-the-app-every-time)
- [Data model](#data-model)
- [API reference](#api-reference)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [Out of scope](#out-of-scope)

---

## What it does

1. **Tray photo analysis.** Pick a resident → pick a meal → take a *before* photo → take an *after* photo → review the AI's per-item "percent eaten" estimate → confirm. The before photo is checked against the resident's dietary profile *before* they eat, so allergen, texture, and preference conflicts are caught early.

2. **Menu editing.** Staff can swap what's served for a meal from the full menu catalogue. Each item shows a safety dot — green (safe), yellow (caution), red (do not serve) — based on the resident's allergies, texture requirement, low-sodium flag, and preferences.

3. **Supplement & weight logging.** Per resident, per day: log supplement tablets taken (which feed into nutrient totals) and daily weight.

4. **Long-term tracking.** A 30-day chart per nutrient (meals + supplements vs. age/sex-specific targets), plus a weight trend. Averages are compared against baselines and surfaced as severe (red) and warning (yellow) alerts on the resident's profile.

5. **AI health review.** On demand, Gemini reviews the 30-day nutrition summary against the resident's profile and flags conditions worth a doctor's check (Osteoporosis, Sarcopenia, Anemia, Type 2 Diabetes, Cardiovascular Disease, etc.), recommends next steps, suggests foods to correct deficiencies, and writes a shift-handoff summary.

6. **Meal reminders.** Local notifications fire if a meal hasn't been logged after each meal window (10:40 am breakfast, 2:00 pm lunch, 8:00 pm dinner).

---

## Architecture

```
┌─────────────────────┐         ┌──────────────────────┐        ┌─────────────────┐
│  Expo app (phone)   │         │  FastAPI backend     │        │  Gemini API     │
│  React Native + TS  │  HTTPS  │  Python + SQLite     │  HTTPS │  vision + text  │
│                     ├────────▶│                      ├───────▶│  (key on server)│
│  camera, charts,    │         │  rules engine,       │        └─────────────────┘
│  logging screens    │◀────────┤  nutrient math,      │
└─────────────────────┘  JSON   │  baselines           │
         ▲                       └──────────┬───────────┘
         │                                  │
   Expo tunnel                       SQLite (nourish.db)
   (Metro bundler)                   residents, meals, menu_items,
         │                           intake_records, supplement_logs,
   cloudflared tunnel                weight_logs, meal_analyses
   (exposes :8000)
```

**Request flow for a meal analysis:**
1. Phone resizes both photos to ~1536px (`expo-image-manipulator`) and uploads them as multipart form data.
2. Backend normalizes the images (`images.py`), sends them to Gemini with the known served menu and a strict JSON schema (`gemini.py`).
3. Gemini's response is treated as untrusted: unknown item IDs are dropped, percentages are clamped and rounded to 5%, low-confidence items are flagged for review (`analysis.py`).
4. The rules engine (`diet_rules.py`) checks the tray for allergen, texture, and sodium violations independently of the AI.
5. Staff review and confirm; confirmed intake is written to `intake_records` — this, not the raw AI output, feeds all downstream scoring.

**Key separation of concerns:**
- `gemini.py` — all AI calls (vision analysis, before-check, health assessment). Has a `mock` mode for offline development.
- `diet_rules.py` — deterministic safety rules. The AI never decides what's safe.
- `nutrition.py` — deterministic nutrient math (served portion × percent eaten × per-serving values).
- `baselines.py` — age/sex/condition-adjusted daily targets (approximate US DRI figures).
- `longterm.py` — aggregates confirmed intake into 30-day trends and alerts.

---

## Tech stack

| Layer | Technology |
|---|---|
| **Mobile** | Expo (SDK 57), React Native, TypeScript |
| **Mobile modules** | expo-camera, expo-image-manipulator, expo-image-picker, expo-notifications, @react-native-community/slider, react-native-svg, @react-native-async-storage/async-storage |
| **Backend** | Python, FastAPI, Uvicorn, Pydantic |
| **Database** | SQLite |
| **AI** | Google Gemini API (`google-genai`) — vision + structured JSON output |
| **Nutrition data** | USDA FoodData Central (values seeded into SQLite) |
| **Networking (dev)** | cloudflared (backend tunnel), Expo tunnel (Metro) |

---

## Project layout

```
HTV/
├── backend/
│   ├── app/
│   │   ├── main.py         FastAPI routes
│   │   ├── db.py           SQLite schema + seed data (residents, menu, meals)
│   │   ├── schemas.py      Pydantic models (Gemini output + API payloads)
│   │   ├── gemini.py       Gemini vision + text calls (with mock mode)
│   │   ├── analysis.py     Turns raw Gemini output into a validated estimate
│   │   ├── diet_rules.py   Rule-based allergy / texture / sodium checks
│   │   ├── nutrition.py    Deterministic nutrient math
│   │   ├── baselines.py    Age/sex/condition daily nutrient targets
│   │   ├── longterm.py     30-day trends, averages, and alerts
│   │   ├── images.py       Image validation + resizing
│   │   └── config.py       Env / runtime configuration
│   ├── data/nourish.db     SQLite database (auto-created, gitignored)
│   ├── cache/              Cached Gemini responses (gitignored)
│   ├── .env                Secrets (gitignored) — create from .env.example
│   └── requirements.txt
└── mobile/
    ├── App.tsx             State-machine navigation
    ├── app.json            Expo config + plugins
    ├── src/
    │   ├── api.ts          Typed API client + URL resolution
    │   ├── theme.ts        Colors + labels
    │   ├── notifications.ts Meal reminder scheduling
    │   ├── image.ts        Photo resize before upload
    │   ├── components/ui.tsx  Button, Header, Banner, Card
    │   └── screens/
    │       ├── ResidentsScreen.tsx   Resident list
    │       ├── MealsScreen.tsx       Meals, profile, weight, supplements
    │       ├── CaptureScreen.tsx     Before/after photo + before-check
    │       ├── ReviewScreen.tsx      Adjust & confirm intake (sliders)
    │       ├── DoneScreen.tsx        Confirmation summary
    │       ├── EditMenuScreen.tsx    Change served items (safety dots)
    │       └── NutrientCharts.tsx    30-day charts + AI health review
    └── package.json
```

---

## First-time setup

**Prerequisites (all platforms):**
- **Python 3.11+**
- **Node.js 18+** and npm
- A free **Gemini API key** — https://aistudio.google.com/apikey
- A free **Expo account** — https://expo.dev (needed for tunnel mode)
- **Expo Go** installed on your phone, signed in with the same Expo account
- **cloudflared** — exposes the local backend to your phone over HTTPS

### macOS / Linux

```bash
# --- backend ---
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # then edit .env and add your GEMINI_API_KEY
deactivate

# --- mobile ---
cd ../mobile
npm install
npx expo login                  # sign in with your Expo account

# --- cloudflared ---
# macOS:
brew install cloudflared
# Debian/Ubuntu:
# sudo mkdir -p --mode=0755 /usr/share/keyrings
# curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
# echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
# sudo apt update && sudo apt install cloudflared
```

### Windows (PowerShell)

```powershell
# --- backend ---
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env     # then edit .env and add your GEMINI_API_KEY
deactivate

# --- mobile ---
cd ..\mobile
npm install
npx expo login                  # sign in with your Expo account

# --- cloudflared ---
winget install Cloudflare.cloudflared
# Close and reopen the terminal afterward so PATH updates.
# If `cloudflared` still isn't found, it's usually at:
#   C:\Program Files (x86)\cloudflared\cloudflared.exe
# Add it permanently with:
#   [Environment]::SetEnvironmentVariable("PATH", [Environment]::GetEnvironmentVariable("PATH","User") + ";C:\Program Files (x86)\cloudflared", "User")
```

> **Note on `.env`:** the file must contain your `GEMINI_API_KEY`. Without it the backend silently runs in **mock mode** (deterministic fake estimates, no Gemini calls). Check the mode at `<backend>/api/health`.

---

## Running the app (every time)

You need **three terminals**.

### Terminal 1 — backend

**macOS / Linux**
```bash
cd backend
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```

**Windows (PowerShell)**
```powershell
cd backend
.\.venv\Scripts\uvicorn.exe app.main:app --host 0.0.0.0 --port 8000
```

On startup it logs either `Nourish running in live mode` (Gemini key present) or `mock mode`.

### Terminal 2 — backend tunnel

```bash
cloudflared tunnel --url http://localhost:8000
```

It prints a URL like `https://something.trycloudflare.com`. **This URL changes every restart.** Copy it into `mobile/.env`:

```
EXPO_PUBLIC_API_URL=https://something.trycloudflare.com
```

### Terminal 3 — Expo app

```bash
cd mobile
npx expo start --tunnel --clear
```

Scan the QR code (iPhone: Camera app; Android: Expo Go). The residents screen footer should show the tunnel URL you set.

> **Changed the tunnel URL?** `EXPO_PUBLIC_*` vars are baked in at bundle time, so after editing `mobile/.env` you must restart Expo with `--clear`.

**Same-network shortcut:** if the phone and laptop are on the same network (e.g. laptop on the phone's hotspot), you can skip Terminal 2, delete `mobile/.env`, and run `npx expo start` without `--tunnel`. The app then auto-discovers the backend at port 8000 on the laptop.

Check the backend any time: `<backend URL>/api/health` returns the current mode. Interactive API docs are at `<backend URL>/docs`.

---

## Data model

SQLite tables (`backend/app/db.py`):

| Table | Purpose |
|---|---|
| `residents` | Profile: name, room, sex, DOB, height, texture, diet flags, allergies, preferences, conditions, medications |
| `menu_items` | Food catalogue with 11 nutrients per serving + texture + allergens |
| `meals` | A resident's meal on a date (breakfast/lunch/dinner), status served/confirmed |
| `meal_items` | Which menu items are served for a meal |
| `meal_analyses` | Raw Gemini output, kept for audit |
| `intake_records` | Staff-confirmed percent eaten per item — the source of truth for scoring |
| `supplements` | Supplement catalogue (nutrient, unit, amount per tablet) |
| `supplement_logs` | Tablets taken per resident per day |
| `weight_logs` | Daily weight per resident |

**Nutrients tracked:** kcal, protein, fat, cholesterol, sodium, iron, calcium, sugar, vitamin C, vitamin D, vitamin B12. Consumed amounts are **computed on demand** (per-serving × servings × percent eaten), never stored — so correcting a food's values updates all history automatically.

### Resetting demo data

During a demo you'll log meals, weights, and supplements. To wipe that session data and
restore the database to its **fresh first-load state** (residents, full menu, the
reproducible 30-day synthetic history, and today's unlogged meals), use the reset tool.

**Stop the backend first** — Windows locks the SQLite file while uvicorn is running.

**Windows** — double-click `backend/reset_demo.bat`, or run:
```powershell
cd backend
.venv\Scripts\python.exe reset_demo.py
```

**macOS / Linux**:
```bash
cd backend
.venv/bin/python reset_demo.py
```

Then restart the backend. The 30-day history is generated from a fixed random seed, so the
reset is fully reproducible — every reset yields the same baseline.

> Manual alternative: delete `backend/data/nourish.db` and restart the backend; it
> re-seeds automatically on the next request.

**Targeted resets (backend running, no restart needed)** — dev-only endpoints let you unlog
specific data without rebuilding everything. Call them from `<backend>/docs` or directly:
```powershell
# Unlog all breakfasts today
Invoke-WebRequest -Method POST -Uri "http://localhost:8000/api/dev/reset-meal?meal_type=breakfast" -UseBasicParsing
# Unlog one resident's breakfast (resident_id 1 = Okafor, 2 = Lindqvist, 3 = Tanaka)
Invoke-WebRequest -Method POST -Uri "http://localhost:8000/api/dev/reset-meal?resident_id=1&meal_type=breakfast" -UseBasicParsing
# Clear today's weight logs
Invoke-WebRequest -Method POST -Uri "http://localhost:8000/api/dev/reset-weight" -UseBasicParsing
```

---

## API reference

Base path: `/api`. Full interactive docs at `/docs`.

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Mode and model info |
| GET | `/residents` | All residents |
| GET | `/residents/{id}/meals` | Today's meals for a resident |
| GET | `/meals/unlogged?meal_type=` | Residents with an unlogged meal of a type |
| GET | `/meals/{id}` | A single meal with its items |
| GET | `/menu-items?resident_id=` | Full menu, annotated with safety for a resident |
| PUT | `/meals/{id}/items` | Replace a meal's served items |
| POST | `/meals/{id}/check-before` | Analyze the before photo (diet checks + inventory) |
| POST | `/meals/{id}/analyze` | Analyze before+after photos → percent eaten |
| POST | `/meals/{id}/confirm` | Save staff-confirmed intake |
| GET | `/residents/{id}/weight` | Today's logged weight |
| POST | `/residents/{id}/weight` | Log today's weight (30–200 kg) |
| GET | `/supplements` | Supplement catalogue |
| GET | `/residents/{id}/supplements` | Today's supplement log |
| POST | `/residents/{id}/supplements` | Save supplement tablet counts |
| GET | `/residents/{id}/intake-history?days=30` | 30-day nutrient/weight trends + alerts |
| GET | `/residents/{id}/health-assessment` | Gemini health review (flags, recommendations) |
| POST | `/dev/reset-meal` | Unlog meals (optional `resident_id`, `meal_type`, `meal_date`) |
| POST | `/dev/reset-weight` | Delete weight logs (optional `resident_id`, `log_date`) |
| POST | `/dev/reset-supplements` | Delete supplement logs (optional `resident_id`, `log_date`) |

> The `/dev/*` endpoints are demo helpers with no auth — remove them before any real deployment.

---

## Configuration

`backend/.env` (see `.env.example`):

| Variable | Meaning |
|---|---|
| `GEMINI_API_KEY` | Your Gemini key. Empty → forces mock mode. |
| `GEMINI_MODEL` | Primary vision model. |
| `GEMINI_FALLBACK_MODEL` | Used if the primary is rate-limited/unavailable. |
| `NOURISH_MODE` | `live` (call Gemini, fall back to cache on failure) or `mock` (deterministic fake estimates, offline). |
| `GEMINI_THINKING_LEVEL` | `MINIMAL` \| `LOW` \| `MEDIUM` \| `HIGH` reasoning budget. |
| `NOURISH_DB` | Optional override for the SQLite path. |

`mobile/.env`:

| Variable | Meaning |
|---|---|
| `EXPO_PUBLIC_API_URL` | The cloudflared tunnel URL. Baked in at bundle time — restart Expo with `--clear` after changing. |

---

## Troubleshooting

**`cloudflared` not recognized (Windows)** — PATH not updated. Reopen the terminal, or add `C:\Program Files (x86)\cloudflared` to PATH (see setup).

**App says "can't reach the server"** — the tunnel URL in `mobile/.env` is stale or the tunnel/backend isn't running. Confirm `<tunnel>/api/health` responds, update `mobile/.env`, and restart Expo with `--clear`. The residents-screen footer shows the URL the app is actually using.

**App shows an old tunnel URL** — `EXPO_PUBLIC_*` is cached in the bundle. Stop Expo and run `npx expo start --tunnel --clear`.

**Backend says "mode: mock"** — `GEMINI_API_KEY` is missing/empty in `backend/.env`. Add it and restart the backend.

**Port 8000 already in use** — a previous backend is still running.
```bash
# macOS / Linux
lsof -ti:8000 | xargs kill -9
# Windows
Get-NetTCPConnection -LocalPort 8000 | Select-Object -ExpandProperty OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force }
```

**Charts / health review are empty** — these need confirmed intake history to aggregate. They populate as meals are confirmed over multiple days.

**Android scheduled notifications don't fire** — Android 13+ restricts repeating calendar triggers in Expo Go; a development build is needed. iOS works in Expo Go.

---

## Out of scope

Authentication, real EHR integration, and conditions outside nutrition decline. The nutrient values are approximate USDA-based figures seeded by hand and are **not** medical-grade — verify with a dietitian before any real use. The AI health review is decision-support for staff, **not** a diagnosis. This is a hackathon demo built on synthetic resident data.
