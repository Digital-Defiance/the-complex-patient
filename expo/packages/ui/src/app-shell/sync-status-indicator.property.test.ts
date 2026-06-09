/**
 * Property-based test for the sync-status indicator mapping (Task 8.6).
 *
 * Property 9: Sync-status indicator is a total, injective mapping
 *   For any PartitionSyncStatus (idle, syncing, pending, conflict), the indicator
 *   renders the mapped visual state; the four mapped states are pairwise distinct;
 *   and `pending` and `syncing` both render a non-idle in-progress state.
 *
 * **Validates: Requirements 12.1, 12.2, 12.3**
 *
 * Uses @fast-check/vitest for property-based testing integration.
 */

import { fc, it } from '@fast-check/vitest';
import { describe, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock native modules that SyncStatusIndicator.tsx imports transitively.
// ---------------------------------------------------------------------------

vi.mock('react/jsx-dev-runtime', () => ({
  jsxDEV: vi.fn(),
  Fragment: Symbol('Fragment'),
}));

vi.mock('react/jsx-runtime', () => ({
  jsx: vi.fn(),
  jsxs: vi.fn(),
  Fragment: Symbol('Fragment'),
}));

vi.mock('react', () => ({
  default: { createElement: vi.fn() },
  createElement: vi.fn(),
  createContext: vi.fn(() => ({ Provider: 'Provider', Consumer: 'Consumer' })),
  useState: vi.fn(() => [false, vi.fn()]),
  useEffect: vi.fn(),
  useRef: vi.fn(() => ({ current: false })),
  useContext: vi.fn(() => null),
  useCallback: vi.fn((fn: unknown) => fn),
  useMemo: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  StyleSheet: { create: (s: unknown) => s },
  Platform: { OS: 'web' },
}));

vi.mock('../app-host', () => ({
  useAppHost: vi.fn(() => ({ home: null })),
}));

vi.mock('../hooks', () => ({
  useStore: vi.fn(() => ({ partitions: {} })),
}));

import {
  aggregateSyncStatus,
  STATUS_VISUALS,
} from './screens/SyncStatusIndicator';
import type { PartitionSyncStatus, SyncStatusState } from '../store/offline-sync';
import { PHI_VAULT_TYPES } from '../store/types';
import type { VaultType } from '@complex-patient/domain';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** All valid PartitionSyncStatus values. */
const ALL_STATUSES: readonly PartitionSyncStatus[] = [
  'idle',
  'syncing',
  'pending',
  'conflict',
] as const;

const partitionSyncStatusArb: fc.Arbitrary<PartitionSyncStatus> = fc.constantFrom(
  ...ALL_STATUSES,
);

/**
 * Generate a valid SyncStatusState by assigning an arbitrary PartitionSyncStatus
 * to each PHI vault type partition.
 */
const syncStatusStateArb: fc.Arbitrary<SyncStatusState> = fc
  .tuple(...PHI_VAULT_TYPES.map(() => partitionSyncStatusArb))
  .map((statuses) => {
    const partitions = {} as Record<VaultType, PartitionSyncStatus>;
    PHI_VAULT_TYPES.forEach((vt, i) => {
      partitions[vt] = statuses[i];
    });
    return { partitions };
  });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Property 9: Sync-status indicator is a total, injective mapping (12.1, 12.2, 12.3)', () => {
  it.prop([partitionSyncStatusArb], { numRuns: 100 })(
    'total: every PartitionSyncStatus has a visual mapping in STATUS_VISUALS',
    (status) => {
      const visual = STATUS_VISUALS[status];
      expect(visual).toBeDefined();
      expect(visual).toHaveProperty('color');
      expect(visual).toHaveProperty('label');
      expect(visual).toHaveProperty('icon');
      expect(typeof visual.color).toBe('string');
      expect(visual.color.length).toBeGreaterThan(0);
      expect(typeof visual.label).toBe('string');
      expect(visual.label.length).toBeGreaterThan(0);
    },
  );

  it.prop([partitionSyncStatusArb], { numRuns: 100 })(
    'injective: each status maps to a distinct color (pairwise distinct visuals)',
    (status) => {
      // Collect all colors mapped by the 4 statuses
      const colors = ALL_STATUSES.map((s) => STATUS_VISUALS[s].color);
      const uniqueColors = new Set(colors);
      // All 4 must be distinct
      expect(uniqueColors.size).toBe(4);

      // Additionally verify the current status has a color that only it uses
      const myColor = STATUS_VISUALS[status].color;
      const othersWithSameColor = ALL_STATUSES.filter(
        (s) => s !== status && STATUS_VISUALS[s].color === myColor,
      );
      expect(othersWithSameColor).toHaveLength(0);
    },
  );

  it.prop([partitionSyncStatusArb], { numRuns: 100 })(
    'pending and syncing both render a non-idle in-progress state (12.2)',
    (status) => {
      if (status === 'pending' || status === 'syncing') {
        const visual = STATUS_VISUALS[status];
        const idleVisual = STATUS_VISUALS['idle'];
        // Must be visually distinct from idle (different color)
        expect(visual.color).not.toBe(idleVisual.color);
        // Must be a non-idle state (label is not the idle label)
        expect(visual.label).not.toBe(idleVisual.label);
      }
    },
  );

  it.prop([syncStatusStateArb], { numRuns: 200 })(
    'aggregateSyncStatus returns a valid PartitionSyncStatus for any state',
    (state) => {
      const result = aggregateSyncStatus(state);
      expect(ALL_STATUSES).toContain(result);
    },
  );

  it.prop([syncStatusStateArb], { numRuns: 200 })(
    'aggregateSyncStatus result always has a visual mapping (totality through aggregation)',
    (state) => {
      const result = aggregateSyncStatus(state);
      const visual = STATUS_VISUALS[result];
      expect(visual).toBeDefined();
      expect(visual.color).toBeTruthy();
      expect(visual.label).toBeTruthy();
    },
  );

  it.prop([syncStatusStateArb], { numRuns: 200 })(
    'aggregation priority: conflict > pending > syncing > idle',
    (state) => {
      const result = aggregateSyncStatus(state);
      const statuses = PHI_VAULT_TYPES.map((vt) => state.partitions[vt]);

      if (statuses.includes('conflict')) {
        expect(result).toBe('conflict');
      } else if (statuses.includes('pending')) {
        expect(result).toBe('pending');
      } else if (statuses.includes('syncing')) {
        expect(result).toBe('syncing');
      } else {
        expect(result).toBe('idle');
      }
    },
  );

  it.prop([syncStatusStateArb], { numRuns: 200 })(
    'conflict visual is distinct from idle, syncing, and pending (12.3)',
    (state) => {
      const result = aggregateSyncStatus(state);
      if (result === 'conflict') {
        const conflictVisual = STATUS_VISUALS['conflict'];
        expect(conflictVisual.color).not.toBe(STATUS_VISUALS['idle'].color);
        expect(conflictVisual.color).not.toBe(STATUS_VISUALS['syncing'].color);
        expect(conflictVisual.color).not.toBe(STATUS_VISUALS['pending'].color);
      }
    },
  );
});
