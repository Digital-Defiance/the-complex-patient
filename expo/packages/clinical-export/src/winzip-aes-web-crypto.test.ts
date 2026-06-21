import { describe, expect, it } from 'vitest';
import { BlobReader, TextWriter, ZipReader } from './zip-entry';
import { packExportZipCore } from './pack-core';
import { EXPORT_JSON_FILENAME } from './types';
import { canUseWinZipAesWebCrypto, encryptWinZipAes256 } from './winzip-aes-web-crypto';
import { buildWinZipAesArchive } from './zip-aes-archive';

async function extractJson(zipBytes: Uint8Array, password: string): Promise<string> {
  const reader = new ZipReader(new BlobReader(new Blob([zipBytes])));
  const entries = await reader.getEntries();
  const jsonEntry = entries.find((entry) => entry.filename === EXPORT_JSON_FILENAME);
  expect(jsonEntry?.getData).toBeDefined();
  if (!jsonEntry?.getData) {
    throw new Error('missing json entry');
  }
  const extracted = await jsonEntry.getData(new TextWriter(), { password });
  await reader.close();
  return extracted;
}

describe('WinZip AES Web Crypto fast path', () => {
  it('produces a zip that zip.js can decrypt', async () => {
    if (!canUseWinZipAesWebCrypto()) {
      return;
    }

    const json = '{"resourceType":"Bundle","id":"fast-path-test"}';
    const password = 'fast-path-password';
    const plaintext = new TextEncoder().encode(json);
    const encryptedPayload = await encryptWinZipAes256(plaintext, password);
    const zipBytes = buildWinZipAesArchive({
      filename: EXPORT_JSON_FILENAME,
      encryptedPayload,
      uncompressedSize: plaintext.length,
    });

    const extracted = await extractJson(zipBytes, password);
    expect(extracted).toBe(json);
  });

  it('matches zip.js decrypt for the same plaintext', async () => {
    if (!canUseWinZipAesWebCrypto()) {
      return;
    }

    const json = JSON.stringify({
      resourceType: 'Bundle',
      entry: Array.from({ length: 50 }, (_, i) => ({ id: String(i), note: 'abc' })),
    });
    const password = 'interop-password';

    const zipJsBytes = await packExportZipCore({
      json,
      markdown: '# Clinical Summary\n',
      zipPassword: password,
    });
    const fastBytes = buildWinZipAesArchive({
      filename: EXPORT_JSON_FILENAME,
      encryptedPayload: await encryptWinZipAes256(new TextEncoder().encode(json), password),
      uncompressedSize: new TextEncoder().encode(json).length,
    });

    expect(await extractJson(fastBytes, password)).toBe(json);
    expect(await extractJson(zipJsBytes, password)).toBe(json);
  });
});
