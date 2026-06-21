/**
 * Time-weighted export progress — encryption gets ~75% of the bar.
 *
 * During packaging, elapsed time drives most of the bar. Sub-steps raise a
 * floor so the bar advances when zip.js completes a phase. After the estimate
 * is exceeded, the bar creeps slowly instead of stalling at ~85%.
 */

import type { ClinicalExportProgress, ClinicalExportProgressCallback, ClinicalExportProgressStage } from './types';

/** Percent ranges for each export phase. */
const BAND = {
  build: [0, 12] as const,
  serialize: [12, 18] as const,
  encrypt: [18, 92] as const,
  save: [92, 99] as const,
  done: 100,
};

export type PackProgressStep = 'compress' | 'encrypt' | 'read-blob' | 'finalize';

/** Minimum bar percent when a packaging sub-step completes. */
const PACK_SUBSTEP_FLOOR: Partial<Record<PackProgressStep, number>> = {
  compress: 20,
  encrypt: 20,
  'read-blob': 90,
  finalize: 95,
};

function bandPercent(band: readonly [number, number], fraction: number): number {
  const [start, end] = band;
  const clamped = Math.min(1, Math.max(0, fraction));
  return Math.round(start + (end - start) * clamped);
}

/**
 * Shape constant for the encrypt progress curve (not shown to users).
 * Smaller exports get a shorter shape so the bar still moves meaningfully.
 */
export function estimateEncryptDurationMs(jsonByteLength: number): number {
  const mb = jsonByteLength / (1024 * 1024);
  // STORE + AES-256 in zip.js (pure JS): ~2–5s per MB on typical web hardware.
  return Math.min(15 * 60_000, Math.max(3_000, Math.round(2_000 + mb * 4_000)));
}

/** Fraction of the encrypt band (0–1) from elapsed time; keeps moving after estimate. */
export function encryptTimeFraction(elapsedMs: number, shapeMs: number): number {
  if (shapeMs <= 0) {
    return 0;
  }
  const t = elapsedMs / shapeMs;
  const primary = 0.82 * (1 - Math.exp(-t * 1.2));
  if (elapsedMs <= shapeMs * 2) {
    return Math.min(0.88, primary);
  }
  const overtimeMs = elapsedMs - shapeMs * 2;
  const overtimeSpan = shapeMs * 10;
  const crawl = Math.min(0.1, (overtimeMs / overtimeSpan) * 0.1);
  return Math.min(0.98, 0.88 + crawl);
}

export class ExportProgressTracker {
  private floorPercent = 0;
  private encryptShapeMs = 5_000;
  private encryptStartedAt = 0;
  private encryptDetailMessage: string | undefined;
  private tickTimer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly onProgress?: ClinicalExportProgressCallback) {}

  dispose(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = undefined;
    }
  }

  private emit(stage: ClinicalExportProgressStage, percent: number, message: string): void {
    const clamped = Math.min(99, Math.max(this.floorPercent, Math.round(percent)));
    this.floorPercent = clamped;
    this.onProgress?.({ stage, percent: clamped, message });
  }

  buildStart(): void {
    this.emit('building-fhir', BAND.build[0], 'Building FHIR bundle…');
  }

  buildDone(): void {
    this.emit('building-fhir', BAND.build[1], 'FHIR bundle ready.');
  }

  serializeStart(): void {
    this.emit('serializing', BAND.serialize[0], 'Serializing export JSON…');
  }

  serializeDone(): void {
    this.emit('serializing', BAND.serialize[1], 'JSON ready.');
  }

  encryptStart(jsonByteLength: number): void {
    this.encryptShapeMs = estimateEncryptDurationMs(jsonByteLength);
    this.encryptStartedAt = Date.now();
    this.encryptDetailMessage = undefined;
    this.emit('encrypting', BAND.encrypt[0], 'Encrypting zip file…');
    this.tickTimer = setInterval(() => this.tickEncrypt(), 500);
  }

  encryptSubstep(step: PackProgressStep, message: string): void {
    this.encryptDetailMessage = message;
    const substepFloor = PACK_SUBSTEP_FLOOR[step];
    if (substepFloor !== undefined) {
      this.floorPercent = Math.max(this.floorPercent, substepFloor);
    }
    this.tickEncrypt();
  }

  private tickEncrypt(): void {
    const elapsedMs = Date.now() - this.encryptStartedAt;
    const fraction = encryptTimeFraction(elapsedMs, this.encryptShapeMs);
    const percent = bandPercent(BAND.encrypt, fraction);
    const elapsedSec = Math.floor(elapsedMs / 1000);
    const detail = this.encryptDetailMessage ?? 'Encrypting zip file';
    const overtime =
      elapsedMs > this.encryptShapeMs * 2 ? ' — still working, please keep this tab open' : '';
    const message = `${detail} (${elapsedSec}s elapsed${overtime})…`;
    this.emit('encrypting', Math.min(BAND.encrypt[1] - 1, percent), message);
  }

  encryptDone(): void {
    this.dispose();
    this.emit('encrypting', BAND.encrypt[1], 'Encryption complete.');
  }

  saveStart(): void {
    this.emit('saving', BAND.save[0], 'Saving export file…');
  }

  saveDone(): void {
    this.emit('complete', BAND.done, 'Export ready.');
  }
}
