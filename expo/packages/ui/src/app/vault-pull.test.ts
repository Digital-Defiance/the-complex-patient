/**
 * Remote vault pull tests.
 */

import { describe, expect, it, vi } from 'vitest';
import type { LocalVault } from '@complex-patient/local-vault';
import type { VaultHttpClient } from '@complex-patient/sync-engine';
import { pullRemoteVaultPartitions } from './vault-pull';

describe('pullRemoteVaultPartitions', () => {
  it('writes remote blob when local partition is empty', async () => {
    const writePartition = vi.fn(async () => {});
    const vault = {
      readPartition: vi.fn(async () => null),
      writePartition,
    } as unknown as LocalVault;

    const http: VaultHttpClient = {
      postVault: vi.fn(),
      getVault: vi.fn(async (vaultType) => ({
        status: 200,
        sync_version: 2,
        iv: 'iv',
        auth_tag: 'tag',
        ciphertext: 'cipher',
      })),
    };

    await pullRemoteVaultPartitions({ vault, http });

    expect(writePartition).toHaveBeenCalled();
    expect(writePartition.mock.calls[0]?.[0]).toBe('medications');
  });

  it('does not overwrite newer local blob', async () => {
    const writePartition = vi.fn(async () => {});
    const vault = {
      readPartition: vi.fn(async () => ({
        sync_version: 5,
        iv: 'local-iv',
        auth_tag: 'local-tag',
        ciphertext: 'local-cipher',
      })),
      writePartition,
    } as unknown as LocalVault;

    const http: VaultHttpClient = {
      postVault: vi.fn(),
      getVault: vi.fn(async () => ({
        status: 200,
        sync_version: 2,
        iv: 'remote-iv',
        auth_tag: 'remote-tag',
        ciphertext: 'remote-cipher',
      })),
    };

    await pullRemoteVaultPartitions({ vault, http });

    expect(writePartition).not.toHaveBeenCalled();
  });
});
