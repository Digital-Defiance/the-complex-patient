/**
 * @complex-patient/crypto-engine — Runtime provider selection
 *
 * Selects the cryptographic backend based on the runtime environment.
 * The decision distinguishes the *runtime* (native vs browser), not the *device*:
 * a browser on iOS/Android still uses Web Crypto over HTTPS (Requirement 1.6).
 */

import type { RuntimeContext, ProviderDecision } from './types';

/**
 * Determine the correct crypto provider for the current runtime.
 *
 * Decision tree:
 * 1. Native runtime → expo-crypto (Requirement 1.5)
 * 2. Web, non-secure context → refuse SECURE_CONTEXT_REQUIRED (Requirement 1.8)
 * 3. Web + HTTPS + subtle available → web-subtle (Requirement 1.6)
 * 4. Ambiguous / uncertain → expo-crypto fallback (Requirement 1.7)
 */
export function selectProvider(ctx: RuntimeContext): ProviderDecision {
  // Native runtime (iOS/Android via React Native) → expo-crypto
  if (!ctx.isWeb) {
    return { provider: 'expo-crypto' };
  }

  // Web runtime, but served over non-secure context (HTTP) → refuse all crypto
  if (!ctx.isSecureContext) {
    return { refuse: 'SECURE_CONTEXT_REQUIRED' };
  }

  // Web + secure context + SubtleCrypto available → Web Crypto API
  if (ctx.hasSubtle) {
    return { provider: 'web-subtle' };
  }

  // Ambiguous or uncertain environment → fall back to expo-crypto
  return { provider: 'expo-crypto' };
}

/**
 * Detect the current runtime context.
 * Useful for production code that needs to auto-detect the environment.
 *
 * Uses `globalThis` and `typeof` checks to avoid hard DOM lib dependency,
 * allowing this module to compile under both Node (native) and browser targets.
 */
export function detectRuntimeContext(): RuntimeContext {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;

  const isWeb: boolean =
    typeof g.window !== 'undefined' && typeof g.document !== 'undefined';

  if (!isWeb) {
    return { isWeb: false, isSecureContext: false, hasSubtle: false };
  }

  const win = g.window;
  return {
    isWeb: true,
    isSecureContext: typeof win.isSecureContext === 'boolean' ? win.isSecureContext : false,
    hasSubtle: typeof win.crypto?.subtle !== 'undefined' && win.crypto?.subtle !== null,
  };
}
