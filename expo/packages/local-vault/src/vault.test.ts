import { describe, it, expect } from 'vitest';
import type { VaultType } from '@complex-patient/domain';
import {
  EncryptedLocalVault,
  createLocalVault,
  LocalVaultError,
  MemoryStorageBackend,
  type VaultBlob,
} from './index';

/**
 * Unit tests for the Local_Vault persistence layer.
 *
 * Coverage:
 * - Atomic write-before-confirm (Requirement 5.4)
 * - Read-back without network (Requirement 5.4)
 * - Encrypted-at-rest: only ciphertext envelope fields written (Requirements 22.4, 5.1)
 * - Init-failure handling: fail-closed, data unchanged (Requirements 22.5, 5.4)
 * - partition vs base namespace separation (Requirement 8.5)
 */

/** The four envelope fields that are the ONLY fields allowed at rest. */
const ENVELOPE_FIELDS = ['sync_version', 'iv', 'auth_tag', 'ciphertext'] as const;

/**
 * Build a valid ciphertext envelope. The fields are opaque Base64 strings here;
 * the vault never inspects them, it just persists the envelope.
 */
function makeBlob(overrides: Partial<VaultBlob> = {}): VaultBlob {
  return {
    sync_version: 1,
    iv: 'AAAAAAAAAAAAAAAA',
    auth_tag: 'AAAAAAAAAAAAAAAAAAAAAA==',
    ciphertext: 'Y2lwaGVydGV4dA==',
    ...overrides,
  };
}

describe('EncryptedLocalVault — initialization', () => {
  it('createLocalVault returns an initialized vault when backend opens', async () => {
    const backend = new MemoryStorageBackend();
    const vault = await createLocalVault(backend);
    // A read on an initialized empty vault returns null, not a throw.
    await expect(vault.readPartition('medications')).resolves.toBeNull();
  });

  it('blocks reads with VAULT_NOT_INITIALIZED before init() (Requirement 22.5)', async () => {
    const vault = new EncryptedLocalVault(new MemoryStorageBackend());
    await expect(vault.readPartition('medications')).rejects.toMatchObject({
      code: 'VAULT_NOT_INITIALIZED',
    });
  });

  it('blocks writes with VAULT_NOT_INITIALIZED before init() (Requirement 22.5)', async () => {
    const vault = new EncryptedLocalVault(new MemoryStorageBackend());
    await expect(
      vault.writePartition('medications', makeBlob()),
    ).rejects.toMatchObject({ code: 'VAULT_NOT_INITIALIZED' });
  });
});

describe('EncryptedLocalVault — atomic write-before-confirm (Requirement 5.4)', () => {
  it('persists a write durably before resolving, readable on next read', async () => {
    const backend = new MemoryStorageBackend();
    const vault = await createLocalVault(backend);
    const blob = makeBlob({ sync_version: 1 });

    await vault.writePartition('medications', blob);

    // Once the promise resolves the value is already committed at rest.
    expect(backend.snapshot()['cpv:partition:medications']).toBe(
      JSON.stringify(blob),
    );

    // ...and readable on the next read.
    await expect(vault.readPartition('medications')).resolves.toEqual(blob);
  });

  it('a later write overwrites the prior committed value', async () => {
    const backend = new MemoryStorageBackend();
    const vault = await createLocalVault(backend);

    await vault.writePartition('symptoms', makeBlob({ sync_version: 1 }));
    await vault.writePartition('symptoms', makeBlob({ sync_version: 2 }));

    const read = await vault.readPartition('symptoms');
    expect(read?.sync_version).toBe(2);
  });

  it('write resolves only after the value is observable (commit ordering)', async () => {
    const backend = new MemoryStorageBackend();
    const vault = await createLocalVault(backend);

    const writePromise = vault.writePartition(
      'conditions',
      makeBlob({ sync_version: 7 }),
    );
    await writePromise;
    // Immediately after await, the data must be present.
    const read = await vault.readPartition('conditions');
    expect(read).not.toBeNull();
    expect(read?.sync_version).toBe(7);
  });
});

describe('EncryptedLocalVault — read-back without network (Requirement 5.4)', () => {
  it('reads come purely from the local backend with no external calls', async () => {
    const calls: Array<{ method: string; key: string }> = [];
    // Wrap the in-memory backend to record exactly which calls are made,
    // proving reads only touch the local store.
    const inner = new MemoryStorageBackend();
    const recordingBackend = {
      async open() {
        calls.push({ method: 'open', key: '' });
        return inner.open();
      },
      async getItem(key: string) {
        calls.push({ method: 'getItem', key });
        return inner.getItem(key);
      },
      async setItem(key: string, value: string) {
        calls.push({ method: 'setItem', key });
        return inner.setItem(key, value);
      },
    };

    const vault = await createLocalVault(recordingBackend);
    await vault.writePartition('flares', makeBlob());
    const read = await vault.readPartition('flares');

    expect(read).not.toBeNull();
    // Only open/getItem/setItem against the local backend — nothing else.
    expect(calls.map((c) => c.method)).toEqual(['open', 'setItem', 'getItem']);
    expect(calls[2]).toEqual({ method: 'getItem', key: 'cpv:partition:flares' });
  });

  it('reading an absent partition returns null without writing', async () => {
    const backend = new MemoryStorageBackend();
    const vault = await createLocalVault(backend);

    await expect(vault.readPartition('associations')).resolves.toBeNull();
    expect(Object.keys(backend.snapshot())).toHaveLength(0);
  });
});

describe('EncryptedLocalVault — encrypted-at-rest (Requirements 22.4, 5.1)', () => {
  it('stores only the four ciphertext envelope fields at rest', async () => {
    const backend = new MemoryStorageBackend();
    const vault = await createLocalVault(backend);

    await vault.writePartition('medications', makeBlob());

    const stored = JSON.parse(backend.snapshot()['cpv:partition:medications']);
    expect(Object.keys(stored).sort()).toEqual([...ENVELOPE_FIELDS].sort());
  });

  it('strips any extra plaintext fields a caller attaches — no PHI at rest', async () => {
    const backend = new MemoryStorageBackend();
    const vault = await createLocalVault(backend);

    // A careless caller attaches plaintext PHI onto the blob object.
    const leakyBlob = {
      ...makeBlob(),
      patientName: 'Jane Doe',
      medication: 'Methotrexate 15mg weekly',
      records: [{ id: 'r1', dose: '15mg' }],
    } as unknown as VaultBlob;

    await vault.writePartition('medications', leakyBlob);

    const rawAtRest = backend.snapshot()['cpv:partition:medications'];
    // No plaintext PHI substring should ever appear in the persisted bytes.
    expect(rawAtRest).not.toContain('Jane Doe');
    expect(rawAtRest).not.toContain('Methotrexate');
    expect(rawAtRest).not.toContain('patientName');
    expect(rawAtRest).not.toContain('records');

    const stored = JSON.parse(rawAtRest);
    expect(Object.keys(stored).sort()).toEqual([...ENVELOPE_FIELDS].sort());
  });

  it('every persisted entry across the snapshot is a ciphertext envelope only', async () => {
    const backend = new MemoryStorageBackend();
    const vault = await createLocalVault(backend);

    await vault.writePartition('symptoms', makeBlob({ sync_version: 1 }));
    await vault.setBase('symptoms', makeBlob({ sync_version: 1 }));
    await vault.writePartition('flares', makeBlob({ sync_version: 3 }));

    for (const raw of Object.values(backend.snapshot())) {
      const stored = JSON.parse(raw);
      expect(Object.keys(stored).sort()).toEqual([...ENVELOPE_FIELDS].sort());
    }
  });
});

describe('EncryptedLocalVault — partition vs base namespace separation (Requirement 8.5)', () => {
  it('partition and base blobs for the same vault type are stored independently', async () => {
    const backend = new MemoryStorageBackend();
    const vault = await createLocalVault(backend);

    const partitionBlob = makeBlob({ sync_version: 5, ciphertext: 'cGFydA==' });
    const baseBlob = makeBlob({ sync_version: 2, ciphertext: 'YmFzZQ==' });

    await vault.writePartition('medications', partitionBlob);
    await vault.setBase('medications', baseBlob);

    await expect(vault.readPartition('medications')).resolves.toEqual(
      partitionBlob,
    );
    await expect(vault.readBase('medications')).resolves.toEqual(baseBlob);

    const snap = backend.snapshot();
    expect(snap['cpv:partition:medications']).toBeDefined();
    expect(snap['cpv:base:medications']).toBeDefined();
    expect(snap['cpv:partition:medications']).not.toBe(
      snap['cpv:base:medications'],
    );
  });

  it('different vault types do not collide', async () => {
    const backend = new MemoryStorageBackend();
    const vault = await createLocalVault(backend);

    await vault.writePartition('medications', makeBlob({ sync_version: 1 }));
    await vault.writePartition('symptoms', makeBlob({ sync_version: 9 }));

    expect((await vault.readPartition('medications'))?.sync_version).toBe(1);
    expect((await vault.readPartition('symptoms'))?.sync_version).toBe(9);
  });

  it('reading base for an absent type returns null even if partition exists', async () => {
    const backend = new MemoryStorageBackend();
    const vault = await createLocalVault(backend);

    await vault.writePartition('conditions', makeBlob());
    await expect(vault.readBase('conditions')).resolves.toBeNull();
  });
});

describe('EncryptedLocalVault — init-failure handling (Requirements 22.5, 5.4)', () => {
  it('init() throws LOCAL_STORAGE_INITIALIZATION_FAILED when the backend cannot open', async () => {
    const backend = new MemoryStorageBackend({ failOnOpen: true });
    const vault = new EncryptedLocalVault(backend);

    await expect(vault.init()).rejects.toBeInstanceOf(LocalVaultError);
    await expect(vault.init()).rejects.toMatchObject({
      code: 'LOCAL_STORAGE_INITIALIZATION_FAILED',
    });
  });

  it('createLocalVault rejects with LOCAL_STORAGE_INITIALIZATION_FAILED on open failure', async () => {
    const backend = new MemoryStorageBackend({ failOnOpen: true });
    await expect(createLocalVault(backend)).rejects.toMatchObject({
      code: 'LOCAL_STORAGE_INITIALIZATION_FAILED',
    });
  });

  it('blocks all access with VAULT_NOT_INITIALIZED after a failed init', async () => {
    const backend = new MemoryStorageBackend({ failOnOpen: true });
    const vault = new EncryptedLocalVault(backend);

    await expect(vault.init()).rejects.toMatchObject({
      code: 'LOCAL_STORAGE_INITIALIZATION_FAILED',
    });

    await expect(vault.readPartition('medications')).rejects.toMatchObject({
      code: 'VAULT_NOT_INITIALIZED',
    });
    await expect(
      vault.writePartition('medications', makeBlob()),
    ).rejects.toMatchObject({ code: 'VAULT_NOT_INITIALIZED' });
    await expect(vault.readBase('medications')).rejects.toMatchObject({
      code: 'VAULT_NOT_INITIALIZED',
    });
    await expect(
      vault.setBase('medications', makeBlob()),
    ).rejects.toMatchObject({ code: 'VAULT_NOT_INITIALIZED' });
  });

  it('leaves previously seeded encrypted data unchanged when init fails (Requirement 22.5)', async () => {
    const seededBlob = makeBlob({ sync_version: 4, ciphertext: 'c2VlZGVk' });
    const seed = {
      'cpv:partition:medications': JSON.stringify(seededBlob),
    };
    const backend = new MemoryStorageBackend({ failOnOpen: true, seed });
    const vault = new EncryptedLocalVault(backend);

    await expect(vault.init()).rejects.toMatchObject({
      code: 'LOCAL_STORAGE_INITIALIZATION_FAILED',
    });

    // The at-rest data is untouched by the failed init.
    expect(backend.snapshot()['cpv:partition:medications']).toBe(
      JSON.stringify(seededBlob),
    );
  });
});

describe('EncryptedLocalVault — write validation', () => {
  it('rejects a blob missing envelope fields and writes nothing', async () => {
    const backend = new MemoryStorageBackend();
    const vault = await createLocalVault(backend);

    const bad = { iv: 'x', auth_tag: 'y' } as unknown as VaultBlob;
    await expect(vault.writePartition('medications', bad)).rejects.toBeInstanceOf(
      TypeError,
    );
    expect(Object.keys(backend.snapshot())).toHaveLength(0);
  });

  it('rejects a blob with a non-integer/negative sync_version', async () => {
    const backend = new MemoryStorageBackend();
    const vault = await createLocalVault(backend);

    await expect(
      vault.writePartition('symptoms', makeBlob({ sync_version: -1 })),
    ).rejects.toBeInstanceOf(TypeError);
    await expect(
      vault.writePartition('symptoms', makeBlob({ sync_version: 1.5 })),
    ).rejects.toBeInstanceOf(TypeError);
  });
});
