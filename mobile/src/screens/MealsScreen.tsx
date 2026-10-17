import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { ageGroup, getIntakeSummary, getMeals, getSupplementLogs, getWeight, IntakeSummary, Meal, Resident, saveSupplementLogs, saveWeight, SupplementLog } from '../api';
import { Banner, Button, Header } from '../components/ui';
import { colors, mealLabel } from '../theme';

type Props = { resident: Resident; onSelect: (m: Meal) => void; onBack: () => void; onViewCharts: () => void; onEditMenu: (m: Meal) => void };

export function MealsScreen({ resident, onSelect, onBack, onViewCharts, onEditMenu }: Props) {
  const [meals, setMeals] = useState<Meal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [supplements, setSupplements] = useState<SupplementLog[] | null>(null);
  const [tablets, setTablets] = useState<Record<number, number>>({});
  const [suppSaving, setSuppSaving] = useState(false);
  const [suppSaved, setSuppSaved] = useState(false);
  const [suppError, setSuppError] = useState<string | null>(null);

  const [weightInput, setWeightInput] = useState('');
  const [weightSaving, setWeightSaving] = useState(false);
  const [weightSaved, setWeightSaved] = useState(false);
  const [weightError, setWeightError] = useState<string | null>(null);

  const [intakeSummary, setIntakeSummary] = useState<IntakeSummary | null>(null);

  useEffect(() => {
    getMeals(resident.id).then(setMeals).catch((e: Error) => setError(e.message));
    getIntakeSummary(resident.id).then(setIntakeSummary).catch(() => {});
    getSupplementLogs(resident.id).then((logs) => {
      setSupplements(logs);
      setTablets(Object.fromEntries(logs.map((s) => [s.id, s.tablets])));
    }).catch(() => {});
    getWeight(resident.id).then((w) => {
      if (w.weight_kg !== null) setWeightInput(w.weight_kg.toFixed(2));
    }).catch(() => {});
  }, [resident.id]);

  async function saveWeightLog() {
    const val = parseFloat(weightInput);
    if (isNaN(val) || val < 30 || val > 200) {
      setWeightError('Enter a valid weight between 30 and 200 kg');
      return;
    }
    setWeightSaving(true);
    setWeightError(null);
    setWeightSaved(false);
    try {
      await saveWeight(resident.id, val);
      setWeightSaved(true);
    } catch (e) {
      setWeightError((e as Error).message);
    } finally {
      setWeightSaving(false);
    }
  }

  async function saveSupplements() {
    setSuppSaving(true);
    setSuppError(null);
    setSuppSaved(false);
    try {
      await saveSupplementLogs(resident.id, tablets);
      setSuppSaved(true);
    } catch (e) {
      setSuppError((e as Error).message);
    } finally {
      setSuppSaving(false);
    }
  }

  const tags = [
    resident.texture !== 'regular' ? `${resident.texture} texture` : null,
    ...resident.diet_flags.map((f) => f.replace('_', ' ')),
  ].filter(Boolean);

  return (
    <View style={styles.flex}>
      <Header title={resident.name} subtitle={`Room ${resident.room} · Today's meals`} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.pad}>

        {/* Resident info card */}
        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Sex · Age group</Text>
            <Text style={styles.infoValue}>{resident.sex === 'male' ? 'Male' : 'Female'} · {ageGroup(resident.dob)}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Date of birth</Text>
            <Text style={styles.infoValue}>{resident.dob}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Height</Text>
            <Text style={styles.infoValue}>{resident.height_cm} cm</Text>
          </View>
          {tags.length > 0 && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Dietary restrictions</Text>
              <Text style={styles.infoValue}>{tags.join(', ')}</Text>
            </View>
          )}
          {resident.allergies.length > 0 && (
            <View style={styles.infoRow}>
              <Text style={[styles.infoLabel, { color: colors.danger }]}>Allergies</Text>
              <Text style={[styles.infoValue, { color: colors.danger }]}>{resident.allergies.join(', ')}</Text>
            </View>
          )}
          {resident.preferences.length > 0 && (
            <View style={styles.infoRow}>
              <Text style={[styles.infoLabel, { color: colors.warn }]}>Preferences</Text>
              <Text style={[styles.infoValue, { color: colors.warn }]}>{resident.preferences.join(', ')}</Text>
            </View>
          )}
          {resident.conditions.length > 0 && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Conditions</Text>
              <Text style={styles.infoValue}>{resident.conditions.join(', ')}</Text>
            </View>
          )}
          {resident.medications.length > 0 && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Medications</Text>
              <Text style={styles.infoValue}>{resident.medications.map((m) => `${m.name} ${m.dose_per_day}`).join('\n')}</Text>
            </View>
          )}
          {intakeSummary && intakeSummary.severe_alerts.length > 0 && (
            <View style={styles.infoRow}>
              <Text style={[styles.infoLabel, { color: colors.danger }]}>Severe (30-day avg)</Text>
              <Text style={[styles.infoValue, { color: colors.danger }]}>{intakeSummary.severe_alerts.join(', ')}</Text>
            </View>
          )}
          {intakeSummary && intakeSummary.warning_alerts.length > 0 && (
            <View style={styles.infoRow}>
              <Text style={[styles.infoLabel, { color: colors.warn }]}>Warnings (30-day avg)</Text>
              <Text style={[styles.infoValue, { color: colors.warn }]}>{intakeSummary.warning_alerts.join(', ')}</Text>
            </View>
          )}
          {intakeSummary && intakeSummary.meals_missed > 5 && (
            <View style={styles.infoRow}>
              <Text style={[styles.infoLabel, { color: colors.danger }]}>Meals missed</Text>
              <Text style={[styles.infoValue, { color: colors.danger }]}>{intakeSummary.meals_missed} in last 30 days</Text>
            </View>
          )}
        </View>

        {/* Weight logging */}
        <Text style={styles.sectionHeader}>Today's weight</Text>
        <View style={styles.weightRow}>
          <TextInput
            style={styles.weightInput}
            value={weightInput}
            onChangeText={setWeightInput}
            placeholder="000.00"
            keyboardType="decimal-pad"
            maxLength={6}
            accessibilityLabel="Weight in kg"
          />
          <Text style={styles.weightUnit}>kg</Text>
          <Button label="Save" onPress={saveWeightLog} loading={weightSaving} style={styles.weightBtn} />
        </View>
        {weightError && <Banner tone="danger">{weightError}</Banner>}
        {weightSaved && <Banner tone="ok">Weight saved.</Banner>}
        {error && <Banner tone="danger">{error}</Banner>}
        {!meals && !error && <ActivityIndicator style={{ marginTop: 24 }} />}
        {meals?.length === 0 && <Text style={styles.meta}>No meals scheduled today.</Text>}
        {meals?.map((meal) => {
          const done = meal.status === 'confirmed';
          return (
            <View key={meal.id} style={styles.row}>
              <View style={styles.titleRow}>
                <Text style={styles.name}>{mealLabel[meal.meal_type]}</Text>
                <Text style={[styles.badge, done ? styles.badgeDone : styles.badgeTodo]}>
                  {done ? 'Logged' : 'Not logged'}
                </Text>
              </View>
              <Text style={styles.meta}>{meal.items.map((i) => i.name).join(' · ')}</Text>
              <View style={styles.mealActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Log ${mealLabel[meal.meal_type]}`}
                  onPress={() => onSelect(meal)}
                  style={({ pressed }) => [styles.mealBtn, styles.mealBtnPrimary, pressed && { opacity: 0.7 }]}
                >
                  <Text style={styles.mealBtnPrimaryText}>Log intake</Text>
                </Pressable>
                {!done && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${mealLabel[meal.meal_type]} menu`}
                    onPress={() => onEditMenu(meal)}
                    style={({ pressed }) => [styles.mealBtn, styles.mealBtnSecondary, pressed && { opacity: 0.7 }]}
                  >
                    <Text style={styles.mealBtnSecondaryText}>Edit menu</Text>
                  </Pressable>
                )}
              </View>
            </View>
          );
        })}

        {/* Supplements section */}
        <Text style={styles.sectionHeader}>Supplements today</Text>
        {supplements === null && <ActivityIndicator style={{ marginTop: 8 }} />}
        {supplements?.map((s) => {
          const count = tablets[s.id] ?? 0;
          return (
            <View key={s.id} style={styles.suppRow}>
              <View style={styles.suppInfo}>
                <Text style={styles.suppName}>{s.name}</Text>
                <Text style={styles.suppMeta}>
                  {s.amount_per_tablet} {s.unit} per tablet · {s.nutrient.replace(/_/g, ' ')}
                </Text>
              </View>
              <View style={styles.counter}>
                <TouchableOpacity
                  onPress={() => setTablets((t) => ({ ...t, [s.id]: Math.max(0, (t[s.id] ?? 0) - 1) }))}
                  style={styles.counterBtn}
                  accessibilityLabel={`Decrease ${s.name}`}
                >
                  <Text style={styles.counterBtnText}>−</Text>
                </TouchableOpacity>
                <Text style={styles.counterNum}>{count}</Text>
                <TouchableOpacity
                  onPress={() => setTablets((t) => ({ ...t, [s.id]: (t[s.id] ?? 0) + 1 }))}
                  style={styles.counterBtn}
                  accessibilityLabel={`Increase ${s.name}`}
                >
                  <Text style={styles.counterBtnText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
        {supplements && supplements.length > 0 && (
          <View style={styles.suppSaveRow}>
            {suppError && <Banner tone="danger">{suppError}</Banner>}
            {suppSaved && <Banner tone="ok">Supplements saved.</Banner>}
            <Button label="Save supplements" onPress={saveSupplements} loading={suppSaving} />
          </View>
        )}

        <Button label="View nutrient charts" onPress={onViewCharts} variant="secondary" style={styles.chartsBtn} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pad: { paddingHorizontal: 20, paddingBottom: 24 },
  infoCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 16,
    gap: 6,
  },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  infoLabel: { fontSize: 13, fontWeight: '600', color: colors.muted, flexShrink: 0 },
  infoValue: { fontSize: 13, color: colors.text, flex: 1, textAlign: 'right', textTransform: 'capitalize' },
  row: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 10,
  },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 18, fontWeight: '600', color: colors.text },
  meta: { fontSize: 14, color: colors.muted, marginTop: 6, lineHeight: 20 },
  badge: { fontSize: 13, fontWeight: '600', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, overflow: 'hidden' },
  badgeDone: { backgroundColor: colors.okBg, color: colors.primary },
  badgeTodo: { backgroundColor: colors.warnBg, color: colors.warn },
  mealActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  mealBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  mealBtnPrimary: { backgroundColor: colors.primary },
  mealBtnPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  mealBtnSecondary: { backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.primary },
  mealBtnSecondaryText: { color: colors.primary, fontSize: 15, fontWeight: '600' },
  sectionHeader: { fontSize: 17, fontWeight: '700', color: colors.text, marginTop: 20, marginBottom: 10 },
  weightRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  weightInput: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
    width: 110,
    textAlign: 'center',
  },
  weightUnit: { fontSize: 16, color: colors.muted, fontWeight: '600' },
  weightBtn: { flex: 1 },
  suppRow: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  suppInfo: { flex: 1 },
  suppName: { fontSize: 16, fontWeight: '600', color: colors.text },
  suppMeta: { fontSize: 13, color: colors.muted, marginTop: 2, textTransform: 'capitalize' },
  counter: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  counterBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counterBtnText: { color: '#fff', fontSize: 22, fontWeight: '600', lineHeight: 28 },
  counterNum: { fontSize: 20, fontWeight: '700', color: colors.text, minWidth: 28, textAlign: 'center' },
  suppSaveRow: { marginTop: 4, gap: 8 },
  chartsBtn: { marginTop: 16 },
});
