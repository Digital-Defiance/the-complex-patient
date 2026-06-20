/**
 * Web tab lifecycle hooks for {@link WebSessionKeyStore}.
 *
 * Shared by the dedicated web app and mobile-on-web (Expo default router root).
 */

import type { LifecycleAdapter } from '@complex-patient/key-store';

export function createWebTabLifecycleAdapter(): LifecycleAdapter {
  return {
    onTabClose(handler: () => void): void {
      if (typeof window === 'undefined') {
        return;
      }
      window.addEventListener('beforeunload', handler);
      window.addEventListener('pagehide', handler);
    },
  };
}
