import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useRef, useState } from 'react';
import { Image, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { analyzeMeal, AnalyzeResponse, BeforeCheckResponse, checkBeforeMeal, DietAlert, Meal, Resident } from '../api';
import { Banner, Button, Header } from '../components/ui';
import { prepareForUpload } from '../image';
import { colors, mealLabel } from '../theme';

type ActiveCapture = 'before' | 'after' | null;

type Props = {
  resident: Resident;
  meal: Meal;
  onAnalyzed: (a: AnalyzeResponse) => void;
  onManual: () => void;
  onBack: () => void;
};

export function CaptureScreen({ resident, meal, onAnalyzed, onManual, onBack }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [photos, setPhotos] = useState<{ before?: string; after?: string }>({});
  const [activeCapture, setActiveCapture] = useState<ActiveCapture>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Before-check review state
  const [beforeCheck, setBeforeCheck] = useState<BeforeCheckResponse | null>(null);
  const [checkBusy, setCheckBusy] = useState(false);
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set());

  const hasBefore = !!photos.before;
  const hasAfter = !!photos.after;
  const readyToAnalyze = hasBefore && hasAfter;

  // High-severity alerts block the flow; others need acknowledgment.
  const highAlerts = beforeCheck?.diet_alerts.filter((a) => a.severity === 'high') ?? [];
  const medAlerts = beforeCheck?.diet_alerts.filter((a) => a.severity === 'medium' && a.kind !== 'unexpected_item') ?? [];
  // All items from the menu — show visible ones in green, missing ones handled separately.
  const visibleItems = beforeCheck?.menu_items_visible.filter((i) => i.visible) ?? [];
  const missingItems = beforeCheck?.menu_items_visible.filter((i) => !i.visible) ?? [];
  const extraItems = beforeCheck?.extra_items ?? [];
  const prefConflicts = beforeCheck?.preference_conflicts ?? [];

  // All warnings that need a checkbox before proceeding.
  const warningKeys = [
    ...visibleItems.filter((it) => it.confidence === 'low').map((it) => `conf-${it.id}`),
    ...prefConflicts.map((_, i) => `pref-${i}`),
    ...medAlerts.map((a, i) => `med-${i}`),
    ...missingItems.map((it) => `missing-${it.id}`),
    ...extraItems.map((e, i) => `extra-${i}`),
  ];
  const allAcknowledged = warningKeys.every((k) => acknowledged.has(k));
  const hasBlocker = highAlerts.length > 0;
  const showBeforeReview = beforeCheck !== null;

  async function store(uri: string, width: number, height: number, slot: 'before' | 'after') {
    const small = await prepareForUpload(uri, width, height);
    if (slot === 'before') {
      setPhotos((p) => ({ ...p, before: small }));
      // Run before-check immediately.
      setCheckBusy(true);
      setBeforeCheck(null);
      setAcknowledged(new Set());
      try {
        const result = await checkBeforeMeal(meal.id, small);
        console.log('before-check result:', JSON.stringify(result));
        setBeforeCheck(result);
      } catch (e) {
        setError(`Before check failed: ${(e as Error).message}`);
      } finally {
        setCheckBusy(false);
      }
    } else {
      setPhotos((p) => ({ ...p, after: small }));
    }
  }

  async function takePhoto() {
    if (!camera.current || !activeCapture) return;
    setError(null);
    setBusy(true);
    try {
      const pic = await camera.current.takePictureAsync({ quality: 0.8 });
      const slot = activeCapture;
      setActiveCapture(null);
      await store(pic.uri, pic.width, pic.height, slot);
    } catch (e) {
      setError(`Couldn't take photo: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function pickFromGallery() {
    if (!activeCapture) return;
    setError(null);
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (res.canceled || !res.assets[0]) return;
    const a = res.assets[0];
    const slot = activeCapture;
    setActiveCapture(null);
    setBusy(true);
    try {
      await store(a.uri, a.width, a.height, slot);
    } finally {
      setBusy(false);
    }
  }

  async function analyze() {
    if (!photos.before || !photos.after) return;
    setError(null);
    setBusy(true);
    try {
      onAnalyzed(await analyzeMeal(meal.id, photos.before, photos.after));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function retakeBefore() {
    setPhotos((p) => ({ ...p, before: undefined, after: undefined }));
    setBeforeCheck(null);
    setAcknowledged(new Set());
  }

  function toggleAck(key: string) {
    setAcknowledged((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const title = `${mealLabel[meal.meal_type]} · ${resident.name}`;
  // After-photo card is locked until before is taken AND (no blocker AND all acks done).
  const afterLocked = !hasBefore || hasBlocker || (warningKeys.length > 0 && !allAcknowledged);

  return (
    <View style={styles.flex}>
      <Header title={title} subtitle="Log tray photos to estimate intake" onBack={onBack} />

      <View style={styles.photoRow}>
        <PhotoCard
          label="Before meal"
          step="1"
          uri={photos.before}
          onCapture={() => setActiveCapture('before')}
          disabled={false}
          checking={checkBusy}
        />
        <PhotoCard
          label="After meal"
          step="2"
          uri={photos.after}
          onCapture={() => setActiveCapture('after')}
          disabled={afterLocked}
          lockedMessage={
            !hasBefore
              ? 'Log before photo first'
              : hasBlocker
                ? 'Fix dietary issue first'
                : warningKeys.length > 0 && !allAcknowledged
                  ? 'Acknowledge warnings first'
                  : undefined
          }
        />
      </View>

      {/* Before-check review panel */}
      {showBeforeReview && (
        <ScrollView style={styles.reviewPanel} contentContainerStyle={styles.reviewContent}>

          {/* Always show everything seen on the tray first */}
          {(visibleItems.length > 0 || extraItems.length > 0) && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Items on tray</Text>
              {visibleItems.map((it) => {
                const isLowConf = it.confidence === 'low';
                const ackKey = `conf-${it.id}`;
                const label = `${it.name}${it.confidence ? ` · ${it.confidence} confidence` : ''}${isLowConf ? ' · please check' : ''}`;
                if (isLowConf) {
                  return (
                    <CheckRow
                      key={it.id}
                      message={label}
                      color={colors.warn}
                      bg={colors.warnBg}
                      checked={acknowledged.has(ackKey)}
                      onToggle={() => toggleAck(ackKey)}
                    />
                  );
                }
                return (
                  <AlertRow key={it.id} message={label} color={colors.text} bg={colors.card} />
                );
              })}
              {extraItems.map((name, i) => (
                <AlertRow key={`extra-green-${i}`} message={name} color={colors.text} bg={colors.card} />
              ))}
            </View>
          )}

          {highAlerts.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>⛔ Dietary restrictions violated — retake required</Text>
              {highAlerts.map((a, i) => (
                <AlertRow key={i} message={a.message} color={colors.danger} bg={colors.dangerBg} />
              ))}
              <Button
                label="Please serve them something different and retake the before photo"
                onPress={retakeBefore}
                style={styles.gap}
              />
            </View>
          )}

          {prefConflicts.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>⚠️ Dietary preferences</Text>
              <Text style={styles.ackHint}>The following items on the tray are listed in this resident's dietary preferences. Please check each box to confirm you are aware.</Text>
              {prefConflicts.map((msg, i) => (
                <CheckRow
                  key={i}
                  message={msg}
                  color={colors.warn}
                  bg={colors.warnBg}
                  checked={acknowledged.has(`pref-${i}`)}
                  onToggle={() => toggleAck(`pref-${i}`)}
                />
              ))}
            </View>
          )}

          {medAlerts.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>⚠️ Dietary notices</Text>
              <Text style={styles.ackHint}>Please check the boxes below to confirm you are aware of these dietary notices.</Text>
              {medAlerts.map((a, i) => (
                <CheckRow
                  key={i}
                  message={a.message}
                  color={colors.warn}
                  bg={colors.warnBg}
                  checked={acknowledged.has(`med-${i}`)}
                  onToggle={() => toggleAck(`med-${i}`)}
                />
              ))}
            </View>
          )}

          {missingItems.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>🔍 Menu items not seen on tray</Text>
              <Text style={styles.ackHint}>Please check the boxes below to confirm you are aware that these menu items were not found on the tray.</Text>
              {missingItems.map((it) => (
                <CheckRow
                  key={it.id}
                  message={`${it.name} was not seen on the tray. Confirm it was served.`}
                  color={colors.warn}
                  bg={colors.warnBg}
                  checked={acknowledged.has(`missing-${it.id}`)}
                  onToggle={() => toggleAck(`missing-${it.id}`)}
                />
              ))}
            </View>
          )}

          {extraItems.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>🍽 Items not on menu</Text>
              <Text style={styles.ackHint}>Please check the boxes below to confirm you are aware that these items on the tray are not on the menu.</Text>
              {extraItems.map((name, i) => (
                <CheckRow
                  key={i}
                  message={`'${name}' is not on the menu. Confirm it is allowed.`}
                  color={colors.warn}
                  bg={colors.warnBg}
                  checked={acknowledged.has(`extra-${i}`)}
                  onToggle={() => toggleAck(`extra-${i}`)}
                />
              ))}
            </View>
          )}
        </ScrollView>
      )}

      <View style={styles.controls}>
        {error && <Banner tone="danger">{error}</Banner>}
        {!hasBefore && !checkBusy && (
          <Banner tone="warn">Take the before photo first, then the after photo once the meal is done.</Banner>
        )}
        {checkBusy && <Banner tone="warn">Checking tray…</Banner>}

        {readyToAnalyze && (
          <>
            <Button label="Analyze meal" onPress={analyze} loading={busy} />
            <Button label="Retake photos" variant="secondary" onPress={() => { setPhotos({}); setBeforeCheck(null); setAcknowledged(new Set()); }} disabled={busy} style={styles.gap} />
          </>
        )}
        <Button label="Log intake manually instead" variant="secondary" onPress={onManual} disabled={busy} style={styles.gap} />
      </View>

      {/* Full-screen camera modal */}
      <Modal visible={activeCapture !== null} animationType="slide" onRequestClose={() => setActiveCapture(null)}>
        <View style={styles.flex}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              {activeCapture === 'before' ? 'Before meal photo' : 'After meal photo'}
            </Text>
            <Text style={styles.modalSub}>
              {activeCapture === 'before'
                ? 'Hold phone straight above the tray. Whole tray in frame, lids off.'
                : 'Same tray, same overhead angle as the before photo.'}
            </Text>
          </View>
          {permission?.granted ? (
            <CameraView ref={camera} style={styles.flex} facing="back" onCameraReady={() => setCameraReady(true)} accessibilityLabel="Camera preview" />
          ) : (
            <View style={styles.permission}>
              <Text style={styles.permissionText}>Nourish needs the camera to photograph meal trays.</Text>
              <Button label="Allow camera" onPress={requestPermission} />
            </View>
          )}
          <View style={styles.cameraControls}>
            <Button label={activeCapture === 'before' ? 'Take before photo' : 'Take after photo'} onPress={takePhoto} disabled={!permission?.granted || !cameraReady} loading={busy} />
            <Button label="Choose from gallery" variant="secondary" onPress={pickFromGallery} disabled={busy} style={styles.gap} />
            <Button label="Cancel" variant="secondary" onPress={() => setActiveCapture(null)} disabled={busy} style={styles.gap} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

function AlertRow({ message, color, bg }: { message: string; color: string; bg: string }) {
  return (
    <View style={[styles.alertRow, { backgroundColor: bg, borderColor: color }]}>
      <Text style={[styles.alertText, { color }]}>{message}</Text>
    </View>
  );
}

function CheckRow({ message, color, bg, checked, onToggle }: {
  message: string; color: string; bg: string; checked: boolean; onToggle: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.alertRow, styles.checkRow, { backgroundColor: bg, borderColor: color }]}
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
    >
      <View style={[styles.checkbox, { borderColor: color }, checked && { backgroundColor: color }]}>
        {checked && <Text style={styles.checkmark}>✓</Text>}
      </View>
      <Text style={[styles.alertText, { color, flex: 1 }]}>{message}</Text>
    </TouchableOpacity>
  );
}

type PhotoCardProps = {
  label: string;
  step: string;
  uri?: string;
  onCapture: () => void;
  disabled: boolean;
  lockedMessage?: string;
  checking?: boolean;
};

function PhotoCard({ label, step, uri, onCapture, disabled, lockedMessage, checking }: PhotoCardProps) {
  return (
    <View style={[styles.card, disabled && styles.cardDisabled]}>
      <View style={styles.cardHeader}>
        <View style={[styles.stepBadge, disabled && styles.stepBadgeDisabled]}>
          <Text style={styles.stepText}>{step}</Text>
        </View>
        <Text style={[styles.cardLabel, disabled && styles.cardLabelDisabled]}>{label}</Text>
      </View>
      {uri ? (
        <View style={styles.thumbContainer}>
          <Image source={{ uri }} style={styles.thumb} accessibilityLabel={`${label} photo`} resizeMode="cover" />
          <Text style={styles.capturedBadge}>✓ Logged</Text>
        </View>
      ) : (
        <View style={styles.thumbPlaceholder}>
          <Text style={styles.placeholderIcon}>{checking ? '⏳' : '📷'}</Text>
          {lockedMessage ? (
            <Text style={styles.lockedText}>{lockedMessage}</Text>
          ) : checking ? (
            <Text style={styles.placeholderText}>Checking tray…</Text>
          ) : (
            <Text style={styles.placeholderText}>No photo yet</Text>
          )}
        </View>
      )}
      <Button
        label={uri ? `Retake ${label.toLowerCase()}` : `Log ${label.toLowerCase()}`}
        onPress={onCapture}
        disabled={disabled || checking}
        variant={uri ? 'secondary' : 'primary'}
        style={styles.cardButton}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  photoRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 12, height: 200 },
  card: { flex: 1, backgroundColor: colors.card, borderRadius: 14, borderWidth: 1.5, borderColor: colors.border, padding: 12, gap: 10 },
  cardDisabled: { opacity: 0.5, backgroundColor: colors.bg },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepBadge: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  stepBadgeDisabled: { backgroundColor: colors.muted },
  stepText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  cardLabel: { fontSize: 15, fontWeight: '600', color: colors.text },
  cardLabelDisabled: { color: colors.muted },
  thumbContainer: { flex: 1, borderRadius: 10, overflow: 'hidden' },
  thumb: { flex: 1, borderRadius: 10 },
  capturedBadge: { position: 'absolute', bottom: 6, left: 6, backgroundColor: colors.primary, color: '#fff', fontSize: 12, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, overflow: 'hidden' },
  thumbPlaceholder: { flex: 1, backgroundColor: colors.bg, borderRadius: 10, alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 100 },
  placeholderIcon: { fontSize: 28 },
  placeholderText: { fontSize: 13, color: colors.muted, textAlign: 'center' },
  lockedText: { fontSize: 13, color: colors.warn, textAlign: 'center', fontWeight: '600' },
  cardButton: { marginTop: 8 },
  reviewPanel: { flex: 1, marginHorizontal: 16, marginTop: 12, minHeight: 100 },
  reviewContent: { paddingBottom: 8, gap: 12 },
  section: { gap: 6 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: 2 },
  ackHint: { fontSize: 13, color: colors.muted, marginBottom: 4, fontStyle: 'italic' },
  alertRow: { borderWidth: 1, borderRadius: 10, padding: 10 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  alertText: { fontSize: 14, lineHeight: 20 },
  checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: 1, flexShrink: 0 },
  checkmark: { color: '#fff', fontSize: 13, fontWeight: '700' },
  controls: { padding: 16, paddingTop: 12 },
  gap: { marginTop: 10 },
  modalHeader: { paddingHorizontal: 20, paddingTop: 60, paddingBottom: 12, backgroundColor: colors.bg },
  modalTitle: { fontSize: 22, fontWeight: '700', color: colors.text },
  modalSub: { fontSize: 14, color: colors.muted, marginTop: 4 },
  cameraControls: { padding: 20, backgroundColor: colors.bg },
  permission: { flex: 1, backgroundColor: colors.card, padding: 20, justifyContent: 'center' },
  permissionText: { fontSize: 16, color: colors.text, marginBottom: 16, lineHeight: 22 },
});
