import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Path, Text as SvgText } from 'react-native-svg';
import { API_URL, getHealthAssessment, HealthAssessment } from '../api';
import { Banner, Button } from '../components/ui';
import { colors } from '../theme';

const LABELS: Record<string, [string, string]> = {
  kcal: ['Calories', 'kcal'], protein_g: ['Protein', 'g'], fat_g: ['Fat', 'g'],
  cholesterol_mg: ['Cholesterol', 'mg'], sodium_mg: ['Sodium', 'mg'], iron_mg: ['Iron', 'mg'],
  calcium_mg: ['Calcium', 'mg'], sugar_g: ['Sugar', 'g'], vitamin_c_mg: ['Vitamin C', 'mg'],
  vitamin_d_mcg: ['Vitamin D', 'mcg'], vitamin_b12_mcg: ['Vitamin B12', 'mcg'],
};

const W = 320, H = 150, L = 42, R = 8, T = 8, B = 22;

function LineChart({ dates, values, food, min, max }: {
  dates: string[]; values: (number | null)[]; food?: (number | null)[];
  min?: number | null; max?: number | null;
}) {
  const nums = [...values, ...(food ?? [])].filter((v): v is number => v != null);
  const hi = Math.max(...nums, min ?? 0, max ?? 0, 1) * 1.1;
  const x = (i: number) => L + (i / Math.max(dates.length - 1, 1)) * (W - L - R);
  const y = (v: number) => T + (1 - v / hi) * (H - T - B);

  const path = (arr: (number | null)[]) => {
    let d = '', pen = false;
    arr.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${x(i)} ${y(v)}`;
      pen = true;
    });
    return d;
  };

  const short = (s: string) => s.slice(5);

  return (
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
      <Line x1={L} y1={y(0)} x2={W - R} y2={y(0)} stroke="#bbb" />
      <Line x1={L} y1={T} x2={L} y2={y(0)} stroke="#bbb" />
      {min != null && <Line x1={L} y1={y(min)} x2={W - R} y2={y(min)} stroke="#2e9e5b" strokeDasharray="4 4" />}
      {max != null && <Line x1={L} y1={y(max)} x2={W - R} y2={y(max)} stroke="#d64545" strokeDasharray="4 4" />}
      {food && <Path d={path(food)} stroke="#aaa" strokeWidth={1.5} fill="none" />}
      <Path d={path(values)} stroke="#2563eb" strokeWidth={2} fill="none" />
      <SvgText x={L - 4} y={y(0) + 3} fontSize="9" fill="#666" textAnchor="end">0</SvgText>
      <SvgText x={L - 4} y={T + 8} fontSize="9" fill="#666" textAnchor="end">{Math.round(hi)}</SvgText>
      <SvgText x={L} y={H - 6} fontSize="9" fill="#666">{short(dates[0])}</SvgText>
      <SvgText x={W - R} y={H - 6} fontSize="9" fill="#666" textAnchor="end">{short(dates[dates.length - 1])}</SvgText>
    </Svg>
  );
}

function statusColor(avg: number | null, min?: number | null, max?: number | null) {
  if (avg == null) return '#999';
  if (min != null && avg < min * 0.75) return '#d64545';
  if (min != null && avg < min * 0.9) return '#e0a100';
  if (max != null && avg > max * 1.2) return '#d64545';
  if (max != null && avg > max) return '#e0a100';
  return '#2e9e5b';
}

type Props = { residentId: number; onBack: () => void };

export function NutrientCharts({ residentId, onBack }: Props) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const [assessment, setAssessment] = useState<HealthAssessment | null>(null);
  const [assessing, setAssessing] = useState(false);
  const [assessError, setAssessError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    fetch(`${API_URL}/api/residents/${residentId}/intake-history?days=30`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setData)
      .catch((e) => setError(String(e)));
  }, [residentId]);

  async function runAssessment() {
    setAssessing(true);
    setAssessError(null);
    try {
      setAssessment(await getHealthAssessment(residentId));
    } catch (e) {
      setAssessError((e as Error).message);
    } finally {
      setAssessing(false);
    }
  }

  if (error) return (
    <View style={styles.flex}>
      <Text style={styles.back} onPress={onBack}>‹ Back</Text>
      <Text style={styles.error}>Couldn't load intake history: {error}</Text>
    </View>
  );

  if (!data) return (
    <View style={styles.flex}>
      <Text style={styles.back} onPress={onBack}>‹ Back</Text>
      <ActivityIndicator style={{ marginTop: 24 }} />
    </View>
  );

  const s = data.summary;

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.pad}>
      <Text style={styles.back} onPress={onBack}>‹ Back</Text>
      <Text style={styles.title}>Last 30 days</Text>
      <Text style={styles.summary}>
        {s.days_with_full_logs} days fully logged · {s.meals_missed} meals under 25% eaten
      </Text>
      <Text style={styles.legend}>
        Blue = meals + supplements, grey = meals only, green dashed = minimum, red dashed = limit.
        Days with unconfirmed meals are left blank.
      </Text>

      {/* AI health assessment */}
      <View style={styles.assessBlock}>
        <Button
          label={assessment ? 'Re-run AI health review' : 'Run AI health review'}
          onPress={runAssessment}
          loading={assessing}
        />
        {assessError && <Banner tone="danger">{assessError}</Banner>}
        {assessment && (
          <View style={styles.assessResult}>
            <Text style={styles.assessSummary}>{assessment.summary}</Text>

            {assessment.flags.length > 0 && (
              <>
                <Text style={styles.assessHeader}>Conditions to check with a doctor</Text>
                {assessment.flags.map((f, i) => (
                  <View key={i} style={[styles.flagCard, { borderColor: f.severity === 'high' ? colors.danger : colors.warn }]}>
                    <Text style={[styles.flagCondition, { color: f.severity === 'high' ? colors.danger : colors.warn }]}>
                      {f.severity === 'high' ? '⛔ ' : '⚠️ '}{f.condition}
                    </Text>
                    <Text style={styles.flagReason}>{f.reason}</Text>
                  </View>
                ))}
              </>
            )}

            {assessment.recommendations.length > 0 && (
              <>
                <Text style={styles.assessHeader}>Recommended next steps</Text>
                {assessment.recommendations.map((r, i) => (
                  <View key={i} style={styles.recRow}>
                    <Text style={styles.recAction}>• {r.action}</Text>
                    <Text style={styles.recDetail}>{r.detail}</Text>
                  </View>
                ))}
              </>
            )}

            {assessment.menu_suggestions.length > 0 && (
              <>
                <Text style={styles.assessHeader}>Suggested foods</Text>
                <Text style={styles.menuSuggest}>{assessment.menu_suggestions.join(' · ')}</Text>
              </>
            )}

            <Text style={styles.disclaimer}>
              AI decision-support for staff, not a medical diagnosis. Confirm with a clinician.
            </Text>
          </View>
        )}
      </View>

      {data.nutrients.map((n: string) => {
        const [label, unit] = LABELS[n] ?? [n, ''];
        const t = data.targets[n] ?? {};
        const avg = s.average[n];
        const range = t.min != null && t.max != null
          ? `${Math.round(t.min)}–${Math.round(t.max)}`
          : t.min != null
            ? `≥ ${Math.round(t.min)}`
            : t.max != null
              ? `≤ ${Math.round(t.max)}`
              : 'no target';

        return (
          <View key={n} style={styles.chartBlock}>
            <Text style={styles.chartTitle}>
              <Text style={{ color: statusColor(avg, t.min, t.max) }}>● </Text>
              {label} ({unit}), avg {avg ?? 'n/a'}, target {range}
            </Text>
            <LineChart dates={data.dates} values={data.total[n]} food={data.food[n]} min={t.min} max={t.max} />
          </View>
        );
      })}

      <View style={styles.chartBlock}>
        <Text style={styles.chartTitle}>Weight (kg)</Text>
        <LineChart dates={data.dates} values={data.weight_kg} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  pad: { paddingHorizontal: 20, paddingBottom: 40 },
  back: { fontSize: 17, color: colors.primary, paddingVertical: 8 },
  title: { fontSize: 22, fontWeight: '700', color: colors.text, marginBottom: 4 },
  summary: { fontSize: 15, color: colors.text, marginBottom: 6 },
  legend: { fontSize: 12, color: colors.muted, marginBottom: 16, lineHeight: 18 },
  chartBlock: { marginBottom: 16 },
  chartTitle: { fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: 4 },
  error: { fontSize: 16, color: colors.danger, padding: 20 },
  assessBlock: { marginBottom: 20, gap: 8 },
  assessResult: { gap: 8, marginTop: 4 },
  assessSummary: { fontSize: 15, color: colors.text, lineHeight: 21, fontStyle: 'italic' },
  assessHeader: { fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 8 },
  flagCard: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderRadius: 10,
    padding: 10,
  },
  flagCondition: { fontSize: 15, fontWeight: '700' },
  flagReason: { fontSize: 14, color: colors.text, marginTop: 2, lineHeight: 19 },
  recRow: { marginBottom: 4 },
  recAction: { fontSize: 14, fontWeight: '600', color: colors.text },
  recDetail: { fontSize: 13, color: colors.muted, marginLeft: 12, lineHeight: 18 },
  menuSuggest: { fontSize: 14, color: colors.primary, fontWeight: '600' },
  disclaimer: { fontSize: 12, color: colors.muted, fontStyle: 'italic', marginTop: 8 },
});
