/**
 * @complex-patient/mobile — Age-gate route
 *
 * Expo Router route file that renders the shared AgeGateScreen component.
 * This screen is shown while the Onboarding_Controller status is `age-gate`.
 * It also handles the `checking` → `age-gate` transition (loading indicator)
 * and surfaces an error if `onboarding.start()` fails.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.9
 */

import React from 'react';
import { AgeGateScreen } from '@complex-patient/ui';

export default function AgeGate(): React.ReactElement {
  return <AgeGateScreen />;
}
