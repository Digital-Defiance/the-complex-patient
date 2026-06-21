/**
 * Run clinical export ZIP packaging in a Web Worker when available.
 */

import type { PackProgressStep } from './export-progress';
import type { PackExportZipOptions } from './pack-core';
import { packExportZipCore } from './pack-core';

let nextWorkerId = 0;
let worker: Worker | undefined;
let workerFailed = false;

function getPackWorker(): Worker | null {
  if (workerFailed || typeof Worker === 'undefined' || typeof window === 'undefined') {
    return null;
  }

  if (worker) {
    return worker;
  }

  try {
    // Expo Metro rewrites this literal Worker(new URL(..., window.location.href)) pattern.
    worker = new Worker(new URL('./pack.worker.ts', window.location.href), { type: 'module' });
    worker.addEventListener('error', () => {
      workerFailed = true;
      worker?.terminate();
      worker = undefined;
    });
    return worker;
  } catch {
    workerFailed = true;
    return null;
  }
}

export function canUsePackWorker(): boolean {
  return typeof Worker !== 'undefined' && typeof globalThis.document !== 'undefined';
}

export async function packExportZipInWorker(options: PackExportZipOptions): Promise<Uint8Array> {
  const packWorker = getPackWorker();
  if (!packWorker) {
    return packExportZipCore(options);
  }

  const id = ++nextWorkerId;

  return new Promise<Uint8Array>((resolve, reject) => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data as {
        type: string;
        id: number;
        step?: PackProgressStep;
        message?: string;
        bytes?: Uint8Array;
      };

      if (data.id !== id) {
        return;
      }

      if (data.type === 'progress' && data.step && data.message) {
        options.onPackProgress?.(data.step, data.message);
        return;
      }

      packWorker.removeEventListener('message', handleMessage);

      if (data.type === 'done' && data.bytes) {
        resolve(data.bytes);
        return;
      }

      if (data.type === 'error') {
        reject(new Error(data.message ?? 'Export packaging failed.'));
        return;
      }

      reject(new Error('Export packaging failed.'));
    };

    packWorker.addEventListener('message', handleMessage);
    const jsonBytes = new TextEncoder().encode(options.json);
    const markdownBytes = new TextEncoder().encode(options.markdown);
    packWorker.postMessage(
      { id, jsonBytes, markdownBytes, zipPassword: options.zipPassword },
      [jsonBytes.buffer, markdownBytes.buffer],
    );
  });
}
