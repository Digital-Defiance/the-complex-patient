import { describe, expect, it } from 'vitest';
import { BlobReader, TextWriter, ZipReader } from './zip-entry';
import { packExportZipCore } from './pack-core';
import { EXPORT_JSON_FILENAME, EXPORT_MARKDOWN_FILENAME } from './types';

describe('packExportZipCore', () => {
  it('uses STORE + AES-256 and completes multi-MB packaging in reasonable time', async () => {
    const largeJson = JSON.stringify({
      resourceType: 'Bundle',
      entry: Array.from({ length: 4000 }, (_, i) => ({
        fullUrl: `urn:uuid:${i}`,
        resource: { resourceType: 'Observation', id: String(i), note: 'x'.repeat(400) },
      })),
    });

    const start = Date.now();
    const zipBytes = await packExportZipCore({
      json: largeJson,
      markdown: '# Clinical Summary\n\nTest export.',
      zipPassword: 'store-mode-password',
    });
    const elapsedMs = Date.now() - start;

    expect(zipBytes.length).toBeGreaterThan(largeJson.length);
    expect(elapsedMs).toBeLessThan(120_000);

    const reader = new ZipReader(new BlobReader(new Blob([zipBytes])));
    const entries = await reader.getEntries();
    const jsonEntry = entries.find((entry) => entry.filename === EXPORT_JSON_FILENAME);
    expect(jsonEntry?.getData).toBeDefined();
    expect(entries.some((entry) => entry.filename === EXPORT_MARKDOWN_FILENAME)).toBe(true);
    if (!jsonEntry?.getData) return;

    const extracted = await jsonEntry.getData(new TextWriter(), { password: 'store-mode-password' });
    expect(extracted).toContain('"resourceType":"Bundle"');
    await reader.close();
  }, 120_000);
});
