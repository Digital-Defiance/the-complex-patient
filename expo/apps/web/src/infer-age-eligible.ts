/**
 * Web-only helper: infer age eligibility from an existing Local_Vault on device.
 */

/** Returns true when localStorage contains persisted vault partition data. */
export function inferAgeEligibleFromWebVault(): Promise<boolean> {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return Promise.resolve(false);
  }

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith('cpv:partition:')) {
      return Promise.resolve(true);
    }
  }

  return Promise.resolve(false);
}
