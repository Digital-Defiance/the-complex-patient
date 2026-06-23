/**
 * Unit tests for the auth/unlock screen logic functions.
 *
 * Tests the exported `submitPassphrase` and `submitBiometric` pure functions
 * from UnlockScreen.tsx without any React rendering. These functions encapsulate
 * the core unlock logic and can be tested directly with mocked dependencies.
 *
 * Requirements validated:
 * - 7.3: KEK forwarded to unlockWithKek
 * - 7.4: Biometric wiring (calls home.unlock)
 * - 7.5: Biometric fallback on BIOMETRIC_FAILED / BIOMETRIC_LOCKED_OUT
 * - 7.9: Non-ready results preserve the locked state
 */

import { describe, it, expect, vi } from 'vitest';
import type { CryptoKeyRef, KdfParams } from '@complex-patient/crypto-engine';
import { wrapKey } from '@complex-patient/crypto-engine';

// ---------------------------------------------------------------------------
// Mock native modules that UnlockScreen.tsx imports transitively.
// The JSX runtime and React must be mocked because PnP cannot resolve
// react/jsx-dev-runtime in vitest's node environment.
// ---------------------------------------------------------------------------

vi.mock('react/jsx-dev-runtime', () => ({
  jsxDEV: vi.fn(),
  Fragment: Symbol('Fragment'),
}));

vi.mock('react/jsx-runtime', () => ({
  jsx: vi.fn(),
  jsxs: vi.fn(),
  Fragment: Symbol('Fragment'),
}));

vi.mock('react', () => ({
  default: { createElement: vi.fn() },
  createElement: vi.fn(),
  useState: vi.fn(() => ['', vi.fn()]),
  useCallback: vi.fn((fn: unknown) => fn),
}));

vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TextInput: 'TextInput',
  Pressable: 'Pressable',
  StyleSheet: { create: (s: unknown) => s },
  ActivityIndicator: 'ActivityIndicator',
}));

vi.mock('../app-host', () => ({
  useAppHost: vi.fn(() => ({ home: null })),
}));

// ---------------------------------------------------------------------------
// Mock the crypto-engine module — we don't want real KDF in unit tests
// ---------------------------------------------------------------------------

vi.mock('@complex-patient/crypto-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@complex-patient/crypto-engine')>();
  return {
    ...actual,
    deriveKEK: vi.fn(async (_passphrase: string, _salt: Uint8Array, _params: KdfParams) => {
      // Default: return a successful derivation with a fake KEK
      const fakeKek = actual.wrapKey(new Uint8Array(32).fill(0xab));
      return { ok: true as const, kek: fakeKek };
    }),
    generateSalt: vi.fn(async () => new Uint8Array(16).fill(0x01)),
  };
});

import { submitPassphrase, submitBiometric, type PassphraseScreenDeps } from './UnlockScreen';
import { deriveKEK, generateSalt } from '@complex-patient/crypto-engine';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockDeps(overrides?: {
  unlockResult?: { ok: boolean };
  kdfMaterial?: { salt: Uint8Array; params: KdfParams } | null;
}): PassphraseScreenDeps {
  const unlockWithKek = vi.fn(async (_kek: CryptoKeyRef) => {
    return overrides?.unlockResult ?? { ok: true };
  });

  return {
    home: {
      unlockWithKek,
      fetchRemoteKdfMaterial: vi.fn(async () => null),
      publishKdfMaterial: vi.fn(async () => {}),
      probeRemoteVaultDecrypt: vi.fn(async () => true),
    },
    loadKdfMaterial: vi.fn(async () => overrides?.kdfMaterial ?? null),
    saveKdfMaterial: vi.fn(async () => {}),
  };
}

// ---------------------------------------------------------------------------
// submitPassphrase tests
// ---------------------------------------------------------------------------

describe('submitPassphrase', () => {
  describe('Requirement 7.3: KEK forwarded to unlockWithKek', () => {
    it('calls unlockWithKek with the derived KEK when passphrase is valid length', async () => {
      const deps = createMockDeps({ unlockResult: { ok: true } });
      const passphrase = 'validpassphrase'; // 15 chars, within 12-128

      const result = await submitPassphrase(deps, passphrase);

      expect(result).toEqual({ ok: true });
      expect(deps.home.unlockWithKek).toHaveBeenCalledTimes(1);
      // The KEK passed should be a CryptoKeyRef (the one returned by deriveKEK mock)
      const kekArg = (deps.home.unlockWithKek as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(kekArg).toBeDefined();
      expect(kekArg._inner).toBeInstanceOf(Uint8Array);
    });

    it('does NOT call unlockWithKek when passphrase is too short', async () => {
      const deps = createMockDeps();
      const passphrase = 'short'; // 5 chars, below minimum 12

      const result = await submitPassphrase(deps, passphrase);

      expect(result).toEqual({ ok: false, reason: 'LENGTH' });
      expect(deps.home.unlockWithKek).not.toHaveBeenCalled();
    });

    it('does NOT call unlockWithKek when passphrase is too long', async () => {
      const deps = createMockDeps();
      const passphrase = 'a'.repeat(129); // 129 chars, above maximum 128

      const result = await submitPassphrase(deps, passphrase);

      expect(result).toEqual({ ok: false, reason: 'LENGTH' });
      expect(deps.home.unlockWithKek).not.toHaveBeenCalled();
    });

    it('calls unlockWithKek for exactly 12-character passphrase (boundary)', async () => {
      const deps = createMockDeps({ unlockResult: { ok: true } });
      const passphrase = 'abcdefgh1234'; // exactly 12 chars

      await submitPassphrase(deps, passphrase);

      expect(deps.home.unlockWithKek).toHaveBeenCalledTimes(1);
    });

    it('calls unlockWithKek for exactly 128-character passphrase (boundary)', async () => {
      const deps = createMockDeps({ unlockResult: { ok: true } });
      const passphrase = 'a'.repeat(128); // exactly 128 chars

      await submitPassphrase(deps, passphrase);

      expect(deps.home.unlockWithKek).toHaveBeenCalledTimes(1);
    });
  });

  describe('Requirement 7.9: Non-ready results preserve the locked state', () => {
    it('returns STILL_LOCKED when unlockWithKek returns { ok: false }', async () => {
      const deps = createMockDeps({ unlockResult: { ok: false } });
      const passphrase = 'validpass123';

      const result = await submitPassphrase(deps, passphrase);

      expect(result).toEqual({ ok: false, reason: 'STILL_LOCKED' });
    });

    it('returns ok: true when unlockWithKek returns { ok: true }', async () => {
      const deps = createMockDeps({ unlockResult: { ok: true } });
      const passphrase = 'validpass123';

      const result = await submitPassphrase(deps, passphrase);

      expect(result).toEqual({ ok: true });
    });
  });

  describe('KDF material management', () => {
    it('generates a new salt when no existing KDF material is found (first vault)', async () => {
      vi.mocked(generateSalt).mockClear();
      const deps = createMockDeps({ unlockResult: { ok: true }, kdfMaterial: null });
      const passphrase = 'validpass123';

      await submitPassphrase(deps, passphrase);

      expect(generateSalt).toHaveBeenCalledTimes(1);
      expect(deps.saveKdfMaterial).toHaveBeenCalledTimes(1);
    });

    it('uses existing KDF material when available (re-unlock)', async () => {
      vi.mocked(generateSalt).mockClear();
      vi.mocked(deriveKEK).mockClear();
      const existingMaterial = {
        salt: new Uint8Array(16).fill(0xcc),
        params: { algorithm: 'PBKDF2' as const, pbkdf2Iterations: 600_000 },
      };
      const deps = createMockDeps({ unlockResult: { ok: true }, kdfMaterial: existingMaterial });
      const passphrase = 'validpass123';

      await submitPassphrase(deps, passphrase);

      expect(generateSalt).not.toHaveBeenCalled();
      expect(deriveKEK).toHaveBeenCalledWith(passphrase, existingMaterial.salt, existingMaterial.params);
    });

    it('returns DERIVATION_FAILED when deriveKEK fails', async () => {
      // Override deriveKEK mock to return failure for this test
      vi.mocked(deriveKEK).mockResolvedValueOnce({
        ok: false,
        error: 'DERIVATION_FAILED',
      });

      const deps = createMockDeps();
      const passphrase = 'validpass123';

      const result = await submitPassphrase(deps, passphrase);

      expect(result).toEqual({ ok: false, reason: 'DERIVATION_FAILED' });
      expect(deps.home.unlockWithKek).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// submitBiometric tests
// ---------------------------------------------------------------------------

describe('submitBiometric', () => {
  describe('Requirement 7.4: Biometric wiring (calls home.unlock)', () => {
    it('calls home.unlock and returns { ok: true } on ready', async () => {
      const home = { unlock: vi.fn(async () => ({ ok: true })) };

      const result = await submitBiometric(home);

      expect(home.unlock).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ ok: true });
    });
  });

  describe('Requirement 7.5: Biometric fallback on BIOMETRIC_FAILED / BIOMETRIC_LOCKED_OUT', () => {
    it('returns FALLBACK on BIOMETRIC_FAILED', async () => {
      const home = { unlock: vi.fn(async () => ({ ok: false, reason: 'BIOMETRIC_FAILED' })) };

      const result = await submitBiometric(home);

      expect(result).toBe('FALLBACK');
    });

    it('returns FALLBACK on BIOMETRIC_LOCKED_OUT', async () => {
      const home = { unlock: vi.fn(async () => ({ ok: false, reason: 'BIOMETRIC_LOCKED_OUT' })) };

      const result = await submitBiometric(home);

      expect(result).toBe('FALLBACK');
    });
  });

  describe('Requirement 7.9: Non-ready results preserve the locked state', () => {
    it('returns { ok: false, reason: STILL_LOCKED } on other non-ready reason', async () => {
      const home = { unlock: vi.fn(async () => ({ ok: false, reason: 'UNKNOWN_ERROR' })) };

      const result = await submitBiometric(home);

      expect(result).toEqual({ ok: false, reason: 'STILL_LOCKED' });
    });

    it('returns { ok: false, reason: STILL_LOCKED } when no reason provided', async () => {
      const home = { unlock: vi.fn(async () => ({ ok: false })) };

      const result = await submitBiometric(home);

      expect(result).toEqual({ ok: false, reason: 'STILL_LOCKED' });
    });

    it('returns { ok: false, reason: STILL_LOCKED } on KEY_NOT_FOUND', async () => {
      const home = { unlock: vi.fn(async () => ({ ok: false, reason: 'KEY_NOT_FOUND' })) };

      const result = await submitBiometric(home);

      expect(result).toEqual({ ok: false, reason: 'STILL_LOCKED' });
    });
  });
});
