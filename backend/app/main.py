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

from . import analysis, config, db, gemini, images, nutrition
from .schemas import AnalyzeResponse, ConfirmRequest, ConfirmResponse, TrayAnalysis

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


@app.get("/api/meals/{meal_id}")
def get_meal(meal_id: int):
    with db.connect() as conn:
        meal = db.get_meal(conn, meal_id)
    if meal is None:
        raise HTTPException(404, "meal not found")
    return meal


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
