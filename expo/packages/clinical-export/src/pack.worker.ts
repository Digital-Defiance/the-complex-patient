/**
 * Web Worker entry for clinical export ZIP packaging.
 */

import { packExportZipCore } from './pack-core';

type WorkerRequest = {
  id: number;
  jsonBytes: Uint8Array;
  markdownBytes: Uint8Array;
  zipPassword: string;
};

type WorkerProgress = {
  type: 'progress';
  id: number;
  step: string;
  message: string;
};

type WorkerDone = {
  type: 'done';
  id: number;
  bytes: Uint8Array;
};

type WorkerError = {
  type: 'error';
  id: number;
  message: string;
};

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, jsonBytes, markdownBytes, zipPassword } = event.data;
  const json = new TextDecoder().decode(jsonBytes);
  const markdown = new TextDecoder().decode(markdownBytes);

  void packExportZipCore({
    json,
    markdown,
    zipPassword,
    onPackProgress: (step, message) => {
      const progress: WorkerProgress = { type: 'progress', id, step, message };
      self.postMessage(progress);
    },
  })
    .then((bytes) => {
      const done: WorkerDone = { type: 'done', id, bytes };
      self.postMessage(done, [bytes.buffer]);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Export packaging failed.';
      const failure: WorkerError = { type: 'error', id, message };
      self.postMessage(failure);
    });
};
