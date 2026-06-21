/**
 * KDF material cross-device resolution tests.
 */

import { describe, expect, it, vi } from 'vitest';
import type { KdfParams } from '@complex-patient/crypto-engine';
import { resolveKdfMaterial } from './kdf-material-sync';

const DEFAULT_PARAMS: KdfParams = { algorithm: 'PBKDF2', pbkdf2Iterations: 600_000 };

function material(byte: number) {
  return {
    salt: new Uint8Array(16).fill(byte),
    params: DEFAULT_PARAMS,
  };
}

describe('resolveKdfMaterial', () => {
  it('uses remote material when local is absent', async () => {
    const remote = material(0x02);
    const saveLocal = vi.fn(async () => {});

    const resolved = await resolveKdfMaterial({
      loadLocal: async () => null,
      saveLocal,
      fetchRemote: async () => remote,
    });

    expect(resolved).toEqual(remote);
    expect(saveLocal).toHaveBeenCalledWith(remote);
  });

  it('prefers remote when local salt differs', async () => {
    const remote = material(0x03);
    const saveLocal = vi.fn(async () => {});

    const resolved = await resolveKdfMaterial({
      loadLocal: async () => material(0x01),
      saveLocal,
      fetchRemote: async () => remote,
    });

    expect(resolved).toEqual(remote);
    expect(saveLocal).toHaveBeenCalledWith(remote);
  });

  it('keeps local salt when vault data exists on device and remote differs', async () => {
    const local = material(0x01);
    const remote = material(0x03);
    const saveLocal = vi.fn(async () => {});
    const publishRemote = vi.fn(async () => {});

    const resolved = await resolveKdfMaterial({
      loadLocal: async () => local,
      saveLocal,
      fetchRemote: async () => remote,
      publishRemote,
      hasExistingVaultData: async () => true,
    });

    expect(resolved).toEqual(local);
    expect(saveLocal).not.toHaveBeenCalled();
    expect(publishRemote).toHaveBeenCalledWith(local);
  });

  it('publishes local material when remote is absent', async () => {
    const local = material(0x04);
    const publishRemote = vi.fn(async () => {});

    const resolved = await resolveKdfMaterial({
      loadLocal: async () => local,
      saveLocal: async () => {},
      fetchRemote: async () => null,
      publishRemote,
    });

    expect(resolved).toEqual(local);
    expect(publishRemote).toHaveBeenCalledWith(local);
  });
});
