import { describe, it, expect } from 'vitest';
import { selectProvider, detectRuntimeContext } from './provider';
import type { RuntimeContext } from './types';

describe('selectProvider', () => {
  it('returns expo-crypto for native runtime (Requirement 1.5)', () => {
    const ctx: RuntimeContext = { isWeb: false, isSecureContext: false, hasSubtle: false };
    const result = selectProvider(ctx);
    expect(result).toEqual({ provider: 'expo-crypto' });
  });

  it('refuses with SECURE_CONTEXT_REQUIRED for non-secure web context (Requirement 1.8)', () => {
    const ctx: RuntimeContext = { isWeb: true, isSecureContext: false, hasSubtle: false };
    const result = selectProvider(ctx);
    expect(result).toEqual({ refuse: 'SECURE_CONTEXT_REQUIRED' });
  });

  it('refuses with SECURE_CONTEXT_REQUIRED even if subtle is available on non-secure context', () => {
    const ctx: RuntimeContext = { isWeb: true, isSecureContext: false, hasSubtle: true };
    const result = selectProvider(ctx);
    expect(result).toEqual({ refuse: 'SECURE_CONTEXT_REQUIRED' });
  });

  it('returns web-subtle for web + HTTPS + subtle available (Requirement 1.6)', () => {
    const ctx: RuntimeContext = { isWeb: true, isSecureContext: true, hasSubtle: true };
    const result = selectProvider(ctx);
    expect(result).toEqual({ provider: 'web-subtle' });
  });

  it('falls back to expo-crypto when web + HTTPS but no subtle (Requirement 1.7)', () => {
    const ctx: RuntimeContext = { isWeb: true, isSecureContext: true, hasSubtle: false };
    const result = selectProvider(ctx);
    expect(result).toEqual({ provider: 'expo-crypto' });
  });

  it('refusal result has no provider property (Requirement 1.8)', () => {
    const ctx: RuntimeContext = { isWeb: true, isSecureContext: false, hasSubtle: false };
    const result = selectProvider(ctx);
    expect('provider' in result).toBe(false);
    expect(result.refuse).toBe('SECURE_CONTEXT_REQUIRED');
  });

  it('provider results have no refuse property (Requirements 1.5, 1.6, 1.7)', () => {
    const nativeCtx: RuntimeContext = { isWeb: false, isSecureContext: false, hasSubtle: false };
    const webSubtleCtx: RuntimeContext = { isWeb: true, isSecureContext: true, hasSubtle: true };
    const fallbackCtx: RuntimeContext = { isWeb: true, isSecureContext: true, hasSubtle: false };

    const nativeResult = selectProvider(nativeCtx);
    const webResult = selectProvider(webSubtleCtx);
    const fallbackResult = selectProvider(fallbackCtx);

    expect('refuse' in nativeResult).toBe(false);
    expect('refuse' in webResult).toBe(false);
    expect('refuse' in fallbackResult).toBe(false);
  });
});

describe('detectRuntimeContext', () => {
  it('detects non-web (Node/native) environment', () => {
    // In a vitest/Node environment, there's no window/document
    const ctx = detectRuntimeContext();
    expect(ctx.isWeb).toBe(false);
    expect(ctx.isSecureContext).toBe(false);
    expect(ctx.hasSubtle).toBe(false);
  });
});
