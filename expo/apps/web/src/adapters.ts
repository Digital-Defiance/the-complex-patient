/**
 * @complex-patient/web — Web platform adapters
 *
 * Concrete implementations of the FIXED device-storage interface
 * (`@complex-patient/ui`). This module is the only place browser globals are
 * touched for storage, so the rest of the shell stays testable under vitest.
 */

import type { DeviceFlagStorage } from '@complex-patient/ui';

// ---------------------------------------------------------------------------
// Device ineligibility-flag storage (Requirement 14.3)
// ---------------------------------------------------------------------------

/**
 * Web backing store for the age-gate ineligibility flag, kept OUTSIDE the
 * encrypted Local_Vault so it is readable at launch without a KEK. Backed by
 * `localStorage`; its synchronous `getItem` / `setItem` satisfy the sync arm of
 * {@link DeviceFlagStorage}.
 */
export const webFlagStorage: DeviceFlagStorage = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => {
    window.localStorage.setItem(key, value);
  },
};
