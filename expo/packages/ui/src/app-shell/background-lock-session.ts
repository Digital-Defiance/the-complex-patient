/**
 * Temporarily suppress lock-on-background while a system dialog is showing
 * (permissions, biometrics, etc.) so Android does not treat the overlay as a
 * background transition and immediately re-lock the vault.
 */

let suspendedBackgroundLocks = 0;

/** Pause background auto-lock until the returned cleanup runs. */
export function suspendBackgroundLock(): () => void {
  suspendedBackgroundLocks += 1;
  return () => {
    suspendedBackgroundLocks = Math.max(0, suspendedBackgroundLocks - 1);
  };
}

/** Whether background auto-lock should be skipped right now. */
export function isBackgroundLockSuspended(): boolean {
  return suspendedBackgroundLocks > 0;
}
