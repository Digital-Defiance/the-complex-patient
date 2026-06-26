import { vi } from 'vitest';

/** Expo / React Native globals required when expo-modules-core loads under vitest. */
(globalThis as typeof globalThis & { __DEV__?: boolean; expo?: { EventEmitter: new () => unknown } }).__DEV__ =
  true;
(globalThis as typeof globalThis & { expo?: { EventEmitter: new () => unknown } }).expo = {
  EventEmitter: class {
    addListener(): void {}
    removeListener(): void {}
    removeAllListeners(): void {}
    emit(): void {}
  },
};

vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 0,
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined),
}));
