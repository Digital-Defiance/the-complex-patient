/**
 * @complex-patient/ui — Minimal Zustand-compatible vanilla store
 *
 * The design specifies Zustand stores that mirror the decrypted Local_Vault
 * partitions (design.md → State Management). The `zustand` package is not
 * resolvable in this Yarn PnP workspace, so this module provides a tiny vanilla
 * store with the same public contract Zustand's `createStore` exposes
 * (`getState`, `setState`, `subscribe`, `getInitialState`). Swapping in the real
 * `zustand` later is a drop-in replacement: the {@link StoreApi} surface and the
 * `(set, get) => state` initializer signature match Zustand's vanilla API.
 *
 * Keeping the store abstraction behind this interface means the
 * {@link VaultStore} logic is framework-agnostic and fully testable under vitest
 * without React or native modules.
 */

/** Listener invoked on every state transition with the new and previous state. */
export type StateListener<T> = (state: T, previousState: T) => void;

/** Selector used by {@link StoreApi.subscribe} overloads to observe a slice. */
export type StateSelector<T, U> = (state: T) => U;

/**
 * The store API surface, structurally compatible with Zustand's vanilla store.
 */
export interface StoreApi<T> {
  /** Return the current state snapshot. */
  getState(): T;
  /** Return the state the store was initialized with. */
  getInitialState(): T;
  /**
   * Merge (or, with `replace`, overwrite) the state. Accepts a partial object or
   * an updater function of the current state, mirroring Zustand semantics.
   */
  setState(
    partial: Partial<T> | ((state: T) => Partial<T>),
    replace?: boolean,
  ): void;
  /** Subscribe to state transitions. Returns an unsubscribe function. */
  subscribe(listener: StateListener<T>): () => void;
}

/** Initializer receiving the `set`/`get` seams, mirroring Zustand. */
export type StateCreator<T> = (
  set: StoreApi<T>['setState'],
  get: StoreApi<T>['getState'],
  api: StoreApi<T>,
) => T;

/**
 * Create a vanilla store. Behaviorally equivalent to Zustand's `createStore`
 * for the features this codebase relies on: shallow-merge `setState`, snapshot
 * `getState`, and synchronous `subscribe` notification.
 */
export function createStore<T>(initializer: StateCreator<T>): StoreApi<T> {
  let state: T;
  const listeners = new Set<StateListener<T>>();

  const setState: StoreApi<T>['setState'] = (partial, replace) => {
    const nextPartial =
      typeof partial === 'function'
        ? (partial as (s: T) => Partial<T>)(state)
        : partial;

    // Skip notification when nothing changes (Object.is on the merged result).
    const nextState =
      replace === true
        ? (nextPartial as T)
        : Object.assign({}, state, nextPartial);

    if (Object.is(nextState, state)) {
      return;
    }

    const previousState = state;
    state = nextState;
    listeners.forEach((listener) => listener(state, previousState));
  };

  const getState: StoreApi<T>['getState'] = () => state;

  const getInitialState: StoreApi<T>['getInitialState'] = () => initialState;

  const subscribe: StoreApi<T>['subscribe'] = (listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const api: StoreApi<T> = { getState, getInitialState, setState, subscribe };

  state = initializer(setState, getState, api);
  const initialState = state;

  return api;
}
