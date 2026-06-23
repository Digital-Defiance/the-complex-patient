import { describe, it, expect, beforeEach } from 'vitest';
import { loadAuthFromSession, saveAuthToSession } from './auth-session-storage';

function createSessionStorageMock(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

describe('web auth session storage', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      value: createSessionStorageMock(),
    });
  });

  it('round-trips an application password credential', () => {
    saveAuthToSession({
      kind: 'application-password',
      username: 'patient',
      applicationPassword: 'abcd efgh',
    });

    expect(loadAuthFromSession()).toEqual({
      kind: 'application-password',
      username: 'patient',
      applicationPassword: 'abcd efgh',
    });
  });

  it('clears stored credentials on sign-out', () => {
    saveAuthToSession({ kind: 'jwt', token: 'jwt-token' });
    saveAuthToSession(null);
    expect(loadAuthFromSession()).toBeNull();
  });
});
