/**
 * @complex-patient/mobile — /secure-context-required route
 *
 * Expo Router route file rendering the SecureContextRequiredScreen. On native
 * this route is unlikely to be reached (secure-context is always available on
 * native), but is included for completeness and defensive consistency with the
 * shared route mapping.
 *
 * This screen blocks all application functionality — no onboarding, no
 * authenticated content, no Local_Vault construction.
 *
 * Requirements: 4.2, 4.4
 */

import React from 'react';
import { SecureContextRequiredScreen } from '@complex-patient/ui/screens';

export default function SecureContextRequiredRoute(): React.ReactElement {
  return <SecureContextRequiredScreen />;
}
