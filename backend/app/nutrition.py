"""Deterministic nutrient math. No AI here: served portion x percent eaten x per-serving values."""
from .schemas import Nutrients

FIELDS = ("kcal", "protein_g", "iron_mg", "calcium_mg", "sodium_mg")


def served(item: dict) -> Nutrients:
    s = item.get("servings", 1.0)
    return Nutrients(**{f: round(item[f] * s, 1) for f in FIELDS})


def consumed(item: dict, percent_eaten: int | None) -> Nutrients:
    if percent_eaten is None:
        return Nutrients()
    s = item.get("servings", 1.0) * percent_eaten / 100
    return Nutrients(**{f: round(item[f] * s, 1) for f in FIELDS})


def total(parts: list[Nutrients]) -> Nutrients:
    return Nutrients(**{f: round(sum(getattr(p, f) for p in parts), 1) for f in FIELDS})


def overall_percent(items: list[dict], percents: dict[int, int | None]) -> int | None:
    """Calorie-weighted percent eaten across the tray.

    Weighting by calories means leaving the broccoli counts less than leaving the salmon,
    which is closer to what matters clinically than a simple average.
    """
    weighted = served_kcal = 0.0
    for item in items:
        pct = percents.get(item["id"])
        if pct is None:
            continue
        kcal = item["kcal"] * item.get("servings", 1.0)
        weighted += kcal * pct
        served_kcal += kcal
    if served_kcal == 0:
        return None
    return round(weighted / served_kcal)
