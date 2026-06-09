/**
 * @complex-patient/ui — ConnectivityContext
 *
 * Provides the current network connectivity state to the authenticated stack
 * tree. Child screens use `useConnectivity()` to conditionally disable
 * backend-only controls (e.g., manual sync triggers) while keeping all
 * Local_Vault reads/writes/navigation enabled.
 *
 * Requirements: 12.4, 14.5
 */

import React, { createContext, useContext } from 'react';

export interface ConnectivityState {
  /** Whether the Sync_Backend is currently unreachable. */
  isOffline: boolean;
}

const ConnectivityContext = createContext<ConnectivityState>({ isOffline: false });

/**
 * Access the connectivity state from any descendant of the authenticated stack.
 * Controls whose action requires a Sync_Backend response should be disabled
 * when `isOffline` is true (Requirement 14.5).
 */
export function useConnectivity(): ConnectivityState {
  return useContext(ConnectivityContext);
}

export interface ConnectivityProviderProps {
  isOffline: boolean;
  children: React.ReactNode;
}

/**
 * Provider mounted in the authenticated home layout. Wraps children with the
 * current connectivity state.
 */
export function ConnectivityProvider({ isOffline, children }: ConnectivityProviderProps): React.ReactElement {
  return (
    <ConnectivityContext.Provider value={{ isOffline }}>
      {children}
    </ConnectivityContext.Provider>
  );
}
