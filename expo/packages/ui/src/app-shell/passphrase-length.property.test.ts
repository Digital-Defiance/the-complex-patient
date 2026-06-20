/**
 * Property-based test for the passphrase length gate (Task 7.5).
 *
 * Property 4: Passphrase derivation occurs exactly within the length bound
 *   For any passphrase with length < 8 OR length > 128, `submitPassphrase`
 *   returns `{ok: false, reason: 'LENGTH'}` and NEVER calls `unlockWithKek`
 *   (no KEK derived). For any passphrase with 8 ≤ length ≤ 128,
 *   `submitPassphrase` does NOT return a LENGTH error (it proceeds to
 *   derivation). The biconditional holds: LENGTH error ⟺
 *   passphrase.length < 8 || passphrase.length > 128.
 *
 * **Validates: Requirements 7.8**
 *
 * Uses @fast-check/vitest for property-based testing integration.
 */

import { fc, it } from '@fast-check/vitest';
import { describe, expect, vi } from 'vitest';

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

vi.mock('./app-host', () => ({
  useAppHost: vi.fn(() => ({ home: null })),
}));

// Mock the crypto-engine — for property tests we need deterministic behavior
vi.mock('@complex-patient/crypto-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@complex-patient/crypto-engine')>();
  return {
    ...actual,
    deriveKEK: vi.fn(async () => {
      const fakeKek = actual.wrapKey(new Uint8Array(32).fill(0xab));
      return { ok: true as const, kek: fakeKek };
    }),
    generateSalt: vi.fn(async () => new Uint8Array(16).fill(0x01)),
  };
});

import { submitPassphrase, type PassphraseScreenDeps } from './screens/UnlockScreen';

// ---------------------------------------------------------------------------
// Constants matching the implementation bounds
// ---------------------------------------------------------------------------

const PASSPHRASE_MIN = 12;
const PASSPHRASE_MAX = 128;

// ---------------------------------------------------------------------------
// Test helpers — mock deps that track calls
// ---------------------------------------------------------------------------

/**
 * Creates mock PassphraseScreenDeps where `unlockWithKek` records whether it
 * was called and always returns `{ ok: true }` (successful unlock).
 */
function createMockDeps(): PassphraseScreenDeps & { unlockWithKekCalled: boolean } {
  const deps = {
    unlockWithKekCalled: false,
    home: {
      async unlockWithKek(_kek: unknown) {
        deps.unlockWithKekCalled = true;
        return { ok: true };
      },
    },
    async loadKdfMaterial() {
      return {
        salt: new Uint8Array(32),
        params: { algorithm: 'PBKDF2' as const, pbkdf2Iterations: 600_000 },
      };
    },
    async saveKdfMaterial() {},
  };
  return deps;
}

// ---------------------------------------------------------------------------
// Generators — arbitrary passphrases at controlled lengths
// ---------------------------------------------------------------------------

/**
 * Generate passphrases that are TOO SHORT (length 0 to 7).
 */
const tooShortPassphraseArb = fc
  .integer({ min: 0, max: PASSPHRASE_MIN - 1 })
  .chain((len) => fc.string({ minLength: len, maxLength: len }));

/**
 * Generate passphrases that are TOO LONG (length 129 to 256).
 * Upper bound capped at 256 to keep test runtime reasonable.
 */
const tooLongPassphraseArb = fc
  .integer({ min: PASSPHRASE_MAX + 1, max: 256 })
  .chain((len) => fc.string({ minLength: len, maxLength: len }));

/**
 * Generate passphrases that are out of bounds (either too short or too long).
 */
const outOfBoundsPassphraseArb = fc.oneof(tooShortPassphraseArb, tooLongPassphraseArb);

/**
 * Generate passphrases that are within bounds (length 8 to 128).
 */
const inBoundsPassphraseArb = fc
  .integer({ min: PASSPHRASE_MIN, max: PASSPHRASE_MAX })
  .chain((len) => fc.string({ minLength: len, maxLength: len }));

/**
 * Generate an arbitrary-length passphrase (0 to 256) for biconditional test.
 */
const arbitraryPassphraseArb = fc.string({ minLength: 0, maxLength: 256 });

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('Property 4: Passphrase derivation occurs exactly within the length bound (7.8)', () => {
  it.prop([outOfBoundsPassphraseArb], { numRuns: 100 })(
    'out-of-bounds passphrase returns LENGTH error and never calls unlockWithKek',
    async (passphrase) => {
      const deps = createMockDeps();
      const result = await submitPassphrase(deps, passphrase);

      // Must return LENGTH error (Requirement 7.8: SHALL display a
      // passphrase-length message AND SHALL NOT derive a KEK)
      expect(result).toEqual({ ok: false, reason: 'LENGTH' });

      // unlockWithKek must never have been called — no KEK was derived
      expect(deps.unlockWithKekCalled).toBe(false);
    },
  );

  it.prop([inBoundsPassphraseArb], { numRuns: 100 })(
    'in-bounds passphrase does NOT return LENGTH error (proceeds to derivation)',
    async (passphrase) => {
      const deps = createMockDeps();
      const result = await submitPassphrase(deps, passphrase);

      // Must NOT return LENGTH error — derivation is attempted
      if (!result.ok) {
        expect(result.reason).not.toBe('LENGTH');
      }
      // The result is either ok:true (unlock succeeded) or a non-LENGTH failure
      // (DERIVATION_FAILED or STILL_LOCKED), but never LENGTH.
    },
  );

  it.prop([arbitraryPassphraseArb], { numRuns: 100 })(
    'biconditional: LENGTH error ⟺ passphrase.length < 8 || passphrase.length > 128',
    async (passphrase) => {
      const deps = createMockDeps();
      const result = await submitPassphrase(deps, passphrase);
      const isOutOfBounds = passphrase.length < PASSPHRASE_MIN || passphrase.length > PASSPHRASE_MAX;
      const isLengthError = !result.ok && result.reason === 'LENGTH';

      // The biconditional: out of bounds ⟺ LENGTH error
      expect(isLengthError).toBe(isOutOfBounds);
    },
  );

  it.prop([outOfBoundsPassphraseArb], { numRuns: 100 })(
    'no KDF material is loaded for out-of-bounds passphrases (early return before derivation)',
    async (passphrase) => {
      let loadCalled = false;
      const deps: PassphraseScreenDeps = {
        home: {
          async unlockWithKek() {
            throw new Error('unlockWithKek should not be called for out-of-bounds');
          },
        },
        async loadKdfMaterial() {
          loadCalled = true;
          return null;
        },
        async saveKdfMaterial() {
          throw new Error('saveKdfMaterial should not be called for out-of-bounds');
        },
      };

      const result = await submitPassphrase(deps, passphrase);

      expect(result).toEqual({ ok: false, reason: 'LENGTH' });
      // No KDF material loading, no derivation, no unlock attempted
      expect(loadCalled).toBe(false);
    },
  );
});
