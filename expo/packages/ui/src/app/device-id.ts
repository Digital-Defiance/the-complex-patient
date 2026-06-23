/**
 * Stable per-install device identifier for push registration and fan-out exclusion.
 */

export const DEVICE_ID_STORAGE_KEY = 'complex-patient.device-id';

export interface DeviceIdStorage {
  getDeviceId(): Promise<string | null>;
  setDeviceId(deviceId: string): Promise<void>;
}

function createRandomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `device-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Return a persisted device id, creating one when absent. */
export async function getOrCreateDeviceId(storage: DeviceIdStorage): Promise<string> {
  const existing = await storage.getDeviceId();
  if (existing !== null && existing !== '') {
    return existing;
  }

  const deviceId = createRandomId();
  await storage.setDeviceId(deviceId);
  return deviceId;
}

/** Adapt platform key-value storage into {@link DeviceIdStorage}. */
export function createDeviceIdStorage(storage: {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
}): DeviceIdStorage {
  return {
    async getDeviceId(): Promise<string | null> {
      const value = await storage.getItem(DEVICE_ID_STORAGE_KEY);
      return value ?? null;
    },
    async setDeviceId(deviceId: string): Promise<void> {
      await storage.setItem(DEVICE_ID_STORAGE_KEY, deviceId);
    },
  };
}
