"""Turn raw Gemini output into a validated, review-ready estimate.

Gemini's output is treated as untrusted: unknown IDs are dropped, values are clamped,
and anything uncertain is flagged for staff review instead of silently accepted.
"""
from . import diet_rules, nutrition
from .schemas import AnalyzedItem, AnalyzeResponse, Confidence, TrayAnalysis


def _round5(v: int) -> int:
    return max(0, min(100, round(v / 5) * 5))


def build_response(
    *, analysis_id: int, meal: dict, resident: dict, raw: TrayAnalysis, source: str, model: str
) -> AnalyzeResponse:
    served_ids = {it["id"] for it in meal["items"]}
    estimates = {}
    for est in raw.items:
        if est.menu_item_id in served_ids and est.menu_item_id not in estimates:
            estimates[est.menu_item_id] = est

    review_reasons: list[str] = []
    if not raw.same_tray:
        review_reasons.append("Before and after photos may not show the same tray.")
    for label, quality in (("Before", raw.before_quality), ("After", raw.after_quality)):
        if quality.value != "ok":
            review_reasons.append(f"{label} photo quality: {quality.value.replace('_', ' ')}.")

    items: list[AnalyzedItem] = []
    percents: dict[int, int | None] = {}
    for it in meal["items"]:
        est = estimates.get(it["id"])
        if est is None:
            pct, observation = None, ""
            review_reasons.append(f"No estimate returned for {it['name']}.")
        elif not est.visible_in_before:
            # Not seen on the tray: unknown, not "refused". Staff must decide.
            pct, observation = None, f"{it['name']} was not seen on the tray."
            review_reasons.append(
                f"{it['name']} is on the menu but wasn't seen in the photo. Set it if it was served."
            )
        else:
            pct, observation = _round5(est.percent_eaten), est.observation
        percents[it["id"]] = pct
        items.append(AnalyzedItem(
            menu_item_id=it["id"],
            name=it["name"],
            food_group=it["food_group"],
            percent_eaten=pct,
            confidence=None if est is None else est.confidence,
            observation=observation,
            needs_review=pct is None or est.confidence == Confidence.low,
            served=nutrition.served(it),
            consumed=nutrition.consumed(it, pct),
        ))

    extras = [e.model_copy(update={"percent_eaten": _round5(e.percent_eaten)}) for e in raw.extra_items]
    if extras:
        review_reasons.append(
            "Items not on the menu were seen: "
            + ", ".join(f"{e.name} (~{e.percent_eaten}% eaten)" for e in extras)
            + ". They aren't counted in the nutrient totals."
        )

    return AnalyzeResponse(
        analysis_id=analysis_id,
        meal_id=meal["id"],
        resident_id=resident["id"],
        source=source,
        model=model,
        overall_percent_eaten=nutrition.overall_percent(meal["items"], percents),
        items=items,
        totals_consumed=nutrition.total([i.consumed for i in items]),
        totals_served=nutrition.total([i.served for i in items]),
        diet_alerts=diet_rules.check_tray(resident, meal["items"], [e.name for e in extras]),
        review_reasons=review_reasons,
        extra_items=extras,
        notes=raw.notes,
    )
