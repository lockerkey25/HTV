import { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors } from '../theme';

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
};

export function Button({ label, onPress, variant = 'primary', disabled, loading, style }: ButtonProps) {
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled || !!loading, busy: !!loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary ? styles.primary : styles.secondary,
        (disabled || loading) && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={primary ? colors.primaryText : colors.primary} />
      ) : (
        <Text style={[styles.label, { color: primary ? colors.primaryText : colors.primary }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Header({ title, subtitle, onBack }: { title: string; subtitle?: string; onBack?: () => void }) {
  return (
    <View style={styles.header}>
      {onBack && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          hitSlop={12}
          style={styles.back}
        >
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>
      )}
      <Text accessibilityRole="header" style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function Banner({ tone, children }: { tone: 'danger' | 'warn' | 'ok'; children: ReactNode }) {
  const bg = tone === 'danger' ? colors.dangerBg : tone === 'warn' ? colors.warnBg : colors.okBg;
  const fg = tone === 'danger' ? colors.danger : tone === 'warn' ? colors.warn : colors.primary;
  return (
    <View style={[styles.banner, { backgroundColor: bg, borderColor: fg }]} accessibilityRole="alert">
      <Text style={[styles.bannerText, { color: fg }]}>{children}</Text>
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    borderRadius: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: { backgroundColor: colors.primary },
  secondary: { backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.primary },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
  label: { fontSize: 17, fontWeight: '600' },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  back: { paddingVertical: 6, alignSelf: 'flex-start' },
  backText: { fontSize: 17, color: colors.primary },
  title: { fontSize: 26, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: 15, color: colors.muted, marginTop: 2 },
  banner: { borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 8 },
  bannerText: { fontSize: 15, lineHeight: 20 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 12,
  },
});
