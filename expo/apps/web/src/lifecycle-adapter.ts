/**
 * Web platform `LifecycleAdapter` (Requirement 13.4).
 *
 * Registers `beforeunload` / `pagehide` listeners on `window` so that
 * {@link WebSessionKeyStore} can discard the KEK from volatile RAM when the tab
 * is closed or reloaded (Requirements 3.6, 13.4). This is the only place the
 * web shell touches the `window` lifecycle events, keeping the key store and
 * the rest of the shell injectable and testable.
 *
 * The fixed `WebSessionKeyStore` calls `onTabClose(handler)` with a handler that
 * clears the in-memory KEK; either browser event invokes that handler.
 */

import type { LifecycleAdapter } from '@complex-patient/key-store';

import { createWebTabLifecycleAdapter } from '../../web-lifecycle';

/**
 * Build the web tab-lifecycle adapter. Both `beforeunload` and `pagehide` are
 * registered because browsers fire them in different scenarios (navigation,
 * reload, tab close, and the bfcache `pagehide` path on mobile Safari), so the
 * KEK is discarded regardless of how the page goes away (Requirement 13.4).
 */
export function createWebLifecycleAdapter(): LifecycleAdapter {
  return createWebTabLifecycleAdapter();
}
