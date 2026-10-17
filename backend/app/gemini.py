"""Gemini vision call: compare BEFORE/AFTER tray photos against the known served menu.

Order of attempts: primary model -> fallback model -> cached response for identical photos.
In mock mode (no API key, or NOURISH_MODE=mock) a deterministic fake estimate is returned.
"""
import hashlib
import json
import logging

from google import genai
from google.genai import types

from . import config
from .schemas import TrayAnalysis

log = logging.getLogger("nourish.gemini")

PROMPT = """You are assisting nursing staff in a long-term care facility by estimating meal intake.
Accuracy matters: these estimates are used to spot residents who are not eating enough.

You get two photos of the SAME meal tray:
  Photo 1 = BEFORE the resident ate.
  Photo 2 = AFTER the resident ate.

The kitchen says these items were served (id: name, food group):
{menu}

Work in this order:

1. INVENTORY. Look only at BEFORE. In before_inventory, list every food, drink and condiment
   you can see and where it is (e.g. "scrambled eggs, left compartment, about 1 cup").
   The kitchen list can be wrong. Trust the photo, not the list.

2. MATCH. For each served id, decide if it is actually in BEFORE.
   - Match by appearance, not exact wording (e.g. "Sliced banana" matches banana pieces).
   - If it is NOT in BEFORE: visible_in_before=false, percent_eaten=0, confidence=low.
     Do not guess an amount for food that was never there.

3. COMPARE. For each item that is present, describe it in BEFORE and in AFTER, then estimate
   percent_eaten = portion gone. Use the same item in both photos as its own reference:
     0   = untouched, same size and shape
     10  = one or two bites gone
     25  = about a quarter gone
     50  = about half gone, plate visible under the food
     75  = only a small amount left
     90  = scraps or smears only
     100 = nothing left
   Use multiples of 5.
   - Liquids: compare the fill line in the cup, not the cup itself.
   - Food pushed around, spread out or mashed is NOT eaten. Spread-out food looks larger
     than it is; judge by the amount, not the area it covers.
   - Hidden food (under a napkin or lid, or out of frame) is NOT eaten: lower confidence instead.
   - Empty wrappers, peels and bones are leftovers, not food.
   - confidence=high only when the item is clearly visible in both photos.

4. EXTRAS. Every food, drink or condiment in BEFORE that is not in the served list goes in
   extra_items with its own percent_eaten (salt packets and sauces count).

Also report same_tray (false if the photos clearly show different trays), image quality for
each photo, and notes (one or two short factual sentences about what was left).

Describe only what is visible. Do not give medical advice or diagnoses.
Return one entry in "items" for every served id, using exactly those ids."""

_client: genai.Client | None = None


class AnalysisUnavailable(RuntimeError):
    pass


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(api_key=config.GEMINI_API_KEY)
    return _client


def _cache_key(meal_id: int, before: bytes, after: bytes) -> str:
    h = hashlib.sha256()
    for part in (str(meal_id).encode(), before, after):
        h.update(hashlib.sha256(part).digest())
    return h.hexdigest()


def _cache_read(key: str) -> TrayAnalysis | None:
    path = config.CACHE_DIR / f"{key}.json"
    if not path.exists():
        return None
    try:
        return TrayAnalysis.model_validate_json(path.read_text())
    except ValueError:  # cached with an older schema
        return None


def _cache_write(key: str, analysis: TrayAnalysis) -> None:
    config.CACHE_DIR.mkdir(parents=True, exist_ok=True)
    (config.CACHE_DIR / f"{key}.json").write_text(analysis.model_dump_json(indent=2))


def _mock(items: list[dict]) -> TrayAnalysis:
    """Deterministic, varied fake estimates so the UI can be built offline."""
    pattern = [25, 80, 50, 100, 10, 65]
    return TrayAnalysis(
        before_inventory="(mock) Gemini was not called.",
        same_tray=True,
        before_quality="ok",
        after_quality="ok",
        items=[
            {
                "menu_item_id": it["id"],
                "visible_in_before": True,
                "before_description": f"(mock) full portion of {it['name']}",
                "after_description": "(mock) partly eaten",
                "percent_eaten": pattern[(it["id"] + i) % len(pattern)],
                "confidence": "low" if i == 0 else "high",
                "observation": f"(mock) {it['name']} partially eaten.",
            }
            for i, it in enumerate(items)
        ],
        extra_items=[],
        notes="Mock analysis: Gemini was not called.",
    )


async def _call(model: str, prompt: str, before: bytes, after: bytes) -> TrayAnalysis:
    resp = await _get_client().aio.models.generate_content(
        model=model,
        contents=[
            prompt,
            "Photo 1 (BEFORE):",
            types.Part.from_bytes(data=before, mime_type="image/jpeg"),
            "Photo 2 (AFTER):",
            types.Part.from_bytes(data=after, mime_type="image/jpeg"),
        ],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=TrayAnalysis,
            temperature=0,
            # More image tokens so small leftovers are visible to the model.
            media_resolution=types.MediaResolution.MEDIA_RESOLUTION_HIGH,
            # Let the model reason through the BEFORE/AFTER comparison before answering.
            thinking_config=types.ThinkingConfig(thinking_level=config.GEMINI_THINKING_LEVEL),
        ),
    )
    if isinstance(resp.parsed, TrayAnalysis):
        return resp.parsed
    if not resp.text:
        raise AnalysisUnavailable("empty response from Gemini")
    return TrayAnalysis.model_validate(json.loads(resp.text))


async def analyze_tray(
    meal_id: int, items: list[dict], before: bytes, after: bytes
) -> tuple[TrayAnalysis, str, str]:
    """Returns (analysis, source, model). source is gemini | cache | mock."""
    if config.MODE == "mock":
        return _mock(items), "mock", "mock"

    key = _cache_key(meal_id, before, after)
    menu = "\n".join(f"  {it['id']}: {it['name']} ({it['food_group']})" for it in items)
    prompt = PROMPT.format(menu=menu)

    errors = []
    for model in dict.fromkeys([config.GEMINI_MODEL, config.GEMINI_FALLBACK_MODEL]):
        try:
            analysis = await _call(model, prompt, before, after)
            _cache_write(key, analysis)
            return analysis, "gemini", model
        except Exception as e:  # rate limit, network, bad JSON: try next option
            log.warning("Gemini model %s failed: %s", model, e)
            errors.append(f"{model}: {type(e).__name__}")

    cached = _cache_read(key)
    if cached is not None:
        return cached, "cache", "cache"
    raise AnalysisUnavailable("; ".join(errors))
