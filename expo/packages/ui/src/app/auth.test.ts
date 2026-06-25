import { describe, it, expect } from 'vitest';
import {
  buildAuthorizationHeader,
  createAuthProvider,
  encodeBase64Utf8,
  type WordPressAuth,
} from './auth';

/**
 * Tests for the Sync_Backend credential model (Requirement 4.1): JWT bearer and
 * WordPress Application Password basic auth, plus the mutable session provider.
 */
describe('buildAuthorizationHeader (Requirement 4.1)', () => {
  it('builds a Bearer header for a JWT credential', () => {
    const auth: WordPressAuth = { kind: 'jwt', token: 'abc.def.ghi' };
    expect(buildAuthorizationHeader(auth)).toBe('Bearer abc.def.ghi');
  });

  it('builds a Basic header for an Application Password credential', () => {
    const auth: WordPressAuth = {
      kind: 'application-password',
      username: 'alice',
      applicationPassword: 'xxxx yyyy zzzz',
    };
    const expected = `Basic ${encodeBase64Utf8('alice:xxxxyyyyzzzz')}`;
    expect(buildAuthorizationHeader(auth)).toBe(expected);
  });

  it('round-trips the basic credential through base64', () => {
    const header = buildAuthorizationHeader({
      kind: 'application-password',
      username: 'bob',
      applicationPassword: 'secret',
    });
    const b64 = header.replace('Basic ', '');
    // Decode using atob-equivalent for assertion.
    const decoded = Buffer.from(b64, 'base64').toString('utf8');
    expect(decoded).toBe('bob:secret');
  });

  it('refuses an empty JWT token (never sent as valid, 4.3)', () => {
    expect(() => buildAuthorizationHeader({ kind: 'jwt', token: '' })).toThrow();
  });

  it('refuses an incomplete Application Password credential', () => {
    expect(() =>
      buildAuthorizationHeader({
        kind: 'application-password',
        username: '',
        applicationPassword: 'p',
      }),
    ).toThrow();
  });
});

describe('createAuthProvider', () => {
  it('starts signed out and records a credential on setAuth', () => {
    const provider = createAuthProvider();
    expect(provider.getAuth()).toBeNull();

    provider.setAuth({ kind: 'jwt', token: 't' });
    expect(provider.getAuth()).toEqual({ kind: 'jwt', token: 't' });
  });

  it('clears the credential on sign-out (Requirement 4.8)', () => {
    const provider = createAuthProvider({ kind: 'jwt', token: 't' });
    provider.setAuth(null);
    expect(provider.getAuth()).toBeNull();
  });
});

describe('encodeBase64Utf8', () => {
  it('encodes UTF-8 input identically to Buffer', () => {
    const input = 'user:pä$$wörd';
    expect(encodeBase64Utf8(input)).toBe(Buffer.from(input, 'utf8').toString('base64'));
  });
});
