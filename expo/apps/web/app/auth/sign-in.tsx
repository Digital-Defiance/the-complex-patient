/**
 * @complex-patient/web — Sign-in route
 *
 * Expo Router route file that renders the shared SignInScreen component.
 * This screen is shown while the Home_Controller status is `signed-out`.
 *
 * Requirements: 7.1, 8.2
 */

import React from 'react';
import { SignInScreen } from '@complex-patient/ui/screens';

export default function SignIn(): React.ReactElement {
  return <SignInScreen />;
}
