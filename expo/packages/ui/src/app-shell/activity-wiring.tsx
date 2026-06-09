/**
 * @complex-patient/ui — Activity, idle auto-lock, and lock-on-background wiring
 *
 * This module provides the `<ActivityResponder>` wrapper component and the
 * lifecycle hooks that wire the authenticated stack to the Home_Controller's
 * lock/idle bindings:
 *
 * 1. **Activity forwarding (Requirement 13.1):** Wraps children in a responder
 *    that captures touch/pointer/keyboard events and calls
 *    `home.notifyActivity()` to reset the 300s IdleAutoLock countdown.
 *
 * 2. **Lock-on-background, native (Requirement 13.3):** Attaches an AppState
 *    listener that triggers `home.lock.lock()` within 1s when the app enters
 *    the background.
 *
 * 3. **Lock-on-background, web (Requirement 13.4):** Attaches a
 *    `visibilitychange` listener that triggers `home.lock.lock()` when the tab
 *    becomes hidden.
 *
 * 4. **Lock reaction (Requirement 13.5):** When the controller transitions to
 *    `locked`, the parent (home layout) routes to `/auth/unlock`. Since all PHI
 *    reads go through `home.read(...)` and the store is cleared on lock, screens
 *    re-render with empty data — clearing PHI within 1s.
 *
 * 5. **Lock failure defense (Requirement 13.6):** If `lock()` rejects, the
 *    component still routes to unlock (defense in depth) so PHI screens unmount.
 *
 * The 300s IdleAutoLock timer is managed entirely by the controller — the shell
 * only needs to call `notifyActivity()` on interaction and react to the `locked`
 * status.
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6
 */

import React, { useEffect, useRef, useCallback } from 'react';
import { View, Platform, AppState, type AppStateStatus, StyleSheet } from 'react-native';
import type { HomeEntryController } from '../app/home-entry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActivityResponderProps {
  /** The home controller to wire activity/lock events to. */
  home: HomeEntryController;
  /** Called when the controller transitions to 'locked' (routes to unlock). */
  onLocked: () => void;
  /** Children rendered inside the activity responder. */
  children: React.ReactNode;
}

// ---------------------------------------------------------------------------
// ActivityResponder component
// ---------------------------------------------------------------------------

/**
 * Wraps the authenticated stack in a root responder that:
 * - Forwards touch/pointer/keyboard interactions to `home.notifyActivity()`
 * - Attaches platform lifecycle listeners (AppState / visibilitychange)
 * - Reacts to the `locked` status by calling `onLocked`
 *
 * The responder uses passive event capture: it does not intercept or consume
 * the events, only observes them for activity signaling.
 */
export function ActivityResponder({
  home,
  onLocked,
  children,
}: ActivityResponderProps): React.ReactElement {
  const onLockedRef = useRef(onLocked);
  onLockedRef.current = onLocked;

  // -------------------------------------------------------------------------
  // Activity forwarding (Requirement 13.1)
  // -------------------------------------------------------------------------

  const handleActivity = useCallback(() => {
    home.notifyActivity();
  }, [home]);

  // -------------------------------------------------------------------------
  // Lock-on-background lifecycle (Requirements 13.3, 13.4)
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (Platform.OS === 'web') {
      // Web: visibilitychange → hidden triggers lock (Requirement 13.4)
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'hidden') {
          // Fire and forget — on failure we still route to unlock (13.6)
          void home.lock.lock().catch(() => {
            // Defense in depth: even if lock() fails, route to unlock
            onLockedRef.current();
          });
        }
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);
      return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    } else {
      // Native: AppState background → lock within 1s (Requirement 13.3)
      const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
        if (nextState !== 'active') {
          // Fire and forget — on failure we still route to unlock (13.6)
          void home.lock.lock().catch(() => {
            // Defense in depth: even if lock() fails, route to unlock
            onLockedRef.current();
          });
        }
      });
      return () => {
        subscription.remove();
      };
    }
  }, [home]);

  // -------------------------------------------------------------------------
  // React to locked status (Requirements 13.2, 13.5)
  // -------------------------------------------------------------------------

  useEffect(() => {
    // Subscribe to the coordinator's syncStatus store — any state change
    // (including lock-triggered clears) notifies us. We then check home status.
    const unsubscribe = home.coordinator.syncStatus.subscribe(() => {
      if (home.getStatus() === 'locked') {
        onLockedRef.current();
      }
    });

    // Also check initial status in case we mounted while already locked.
    if (home.getStatus() === 'locked') {
      onLockedRef.current();
    }

    return unsubscribe;
  }, [home]);

  // -------------------------------------------------------------------------
  // Web keyboard/pointer listeners (Requirement 13.1)
  // -------------------------------------------------------------------------

  const viewRef = useRef<View>(null);

  useEffect(() => {
    if (Platform.OS === 'web') {
      // On web, add keyboard and pointer listeners to the document to capture
      // all interactions regardless of focus.
      const handler = () => home.notifyActivity();
      document.addEventListener('pointerdown', handler, { passive: true });
      document.addEventListener('keydown', handler, { passive: true });
      return () => {
        document.removeEventListener('pointerdown', handler);
        document.removeEventListener('keydown', handler);
      };
    }
    return undefined;
  }, [home]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <View
      ref={viewRef}
      style={styles.container}
      // Native: onTouchStart captures touch interactions (Requirement 13.1)
      onTouchStart={Platform.OS !== 'web' ? handleActivity : undefined}
      // onStartShouldSetResponder returns false so we don't steal the responder
      // from children — we only observe.
      onStartShouldSetResponder={() => false}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
