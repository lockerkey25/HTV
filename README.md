# Nourish

Nutrition decline early-warning app for care teams.

CNAs use their phone to photograph a resident's tray before and after a meal. Gemini compares the two photos and estimates how much of each served item was eaten. Rule-based scoring then tracks intake, nutrient, and weight trends to flag early malnutrition/sarcopenia risk, with plain-language explanations.

**Design principle:** rules decide what gets flagged; Gemini only describes what it sees and what the rules found. Staff confirm every AI estimate before it counts.

## Stack
- **Mobile app:** Expo (React Native + TypeScript), runs on iOS and Android via Expo Go
  - `expo-camera` for before/after tray photos
  - `expo-image-manipulator` to resize photos (~1024px) before upload
  - `expo-image-picker` as a gallery fallback for the demo
  - Same screens exported to web (`expo start --web`) for the projector dashboard
- **Backend:** Python / FastAPI, SQLite
- **AI:** Gemini API (vision + shift-handoff summaries). The key stays on the server, never in the app.
- **Nutrition data:** USDA FoodData Central (looked up once, cached in SQLite)

## Repo layout
```
backend/   FastAPI + SQLite + Gemini
mobile/    Expo app (CNA camera flow + care team dashboard)
```

## Roadmap
1. **Tray photo analysis**
   - Backend: `POST /api/meals/{meal_id}/analyze` takes `before` + `after` images (multipart) and returns per-item percent eaten, nutrients, and diet alerts. Nothing is saved yet.
   - Backend: `POST /api/meals/{meal_id}/confirm` saves the staff-confirmed intake
   - Gemini call is menu-aware (it gets the served item list) and uses structured JSON output
   - Mobile: pick resident → pick meal → before photo → after photo → review/adjust → confirm
2. **Synthetic resident data:** 20–30 residents, 2–3 weeks of meals and weights, with 3–4 planted stories (slow decline, stable, sudden drop)
3. **Rule-based risk scoring** with plain-language explanations
4. **Dashboard:** residents sorted by risk, trend charts (web export for the projector)
5. **Gemini shift-handoff summary**

## First-time setup
```bash
cd ~/HTV/backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env          # add GEMINI_API_KEY
cd ~/HTV/mobile
npm install
npx expo login                # free Expo account, needed for --tunnel
brew install cloudflared
```
Phone: install **Expo Go** and sign in with the **same Expo account** as `npx expo login` (required for tunnel mode). The project is on Expo SDK 57 to match the store version of Expo Go.

## Run it (every time, 3 terminals)
**Terminal 1: backend**
```bash
cd ~/HTV/backend
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```
**Terminal 2: backend tunnel**
```bash
cloudflared tunnel --url http://localhost:8000
```
Copy the `https://....trycloudflare.com` URL it prints into `mobile/.env`:
```
EXPO_PUBLIC_API_URL=https://....trycloudflare.com
```
The URL changes every time cloudflared restarts.

**Terminal 3: Expo app**
```bash
cd ~/HTV/mobile
npm run tunnel                # = npx expo start --tunnel
```
Scan the QR code (iPhone: Camera app; Android: Expo Go). The residents screen footer should show the trycloudflare URL.

**Same-network shortcut:** if the phone and laptop can reach each other (e.g. laptop on the phone's hotspot), skip Terminal 2, delete `mobile/.env`, and run `npx expo start` without `--tunnel`. The app then finds the backend at port 8000 on the laptop automatically.

Check the backend any time: `<backend URL>/api/health` should return `"mode": "live"`. API docs are at `/docs`.

## Out of scope
Auth, real EHR integration, and conditions other than nutrition decline. These are "where this goes next."
