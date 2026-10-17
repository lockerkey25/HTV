"""SQLite schema and a small seed set for step 1 (tray photo analysis).

Step 2 replaces the seed with full synthetic resident histories.
"""
import json
import sqlite3
from datetime import date

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS residents (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL,
    room          TEXT NOT NULL,
    texture       TEXT NOT NULL DEFAULT 'regular',  -- regular | soft | minced | pureed
    diet_flags    TEXT NOT NULL DEFAULT '[]',       -- JSON list, e.g. ["low_sodium"]
    allergies     TEXT NOT NULL DEFAULT '[]'        -- JSON list, e.g. ["fish"]
);

-- Nutrient values are per standard serving. Approximate for now;
-- step 2 refreshes them from USDA FoodData Central (fdc_id).
CREATE TABLE IF NOT EXISTS menu_items (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL,
    food_group    TEXT NOT NULL,   -- protein | grain | vegetable | fruit | dairy | other
    texture       TEXT NOT NULL,   -- regular | soft | minced | pureed
    allergens     TEXT NOT NULL DEFAULT '[]',
    kcal          REAL NOT NULL,
    protein_g     REAL NOT NULL,
    iron_mg       REAL NOT NULL,
    calcium_mg    REAL NOT NULL,
    sodium_mg     REAL NOT NULL,
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
"""

# name, food_group, texture, allergens, kcal, protein_g, iron_mg, calcium_mg, sodium_mg
MENU = [
    ("Baked salmon", "protein", "regular", ["fish"], 230, 25, 0.5, 15, 75),
    ("Roast chicken breast", "protein", "regular", [], 190, 29, 1.0, 15, 400),
    ("Minced beef with gravy", "protein", "minced", [], 250, 20, 2.6, 20, 520),
    ("Scrambled eggs", "protein", "soft", ["egg"], 170, 12, 1.3, 70, 290),
    ("Mashed potatoes", "grain", "soft", ["dairy"], 210, 4, 0.5, 45, 630),
    ("White rice", "grain", "regular", [], 205, 4, 1.9, 15, 5),
    ("Whole wheat toast", "grain", "regular", ["gluten"], 140, 6, 1.6, 60, 260),
    ("Oatmeal", "grain", "soft", [], 160, 6, 2.1, 20, 10),
    ("Steamed broccoli", "vegetable", "regular", [], 55, 4, 1.0, 60, 60),
    ("Pureed carrots", "vegetable", "pureed", [], 50, 1, 0.4, 40, 80),
    ("Spinach (creamed)", "vegetable", "soft", ["dairy"], 150, 5, 2.4, 190, 490),
    ("Applesauce", "fruit", "pureed", [], 90, 0, 0.3, 5, 5),
    ("Sliced banana", "fruit", "soft", [], 105, 1, 0.3, 6, 1),
    ("Vanilla yogurt", "dairy", "pureed", ["dairy"], 150, 8, 0.1, 280, 110),
    ("Glass of milk", "dairy", "regular", ["dairy"], 120, 8, 0.1, 300, 105),
    ("Chicken noodle soup", "other", "soft", ["gluten"], 120, 7, 1.1, 20, 860),
]

# name, room, texture, diet_flags, allergies
RESIDENTS = [
    ("Mr. Okafor", "112A", "regular", ["low_sodium"], []),
    ("Mrs. Lindqvist", "114B", "soft", [], ["fish"]),
    ("Mr. Tanaka", "120A", "pureed", [], []),
]

# resident index -> {meal_type: [menu names]}. Some trays intentionally
# break diet rules so the checks have something to catch in the demo.
TODAY_MEALS = {
    0: {
        "breakfast": ["Oatmeal", "Sliced banana", "Glass of milk"],
        "lunch": ["Roast chicken breast", "Mashed potatoes", "Steamed broccoli"],
        "dinner": ["Baked salmon", "White rice", "Chicken noodle soup"],
    },
    1: {
        "breakfast": ["Scrambled eggs", "Applesauce", "Vanilla yogurt"],
        "lunch": ["Minced beef with gravy", "Mashed potatoes", "Pureed carrots"],
        "dinner": ["Baked salmon", "White rice", "Steamed broccoli"],
    },
    2: {
        "breakfast": ["Oatmeal", "Applesauce", "Vanilla yogurt"],
        "lunch": ["Pureed carrots", "Mashed potatoes", "Vanilla yogurt"],
        "dinner": ["Minced beef with gravy", "Pureed carrots", "Applesauce"],
    },
}


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
    menu_ids = {}
    for name, group, texture, allergens, kcal, protein, iron, calcium, sodium in MENU:
        cur = conn.execute(
            "INSERT INTO menu_items (name, food_group, texture, allergens, kcal, protein_g,"
            " iron_mg, calcium_mg, sodium_mg) VALUES (?,?,?,?,?,?,?,?,?)",
            (name, group, texture, json.dumps(allergens), kcal, protein, iron, calcium, sodium),
        )
        menu_ids[name] = cur.lastrowid

    today = date.today().isoformat()
    for idx, (name, room, texture, flags, allergies) in enumerate(RESIDENTS):
        cur = conn.execute(
            "INSERT INTO residents (name, room, texture, diet_flags, allergies) VALUES (?,?,?,?,?)",
            (name, room, texture, json.dumps(flags), json.dumps(allergies)),
        )
        resident_id = cur.lastrowid
        for meal_type, items in TODAY_MEALS[idx].items():
            meal = conn.execute(
                "INSERT INTO meals (resident_id, meal_date, meal_type) VALUES (?,?,?)",
                (resident_id, today, meal_type),
            )
            conn.executemany(
                "INSERT INTO meal_items (meal_id, menu_item_id) VALUES (?,?)",
                [(meal.lastrowid, menu_ids[item]) for item in items],
            )


def get_resident(conn: sqlite3.Connection, resident_id: int) -> dict | None:
    row = conn.execute("SELECT * FROM residents WHERE id = ?", (resident_id,)).fetchone()
    if row is None:
        return None
    r = dict(row)
    r["diet_flags"] = json.loads(r["diet_flags"])
    r["allergies"] = json.loads(r["allergies"])
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
