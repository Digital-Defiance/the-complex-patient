/**
 * Platform vault storage resolution tests.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Platform: { OS: 'web' },
}));

describe('createPlatformVaultStorageBackend', () => {
  it('uses localStorage on web', async () => {
    const storage = {
      data: {} as Record<string, string>,
      getItem(key: string) {
        return this.data[key] ?? null;
      },
      setItem(key: string, value: string) {
        this.data[key] = value;
      },
    };

    vi.stubGlobal('window', { localStorage: storage });

    const { createPlatformVaultStorageBackend } = await import('./platform-vault-storage');
    const backend = await createPlatformVaultStorageBackend();
    await backend.open();
    await backend.setItem('cpv:partition:symptoms', '{"sync_version":1}');
    expect(await backend.getItem('cpv:partition:symptoms')).toBe('{"sync_version":1}');
  });
});
