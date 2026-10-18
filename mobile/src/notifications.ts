/**
 * Meal reminder notifications.
 *
 * Three daily local notifications are scheduled:
 *   10:40am → breakfast check
 *   2:00pm  → lunch check
 *   8:00pm  → dinner check
 *
 * checkUnloggedMealsForNow() is called once on app open. It checks which
 * meal windows have passed and sends at most one notification per resident
 * per meal type per day, using AsyncStorage to persist the sent flag.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { getUnloggedMeals } from './api';

export type MealType = 'breakfast' | 'lunch' | 'dinner';

const MEAL_CUTOFFS: { mealType: MealType; hour: number; minute: number }[] = [
  { mealType: 'breakfast', hour: 10, minute: 0 },
  { mealType: 'lunch', hour: 14, minute: 0 },
  { mealType: 'dinner', hour: 20, minute: 0 },
];

// How to handle notifications when the app is in the foreground.
// Wrapped in try/catch and skipped on web — in Expo Go on newer SDKs the
// notifications native module can be unavailable and throw at registration,
// which otherwise cascades into an RCTEventEmitter bridge error.
if (Platform.OS !== 'web') {
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
  } catch {
    // notifications not available in this runtime — reminders simply won't fire
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    if (existing === 'granted') return true;
    const { status } = await Notifications.requestPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}

export async function scheduleMealReminders(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    for (const { mealType, hour, minute } of MEAL_CUTOFFS) {
      const id = `meal-reminder-${mealType}`;
      await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
      const label = mealType.charAt(0).toUpperCase() + mealType.slice(1);
      await Notifications.scheduleNotificationAsync({
        identifier: id,
        content: {
          title: `${label} meal check`,
          body: `Time to check if all ${mealType} trays have been logged.`,
          data: { mealType },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
          hour,
          minute,
          repeats: true,
        },
      });
    }
  } catch {
    // notifications unavailable in this runtime
  }
}

export async function checkUnloggedMealsForNow(): Promise<void> {
  if (Platform.OS === 'web') return;

  const now = new Date();
  const todayStr = now.toDateString(); // e.g. "Sat Oct 17 2026"

  for (const { mealType, hour, minute } of MEAL_CUTOFFS) {
    // Skip if this meal window hasn't passed yet.
    const cutoff = new Date(now);
    cutoff.setHours(hour, minute, 0, 0);
    if (now < cutoff) continue;

    // Use AsyncStorage as a persistent "already sent today" flag.
    const storageKey = `notif-sent-${mealType}-${todayStr}`;
    const alreadySent = await AsyncStorage.getItem(storageKey);
    if (alreadySent) continue;

    // Set the flag immediately — before any async work — to block concurrent runs.
    await AsyncStorage.setItem(storageKey, '1');

    // Fetch and notify — silently skip on any error (flag stays set, no retry spam).
    try {
      const unlogged = await getUnloggedMeals(mealType);
      if (unlogged.length === 0) continue;

      const dateStr = now.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      });

      for (const record of unlogged) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: 'Meal not logged',
            body: `${record.name} did not eat ${mealType} on ${dateStr}. Please log the meal if there has been a mistake.`,
            data: { residentId: record.resident_id, mealId: record.meal_id },
          },
          trigger: null,
        });
      }
    } catch {
      // Do NOT clear the flag on failure — prevents retry spam.
    }
  }
}
