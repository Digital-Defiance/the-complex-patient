/**
 * @complex-patient/web — Unlock route
 *
 * Expo Router route file that renders the shared UnlockScreen component.
 * Passkey availability is detected from the home controller at runtime.
 */

import React from 'react';
import { UnlockScreen } from '@complex-patient/ui';
import { webFlagStorage } from '../../src/adapters';
import { inferAgeEligibleFromWebVault } from '../../src/infer-age-eligible';

export default function Unlock(): React.ReactElement {
  return (
    <UnlockScreen
      kdfStorage={webFlagStorage}
      hasExistingVaultData={inferAgeEligibleFromWebVault}
    />
  );
}
