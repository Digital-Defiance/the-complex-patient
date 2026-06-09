import { describe, it, expect, vi, afterEach } from 'vitest';
import { WebSessionKeyStore } from '@complex-patient/key-store';
import { wrapKey, type CryptoKeyRef } from '@complex-patient/crypto-engine';
import { createWebLifecycleAdapter } from './lifecycle-adapter';

/**
 * Web lifecycle adapter (task 3.3, Requirement 13.4): registers
 * `beforeunload`/`pagehide` handlers on `window` so the WebSessionKeyStore can
 * discard the KEK when the tab closes or reloads. The vitest node environment
 * has no `window`, so we install a minimal stub that records listeners.
 */

const g = globalThis as unknown as { window?: unknown };

function installWindowStub() {
  const listeners: Record<string, Array<() => void>> = {};
  const stub = {
    addEventListener: vi.fn((event: string, handler: () => void) => {
      (listeners[event] ??= []).push(handler);
    }),
    dispatch(event: string) {
      for (const h of listeners[event] ?? []) h();
    },
  };
  g.window = stub;
  return stub;
}

afterEach(() => {
  delete g.window;
  vi.restoreAllMocks();
});

describe('createWebLifecycleAdapter (Requirement 13.4)', () => {
  it('registers both beforeunload and pagehide listeners', () => {
    const stub = installWindowStub();
    const adapter = createWebLifecycleAdapter();
    const handler = vi.fn();

    adapter.onTabClose(handler);

    expect(stub.addEventListener).toHaveBeenCalledWith('beforeunload', handler);
    expect(stub.addEventListener).toHaveBeenCalledWith('pagehide', handler);
  });

  it('invokes the registered handler when either tab-close event fires', () => {
    const stub = installWindowStub();
    const adapter = createWebLifecycleAdapter();
    const handler = vi.fn();

    adapter.onTabClose(handler);

    stub.dispatch('beforeunload');
    expect(handler).toHaveBeenCalledTimes(1);

    stub.dispatch('pagehide');
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('lets WebSessionKeyStore discard the KEK on tab close (3.6 / 13.4)', async () => {
    const stub = installWindowStub();
    const keyStore = new WebSessionKeyStore({ lifecycle: createWebLifecycleAdapter() });
    const kek: CryptoKeyRef = wrapKey(new Uint8Array(32).fill(7));

    await keyStore.store(kek);
    expect(keyStore.isUnlocked()).toBe(true);

    // Simulate the tab closing/reloading.
    stub.dispatch('beforeunload');

    expect(keyStore.isUnlocked()).toBe(false);
  });
});
