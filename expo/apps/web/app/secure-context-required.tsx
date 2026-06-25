/**
 * @complex-patient/web — /secure-context-required route
 *
 * Expo Router route file rendering the SecureContextRequiredScreen. On web this
 * route is reached when `createHome()` throws `SecureContextRequiredError`
 * because `window.crypto.subtle` is not available (the page is served over
 * plain HTTP).
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
