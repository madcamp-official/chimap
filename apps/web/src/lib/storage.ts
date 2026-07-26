import {
  storedPreferencesV1Schema,
  storedPreferencesV2Schema,
  storedPreferencesV3Schema,
  storedTripV1Schema,
  type StoredPreferencesV1,
  type StoredPreferencesV2,
  type StoredPreferencesV3,
  type StoredTripV1,
} from "@chimap/contracts";

export const PREFERENCES_STORAGE_KEY = "chimap:preferences";
export const LAST_TRIP_STORAGE_KEY = "chimap:last-trip";

function browserStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function safelyRead(key: string, storage = browserStorage()): unknown {
  if (storage === undefined) {
    return undefined;
  }
  try {
    const value = storage.getItem(key);
    return value === null ? undefined : (JSON.parse(value) as unknown);
  } catch {
    return undefined;
  }
}

function safelyWrite(
  key: string,
  value: unknown,
  storage = browserStorage(),
): boolean {
  if (storage === undefined) {
    return false;
  }
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadPreferences(
  storage = browserStorage(),
):
  | StoredPreferencesV1
  | StoredPreferencesV2
  | StoredPreferencesV3
  | undefined {
  const value = safelyRead(PREFERENCES_STORAGE_KEY, storage);
  const latest = storedPreferencesV3Schema.safeParse(value);
  if (latest.success) {
    return latest.data;
  }
  const current = storedPreferencesV2Schema.safeParse(value);
  if (current.success) {
    return current.data;
  }
  const legacy = storedPreferencesV1Schema.safeParse(value);
  return legacy.success ? legacy.data : undefined;
}

export function savePreferences(
  preferences: StoredPreferencesV3,
  storage = browserStorage(),
): boolean {
  const parsed = storedPreferencesV3Schema.safeParse(preferences);
  return parsed.success
    ? safelyWrite(PREFERENCES_STORAGE_KEY, parsed.data, storage)
    : false;
}

export function clearPreferences(
  storage = browserStorage(),
): boolean {
  if (storage === undefined) {
    return false;
  }
  try {
    storage.removeItem(PREFERENCES_STORAGE_KEY);
    storage.removeItem(LAST_TRIP_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function loadLastTrip(
  storage = browserStorage(),
): StoredTripV1 | undefined {
  const parsed = storedTripV1Schema.safeParse(
    safelyRead(LAST_TRIP_STORAGE_KEY, storage),
  );
  return parsed.success ? parsed.data : undefined;
}

export function saveLastTrip(
  trip: StoredTripV1,
  storage = browserStorage(),
): boolean {
  const parsed = storedTripV1Schema.safeParse(trip);
  return parsed.success
    ? safelyWrite(LAST_TRIP_STORAGE_KEY, parsed.data, storage)
    : false;
}
