import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AnalyzeResponse, ConfirmResponse, Meal, Resident } from './src/api';
import { CaptureScreen } from './src/screens/CaptureScreen';
import { DoneScreen } from './src/screens/DoneScreen';
import { MealsScreen } from './src/screens/MealsScreen';
import { ResidentsScreen } from './src/screens/ResidentsScreen';
import { ReviewScreen } from './src/screens/ReviewScreen';
import { colors } from './src/theme';
import {
  requestNotificationPermission,
  scheduleMealReminders,
} from './src/notifications';

// Simple state-machine navigation for the linear CNA flow:
// residents -> meals -> capture (before/after) -> review -> done
type Screen =
  | { name: 'residents' }
  | { name: 'meals'; resident: Resident }
  | { name: 'capture'; resident: Resident; meal: Meal }
  | { name: 'review'; resident: Resident; meal: Meal; analysis: AnalyzeResponse | null }
  | { name: 'done'; resident: Resident; meal: Meal; result: ConfirmResponse };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'residents' });

  useEffect(() => {
    requestNotificationPermission().then((granted) => {
      if (!granted) return;
      scheduleMealReminders();
    });
  }, []);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <StatusBar style="dark" />
        {screen.name === 'residents' && (
          <ResidentsScreen onSelect={(resident) => setScreen({ name: 'meals', resident })} />
        )}
        {screen.name === 'meals' && (
          <MealsScreen
            resident={screen.resident}
            onBack={() => setScreen({ name: 'residents' })}
            onSelect={(meal) => setScreen({ name: 'capture', resident: screen.resident, meal })}
          />
        )}
        {screen.name === 'capture' && (
          <CaptureScreen
            resident={screen.resident}
            meal={screen.meal}
            onBack={() => setScreen({ name: 'meals', resident: screen.resident })}
            onAnalyzed={(analysis) => setScreen({ ...screen, name: 'review', analysis })}
            onManual={() => setScreen({ ...screen, name: 'review', analysis: null })}
          />
        )}
        {screen.name === 'review' && (
          <ReviewScreen
            resident={screen.resident}
            meal={screen.meal}
            analysis={screen.analysis}
            onBack={() => setScreen({ name: 'capture', resident: screen.resident, meal: screen.meal })}
            onConfirmed={(result) =>
              setScreen({ name: 'done', resident: screen.resident, meal: screen.meal, result })
            }
          />
        )}
        {screen.name === 'done' && (
          <DoneScreen
            resident={screen.resident}
            meal={screen.meal}
            result={screen.result}
            onNext={() => setScreen({ name: 'meals', resident: screen.resident })}
          />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});
