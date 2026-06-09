/**
 * Unit tests for the navigation resolver (task 2.1).
 *
 * Validates that resolveRoute correctly maps NavState to AppRoute per the
 * status→route table in design.md.
 */
import { describe, it, expect } from 'vitest';
import { resolveRoute, type NavState } from './navigation';

describe('resolveRoute', () => {
  const base: NavState = {
    onboarding: 'checking',
    home: null,
    secureContextBlocked: false,
    compositionFailed: false,
  };

  describe('shell-level gates take priority', () => {
    it('returns secure-context-required when secureContextBlocked is true', () => {
      expect(resolveRoute({ ...base, secureContextBlocked: true })).toEqual({
        name: 'secure-context-required',
      });
    });

    it('returns composition-failed when compositionFailed is true', () => {
      expect(resolveRoute({ ...base, compositionFailed: true })).toEqual({
        name: 'composition-failed',
      });
    });

    it('secure-context-required takes priority over composition-failed', () => {
      expect(
        resolveRoute({ ...base, secureContextBlocked: true, compositionFailed: true }),
      ).toEqual({ name: 'secure-context-required' });
    });

    it('secure-context-required takes priority even when onboarding is eligible', () => {
      expect(
        resolveRoute({
          onboarding: 'eligible',
          home: 'ready',
          secureContextBlocked: true,
          compositionFailed: false,
        }),
      ).toEqual({ name: 'secure-context-required' });
    });
  });

  describe('onboarding statuses', () => {
    it('returns loading when onboarding is checking', () => {
      expect(resolveRoute({ ...base, onboarding: 'checking' })).toEqual({ name: 'loading' });
    });

    it('returns age-gate when onboarding is age-gate', () => {
      expect(resolveRoute({ ...base, onboarding: 'age-gate' })).toEqual({ name: 'age-gate' });
    });

    it('returns ineligible when onboarding is ineligible', () => {
      expect(resolveRoute({ ...base, onboarding: 'ineligible' })).toEqual({ name: 'ineligible' });
    });
  });

  describe('authenticated routes (onboarding = eligible)', () => {
    it('returns sign-in when home is signed-out', () => {
      expect(resolveRoute({ ...base, onboarding: 'eligible', home: 'signed-out' })).toEqual({
        name: 'sign-in',
      });
    });

    it('returns unlock when home is locked', () => {
      expect(resolveRoute({ ...base, onboarding: 'eligible', home: 'locked' })).toEqual({
        name: 'unlock',
      });
    });

    it('returns home when home is ready', () => {
      expect(resolveRoute({ ...base, onboarding: 'eligible', home: 'ready' })).toEqual({
        name: 'home',
      });
    });

    it('returns loading when home is null (createHome not yet resolved)', () => {
      expect(resolveRoute({ ...base, onboarding: 'eligible', home: null })).toEqual({
        name: 'loading',
      });
    });
  });

  describe('authenticated routes are gated by onboarding = eligible', () => {
    it('checking + home=ready still returns loading', () => {
      expect(resolveRoute({ ...base, onboarding: 'checking', home: 'ready' })).toEqual({
        name: 'loading',
      });
    });

    it('age-gate + home=ready still returns age-gate', () => {
      expect(resolveRoute({ ...base, onboarding: 'age-gate', home: 'ready' })).toEqual({
        name: 'age-gate',
      });
    });

    it('ineligible + home=ready still returns ineligible', () => {
      expect(resolveRoute({ ...base, onboarding: 'ineligible', home: 'ready' })).toEqual({
        name: 'ineligible',
      });
    });
  });
});
