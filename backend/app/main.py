"""Nourish API.

NOTE: no authentication. Fine for a local hackathon demo with synthetic data only.
Real deployment needs staff auth and must not hold real resident data without it.
"""
import json
import logging
from contextlib import asynccontextmanager
from datetime import date

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

from . import analysis, config, db, diet_rules, gemini, images, nutrition
from .schemas import AnalyzeResponse, BeforeCheckResponse, ConfirmRequest, ConfirmResponse, TrayAnalysis

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.init_db()
    logging.getLogger("nourish").info("Nourish running in %s mode", config.MODE)
    yield


app = FastAPI(title="Nourish", lifespan=lifespan)
# Open CORS so the Expo web build can call the API during development.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/", include_in_schema=False)
def root():
    return RedirectResponse("/docs")


@app.get("/api/health")
def health():
    return {"ok": True, "mode": config.MODE, "model": config.GEMINI_MODEL}


@app.get("/api/meals/unlogged")
def unlogged_meals(meal_type: str, meal_date: str | None = None):
    """Return residents who have a 'served' (not confirmed) meal of the given type today."""
    meal_date = meal_date or date.today().isoformat()
    with db.connect() as conn:
        rows = conn.execute(
            """
            SELECT r.id AS resident_id, r.name, r.room, m.id AS meal_id, m.meal_type, m.meal_date
            FROM meals m
            JOIN residents r ON r.id = m.resident_id
            WHERE m.meal_type = ? AND m.meal_date = ? AND m.status = 'served'
            ORDER BY r.room
            """,
            (meal_type, meal_date),
        ).fetchall()
        return [dict(r) for r in rows]


@app.get("/api/residents/{resident_id}/weight")
def get_weight_log(resident_id: int, log_date: str | None = None):
    log_date = log_date or date.today().isoformat()
    with db.connect() as conn:
        if db.get_resident(conn, resident_id) is None:
            raise HTTPException(404, "resident not found")
        row = conn.execute(
            "SELECT weight_kg, log_date FROM weight_logs WHERE resident_id = ? AND log_date = ?",
            (resident_id, log_date),
        ).fetchone()
        return {"weight_kg": row["weight_kg"] if row else None, "log_date": log_date}


@app.post("/api/residents/{resident_id}/weight")
def log_weight(resident_id: int, body: dict):
    weight_kg = body.get("weight_kg")
    log_date = body.get("log_date") or date.today().isoformat()
    if weight_kg is None or not (30 <= float(weight_kg) <= 200):
        raise HTTPException(422, "weight_kg must be between 30 and 200")
    with db.connect() as conn:
        if db.get_resident(conn, resident_id) is None:
            raise HTTPException(404, "resident not found")
        conn.execute(
            """
            INSERT INTO weight_logs (resident_id, log_date, weight_kg)
            VALUES (?, ?, ?)
            ON CONFLICT(resident_id, log_date)
            DO UPDATE SET weight_kg = excluded.weight_kg, logged_at = datetime('now')
            """,
            (resident_id, log_date, float(weight_kg)),
        )
    return {"ok": True}


@app.get("/api/supplements")
def list_supplements():
    with db.connect() as conn:
        rows = conn.execute("SELECT * FROM supplements ORDER BY name").fetchall()
        return [dict(r) for r in rows]


@app.get("/api/residents/{resident_id}/supplements")
def get_supplement_logs(resident_id: int, log_date: str | None = None):
    log_date = log_date or date.today().isoformat()
    with db.connect() as conn:
        if db.get_resident(conn, resident_id) is None:
            raise HTTPException(404, "resident not found")
        rows = conn.execute(
            """
            SELECT s.id, s.name, s.nutrient, s.unit, s.amount_per_tablet,
                   COALESCE(sl.tablets, 0) AS tablets
            FROM supplements s
            LEFT JOIN supplement_logs sl
                ON sl.supplement_id = s.id
                AND sl.resident_id = ?
                AND sl.log_date = ?
            ORDER BY s.name
            """,
            (resident_id, log_date),
        ).fetchall()
        return [dict(r) for r in rows]


@app.post("/api/residents/{resident_id}/supplements")
def log_supplements(resident_id: int, body: dict, log_date: str | None = None):
    """body: {supplement_id: tablets, ...}"""
    log_date = log_date or date.today().isoformat()
    with db.connect() as conn:
        if db.get_resident(conn, resident_id) is None:
            raise HTTPException(404, "resident not found")
        for supp_id, tablets in body.items():
            conn.execute(
                """
                INSERT INTO supplement_logs (resident_id, supplement_id, log_date, tablets)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(resident_id, supplement_id, log_date)
                DO UPDATE SET tablets = excluded.tablets, logged_at = datetime('now')
                """,
                (resident_id, int(supp_id), log_date, int(tablets)),
            )
    return {"ok": True}


@app.get("/api/residents")
def list_residents():
    with db.connect() as conn:
        rows = conn.execute("SELECT id FROM residents ORDER BY room").fetchall()
        return [db.get_resident(conn, r["id"]) for r in rows]


@app.get("/api/residents/{resident_id}/meals")
def resident_meals(resident_id: int, meal_date: str | None = None):
    meal_date = meal_date or date.today().isoformat()
    with db.connect() as conn:
        if db.get_resident(conn, resident_id) is None:
            raise HTTPException(404, "resident not found")
        rows = conn.execute(
            "SELECT id FROM meals WHERE resident_id = ? AND meal_date = ?"
            " ORDER BY CASE meal_type WHEN 'breakfast' THEN 0 WHEN 'lunch' THEN 1 ELSE 2 END",
            (resident_id, meal_date),
        ).fetchall()
        return [db.get_meal(conn, r["id"]) for r in rows]


@app.get("/api/menu-items")
def list_menu_items(resident_id: int | None = None):
    """Full menu catalogue. If resident_id is given, annotate each item with a
    safety check (safe | warning | block) against that resident's profile."""
    with db.connect() as conn:
        rows = conn.execute("SELECT * FROM menu_items ORDER BY food_group, name").fetchall()
        items = [{**dict(r), "allergens": json.loads(r["allergens"])} for r in rows]

        resident = db.get_resident(conn, resident_id) if resident_id is not None else None

    if resident is None:
        return items

    allergies = set(resident["allergies"])
    res_level = diet_rules.TEXTURE_LEVEL[resident["texture"]]
    low_sodium = "low_sodium" in resident["diet_flags"]
    preferences = [p.lower() for p in resident.get("preferences", [])]

    for it in items:
        warnings: list[str] = []
        level = "safe"
        # Allergy = hard block
        hit = allergies.intersection(it["allergens"])
        if hit:
            level = "block"
            warnings.append(f"Contains {', '.join(sorted(hit))} — resident is allergic.")
        # Texture = hard block
        if diet_rules.TEXTURE_LEVEL[it["texture"]] < res_level:
            level = "block"
            warnings.append(f"{it['texture']} texture; resident needs {resident['texture']}.")
        # Low sodium = warning
        if low_sodium and it["sodium_mg"] > diet_rules.LOW_SODIUM_ITEM_LIMIT_MG:
            if level != "block":
                level = "warning"
            warnings.append(f"High sodium ({it['sodium_mg']:.0f} mg); resident is low-sodium.")
        # Preference dislike = warning
        for pref in preferences:
            if any(word in it["name"].lower() for word in pref.split() if len(word) > 3):
                if level != "block":
                    level = "warning"
                warnings.append(f"Resident preference: {pref}.")
        it["safety"] = level
        it["safety_warnings"] = warnings

    return items


@app.put("/api/meals/{meal_id}/items")
def update_meal_items(meal_id: int, body: dict):
    """Replace the items served for a meal. body: {menu_item_ids: [int, ...]}"""
    ids = body.get("menu_item_ids", [])
    with db.connect() as conn:
        meal = db.get_meal(conn, meal_id)
        if meal is None:
            raise HTTPException(404, "meal not found")
        if meal["status"] == "confirmed":
            raise HTTPException(422, "cannot edit a confirmed meal")
        conn.execute("DELETE FROM meal_items WHERE meal_id = ?", (meal_id,))
        conn.executemany(
            "INSERT INTO meal_items (meal_id, menu_item_id) VALUES (?, ?)",
            [(meal_id, int(i)) for i in ids],
        )
        return db.get_meal(conn, meal_id)


@app.get("/api/meals/{meal_id}")
def get_meal(meal_id: int):
    with db.connect() as conn:
        meal = db.get_meal(conn, meal_id)
    if meal is None:
        raise HTTPException(404, "meal not found")
    return meal


@app.post("/api/meals/{meal_id}/check-before", response_model=BeforeCheckResponse)
async def check_before(meal_id: int, before: UploadFile = File(...)):
    """Analyse the before photo only: check diet rules and what's visible on the tray."""
    with db.connect() as conn:
        meal = db.get_meal(conn, meal_id)
        if meal is None:
            raise HTTPException(404, "meal not found")
        resident = db.get_resident(conn, meal["resident_id"])

    try:
        before_img = images.normalize(await before.read())
    except images.InvalidImage as e:
        raise HTTPException(400, f"invalid image: {e}")

    try:
        result = await gemini.check_before_tray(meal["items"], before_img)
    except gemini.AnalysisUnavailable as e:
        raise HTTPException(503, f"analysis unavailable ({e})")

    # Build a lookup of menu item details by id.
    item_map = {it["id"]: it for it in meal["items"]}

    # Check diet rules against ALL served items (texture/allergy violations apply regardless of visibility).
    alerts = diet_rules.check_tray(resident, meal["items"], result.extra_items)

    # Check preferences — find tray items (menu + extra) that match any preference keyword.
    preferences = resident.get("preferences", [])
    preference_conflicts: list[str] = []
    all_tray_names = [item_map[c.menu_item_id]["name"] for c in result.items if c.visible and c.menu_item_id in item_map] + result.extra_items
    for pref in preferences:
        pref_lower = pref.lower()
        for item_name in all_tray_names:
            item_lower = item_name.lower()
            # Match if any word in the preference (>3 chars) appears in the item name
            if any(word in item_lower for word in pref_lower.split() if len(word) > 3):
                conflict_msg = f"{item_name} — {pref}"
                if conflict_msg not in preference_conflicts:
                    preference_conflicts.append(conflict_msg)
        # Also check if the full preference string contains the item name
        for item_name in all_tray_names:
            item_lower = item_name.lower()
            if any(word in pref_lower for word in item_lower.split() if len(word) > 3):
                conflict_msg = f"{item_name} — {pref}"
                if conflict_msg not in preference_conflicts:
                    preference_conflicts.append(conflict_msg)

    return BeforeCheckResponse(
        quality=result.quality.value,
        menu_items_visible=[
            {
                "id": c.menu_item_id,
                "name": item_map[c.menu_item_id]["name"] if c.menu_item_id in item_map else str(c.menu_item_id),
                "visible": c.visible,
                "description": c.description,
                "confidence": c.confidence.value if hasattr(c, "confidence") and c.confidence else None,
            }
            for c in result.items
        ],
        extra_items=result.extra_items,
        diet_alerts=alerts,
        preference_conflicts=preference_conflicts,
    )


@app.post("/api/meals/{meal_id}/analyze", response_model=AnalyzeResponse)
async def analyze_meal(meal_id: int, before: UploadFile = File(...), after: UploadFile = File(...)):
    with db.connect() as conn:
        meal = db.get_meal(conn, meal_id)
        if meal is None:
            raise HTTPException(404, "meal not found")
        resident = db.get_resident(conn, meal["resident_id"])

    try:
        before_img = images.normalize(await before.read())
        after_img = images.normalize(await after.read())
    except images.InvalidImage as e:
        raise HTTPException(400, f"invalid image: {e}")

    try:
        raw, source, model = await gemini.analyze_tray(meal_id, meal["items"], before_img, after_img)
    except gemini.AnalysisUnavailable as e:
        raise HTTPException(503, f"analysis unavailable, log intake manually ({e})")

    with db.connect() as conn:
        cur = conn.execute(
            "INSERT INTO meal_analyses (meal_id, model, source, raw_json) VALUES (?,?,?,?)",
            (meal_id, model, source, raw.model_dump_json()),
        )
        analysis_id = cur.lastrowid

    return analysis.build_response(
        analysis_id=analysis_id, meal=meal, resident=resident, raw=raw, source=source, model=model
    )


@app.post("/api/meals/{meal_id}/confirm", response_model=ConfirmResponse)
def confirm_meal(meal_id: int, body: ConfirmRequest):
    with db.connect() as conn:
        meal = db.get_meal(conn, meal_id)
        if meal is None:
            raise HTTPException(404, "meal not found")
        served = {it["id"]: it for it in meal["items"]}
        given = {c.menu_item_id: c.percent_eaten for c in body.items}
        if set(given) != set(served):
            raise HTTPException(422, "provide percent_eaten for exactly the served items")

        ai_pcts: dict[int, int] = {}
        if body.analysis_id is not None:
            row = conn.execute(
                "SELECT raw_json FROM meal_analyses WHERE id = ? AND meal_id = ?",
                (body.analysis_id, meal_id),
            ).fetchone()
            if row is None:
                raise HTTPException(404, "analysis not found for this meal")
            try:
                raw = TrayAnalysis.model_validate(json.loads(row["raw_json"]))
                ai_pcts = {e.menu_item_id: e.percent_eaten for e in raw.items if e.visible_in_before}
            except ValueError:  # analysis saved with an older schema
                ai_pcts = {}

        conn.execute("DELETE FROM intake_records WHERE meal_id = ?", (meal_id,))
        conn.executemany(
            "INSERT INTO intake_records (meal_id, menu_item_id, percent_eaten, ai_percent, analysis_id)"
            " VALUES (?,?,?,?,?)",
            [(meal_id, mid, pct, ai_pcts.get(mid), body.analysis_id) for mid, pct in given.items()],
        )
        conn.execute("UPDATE meals SET status = 'confirmed' WHERE id = ?", (meal_id,))

    return ConfirmResponse(
        meal_id=meal_id,
        overall_percent_eaten=nutrition.overall_percent(meal["items"], given) or 0,
        totals_consumed=nutrition.total([nutrition.consumed(served[m], p) for m, p in given.items()]),
        adjusted_items=[m for m, p in given.items() if m in ai_pcts and ai_pcts[m] != p],
    )

from . import analysis, baselines, config, db, diet_rules, gemini, images, longterm, nutrition

@app.get("/api/residents/{resident_id}/intake-history")
def intake_history(resident_id: int, days: int = 30):
    with db.connect() as conn:
        resident = db.get_resident(conn, resident_id)
        if resident is None:
            raise HTTPException(404, "resident not found")
        return longterm.intake_history(conn, resident, days)


@app.get("/api/residents/{resident_id}/health-assessment")
async def health_assessment(resident_id: int, days: int = 30):
    with db.connect() as conn:
        resident = db.get_resident(conn, resident_id)
        if resident is None:
            raise HTTPException(404, "resident not found")
        history = longterm.intake_history(conn, resident, days)

    # Build a readable profile block.
    profile = (
        f"Name: {resident['name']}\n"
        f"Sex: {resident['sex']}\n"
        f"Age group: {baselines.age_group(resident['dob'])} "
        f"(DOB {resident['dob']})\n"
        f"Height: {resident['height_cm']} cm\n"
        f"Conditions: {', '.join(resident['conditions']) or 'none recorded'}\n"
        f"Medications: {', '.join(m['name'] + ' ' + m['dose_per_day'] for m in resident['medications']) or 'none recorded'}"
    )

    # Build the nutrient comparison block.
    avg = history["summary"]["average"]
    targets = history["targets"]
    lines = []
    for n in history["nutrients"]:
        a = avg.get(n)
        t = targets.get(n, {})
        lo, hi = t.get("min"), t.get("max")
        target_str = (
            f"{round(lo)}–{round(hi)}" if lo is not None and hi is not None
            else f"min {round(lo)}" if lo is not None
            else f"max {round(hi)}" if hi is not None
            else "no target"
        )
        label = longterm.LABELS.get(n, n)
        lines.append(f"- {label}: avg {a if a is not None else 'no data'} (target {target_str})")
    nutrients = "\n".join(lines)

    weights = [w for w in history["weight_kg"] if w is not None]
    weight_trend = "no weight data"
    if len(weights) >= 2:
        delta = weights[-1] - weights[0]
        weight_trend = f"{weights[0]} kg → {weights[-1]} kg ({'+' if delta >= 0 else ''}{round(delta, 1)} kg over period)"
    signals = (
        f"Days fully logged: {history['summary']['days_with_full_logs']} of {days}\n"
        f"Meals under 25% eaten: {history['summary']['meals_missed']}\n"
        f"Weight trend: {weight_trend}"
    )

    try:
        result = await gemini.assess_health(profile, nutrients, signals)
    except gemini.AnalysisUnavailable as e:
        raise HTTPException(503, f"assessment unavailable ({e})")

    return result.model_dump()