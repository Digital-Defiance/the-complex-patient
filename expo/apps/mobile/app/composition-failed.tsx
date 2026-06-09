/**
 * @complex-patient/mobile — /composition-failed route
 *
 * Expo Router route file rendering the CompositionFailedScreen. Displayed when
 * `createMobileApp` or `createHome` rejects for a reason other than a missing
 * secure context. This screen blocks all application functionality — no
 * onboarding, no authenticated content, no Local_Vault construction.
 *
 * Requirements: 3.8, 4.5
 */

import React from 'react';
import { CompositionFailedScreen } from '@complex-patient/ui';

export default function CompositionFailedRoute(): React.ReactElement {
  return <CompositionFailedScreen />;
}
