"""SQLite schema, menu/resident seed data, and ~30 days of synthetic history.

Delete the .db file whenever this seed or the schema changes, because init_db()
only seeds when the residents table is empty.
"""
import json
import random
import sqlite3
from datetime import date, timedelta

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS residents (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL,
    room          TEXT NOT NULL,
    texture       TEXT NOT NULL DEFAULT 'regular',
    diet_flags    TEXT NOT NULL DEFAULT '[]',
    allergies     TEXT NOT NULL DEFAULT '[]',
    preferences   TEXT NOT NULL DEFAULT '[]',
    sex           TEXT NOT NULL DEFAULT 'male',      -- male | female
    dob           TEXT NOT NULL DEFAULT '1950-01-01', -- YYYY-MM-DD
    height_cm     REAL NOT NULL DEFAULT 170,
    conditions    TEXT NOT NULL DEFAULT '[]',        -- JSON list
    medications   TEXT NOT NULL DEFAULT '[]'         -- JSON list of {name, dose_per_day}
);

-- Nutrient values are per standard serving. Approximate for now;
CREATE TABLE IF NOT EXISTS menu_items (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL,
    food_group    TEXT NOT NULL,   -- protein | grain | vegetable | fruit | dairy | other
    texture       TEXT NOT NULL,   -- regular | soft | minced | pureed
    allergens     TEXT NOT NULL DEFAULT '[]',
    kcal          REAL NOT NULL,
    protein_g     REAL NOT NULL,
    fat_g         REAL NOT NULL DEFAULT 0,
    cholesterol_mg REAL NOT NULL DEFAULT 0,
    iron_mg       REAL NOT NULL,
    calcium_mg    REAL NOT NULL,
    sodium_mg     REAL NOT NULL,
    sugar_g       REAL NOT NULL DEFAULT 0,
    vitamin_c_mg  REAL NOT NULL DEFAULT 0,
    vitamin_d_mcg REAL NOT NULL DEFAULT 0,
    vitamin_b12_mcg REAL NOT NULL DEFAULT 0,
    fdc_id        INTEGER
);

CREATE TABLE IF NOT EXISTS meals (
    id            INTEGER PRIMARY KEY,
    resident_id   INTEGER NOT NULL REFERENCES residents(id),
    meal_date     TEXT NOT NULL,
    meal_type     TEXT NOT NULL,   -- breakfast | lunch | dinner
    status        TEXT NOT NULL DEFAULT 'served'  -- served | confirmed
);

CREATE TABLE IF NOT EXISTS meal_items (
    meal_id       INTEGER NOT NULL REFERENCES meals(id),
    menu_item_id  INTEGER NOT NULL REFERENCES menu_items(id),
    servings      REAL NOT NULL DEFAULT 1.0,
    PRIMARY KEY (meal_id, menu_item_id)
);

-- Raw Gemini output, kept for audit ("what did the AI actually say").
CREATE TABLE IF NOT EXISTS meal_analyses (
    id            INTEGER PRIMARY KEY,
    meal_id       INTEGER NOT NULL REFERENCES meals(id),
    model         TEXT NOT NULL,
    source        TEXT NOT NULL,   -- gemini | cache | mock
    raw_json      TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Staff-confirmed intake. This, not the raw AI output, feeds risk scoring.
CREATE TABLE IF NOT EXISTS intake_records (
    meal_id       INTEGER NOT NULL REFERENCES meals(id),
    menu_item_id  INTEGER NOT NULL REFERENCES menu_items(id),
    percent_eaten INTEGER NOT NULL CHECK (percent_eaten BETWEEN 0 AND 100),
    ai_percent    INTEGER,
    analysis_id   INTEGER REFERENCES meal_analyses(id),
    confirmed_at  TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (meal_id, menu_item_id)
);

-- Supplements catalogue: one row per supplement type
CREATE TABLE IF NOT EXISTS supplements (
    id                INTEGER PRIMARY KEY,
    name              TEXT NOT NULL,
    nutrient          TEXT NOT NULL,
    unit              TEXT NOT NULL,
    amount_per_tablet REAL NOT NULL
);

-- Daily weight logs
CREATE TABLE IF NOT EXISTS weight_logs (
    id            INTEGER PRIMARY KEY,
    resident_id   INTEGER NOT NULL REFERENCES residents(id),
    log_date      TEXT NOT NULL,
    weight_kg     REAL NOT NULL CHECK (weight_kg BETWEEN 30 AND 200),
    logged_at     TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(resident_id, log_date)
);

-- Daily supplement logs
CREATE TABLE IF NOT EXISTS supplement_logs (
    id            INTEGER PRIMARY KEY,
    resident_id   INTEGER NOT NULL REFERENCES residents(id),
    supplement_id INTEGER NOT NULL REFERENCES supplements(id),
    log_date      TEXT NOT NULL,
    tablets       INTEGER NOT NULL DEFAULT 0,
    logged_at     TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(resident_id, supplement_id, log_date)
);
"""

# Supplements catalogue: name, nutrient, unit, amount_per_tablet
SUPPLEMENTS = [
    ("Vitamin C",     "vitamin_c_mg",   "mg",  500.0),
    ("Vitamin D3",    "vitamin_d_mcg",  "mcg", 25.0),
    ("Vitamin B12",   "vitamin_b12_mcg","mcg", 500.0),
    ("Iron",          "iron_mg",        "mg",  65.0),
    ("Calcium",       "calcium_mg",     "mg",  500.0),
    ("Omega-3",       "fat_g",          "g",   1.0),
]

# name, food_group, texture, allergens, kcal, protein_g, fat_g, cholesterol_mg, sodium_mg, iron_mg, calcium_mg, sugar_g, vitamin_c_mg, vitamin_d_mcg, vitamin_b12_mcg
MENU = [
    ("Baked salmon",          "protein",   "regular", ["fish"],         175, 25.0,  8.1,  63,  52,  0.4,  13,  0.0,  0.0, 14.3, 3.2),
    ("Roast chicken breast",  "protein",   "regular", [],               165, 31.0,  3.6,  85, 360,  1.0,  15,  0.0,  0.0,  0.1, 0.3),
    ("Minced beef with gravy","protein",   "minced",  [],               218, 19.0, 13.0,  70, 450,  2.4,  18,  1.0,  0.0,  0.0, 2.4),
    ("Scrambled eggs",        "protein",   "soft",    ["egg"],          148, 10.0, 11.0, 372, 180,  1.2,  43,  1.2,  0.0,  2.2, 1.1),
    ("Omelette",              "protein",   "regular", ["egg", "dairy"], 154, 11.0, 11.5, 380, 200,  1.3,  50,  1.0,  0.0,  2.2, 1.1),
    ("Sliced strawberries",   "fruit",     "regular", [],                24,  0.5,  0.2,   0,   1,  0.3,   9,  4.9, 42.0,  0.0, 0.0),
    ("Cheese pieces",         "dairy",     "regular", ["dairy"],        113,  7.0,  9.3,  27, 174,  0.2, 202,  0.1,  0.0,  0.2, 0.3),
    ("Mashed potatoes",       "grain",     "soft",    ["dairy"],        119,  2.0,  4.5,  15, 330,  0.3,  24,  1.8,  7.4,  0.1, 0.1),
    ("White rice",            "grain",     "regular", [],               112,  2.1,  0.2,   0,   1,  1.2,  10,  0.0,  0.0,  0.0, 0.0),
    ("Whole wheat toast",     "grain",     "regular", ["gluten"],       128,  5.0,  2.0,   0, 159,  1.5,  30,  1.5,  0.0,  0.0, 0.0),
    ("Oatmeal",               "grain",     "soft",    [],               166,  5.9,  3.6,   0,  49,  2.1,  21,  0.6,  0.0,  0.0, 0.0),
    ("Steamed broccoli",      "vegetable", "regular", [],                27,  1.9,  0.3,   0,  32,  0.5,  47,  1.7, 51.5,  0.0, 0.0),
    ("Pureed carrots",        "vegetable", "pureed",  [],                27,  0.6,  0.1,   0,  45,  0.3,  20,  3.4,  3.6,  0.0, 0.0),
    ("Spinach (creamed)",     "vegetable", "soft",    ["dairy"],        120,  4.5,  7.5,  20, 380,  2.0, 170,  2.5, 12.0,  0.0, 0.1),
    ("Applesauce",            "fruit",     "pureed",  [],                52,  0.2,  0.1,   0,   2,  0.2,   5,  9.8,  0.7,  0.0, 0.0),
    ("Sliced banana",         "fruit",     "soft",    [],                67,  0.8,  0.2,   0,   1,  0.2,   4, 12.2, 11.5,  0.0, 0.0),
    ("Vanilla yogurt",        "dairy",     "pureed",  ["dairy"],        147,  5.9,  3.5,  14,  81,  0.1, 209, 22.0,  1.0,  0.1, 0.9),
    ("Glass of milk",         "dairy",     "regular", ["dairy"],        149,  8.0,  8.0,  24, 105,  0.1, 276, 12.3,  0.0,  3.2, 1.1),
    ("Chicken noodle soup",   "other",     "soft",    ["gluten"],        75,  4.8,  2.4,  17, 744,  0.6,  17,  1.2,  0.3,  0.0, 0.1),
    ("Pureed chicken",        "protein",   "pureed",  [],               150, 24.0,  4.0,  75, 120,  0.9,  14,  0.0,  0.0,  0.1, 0.3),
    ("Pureed lentils",        "protein",   "pureed",  [],               170, 12.0,  0.6,   0,   8,  3.5,  25,  2.0,  2.0,  0.0, 0.0),
    ("Pureed oatmeal",        "grain",     "pureed",  [],               150,  5.0,  3.0,   0,  45,  2.0,  20,  0.5,  0.0,  0.0, 0.0),
    ("Pureed peas",           "vegetable", "pureed",  [],                80,  5.0,  0.4,   0,   5,  1.5,  25,  5.0, 40.0,  0.0, 0.0),
]

# name, room, texture, diet_flags, allergies, preferences, sex, dob, height_cm, conditions, medications
RESIDENTS = [
    (
        "Mr. Okafor", "112A", "regular", ["low_sodium"], [], [],
        "male", "1948-03-14", 175,
        ["hypertension", "type 2 diabetes"],
        [{"name": "Metformin", "dose_per_day": "1000mg"}, {"name": "Lisinopril", "dose_per_day": "10mg"}],
    ),
    (
        "Mrs. Lindqvist", "114B", "soft", [], ["fish"], ["dislikes lemons"],
        "female", "1952-07-22", 162,
        ["osteoporosis", "mild dementia"],
        [{"name": "Alendronate", "dose_per_day": "70mg (weekly)"}, {"name": "Donepezil", "dose_per_day": "5mg"}],
    ),
    (
        "Mr. Tanaka", "120A", "pureed", [], [], [],
        "male", "1944-11-05", 168,
        ["dysphagia", "chronic kidney disease stage 3"],
        [{"name": "Furosemide", "dose_per_day": "40mg"}, {"name": "Aspirin", "dose_per_day": "81mg"}],
    ),
]

# resident index -> {meal_type: [menu names]}. Some trays intentionally
# break diet rules so the checks have something to catch in the demo.
TODAY_MEALS = {
    0: {
        "breakfast": ["Sliced strawberries", "Omelette", "Whole wheat toast", "Cheese pieces"],
        "lunch": ["Roast chicken breast", "Mashed potatoes", "Steamed broccoli"],
        "dinner": ["Baked salmon", "White rice", "Chicken noodle soup"],
    },
    1: {
        "breakfast": ["Scrambled eggs"],
        "lunch": ["Minced beef with gravy", "Mashed potatoes", "Pureed carrots"],
        "dinner": ["Baked salmon", "White rice", "Steamed broccoli"],
    },
    2: {
        "breakfast": ["Sliced strawberries", "Omelette", "Whole wheat toast", "Cheese pieces"],
        "lunch": ["Pureed carrots", "Mashed potatoes", "Vanilla yogurt"],
        "dinner": ["Minced beef with gravy", "Pureed carrots", "Applesauce"],
    },
}

# ---------- Synthetic history ----------

DAYS = 30
MEAL_TYPES = ("breakfast", "lunch", "dinner")

# mean = % eaten (start, end of period), skip = chance a whole meal is refused (start, end),
# weight = kg (start, end), unlogged = {day index: [meals nobody confirmed]},
# supplements = {name: chance given each day}
HISTORY_PLANS = {
    0: {  # Mr. Okafor: eats well, but sodium and sugar run high
        "portion": 1.6, "mean": (85, 85), "skip": (0.03, 0.03), "weight": (82.0, 82.0),
        "unlogged": {12: ["lunch", "dinner"]},
        "supplements": {"Vitamin B12": 0.95},
        "menus": {
            "breakfast": [["Omelette", "Whole wheat toast", "Vanilla yogurt"],
                          ["Oatmeal", "Sliced banana", "Glass of milk"],
                          ["Scrambled eggs", "Whole wheat toast", "Glass of milk"]],
            "lunch":     [["Chicken noodle soup", "Whole wheat toast", "Vanilla yogurt"],
                          ["Roast chicken breast", "Mashed potatoes", "Steamed broccoli"]],
            "dinner":    [["Minced beef with gravy", "Mashed potatoes", "Glass of milk"],
                          ["Chicken noodle soup", "White rice", "Applesauce"],
                          ["Roast chicken breast", "White rice", "Steamed broccoli"]],
        },
    },
    1: {  # Mrs. Lindqvist: intake declines, skips more meals, loses ~4% weight
        "portion": 1.5, "mean": (85, 45), "skip": (0.03, 0.30), "weight": (58.0, 55.5),
        "unlogged": {},
        "supplements": {"Vitamin D3": 0.5},
        "menus": {
            "breakfast": [["Scrambled eggs", "Oatmeal", "Sliced banana"],
                          ["Oatmeal", "Applesauce"]],
            "lunch":     [["Minced beef with gravy", "Mashed potatoes", "Pureed carrots"],
                          ["Chicken noodle soup", "Mashed potatoes", "Applesauce"]],
            "dinner":    [["Minced beef with gravy", "Spinach (creamed)", "Mashed potatoes"],
                          ["Pureed chicken", "Mashed potatoes", "Pureed carrots"]],
        },
    },
    2: {  # Mr. Tanaka: CKD, pureed. Stable weight, protein kept low on purpose
        "portion": 1.3, "mean": (85, 85), "skip": (0.03, 0.03), "weight": (68.0, 68.0),
        "unlogged": {},
        "supplements": {"Vitamin D3": 0.9},
        "menus": {
            "breakfast": [["Pureed oatmeal", "Applesauce", "Vanilla yogurt"]],
            "lunch":     [["Pureed chicken", "Pureed carrots", "Applesauce"],
                          ["Pureed lentils", "Pureed peas", "Applesauce"]],
            "dinner":    [["Pureed oatmeal", "Pureed peas", "Pureed carrots", "Applesauce"],
                          ["Pureed lentils", "Pureed carrots", "Applesauce"]],
        },
    },
}


def _pct(rng: random.Random, mean: float) -> int:
    return max(0, min(100, 5 * round(rng.gauss(mean, 15) / 5)))


def _seed_history(conn: sqlite3.Connection, menu_ids: dict, resident_ids: dict) -> None:
    """~30 days of confirmed meals, weights and supplements. Fixed seed = same demo every run."""
    rng = random.Random(42)
    supp_ids = {r["name"]: r["id"] for r in conn.execute("SELECT id, name FROM supplements")}
    today = date.today()
    for idx, plan in HISTORY_PLANS.items():
        rid = resident_ids[idx]
        for d in range(DAYS):
            iso = (today - timedelta(days=DAYS - d)).isoformat()
            frac = d / (DAYS - 1)
            mean = plan["mean"][0] + (plan["mean"][1] - plan["mean"][0]) * frac
            skip_p = plan["skip"][0] + (plan["skip"][1] - plan["skip"][0]) * frac

            for meal_type in MEAL_TYPES:
                items = rng.choice(plan["menus"][meal_type])
                unlogged = meal_type in plan["unlogged"].get(d, [])
                meal_id = conn.execute(
                    "INSERT INTO meals (resident_id, meal_date, meal_type, status) VALUES (?,?,?,?)",
                    (rid, iso, meal_type, "served" if unlogged else "confirmed"),
                ).lastrowid
                conn.executemany(
                    "INSERT INTO meal_items (meal_id, menu_item_id, servings) VALUES (?,?,?)",
                    [(meal_id, menu_ids[n], plan["portion"]) for n in items],
                )
                if unlogged:
                    continue
                skipped = rng.random() < skip_p
                conn.executemany(
                    "INSERT INTO intake_records (meal_id, menu_item_id, percent_eaten) VALUES (?,?,?)",
                    [(meal_id, menu_ids[n], 0 if skipped else _pct(rng, mean)) for n in items],
                )

            w = plan["weight"][0] + (plan["weight"][1] - plan["weight"][0]) * frac + rng.uniform(-0.3, 0.3)
            conn.execute(
                "INSERT INTO weight_logs (resident_id, log_date, weight_kg) VALUES (?,?,?)",
                (rid, iso, round(w, 1)),
            )
            for sname, prob in plan["supplements"].items():
                conn.execute(
                    "INSERT INTO supplement_logs (resident_id, supplement_id, log_date, tablets) VALUES (?,?,?,?)",
                    (rid, supp_ids[sname], iso, 1 if rng.random() < prob else 0),
                )


# ---------- Connection, init, seed ----------

def connect() -> sqlite3.Connection:
    config.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(config.DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    with connect() as conn:
        conn.executescript(SCHEMA)
        if conn.execute("SELECT COUNT(*) FROM residents").fetchone()[0] == 0:
            _seed(conn)


def _seed(conn: sqlite3.Connection) -> None:
    # Seed supplements catalogue
    if conn.execute("SELECT COUNT(*) FROM supplements").fetchone()[0] == 0:
        for name, nutrient, unit, amount in SUPPLEMENTS:
            conn.execute(
                "INSERT INTO supplements (name, nutrient, unit, amount_per_tablet) VALUES (?,?,?,?)",
                (name, nutrient, unit, amount),
            )

    menu_ids = {}
    for name, group, texture, allergens, kcal, protein, fat, cholesterol, sodium, iron, calcium, sugar, vit_c, vit_d, vit_b12 in MENU:
        cur = conn.execute(
            "INSERT INTO menu_items (name, food_group, texture, allergens, kcal, protein_g,"
            " fat_g, cholesterol_mg, sodium_mg, iron_mg, calcium_mg, sugar_g,"
            " vitamin_c_mg, vitamin_d_mcg, vitamin_b12_mcg) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (name, group, texture, json.dumps(allergens), kcal, protein, fat, cholesterol,
             sodium, iron, calcium, sugar, vit_c, vit_d, vit_b12),
        )
        menu_ids[name] = cur.lastrowid

    today = date.today().isoformat()
    resident_ids = {}
    for idx, (name, room, texture, flags, allergies, preferences, sex, dob, height_cm, conditions, medications) in enumerate(RESIDENTS):
        cur = conn.execute(
            "INSERT INTO residents (name, room, texture, diet_flags, allergies, preferences,"
            " sex, dob, height_cm, conditions, medications) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (name, room, texture, json.dumps(flags), json.dumps(allergies), json.dumps(preferences),
             sex, dob, height_cm, json.dumps(conditions), json.dumps(medications)),
        )
        resident_id = cur.lastrowid
        resident_ids[idx] = resident_id
        for meal_type, items in TODAY_MEALS[idx].items():
            meal = conn.execute(
                "INSERT INTO meals (resident_id, meal_date, meal_type) VALUES (?,?,?)",
                (resident_id, today, meal_type),
            )
            conn.executemany(
                "INSERT INTO meal_items (meal_id, menu_item_id) VALUES (?,?)",
                [(meal.lastrowid, menu_ids[item]) for item in items],
            )
    _seed_history(conn, menu_ids, resident_ids)


def get_resident(conn: sqlite3.Connection, resident_id: int) -> dict | None:
    row = conn.execute("SELECT * FROM residents WHERE id = ?", (resident_id,)).fetchone()
    if row is None:
        return None
    r = dict(row)
    r["diet_flags"] = json.loads(r["diet_flags"])
    r["allergies"] = json.loads(r["allergies"])
    r["preferences"] = json.loads(r["preferences"]) if r["preferences"] else []
    r["conditions"] = json.loads(r["conditions"]) if r["conditions"] else []
    r["medications"] = json.loads(r["medications"]) if r["medications"] else []
    return r


def get_meal(conn: sqlite3.Connection, meal_id: int) -> dict | None:
    row = conn.execute("SELECT * FROM meals WHERE id = ?", (meal_id,)).fetchone()
    if row is None:
        return None
    meal = dict(row)
    items = conn.execute(
        "SELECT mi.*, m.servings FROM meal_items m JOIN menu_items mi ON mi.id = m.menu_item_id"
        " WHERE m.meal_id = ? ORDER BY mi.food_group, mi.name",
        (meal_id,),
    ).fetchall()
    meal["items"] = [{**dict(i), "allergens": json.loads(i["allergens"])} for i in items]
    return meal