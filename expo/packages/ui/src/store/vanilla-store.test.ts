import { describe, it, expect } from 'vitest';
import { createStore } from './vanilla-store';

/**
 * Unit tests for the minimal Zustand-compatible vanilla store used by the
 * vault store (Task 15.1). Validates the subset of Zustand's contract relied on:
 * snapshot getState, shallow-merge setState (object + updater + replace), and
 * synchronous subscribe notification with unsubscribe.
 */
describe('createStore — Zustand-compatible vanilla store', () => {
  it('exposes the initial state via getState/getInitialState', () => {
    const store = createStore(() => ({ count: 0, label: 'a' }));
    expect(store.getState()).toEqual({ count: 0, label: 'a' });
    expect(store.getInitialState()).toEqual({ count: 0, label: 'a' });
  });

  it('shallow-merges a partial object on setState', () => {
    const store = createStore(() => ({ count: 0, label: 'a' }));
    store.setState({ count: 5 });
    expect(store.getState()).toEqual({ count: 5, label: 'a' });
  });

  it('supports an updater function form of setState', () => {
    const store = createStore(() => ({ count: 1 }));
    store.setState((s) => ({ count: s.count + 1 }));
    expect(store.getState().count).toBe(2);
  });

  it('replaces state wholesale when replace=true', () => {
    const store = createStore<{ count: number; label?: string }>(() => ({
      count: 0,
      label: 'a',
    }));
    store.setState({ count: 9 }, true);
    expect(store.getState()).toEqual({ count: 9 });
  });

  it('notifies subscribers with new and previous state, and unsubscribes', () => {
    const store = createStore(() => ({ count: 0 }));
    const seen: Array<[number, number]> = [];
    const unsub = store.subscribe((s, prev) => seen.push([s.count, prev.count]));

    store.setState({ count: 1 });
    store.setState({ count: 2 });
    unsub();
    store.setState({ count: 3 });

    expect(seen).toEqual([
      [1, 0],
      [2, 1],
    ]);
    expect(store.getState().count).toBe(3);
  });

  it('does not notify when the merged state is referentially identical (no-op)', () => {
    const store = createStore(() => ({ count: 0 }));
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });
    // Updater returning the same reference => Object.assign creates a new object,
    // so this still notifies; but a replace with the identical reference is a no-op.
    const current = store.getState();
    store.setState(current, true);
    expect(calls).toBe(0);
  });
});
