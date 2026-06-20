import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLocalStorageFlagStorage } from './device-flag-storage';

describe('createLocalStorageFlagStorage', () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips values through getItem/setItem', () => {
    const flagStorage = createLocalStorageFlagStorage();
    flagStorage.setItem('complex-patient.age-ineligible', 'true');
    expect(flagStorage.getItem('complex-patient.age-ineligible')).toBe('true');
  });
});
