"""Daily intake targets for adults 51+, by sex, age group, weight and conditions.

Values are approximate US DRI figures (NIH ODS fact sheets). Verify and have a
dietitian review before any real use. Demo only, not medical advice.
"""
from datetime import date

# (min_target, max_limit); None means no limit on that side.
Target = tuple[float | None, float | None]


def age_years(dob: str, today: date | None = None) -> int:
    today = today or date.today()
    d = date.fromisoformat(dob)
    return today.year - d.year - ((today.month, today.day) < (d.month, d.day))


def age_group(dob: str, today: date | None = None) -> str:
    return "51-70" if age_years(dob, today) <= 70 else "71+"


def has_condition(conditions: list[str], *keywords: str) -> bool:
    """Free-text conditions, so match by keyword ('kidney', 'diabet', ...)."""
    text = " ".join(conditions).lower()
    return any(k in text for k in keywords)


def targets(resident: dict, weight_kg: float | None, today: date | None = None) -> dict[str, Target]:
    female = resident["sex"] == "female"
    group = age_group(resident["dob"], today)
    conds = resident["conditions"]
    w = weight_kg or 65.0

    t: dict[str, Target] = {
        "kcal":            (1600 if female else 2000, None),   # sedentary estimate
        "protein_g":       (w * 1.0, None),                    # ~1.0-1.2 g/kg for older adults
        "calcium_mg":      (1200 if (female or group == "71+") else 1000, 2000),
        "vitamin_d_mcg":   (20 if group == "71+" else 15, 100),
        "vitamin_b12_mcg": (2.4, None),
        "iron_mg":         (8, 45),
        "vitamin_c_mg":    (75 if female else 90, 2000),
        "sodium_mg":       (None, 2300),
        "cholesterol_mg":  (None, 300),
        "sugar_g":         (None, 50),                         # rough cap, label as an estimate
    }
    if "low_sodium" in resident["diet_flags"] or has_condition(conds, "hypertension", "heart failure"):
        t["sodium_mg"] = (None, 1500)
    if has_condition(conds, "kidney", "ckd"):
        # CKD reverses the usual advice: restrict protein, never push it.
        t["protein_g"] = (w * 0.6, w * 0.8)
    return t