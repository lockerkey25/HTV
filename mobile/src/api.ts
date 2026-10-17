import Constants from 'expo-constants';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

/**
 * Backend URL. Order:
 * 1. EXPO_PUBLIC_API_URL (set in mobile/.env, e.g. a cloudflared tunnel URL)
 * 2. Same machine that serves the Expo bundle, port 8000 (works in Expo Go on the same Wi-Fi)
 * 3. localhost (web / simulator)
 */
function resolveApiUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  const hostUri = Constants.expoConfig?.hostUri; // e.g. "192.168.1.20:8081"
  const host = hostUri?.split(':')[0];
  if (host && Platform.OS !== 'web') return `http://${host}:8000`;
  return 'http://localhost:8000';
}

export const API_URL = resolveApiUrl();

export type Resident = {
  id: number;
  name: string;
  room: string;
  texture: string;
  diet_flags: string[];
  allergies: string[];
};

export type MenuItem = {
  id: number;
  name: string;
  food_group: string;
  texture: string;
  allergens: string[];
  servings: number;
  kcal: number;
  protein_g: number;
  iron_mg: number;
  calcium_mg: number;
  sodium_mg: number;
};

export type Meal = {
  id: number;
  resident_id: number;
  meal_date: string;
  meal_type: 'breakfast' | 'lunch' | 'dinner';
  status: 'served' | 'confirmed';
  items: MenuItem[];
};

export type Nutrients = {
  kcal: number;
  protein_g: number;
  iron_mg: number;
  calcium_mg: number;
  sodium_mg: number;
};

export type AnalyzedItem = {
  menu_item_id: number;
  name: string;
  food_group: string;
  percent_eaten: number | null;
  confidence: 'high' | 'medium' | 'low' | null;
  observation: string;
  needs_review: boolean;
};

export type DietAlert = {
  severity: 'high' | 'medium';
  kind: string;
  menu_item_id: number | null;
  message: string;
};

export type AnalyzeResponse = {
  analysis_id: number;
  meal_id: number;
  source: 'gemini' | 'cache' | 'mock';
  model: string;
  overall_percent_eaten: number | null;
  items: AnalyzedItem[];
  diet_alerts: DietAlert[];
  review_reasons: string[];
  extra_items: { name: string; food_group: string; percent_eaten: number; confidence: string }[];
  notes: string;
};

export type ConfirmResponse = {
  meal_id: number;
  overall_percent_eaten: number;
  totals_consumed: Nutrients;
  adjusted_items: number[];
};

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit, timeoutMs = 15000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, signal: controller.signal });
  } catch (e) {
    const err = e as Error;
    if (err.name === 'AbortError') {
      throw new ApiError(0, `The server took longer than ${timeoutMs / 1000}s to respond. Try again.`);
    }
    // Include the real error so upload/encoding bugs aren't mistaken for network problems.
    throw new ApiError(0, `Can't reach the server at ${API_URL} (${err.message}).`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
    } catch {}
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

export const getResidents = () => request<Resident[]>('/api/residents');

export const getMeals = (residentId: number) => request<Meal[]>(`/api/residents/${residentId}/meals`);

async function appendImage(form: FormData, field: string, uri: string) {
  if (Platform.OS === 'web') {
    const blob = await (await fetch(uri)).blob();
    form.append(field, blob, `${field}.jpg`);
  } else {
    // Expo's fetch (SDK 52+) doesn't accept React Native's { uri, name, type } objects.
    // An expo-file-system File implements the Blob interface, so it can be appended directly.
    form.append(field, new File(uri) as unknown as Blob, `${field}.jpg`);
  }
}

export async function analyzeMeal(mealId: number, beforeUri: string, afterUri: string) {
  const form = new FormData();
  await appendImage(form, 'before', beforeUri);
  await appendImage(form, 'after', afterUri);
  // Vision calls can take a while; don't set Content-Type so fetch adds the multipart boundary.
  return request<AnalyzeResponse>(`/api/meals/${mealId}/analyze`, { method: 'POST', body: form }, 60000);
}

export const confirmMeal = (
  mealId: number,
  analysisId: number | null,
  items: { menu_item_id: number; percent_eaten: number }[],
) =>
  request<ConfirmResponse>(`/api/meals/${mealId}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ analysis_id: analysisId, items }),
  });
