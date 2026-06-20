/**
 * @complex-patient/local-vault — Key-value StorageBackend
 *
 * Persists encrypted vault blobs via an injected async key-value store
 * (localStorage, expo-file-system, SecureStore, etc.).
 */

import type { StorageBackend } from './types';

/** Minimal async key-value store contract. */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
}

export class KeyValueStorageBackend implements StorageBackend {
  constructor(private readonly store: KeyValueStore) {}

  async open(): Promise<void> {
    // No-op: the injected store is ready at construction time.
  }

  async getItem(key: string): Promise<string | null> {
    const value = await this.store.getItem(key);
    return value ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    await this.store.setItem(key, value);
  }
}
