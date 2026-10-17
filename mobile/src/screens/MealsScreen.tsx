import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { getMeals, Meal, Resident } from '../api';
import { Banner, Header } from '../components/ui';
import { colors, mealLabel } from '../theme';

type Props = { resident: Resident; onSelect: (m: Meal) => void; onBack: () => void };

export function MealsScreen({ resident, onSelect, onBack }: Props) {
  const [meals, setMeals] = useState<Meal[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMeals(resident.id).then(setMeals).catch((e: Error) => setError(e.message));
  }, [resident.id]);

  return (
    <View style={styles.flex}>
      <Header title={resident.name} subtitle={`Room ${resident.room} · Today's meals`} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.pad}>
        {error && <Banner tone="danger">{error}</Banner>}
        {!meals && !error && <ActivityIndicator style={{ marginTop: 24 }} />}
        {meals?.length === 0 && <Text style={styles.meta}>No meals scheduled today.</Text>}
        {meals?.map((meal) => {
          const done = meal.status === 'confirmed';
          return (
            <Pressable
              key={meal.id}
              accessibilityRole="button"
              accessibilityLabel={`${mealLabel[meal.meal_type]}${done ? ', already logged' : ''}`}
              onPress={() => onSelect(meal)}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
            >
              <View style={styles.titleRow}>
                <Text style={styles.name}>{mealLabel[meal.meal_type]}</Text>
                <Text style={[styles.badge, done ? styles.badgeDone : styles.badgeTodo]}>
                  {done ? 'Logged' : 'Not logged'}
                </Text>
              </View>
              <Text style={styles.meta}>{meal.items.map((i) => i.name).join(' · ')}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pad: { paddingHorizontal: 20, paddingBottom: 24 },
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
});
