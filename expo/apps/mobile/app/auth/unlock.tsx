/**
 * @complex-patient/mobile — Unlock route (native)
 *
 * Expo Router route file that renders the shared UnlockScreen component with
 * biometric unlock support enabled. On native, the biometric path calls
 * `home.unlock()` which gates KEK release behind the device biometric challenge
 * (expo-local-authentication). On BIOMETRIC_FAILED / BIOMETRIC_LOCKED_OUT, the
 * screen falls back to passphrase re-entry (Requirement 7.5).
 *
 * The `kdfStorage` prop receives the native flag storage backed by
 * `expo-secure-store` — the same non-secret storage used for the ineligibility
 * flag. This persists KDF material (salt + params) outside the vault so it is
 * available before unlock.
 *
 * Requirements: 7.2, 7.3, 7.4, 7.5, 7.6, 7.8, 7.9
 */

import React from 'react';
import { UnlockScreen } from '@complex-patient/ui';
import { nativeFlagStorage } from '../../src/adapters';

export default function Unlock(): React.ReactElement {
  return (
    <UnlockScreen
      kdfStorage={nativeFlagStorage}
      biometricAvailable={true}
    />
  );
}
