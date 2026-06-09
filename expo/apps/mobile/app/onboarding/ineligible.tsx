/**
 * @complex-patient/mobile — /onboarding/ineligible route
 *
 * Expo Router route file rendering the IneligibleScreen. Displayed when the
 * Onboarding_Controller status is `ineligible` (including when `start()` reports
 * `ineligible` directly). This is a terminal screen — there is no control that
 * returns the user to the age-gate.
 *
 * The IneligibleScreen includes an error boundary that falls back to rendering
 * the age-gate screen if the ineligibility screen fails to render (Req 6.4).
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4
 */

import React from 'react';
import { IneligibleScreen } from '@complex-patient/ui';

export default function IneligibleRoute(): React.ReactElement {
  return <IneligibleScreen />;
}
