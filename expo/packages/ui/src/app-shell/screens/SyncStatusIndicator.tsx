/**
 * @complex-patient/ui — SyncStatusIndicator
 *
 * A header-mounted indicator showing the aggregate sync status across all PHI
 * partitions. Renders a pairwise-distinct visual state for each possible
 * PartitionSyncStatus value (idle, syncing, pending, conflict). Updates within
 * one React commit of a coordinator state change (≪ 1s budget).
 *
 * The component also monitors network connectivity (native: AppState/fetch probe
 * or web: navigator.onLine + online/offline events) and calls
 * `home.onConnectivityRestored()` within 5 seconds of detecting restored
 * connectivity. While the backend is unreachable, backend-only controls are
 * disabled but Local_Vault reads/writes/navigation remain fully functional.
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 14.5
 */

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { useAppHost } from '../app-host';
import { useStore } from '../hooks';
import type { VaultType } from '@complex-patient/domain';
import type { PartitionSyncStatus, SyncStatusState } from '../../store/offline-sync';
import { PHI_VAULT_TYPES } from '../../store/types';

// ---------------------------------------------------------------------------
// Aggregate status derivation
// ---------------------------------------------------------------------------

/**
 * Derive the single "worst" status across all partitions.
 * Priority: conflict > pending > syncing > idle
 */
export function aggregateSyncStatus(state: SyncStatusState): PartitionSyncStatus {
  let worst: PartitionSyncStatus = 'idle';
  for (const vaultType of PHI_VAULT_TYPES) {
    const s = state.partitions[vaultType];
    if (s === 'conflict') return 'conflict'; // highest priority — short-circuit
    if (s === 'pending' && worst !== 'conflict') worst = 'pending';
    if (s === 'syncing' && worst === 'idle') worst = 'syncing';
  }
  return worst;
}

/** List vault partitions currently in a given sync status (for UI detail). */
export function partitionsWithStatus(
  state: SyncStatusState,
  status: PartitionSyncStatus,
): VaultType[] {
  return PHI_VAULT_TYPES.filter((vaultType) => state.partitions[vaultType] === status);
}

function formatStatusLabel(
  status: PartitionSyncStatus,
  syncState: SyncStatusState,
): string {
  const base = STATUS_VISUALS[status].label;
  if (status === 'conflict' || status === 'pending') {
    const affected = partitionsWithStatus(syncState, status);
    if (affected.length > 0) {
      return `${base} (${affected.join(', ')})`;
    }
  }
  return base;
}

// ---------------------------------------------------------------------------
// Visual config — pairwise-distinct states
// ---------------------------------------------------------------------------

interface StatusVisual {
  color: string;
  label: string;
  icon: string; // single-char emoji for simplicity; can be swapped for SVG
}

export const STATUS_VISUALS: Record<PartitionSyncStatus, StatusVisual> = {
  idle: { color: '#4caf50', label: 'Synced', icon: '✓' },
  syncing: { color: '#2196f3', label: 'Syncing', icon: '↻' },
  pending: { color: '#ff9800', label: 'Pending', icon: '◷' },
  conflict: { color: '#f44336', label: 'Conflict', icon: '⚠' },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface SyncStatusIndicatorProps {
  /** Whether the network is currently unreachable (disables backend-only controls). */
  isOffline?: boolean;
}

export function SyncStatusIndicator({ isOffline }: SyncStatusIndicatorProps): React.ReactElement {
  const { home } = useAppHost();

  // If home is null (shouldn't happen in authenticated stack), render nothing visible.
  if (!home) {
    return <View testID="sync-status-indicator" />;
  }

  // Subscribe to the coordinator syncStatus store for the aggregate status.
  const syncState = useStore(home.coordinator.syncStatus, (s) => s);
  const status = aggregateSyncStatus(syncState);
  const visual = STATUS_VISUALS[status];
  const label = formatStatusLabel(status, syncState);

  return (
    <View
      style={styles.container}
      testID="sync-status-indicator"
      accessibilityRole="none"
      accessibilityLabel={`Sync status: ${label}${isOffline ? ', offline' : ''}`}
    >
      <View style={[styles.dot, { backgroundColor: visual.color }]}>
        <Text style={styles.icon}>{visual.icon}</Text>
      </View>
      <Text
        style={[styles.label, { color: visual.color }]}
        testID="sync-status-label"
      >
        {label}
      </Text>
      {isOffline && (
        <Text style={styles.offlineBadge} testID="sync-status-offline">
          Offline
        </Text>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// useConnectivityWatcher hook
// ---------------------------------------------------------------------------

/**
 * Monitors network connectivity and calls `home.onConnectivityRestored()`
 * within 5 seconds of detecting restored connectivity. Returns the current
 * offline state so the layout can disable backend-only controls.
 *
 * On web: uses navigator.onLine + online/offline events.
 * On native: uses a periodic reachability check (AppState + fetch probe).
 *
 * Requirements: 12.4, 14.5
 */
export function useConnectivityWatcher(): { isOffline: boolean } {
  const { home } = useAppHost();
  const [isOffline, setIsOffline] = useState(false);
  const wasOfflineRef = useRef(false);

  useEffect(() => {
    if (!home) return;

    let cleanup: (() => void) | undefined;

    if (Platform.OS === 'web') {
      // Web: navigator.onLine + online/offline events
      const updateOnline = () => {
        const online = navigator.onLine;
        setIsOffline(!online);
        if (online && wasOfflineRef.current) {
          // Connectivity restored — call within 5s (typically immediate)
          home.onConnectivityRestored();
        }
        wasOfflineRef.current = !online;
      };

      // Initialize
      setIsOffline(!navigator.onLine);
      wasOfflineRef.current = !navigator.onLine;

      window.addEventListener('online', updateOnline);
      window.addEventListener('offline', updateOnline);

      cleanup = () => {
        window.removeEventListener('online', updateOnline);
        window.removeEventListener('offline', updateOnline);
      };
    } else {
      // Native: use a periodic connectivity probe via fetch.
      // React Native doesn't have navigator.onLine, so we check reachability
      // by attempting a HEAD request to a known endpoint.
      // We also listen to AppState changes to trigger a check when app resumes.
      const { AppState } = require('react-native');

      let intervalId: ReturnType<typeof setInterval> | null = null;
      let appStateSubscription: { remove: () => void } | null = null;

      const checkConnectivity = async () => {
        try {
          // Attempt a lightweight fetch to the configured endpoint.
          // Use a short timeout to avoid blocking.
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 3000);
          await fetch('https://clients3.google.com/generate_204', {
            method: 'HEAD',
            signal: controller.signal,
          });
          clearTimeout(timeout);

          // We're online
          if (wasOfflineRef.current) {
            home.onConnectivityRestored();
          }
          setIsOffline(false);
          wasOfflineRef.current = false;
        } catch {
          setIsOffline(true);
          wasOfflineRef.current = true;
        }
      };

      // Check connectivity every 5 seconds (within the 5s budget)
      intervalId = setInterval(checkConnectivity, 5000);

      // Also check when app state changes to active
      appStateSubscription = AppState.addEventListener(
        'change',
        (nextState: string) => {
          if (nextState === 'active') {
            void checkConnectivity();
          }
        },
      );

      // Initial check
      void checkConnectivity();

      cleanup = () => {
        if (intervalId) clearInterval(intervalId);
        if (appStateSubscription) appStateSubscription.remove();
      };
    }

    return cleanup;
  }, [home]);

  return { isOffline };
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 6,
  },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '700',
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
  },
  offlineBadge: {
    fontSize: 11,
    fontWeight: '600',
    color: '#f44336',
    backgroundColor: '#fde0dc',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
});
