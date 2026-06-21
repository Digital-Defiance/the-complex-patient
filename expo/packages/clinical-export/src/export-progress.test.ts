import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  encryptTimeFraction,
  estimateEncryptDurationMs,
  ExportProgressTracker,
} from './export-progress';

describe('estimateEncryptDurationMs', () => {
  it('scales with JSON size', () => {
    const small = estimateEncryptDurationMs(50_000);
    const large = estimateEncryptDurationMs(2 * 1024 * 1024);
    expect(large).toBeGreaterThan(small);
  });
});

describe('encryptTimeFraction', () => {
  it('grows slowly and can exceed the old 0.9 cap when overtime is long', () => {
    const shape = 10_000;
    expect(encryptTimeFraction(1_000, shape)).toBeLessThan(encryptTimeFraction(5_000, shape));
    expect(encryptTimeFraction(120_000, shape)).toBeGreaterThan(0.88);
    expect(encryptTimeFraction(120_000, shape)).toBeLessThanOrEqual(0.98);
  });
});

describe('ExportProgressTracker', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not jump when zip sub-steps complete quickly', () => {
    vi.useFakeTimers();
    const samples: number[] = [];
    const tracker = new ExportProgressTracker((progress) => {
      samples.push(progress.percent);
    });

    tracker.encryptStart(512 * 1024);
    tracker.encryptSubstep('read-blob', 'Finalizing encrypted archive');
    const afterPackPhase = samples.at(-1) ?? 0;
    expect(afterPackPhase).toBeGreaterThanOrEqual(90);

    vi.advanceTimersByTime(60_000);
    const afterMinute = samples.at(-1) ?? 0;
    expect(afterMinute).toBeGreaterThan(afterPackPhase);
    expect(afterMinute).toBeLessThanOrEqual(91);

    tracker.encryptDone();
    expect(samples.at(-1)).toBe(92);
    tracker.dispose();
  });

  it('does not show a fake seconds estimate in the message', () => {
    vi.useFakeTimers();
    let lastMessage = '';
    const tracker = new ExportProgressTracker((progress) => {
      lastMessage = progress.message;
    });

    tracker.encryptStart(256 * 1024);
    vi.advanceTimersByTime(2_500);
    expect(lastMessage).toMatch(/elapsed\)/);
    expect(lastMessage).not.toMatch(/~\d+s estimated/);
    tracker.dispose();
  });
});
