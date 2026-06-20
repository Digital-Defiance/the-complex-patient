/**
 * @complex-patient/mobile — Unlock route
 *
 * Uses expo-secure-store for KDF material and enables biometric unlock when
 * the device supports it and a KEK has been stored after a prior passphrase unlock.
 *
 * Requirements: 7.2, 7.3, 7.4, 7.6, 7.8, 7.9
 */

import React, { useEffect, useState } from 'react';
import { UnlockScreen } from '@complex-patient/ui';
import { nativeKdfStorage } from '../../src/adapters';
import { createExpoBiometricAdapter } from '../../src/adapters/native-key-store-adapters';

export default function Unlock(): React.ReactElement {
  const [biometricAvailable, setBiometricAvailable] = useState(false);

  useEffect(() => {
    void createExpoBiometricAdapter()
      .isAvailable()
      .then(setBiometricAvailable)
      .catch(() => setBiometricAvailable(false));
  }, []);

  return (
    <UnlockScreen
      kdfStorage={nativeKdfStorage}
      biometricAvailable={biometricAvailable}
    />
  );
}
