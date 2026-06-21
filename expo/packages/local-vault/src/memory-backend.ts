/**
 * @complex-patient/local-vault — In-memory StorageBackend
 *
 * A reference {@link StorageBackend} backed by an in-process Map. It models the
 * atomic-commit contract of the production expo-sqlite / encrypted-MMKV backends
 * without requiring a native runtime, and is the backend used in tests.
 *
 * It still only ever receives the ciphertext envelope strings the Local_Vault
 * hands it, so it does not weaken the encrypted-at-rest guarantee
 * (Requirements 22.4, 5.1).
 */

import type { StorageBackend } from './types';

/**
 * Options controlling fault injection for the in-memory backend, primarily for
 * exercising the init/unlock-failure path (Requirement 22.5).
 */
export interface MemoryStorageBackendOptions {
  /** When true, {@link MemoryStorageBackend.open} rejects to simulate an unlock failure. */
  failOnOpen?: boolean;
  /** Seed entries present "at rest" before initialization. */
  seed?: Record<string, string>;
}

export class MemoryStorageBackend implements StorageBackend {
  private readonly store: Map<string, string>;
  private readonly failOnOpen: boolean;

  constructor(options: MemoryStorageBackendOptions = {}) {
    this.failOnOpen = options.failOnOpen ?? false;
    this.store = new Map<string, string>(
      options.seed ? Object.entries(options.seed) : [],
    );
  }

  async open(): Promise<void> {
    if (this.failOnOpen) {
      throw new Error('simulated storage unlock failure');
    }
  }

  async getItem(key: string): Promise<string | null> {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }

  async setItem(key: string, value: string): Promise<void> {
    // Map.set is a single synchronous commit — atomic from any reader's view.
    this.store.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.store.delete(key);
  }

  /**
   * Inspect the raw persisted entries. Test/diagnostic helper only — lets a
   * caller assert that only ciphertext envelopes were written at rest.
   */
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.store.entries());
  }
}
