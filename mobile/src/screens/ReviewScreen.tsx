import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AnalyzeResponse, confirmMeal, ConfirmResponse, Meal, MenuItem, Resident } from '../api';
import { Banner, Button, Card, Header } from '../components/ui';
import { colors, mealLabel } from '../theme';

const PRESETS = [0, 25, 50, 75, 100];

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

        {analysis?.diet_alerts.map((a, i) => (
          <Banner key={`d${i}`} tone={a.severity === 'high' ? 'danger' : 'warn'}>
            {a.severity === 'high' ? '⚠ ' : ''}{a.message}
          </Banner>
        ))}
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

              <View style={styles.presets}>
                <Step label="−5" a11y={`Decrease ${it.name} by 5 percent`} onPress={() => set(it.id, (value ?? 0) - 5)} />
                {PRESETS.map((p) => (
                  <Pressable
                    key={p}
                    accessibilityRole="button"
                    accessibilityLabel={`${it.name} ${p} percent eaten`}
                    accessibilityState={{ selected: value === p }}
                    onPress={() => set(it.id, p)}
                    style={[styles.chip, value === p && styles.chipOn]}
                  >
                    <Text style={[styles.chipText, value === p && styles.chipTextOn]}>{p}</Text>
                  </Pressable>
                ))}
                <Step label="+5" a11y={`Increase ${it.name} by 5 percent`} onPress={() => set(it.id, (value ?? 0) + 5)} />
              </View>
            </Card>
          );
        })}

        <Card>
          <Text style={styles.itemName}>Meal total{overall != null ? `: ~${overall}% eaten` : ''}</Text>
          <Text style={styles.meta}>
            {Math.round(totals.kcal)} kcal · {totals.protein_g.toFixed(1)} g protein · {totals.iron_mg.toFixed(1)} mg iron ·{' '}
            {Math.round(totals.calcium_mg)} mg calcium
          </Text>
        </Card>

        {error && <Banner tone="danger">{error}</Banner>}
        <Button label={allSet ? 'Confirm intake' : 'Set every item to confirm'} onPress={confirm} disabled={!allSet} loading={saving} />
      </ScrollView>
    </View>
  );
}

function Step({ label, a11y, onPress }: { label: string; a11y: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={a11y} onPress={onPress} style={styles.chip}>
      <Text style={styles.chipText}>{label}</Text>
    </Pressable>
  );
}

// Mirrors backend/app/nutrition.py so totals update live while staff adjust.
function consumedTotals(items: MenuItem[], pcts: Record<number, number | null>) {
  const t = { kcal: 0, protein_g: 0, iron_mg: 0, calcium_mg: 0 };
  for (const it of items) {
    const f = ((pcts[it.id] ?? 0) / 100) * (it.servings ?? 1);
    t.kcal += it.kcal * f;
    t.protein_g += it.protein_g * f;
    t.iron_mg += it.iron_mg * f;
    t.calcium_mg += it.calcium_mg * f;
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
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  chip: {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 15, fontWeight: '600', color: colors.text },
  chipTextOn: { color: colors.primaryText },
});
