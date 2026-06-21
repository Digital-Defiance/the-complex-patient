/**
 * Sync local medication reminders when the cabinet changes (native only).
 */

import React, { useEffect } from 'react';
import type { VaultRecord } from '@complex-patient/domain';
import { splitMedicationsPartition } from '@complex-patient/clinical-export';
import { useAppHost, usePartition } from '@complex-patient/ui';
import { syncMedicationNotifications } from './adapters/medication-notifications';

export function MedicationNotificationSync(): null {
  const { home } = useAppHost();
  if (!home) {
    return null;
  }
  return <MedicationNotificationSyncInner home={home} />;
}

function MedicationNotificationSyncInner({
  home,
}: {
  home: NonNullable<ReturnType<typeof useAppHost>['home']>;
}): null {
  const records = usePartition<VaultRecord>(home, 'medications');

  useEffect(() => {
    const { medications } = splitMedicationsPartition(records);
    void syncMedicationNotifications(medications);
  }, [records]);

  return null;
}
