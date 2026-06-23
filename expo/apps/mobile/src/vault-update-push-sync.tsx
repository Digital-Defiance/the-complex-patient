/**
 * Register for vault-update push notifications when the vault is unlocked.
 */

import React, { useEffect, useRef } from 'react';
import { useAppHost } from '@complex-patient/ui';
import {
  startVaultUpdatePushSession,
  type VaultUpdatePushSession,
} from './adapters/vault-update-push';

export function VaultUpdatePushSync(): null {
  const { home } = useAppHost();
  if (!home) {
    return null;
  }
  return <VaultUpdatePushSyncInner home={home} />;
}

function VaultUpdatePushSyncInner({
  home,
}: {
  home: NonNullable<ReturnType<typeof useAppHost>['home']>;
}): null {
  const sessionRef = useRef<VaultUpdatePushSession | null>(null);
  const startingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const stopSession = () => {
      sessionRef.current?.dispose();
      sessionRef.current = null;
    };

    const start = async () => {
      if (cancelled || home.getStatus() !== 'ready' || startingRef.current) {
        return;
      }

      startingRef.current = true;
      stopSession();

      try {
        const session = await startVaultUpdatePushSession(home);
        if (cancelled) {
          session?.dispose();
          return;
        }
        sessionRef.current = session;
      } finally {
        startingRef.current = false;
      }
    };

    void start();

    const unsubscribe = home.subscribeStatus((status) => {
      if (status === 'ready') {
        void start();
        return;
      }
      stopSession();
    });

    return () => {
      cancelled = true;
      unsubscribe();
      stopSession();
    };
  }, [home]);

  return null;
}
