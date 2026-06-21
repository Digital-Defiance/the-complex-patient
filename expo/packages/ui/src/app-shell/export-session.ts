/**
 * Tracks active clinical export sessions so the shell can avoid interrupting them.
 */

let activeExportSessions = 0;

/** Mark the start of a clinical export; returns a cleanup function. */
export function beginExportSession(): () => void {
  activeExportSessions += 1;
  return () => {
    activeExportSessions = Math.max(0, activeExportSessions - 1);
  };
}

/** Whether a clinical export is currently running. */
export function isExportSessionActive(): boolean {
  return activeExportSessions > 0;
}
