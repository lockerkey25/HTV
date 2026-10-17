"""Pydantic models: the structured output we demand from Gemini, and API payloads."""
from enum import Enum

from pydantic import BaseModel, Field


# ---------- Gemini structured output ----------

class Confidence(str, Enum):
    high = "high"
    medium = "medium"
    low = "low"


class ImageQuality(str, Enum):
    ok = "ok"
    blurry = "blurry"
    partial = "partial"          # tray cut off / items out of frame
    too_dark = "too_dark"
    not_food = "not_food"


class ItemEstimate(BaseModel):
    menu_item_id: int = Field(description="ID from the served menu list")
    visible_in_before: bool = Field(
        description="True if this item can be seen in the BEFORE photo. False means it was not on the tray."
    )
    before_description: str = Field(description="What this item looks like in BEFORE: location, amount")
    after_description: str = Field(description="What remains of it in AFTER")
    percent_eaten: int = Field(description="0-100, how much of the served portion is gone")
    confidence: Confidence
    observation: str = Field(description="One short factual sentence about what is left")


class ExtraItem(BaseModel):
    name: str = Field(description="Short food name, e.g. 'whole wheat toast'")
    food_group: str = Field(description="protein | grain | vegetable | fruit | dairy | other")
    percent_eaten: int = Field(description="0-100, how much of it is gone between BEFORE and AFTER")
    confidence: Confidence


class TrayAnalysis(BaseModel):
    before_inventory: str = Field(
        description="First, list every food, drink and condiment visible in BEFORE with its position"
    )
    same_tray: bool = Field(description="BEFORE and AFTER appear to show the same tray/plate")
    before_quality: ImageQuality
    after_quality: ImageQuality
    items: list[ItemEstimate]
    extra_items: list[ExtraItem] = Field(
        description="Foods/drinks/condiments visible in BEFORE that are NOT in the served list"
    )
    notes: str = Field(description="One or two short factual sentences. No medical advice.")


# ---------- API responses ----------

class Nutrients(BaseModel):
    kcal: float = 0
    protein_g: float = 0
    fat_g: float = 0
    cholesterol_mg: float = 0
    iron_mg: float = 0
    calcium_mg: float = 0
    sodium_mg: float = 0
    sugar_g: float = 0
    vitamin_c_mg: float = 0
    vitamin_d_mcg: float = 0
    vitamin_b12_mcg: float = 0


class AnalyzedItem(BaseModel):
    menu_item_id: int
    name: str
    food_group: str
    percent_eaten: int | None      # None if Gemini skipped the item
    confidence: Confidence | None
    observation: str
    needs_review: bool
    served: Nutrients
    consumed: Nutrients


class DietAlert(BaseModel):
    severity: str                   # high | medium
    kind: str                       # allergy | texture | low_sodium | unexpected_item
    menu_item_id: int | None
    message: str


class AnalyzeResponse(BaseModel):
    analysis_id: int
    meal_id: int
    resident_id: int
    source: str                     # gemini | cache | mock
    model: str
    overall_percent_eaten: int | None
    items: list[AnalyzedItem]
    totals_consumed: Nutrients
    totals_served: Nutrients
    diet_alerts: list[DietAlert]
    review_reasons: list[str]
    extra_items: list[ExtraItem]    # seen on tray but not on the menu; not counted in nutrients
    notes: str


class BeforeCheckResponse(BaseModel):
    quality: str
    menu_items_visible: list[dict]   # [{id, name, visible, description}]
    extra_items: list[str]           # names of extra foods spotted
    diet_alerts: list[DietAlert]     # allergy / texture / sodium violations
    preference_conflicts: list[str]  # items on tray that conflict with resident preferences


class ConfirmItem(BaseModel):
    menu_item_id: int
    percent_eaten: int = Field(ge=0, le=100)


class ConfirmRequest(BaseModel):
    analysis_id: int | None = None
    items: list[ConfirmItem]


class ConfirmResponse(BaseModel):
    meal_id: int
    overall_percent_eaten: int
    totals_consumed: Nutrients
    adjusted_items: list[int]       # items where staff changed the AI estimate
