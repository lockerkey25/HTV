import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useRef, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { analyzeMeal, AnalyzeResponse, Meal, Resident } from '../api';
import { Banner, Button, Header } from '../components/ui';
import { prepareForUpload } from '../image';
import { colors, mealLabel } from '../theme';

type Step = 'before' | 'after' | 'ready';

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const step: Step = !photos.before ? 'before' : !photos.after ? 'after' : 'ready';

  async function store(uri: string, width: number, height: number) {
    const small = await prepareForUpload(uri, width, height);
    setPhotos((p) => (p.before ? { ...p, after: small } : { before: small }));
  }

  async function takePhoto() {
    if (!camera.current) return;
    setError(null);
    setBusy(true);
    try {
      const pic = await camera.current.takePictureAsync({ quality: 0.8 });
      await store(pic.uri, pic.width, pic.height);
    } catch (e) {
      setError(`Couldn't take photo: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function pickFromGallery() {
    setError(null);
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (res.canceled || !res.assets[0]) return;
    const a = res.assets[0];
    setBusy(true);
    try {
      await store(a.uri, a.width, a.height);
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

  const title = `${mealLabel[meal.meal_type]} · ${resident.name}`;
  const instruction =
    step === 'before'
      ? 'Step 1 of 2: BEFORE the meal. Hold the phone straight above the tray, whole tray in frame, lids and wrappers off.'
      : step === 'after'
        ? 'Step 2 of 2: AFTER the meal. Same tray, same overhead angle and distance as the first photo.'
        : 'Both photos taken. Send them for analysis.';

  return (
    <View style={styles.flex}>
      <Header title={title} subtitle={instruction} onBack={onBack} />

      <View style={styles.preview}>
        {step !== 'ready' ? (
          permission?.granted ? (
            <CameraView
              ref={camera}
              style={styles.flex}
              facing="back"
              onCameraReady={() => setCameraReady(true)}
              accessibilityLabel="Camera preview"
            />
          ) : (
            <View style={styles.permission}>
              <Text style={styles.permissionText}>
                Nourish needs the camera to photograph meal trays. Photos are only used to estimate intake.
              </Text>
              <Button label="Allow camera" onPress={requestPermission} />
            </View>
          )
        ) : (
          <View style={styles.thumbs}>
            <Thumb label="Before" uri={photos.before} />
            <Thumb label="After" uri={photos.after} />
          </View>
        )}
      </View>

      <View style={styles.controls}>
        {error && <Banner tone="danger">{error}</Banner>}

        {step !== 'ready' && (
          <View style={styles.thumbRow}>
            {photos.before && <Thumb label="Before" uri={photos.before} small />}
          </View>
        )}

        {step !== 'ready' ? (
          <>
            <Button
              label={step === 'before' ? 'Take BEFORE photo' : 'Take AFTER photo'}
              onPress={takePhoto}
              disabled={!permission?.granted || !cameraReady}
              loading={busy}
            />
            <Button label="Choose from gallery" variant="secondary" onPress={pickFromGallery} disabled={busy} style={styles.gap} />
          </>
        ) : (
          <>
            <Button label="Analyze meal" onPress={analyze} loading={busy} />
            <Button
              label="Retake photos"
              variant="secondary"
              onPress={() => setPhotos({})}
              disabled={busy}
              style={styles.gap}
            />
          </>
        )}
        <Button label="Log intake manually instead" variant="secondary" onPress={onManual} disabled={busy} style={styles.gap} />
      </View>
    </View>
  );
}

function Thumb({ label, uri, small }: { label: string; uri?: string; small?: boolean }) {
  if (!uri) return null;
  return (
    <View style={small ? styles.thumbSmall : styles.thumb}>
      <Image source={{ uri }} style={styles.flex} accessibilityLabel={`${label} photo`} resizeMode="cover" />
      <Text style={styles.thumbLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  preview: { flex: 1, marginHorizontal: 20, borderRadius: 16, overflow: 'hidden', backgroundColor: '#000' },
  permission: { flex: 1, backgroundColor: colors.card, padding: 20, justifyContent: 'center' },
  permissionText: { fontSize: 16, color: colors.text, marginBottom: 16, lineHeight: 22 },
  controls: { padding: 20 },
  gap: { marginTop: 10 },
  thumbs: { flex: 1, flexDirection: 'row', gap: 8, padding: 8, backgroundColor: colors.bg },
  thumb: { flex: 1, borderRadius: 12, overflow: 'hidden' },
  thumbRow: { flexDirection: 'row', marginBottom: 10 },
  thumbSmall: { width: 72, height: 72, borderRadius: 10, overflow: 'hidden' },
  thumbLabel: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
});
