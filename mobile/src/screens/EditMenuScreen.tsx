import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { getMenuItems, Meal, MenuItemWithSafety, Resident, updateMealItems } from '../api';
import { Banner, Button, Header } from '../components/ui';
import { colors, mealLabel } from '../theme';

type Props = {
  resident: Resident;
  meal: Meal;
  onBack: () => void;
  onSaved: (updated: Meal) => void;
};

const GROUP_ORDER = ['protein', 'grain', 'vegetable', 'fruit', 'dairy', 'other'];

export function EditMenuScreen({ resident, meal, onBack, onSaved }: Props) {
  const [items, setItems] = useState<MenuItemWithSafety[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set(meal.items.map((i) => i.id)));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getMenuItems(resident.id).then(setItems).catch((e: Error) => setError(e.message));
  }, [resident.id]);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateMealItems(meal.id, Array.from(selected));
      onSaved(updated);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  // Group items by food group for display.
  const grouped: Record<string, MenuItemWithSafety[]> = {};
  (items ?? []).forEach((it) => {
    (grouped[it.food_group] ??= []).push(it);
  });
  const groups = GROUP_ORDER.filter((g) => grouped[g]?.length);

  return (
    <View style={styles.flex}>
      <Header
        title="Edit menu"
        subtitle={`${mealLabel[meal.meal_type]} · ${resident.name}`}
        onBack={onBack}
      />
      <ScrollView contentContainerStyle={styles.pad}>
        {error && <Banner tone="danger">{error}</Banner>}
        {!items && !error && <ActivityIndicator style={{ marginTop: 24 }} />}

        <Text style={styles.legend}>
          <Text style={{ color: colors.primary }}>● </Text>Safe for this resident ·{' '}
          <Text style={{ color: colors.warn }}>● </Text>Caution ·{' '}
          <Text style={{ color: colors.danger }}>● </Text>Do not serve
        </Text>

        {groups.map((g) => (
          <View key={g} style={styles.group}>
            <Text style={styles.groupTitle}>{g}</Text>
            {grouped[g].map((it) => {
              const isSelected = selected.has(it.id);
              const safety = it.safety ?? 'safe';
              const dotColor =
                safety === 'block' ? colors.danger : safety === 'warning' ? colors.warn : colors.primary;
              const isBlocked = safety === 'block';
              return (
                <TouchableOpacity
                  key={it.id}
                  onPress={() => toggle(it.id)}
                  style={[styles.row, isSelected && styles.rowSelected, isBlocked && isSelected && styles.rowBlocked]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isSelected }}
                >
                  <View style={[styles.checkbox, isSelected && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
                    {isSelected && <Text style={styles.checkmark}>✓</Text>}
                  </View>
                  <View style={styles.rowInfo}>
                    <View style={styles.nameRow}>
                      <Text style={[styles.dot, { color: dotColor }]}>●</Text>
                      <Text style={styles.itemName}>{it.name}</Text>
                    </View>
                    <Text style={styles.itemMeta}>
                      {it.texture} · {Math.round(it.kcal)} kcal · {it.protein_g.toFixed(0)}g protein
                    </Text>
                    {it.safety_warnings?.map((w, i) => (
                      <Text key={i} style={[styles.warning, { color: dotColor }]}>{w}</Text>
                    ))}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <Button label={`Save menu (${selected.size} item${selected.size === 1 ? '' : 's'})`} onPress={save} loading={saving} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pad: { paddingHorizontal: 20, paddingBottom: 24 },
  legend: { fontSize: 13, color: colors.muted, marginBottom: 14, lineHeight: 20 },
  group: { marginBottom: 16 },
  groupTitle: { fontSize: 14, fontWeight: '700', color: colors.muted, textTransform: 'capitalize', marginBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginBottom: 8,
    gap: 12,
  },
  rowSelected: { borderColor: colors.primary, borderWidth: 1.5 },
  rowBlocked: { borderColor: colors.danger, backgroundColor: colors.dangerBg },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkmark: { color: '#fff', fontSize: 14, fontWeight: '700' },
  rowInfo: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { fontSize: 12 },
  itemName: { fontSize: 16, fontWeight: '600', color: colors.text },
  itemMeta: { fontSize: 13, color: colors.muted, marginTop: 2, textTransform: 'capitalize' },
  warning: { fontSize: 13, marginTop: 3, lineHeight: 18 },
  footer: { padding: 20, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.card },
});
