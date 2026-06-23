/**
 * Persist WordPress sync credentials for the current browser tab session only.
 *
 * Auth lives in sessionStorage (cleared when the tab closes) so a reload within
 * the same tab does not drop sync while the vault remains on device. Credentials
 * are never written to the encrypted Local_Vault or sent anywhere except the
 * Sync_Backend Authorization header.
 */

import type { WordPressAuth } from '@complex-patient/ui';

const SESSION_KEY = 'complex-patient.wp-auth';

function readSessionStorage(): Storage | null {
  if (typeof globalThis.sessionStorage === 'undefined') {
    return null;
  }
  return globalThis.sessionStorage;
}

function parseStoredAuth(raw: string): WordPressAuth | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    if (record.kind === 'jwt' && typeof record.token === 'string' && record.token.length > 0) {
      return { kind: 'jwt', token: record.token };
    }
    if (
      record.kind === 'application-password' &&
      typeof record.username === 'string' &&
      record.username.length > 0 &&
      typeof record.applicationPassword === 'string' &&
      record.applicationPassword.length > 0
    ) {
      return {
        kind: 'application-password',
        username: record.username,
        applicationPassword: record.applicationPassword,
      };
    }
  } catch {
    return null;
  }
  return null;
}

/** Restore a credential saved for this tab session, if any. */
export function loadAuthFromSession(): WordPressAuth | null {
  const storage = readSessionStorage();
  if (storage === null) {
    return null;
  }
  const raw = storage.getItem(SESSION_KEY);
  if (raw === null || raw === '') {
    return null;
  }
  return parseStoredAuth(raw);
}

/** Persist or clear the tab-session credential. */
export function saveAuthToSession(auth: WordPressAuth | null): void {
  const storage = readSessionStorage();
  if (storage === null) {
    return;
  }
  if (auth === null) {
    storage.removeItem(SESSION_KEY);
    return;
  }
  storage.setItem(SESSION_KEY, JSON.stringify(auth));
}
