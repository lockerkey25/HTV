"""Rule-based diet restriction checks. Rules decide; the AI only reports what it sees."""
from .schemas import DietAlert

# Higher = more modified. A resident can safely eat anything at or above their level.
TEXTURE_LEVEL = {"regular": 0, "soft": 1, "minced": 2, "pureed": 3}
LOW_SODIUM_ITEM_LIMIT_MG = 600

# Keywords used to match free-text unexpected items against resident allergies.
ALLERGEN_KEYWORDS = {
    "fish": ["fish", "salmon", "tuna", "cod", "tilapia"],
    "dairy": ["milk", "cheese", "yogurt", "butter", "cream", "ice cream"],
    "egg": ["egg"],
    "gluten": ["bread", "toast", "roll", "cracker", "pasta", "noodle", "cookie"],
    "nuts": ["nut", "peanut", "almond", "walnut", "pecan"],
}
SODIUM_KEYWORDS = ["salt", "soy sauce", "chips", "pickle", "ketchup"]


def check_tray(resident: dict, items: list[dict], unexpected: list[str]) -> list[DietAlert]:
    alerts: list[DietAlert] = []
    allergies = set(resident["allergies"])
    res_level = TEXTURE_LEVEL[resident["texture"]]
    low_sodium = "low_sodium" in resident["diet_flags"]

    for item in items:
        hit = allergies.intersection(item["allergens"])
        if hit:
            alerts.append(DietAlert(
                severity="high", kind="allergy", menu_item_id=item["id"],
                message=f"{item['name']} contains {', '.join(sorted(hit))}; "
                        f"{resident['name']} has a documented {', '.join(sorted(hit))} allergy.",
            ))
        if TEXTURE_LEVEL[item["texture"]] < res_level:
            alerts.append(DietAlert(
                severity="high", kind="texture", menu_item_id=item["id"],
                message=f"{item['name']} is {item['texture']} texture; "
                        f"{resident['name']} requires {resident['texture']}.",
            ))
        if low_sodium and item["sodium_mg"] * item.get("servings", 1.0) > LOW_SODIUM_ITEM_LIMIT_MG:
            alerts.append(DietAlert(
                severity="medium", kind="low_sodium", menu_item_id=item["id"],
                message=f"{item['name']} has ~{item['sodium_mg']:.0f} mg sodium "
                        f"(low-sodium limit {LOW_SODIUM_ITEM_LIMIT_MG} mg per item).",
            ))

    for extra in unexpected:
        text = extra.lower()
        allergy_hits = [a for a in allergies if any(k in text for k in ALLERGEN_KEYWORDS.get(a, [a]))]
        if allergy_hits:
            alerts.append(DietAlert(
                severity="high", kind="allergy", menu_item_id=None,
                message=f"Unlisted item on tray ('{extra}') may contain "
                        f"{', '.join(allergy_hits)}; resident is allergic.",
            ))
        elif low_sodium and any(k in text for k in SODIUM_KEYWORDS):
            alerts.append(DietAlert(
                severity="medium", kind="low_sodium", menu_item_id=None,
                message=f"Unlisted high-sodium item on tray ('{extra}'); resident is low-sodium.",
            ))
        else:
            alerts.append(DietAlert(
                severity="medium", kind="unexpected_item", menu_item_id=None,
                message=f"Unlisted item on tray: '{extra}'. Please verify it is allowed.",
            ))
    return alerts
