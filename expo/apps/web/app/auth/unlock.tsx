/**
 * @complex-patient/web — Unlock route
 *
 * Expo Router route file that renders the shared UnlockScreen component WITHOUT
 * biometric support. On web, biometric unlock is not available — the user must
 * always enter their Master Passphrase to derive the KEK and unlock the vault.
 *
 * The `kdfStorage` prop receives `localStorage`-backed storage for the KDF
 * material (salt + params), kept outside the encrypted vault so it is available
 * before unlock.
 *
 * Requirements: 7.2, 7.3, 7.6, 7.8, 7.9
 */

import React from 'react';
import { UnlockScreen } from '@complex-patient/ui';
import { webFlagStorage } from '../../src/adapters';

export default function Unlock(): React.ReactElement {
  return (
    <UnlockScreen
      kdfStorage={webFlagStorage}
      biometricAvailable={false}
    />
  );
}
