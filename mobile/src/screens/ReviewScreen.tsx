import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { AnalyzeResponse, confirmMeal, ConfirmResponse, Meal, MenuItem, Resident } from '../api';
import { Banner, Button, Card, Header } from '../components/ui';
import { colors, mealLabel } from '../theme';

type Props = {
  resident: Resident;
  meal: Meal;
  analysis: AnalyzeResponse | null; // null = manual entry
  onConfirmed: (r: ConfirmResponse) => void;
  onBack: () => void;
};

export function ReviewScreen({ resident, meal, analysis, onConfirmed, onBack }: Props) {
  const aiById = useMemo(
    () => new Map((analysis?.items ?? []).map((i) => [i.menu_item_id, i])),
    [analysis],
  );
  const [percents, setPercents] = useState<Record<number, number | null>>(() =>
    Object.fromEntries(meal.items.map((it) => [it.id, aiById.get(it.id)?.percent_eaten ?? null])),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allSet = meal.items.every((it) => percents[it.id] != null);
  const totals = useMemo(() => consumedTotals(meal.items, percents), [meal.items, percents]);
  const overall = useMemo(() => overallPercent(meal.items, percents), [meal.items, percents]);

  const set = (id: number, v: number) => setPercents((p) => ({ ...p, [id]: Math.max(0, Math.min(100, v)) }));

  async function confirm() {
    setSaving(true);
    setError(null);
    try {
      const items = meal.items.map((it) => ({ menu_item_id: it.id, percent_eaten: percents[it.id] as number }));
      onConfirmed(await confirmMeal(meal.id, analysis?.analysis_id ?? null, items));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.flex}>
      <Header
        title="Review intake"
        subtitle={`${mealLabel[meal.meal_type]} · ${resident.name}`}
        onBack={onBack}
      />
      <ScrollView contentContainerStyle={styles.pad}>
        {analysis ? (
          <Text style={styles.source}>
            {analysis.source === 'gemini'
              ? `AI estimate (${analysis.model}). Check each item and adjust if needed.`
              : analysis.source === 'cache'
                ? 'AI was unavailable, showing a saved estimate for these photos.'
                : 'Demo mode: these are placeholder estimates, not AI.'}
          </Text>
        ) : (
          <Text style={styles.source}>Manual entry: set how much of each item was eaten.</Text>
        )}

        {analysis?.review_reasons.map((r, i) => (
          <Banner key={`r${i}`} tone="warn">{r}</Banner>
        ))}
        {analysis?.notes ? <Text style={styles.notes}>{analysis.notes}</Text> : null}

        {meal.items.map((it) => {
          const ai = aiById.get(it.id);
          const value = percents[it.id];
          const changed = ai?.percent_eaten != null && value !== ai.percent_eaten;
          return (
            <Card key={it.id} style={ai?.needs_review ? styles.reviewCard : undefined}>
              <View style={styles.itemHead}>
                <View style={styles.flex}>
                  <Text style={styles.itemName}>{it.name}</Text>
                  <Text style={styles.meta}>
                    {it.food_group}
                    {ai?.confidence ? ` · ${ai.confidence} confidence` : ''}
                    {ai?.needs_review ? ' · please check' : ''}
                  </Text>
                </View>
                <Text style={styles.pct} accessibilityLabel={`${value ?? 'not set'} percent eaten`}>
                  {value == null ? '–' : `${value}%`}
                </Text>
              </View>
              {ai?.observation ? <Text style={styles.observation}>{ai.observation}</Text> : null}
              {changed && <Text style={styles.changed}>Adjusted from AI estimate of {ai!.percent_eaten}%</Text>}

              <View style={styles.sliderRow}>
                <Text style={styles.sliderLabel}>0%</Text>
                <Slider
                  style={styles.slider}
                  minimumValue={0}
                  maximumValue={100}
                  step={5}
                  value={value ?? 0}
                  onValueChange={(v) => set(it.id, Math.round(v / 5) * 5)}
                  minimumTrackTintColor={colors.primary}
                  maximumTrackTintColor={colors.border}
                  thumbTintColor={colors.primary}
                  accessibilityLabel={`${it.name} percent eaten slider`}
                />
                <Text style={styles.sliderLabel}>100%</Text>
              </View>
            </Card>
          );
        })}

        <Card>
          <Text style={styles.itemName}>Meal total{overall != null ? `: ~${overall}% eaten` : ''}</Text>
          <Text style={styles.meta}>
            {Math.round(totals.kcal)} kcal · {totals.protein_g.toFixed(1)} g protein · {totals.fat_g.toFixed(1)} g fat ·{' '}
            {Math.round(totals.cholesterol_mg)} mg cholesterol · {totals.sodium_mg.toFixed(0)} mg sodium
          </Text>
          <Text style={styles.meta}>
            {totals.iron_mg.toFixed(1)} mg iron · {Math.round(totals.calcium_mg)} mg calcium · {totals.sugar_g.toFixed(1)} g sugar ·{' '}
            {totals.vitamin_c_mg.toFixed(1)} mg vit C · {totals.vitamin_d_mcg.toFixed(1)} mcg vit D · {totals.vitamin_b12_mcg.toFixed(1)} mcg vit B12
          </Text>
        </Card>

        {error && <Banner tone="danger">{error}</Banner>}
        <Button label={allSet ? 'Confirm intake' : 'Set every item to confirm'} onPress={confirm} disabled={!allSet} loading={saving} />
      </ScrollView>
    </View>
  );
}

// Mirrors backend/app/nutrition.py so totals update live while staff adjust.
function consumedTotals(items: MenuItem[], pcts: Record<number, number | null>) {
  const t = { kcal: 0, protein_g: 0, fat_g: 0, cholesterol_mg: 0, iron_mg: 0, calcium_mg: 0, sodium_mg: 0, sugar_g: 0, vitamin_c_mg: 0, vitamin_d_mcg: 0, vitamin_b12_mcg: 0 };
  for (const it of items) {
    const f = ((pcts[it.id] ?? 0) / 100) * (it.servings ?? 1);
    t.kcal += it.kcal * f;
    t.protein_g += it.protein_g * f;
    t.fat_g += (it.fat_g ?? 0) * f;
    t.cholesterol_mg += (it.cholesterol_mg ?? 0) * f;
    t.iron_mg += it.iron_mg * f;
    t.calcium_mg += it.calcium_mg * f;
    t.sodium_mg += (it.sodium_mg ?? 0) * f;
    t.sugar_g += (it.sugar_g ?? 0) * f;
    t.vitamin_c_mg += (it.vitamin_c_mg ?? 0) * f;
    t.vitamin_d_mcg += (it.vitamin_d_mcg ?? 0) * f;
    t.vitamin_b12_mcg += (it.vitamin_b12_mcg ?? 0) * f;
  }
  return t;
}

function overallPercent(items: MenuItem[], pcts: Record<number, number | null>) {
  let weighted = 0;
  let kcal = 0;
  for (const it of items) {
    const p = pcts[it.id];
    if (p == null) continue;
    const k = it.kcal * (it.servings ?? 1);
    weighted += k * p;
    kcal += k;
  }
  return kcal ? Math.round(weighted / kcal) : null;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pad: { paddingHorizontal: 20, paddingBottom: 40 },
  source: { fontSize: 14, color: colors.muted, marginBottom: 10 },
  notes: { fontSize: 15, color: colors.text, fontStyle: 'italic', marginVertical: 8, lineHeight: 21 },
  reviewCard: { borderColor: colors.warn, borderWidth: 2 },
  itemHead: { flexDirection: 'row', alignItems: 'center' },
  itemName: { fontSize: 17, fontWeight: '600', color: colors.text },
  meta: { fontSize: 14, color: colors.muted, marginTop: 2, textTransform: 'capitalize' },
  pct: { fontSize: 26, fontWeight: '700', color: colors.primary, minWidth: 70, textAlign: 'right' },
  observation: { fontSize: 14, color: colors.text, marginTop: 8, lineHeight: 20 },
  changed: { fontSize: 13, color: colors.warn, marginTop: 4 },
  sliderRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 8 },
  slider: { flex: 1, height: 40 },
  sliderLabel: { fontSize: 13, color: colors.muted, width: 32, textAlign: 'center' },
});
