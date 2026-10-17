import { StyleSheet, Text, View } from 'react-native';
import { ConfirmResponse, Meal, Resident } from '../api';
import { Button, Card, Header } from '../components/ui';
import { colors, mealLabel } from '../theme';

type Props = { resident: Resident; meal: Meal; result: ConfirmResponse; onNext: () => void };

export function DoneScreen({ resident, meal, result, onNext }: Props) {
  const t = result.totals_consumed;
  return (
    <View style={styles.flex}>
      <Header title="Intake logged" subtitle={`${mealLabel[meal.meal_type]} · ${resident.name}`} />
      <View style={styles.pad}>
        <Card>
          <Text style={styles.big} accessibilityLabel={`About ${result.overall_percent_eaten} percent of the meal eaten`}>
            ~{result.overall_percent_eaten}% eaten
          </Text>
          <Text style={styles.meta}>
            {Math.round(t.kcal)} kcal · {t.protein_g.toFixed(1)} g protein · {t.iron_mg.toFixed(1)} mg iron ·{' '}
            {Math.round(t.calcium_mg)} mg calcium
          </Text>
          {result.adjusted_items.length > 0 && (
            <Text style={styles.adjusted}>
              You adjusted {result.adjusted_items.length} AI estimate{result.adjusted_items.length > 1 ? 's' : ''}.
            </Text>
          )}
        </Card>
        <Button label="Log another meal" onPress={onNext} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pad: { paddingHorizontal: 20 },
  big: { fontSize: 34, fontWeight: '700', color: colors.primary },
  meta: { fontSize: 15, color: colors.muted, marginTop: 6, lineHeight: 21 },
  adjusted: { fontSize: 14, color: colors.warn, marginTop: 8 },
});
