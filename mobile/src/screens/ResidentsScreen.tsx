import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { ageGroup, API_URL, getResidents, Resident } from '../api';
import { Banner, Button, Header } from '../components/ui';
import { colors } from '../theme';

export function ResidentsScreen({ onSelect }: { onSelect: (r: Resident) => void }) {
  const [residents, setResidents] = useState<Resident[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setResidents(await getResidents());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <View style={styles.flex}>
      <Header title="Nourish" subtitle="Select a resident to log a meal" />
      {error && (
        <View style={styles.pad}>
          <Banner tone="danger">{error}</Banner>
          <Button label="Try again" onPress={load} variant="secondary" />
        </View>
      )}
      <FlatList
        data={residents}
        keyExtractor={(r) => String(r.id)}
        contentContainerStyle={styles.pad}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        renderItem={({ item }) => {
          const tags = [item.texture !== 'regular' ? item.texture : null, ...item.diet_flags.map((f) => f.replace('_', ' '))]
            .filter(Boolean)
            .join(' · ');
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.name}, room ${item.room}`}
              onPress={() => onSelect(item)}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <View style={styles.flex}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.meta}>
                  Room {item.room} · {item.sex === 'male' ? 'M' : 'F'} · {ageGroup(item.dob)}
                  {tags ? ` · ${tags}` : ''}
                </Text>
                {item.allergies.length > 0 && (
                  <Text style={styles.allergy}>Allergies: {item.allergies.join(', ')}</Text>
                )}
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          );
        }}
        ListFooterComponent={<Text style={styles.footer}>Server: {API_URL}</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pad: { paddingHorizontal: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 10,
    minHeight: 72,
  },
  pressed: { opacity: 0.7 },
  name: { fontSize: 18, fontWeight: '600', color: colors.text },
  meta: { fontSize: 14, color: colors.muted, marginTop: 2, textTransform: 'capitalize' },
  allergy: { fontSize: 14, color: colors.danger, marginTop: 2, fontWeight: '600' },
  chevron: { fontSize: 28, color: colors.muted, marginLeft: 8 },
  footer: { fontSize: 12, color: colors.muted, textAlign: 'center', marginVertical: 16 },
});
