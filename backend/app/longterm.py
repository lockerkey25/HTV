"""Daily nutrient totals for the long-term chart. Staff-confirmed intake only."""
from datetime import date, timedelta

from . import baselines

NUTRIENTS = ["kcal", "protein_g", "fat_g", "cholesterol_mg", "sodium_mg", "iron_mg",
             "calcium_mg", "sugar_g", "vitamin_c_mg", "vitamin_d_mcg", "vitamin_b12_mcg"]
MEALS_PER_DAY = 3
MISSED_BELOW_PCT = 25   # a confirmed meal under this % (calorie-weighted) counts as missed

INTAKE_SQL = """
SELECT m.id AS meal_id, m.meal_date, mi.*, ml.servings, ir.percent_eaten
FROM meals m
JOIN meal_items ml ON ml.meal_id = m.id
JOIN menu_items mi ON mi.id = ml.menu_item_id
JOIN intake_records ir ON ir.meal_id = m.id AND ir.menu_item_id = mi.id
WHERE m.resident_id = ? AND m.meal_date BETWEEN ? AND ? AND m.status = 'confirmed'
"""


def _r(n: str, v: float) -> float:
    return round(v, 2 if "vitamin" in n else 1)


def intake_history(conn, resident: dict, days: int = 30) -> dict:
    days = max(1, min(days, 90))
    end = date.today()
    dates = [(end - timedelta(days=days - 1 - i)).isoformat() for i in range(days)]
    idx = {d: i for i, d in enumerate(dates)}

    food = {n: [0.0] * days for n in NUTRIENTS}
    meals_on_day = [set() for _ in range(days)]
    meal_pct = {}   # meal_id -> [kcal_eaten, kcal_served, day_index]

    for r in conn.execute(INTAKE_SQL, (resident["id"], dates[0], dates[-1])):
        i = idx[r["meal_date"]]
        scale = r["servings"] * r["percent_eaten"] / 100
        for n in NUTRIENTS:
            food[n][i] += r[n] * scale
        meals_on_day[i].add(r["meal_id"])
        m = meal_pct.setdefault(r["meal_id"], [0.0, 0.0, i])
        m[0] += r["kcal"] * scale
        m[1] += r["kcal"] * r["servings"]

    supp = {n: [0.0] * days for n in NUTRIENTS}
    for r in conn.execute(
        "SELECT sl.log_date, sl.tablets, s.nutrient, s.amount_per_tablet FROM supplement_logs sl"
        " JOIN supplements s ON s.id = sl.supplement_id"
        " WHERE sl.resident_id = ? AND sl.log_date BETWEEN ? AND ?",
        (resident["id"], dates[0], dates[-1]),
    ):
        if r["nutrient"] in supp:
            supp[r["nutrient"]][idx[r["log_date"]]] += r["tablets"] * r["amount_per_tablet"]

    weights = [None] * days
    for r in conn.execute(
        "SELECT log_date, weight_kg FROM weight_logs WHERE resident_id = ? AND log_date BETWEEN ? AND ?",
        (resident["id"], dates[0], dates[-1]),
    ):
        weights[idx[r["log_date"]]] = r["weight_kg"]

    # A day only counts if every meal was confirmed; partial days are gaps, not "ate nothing".
    complete = [len(s) >= MEALS_PER_DAY for s in meals_on_day]
    meals_missed = [0] * days
    for eaten, served, i in meal_pct.values():
        if served and eaten / served * 100 < MISSED_BELOW_PCT:
            meals_missed[i] += 1

    food_out = {n: [_r(n, food[n][i]) if complete[i] else None for i in range(days)] for n in NUTRIENTS}
    total_out = {n: [_r(n, food[n][i] + supp[n][i]) if complete[i] else None for i in range(days)]
                 for n in NUTRIENTS}

    latest_weight = next((w for w in reversed(weights) if w is not None), None)
    targets = {n: {"min": lo, "max": hi}
               for n, (lo, hi) in baselines.targets(resident, latest_weight).items()}

    avg = {}
    for n in NUTRIENTS:
        vals = [v for v in total_out[n] if v is not None]
        avg[n] = _r(n, sum(vals) / len(vals)) if vals else None

    return {
        "resident_id": resident["id"],
        "dates": dates,
        "nutrients": NUTRIENTS,
        "food": food_out,            # meals only
        "total": total_out,          # meals + supplements
        "targets": targets,          # {nutrient: {min, max}}; fat_g has none
        "weight_kg": weights,
        "meals_logged": [len(s) for s in meals_on_day],
        "meals_missed": meals_missed,
        "summary": {
            "days_with_full_logs": sum(complete),
            "meals_missed": sum(meals_missed),
            "average": avg,
        },
    }