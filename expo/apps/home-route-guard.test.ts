import { describe, expect, it } from 'vitest';
import { isWithinHomeArea } from './home-route-guard';

describe('isWithinHomeArea', () => {
  it('allows home root and subsystem routes', () => {
    expect(isWithinHomeArea('/')).toBe(true);
    expect(isWithinHomeArea('/(home)')).toBe(true);
    expect(isWithinHomeArea('/(home)/journal/log')).toBe(true);
    expect(isWithinHomeArea('/export')).toBe(true);
    expect(isWithinHomeArea('/(home)/import')).toBe(true);
    expect(isWithinHomeArea('/(home)/settings')).toBe(true);
    expect(isWithinHomeArea('/settings')).toBe(true);
  });

  it('blocks auth and onboarding routes', () => {
    expect(isWithinHomeArea('/auth/sign-in')).toBe(false);
    expect(isWithinHomeArea('/auth/unlock')).toBe(false);
    expect(isWithinHomeArea('/onboarding/age-gate')).toBe(false);
  });
});
