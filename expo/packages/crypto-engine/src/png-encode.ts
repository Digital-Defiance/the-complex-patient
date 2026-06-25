/**
 * Minimal RGBA → PNG encoder for Hermes/React Native.
 *
 * Avoids fast-png, which instantiates TextDecoder('latin1') at import time and
 * crashes release Android builds.
 */

import { deflate } from 'pako';

const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint32BE(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, false);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  writeUint32BE(view, 0, data.length);
  for (let i = 0; i < 4; i += 1) {
    chunk[4 + i] = type.charCodeAt(i)!;
  }
  chunk.set(data, 8);
  writeUint32BE(view, 8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Encode raw RGBA pixels (width × height × 4 bytes) as a PNG file. */
export function encodeRgbaPng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  if (rgba.length !== width * height * 4) {
    throw new Error('RGBA byte length does not match width × height × 4');
  }

  const rowBytes = width * 4;
  const raw = new Uint8Array(height * (1 + rowBytes));
  for (let y = 0; y < height; y += 1) {
    const dest = y * (1 + rowBytes);
    raw[dest] = 0;
    raw.set(rgba.subarray(y * rowBytes, (y + 1) * rowBytes), dest + 1);
  }

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  writeUint32BE(ihdrView, 0, width);
  writeUint32BE(ihdrView, 4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return concatChunks([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflate(raw)),
    pngChunk('IEND', new Uint8Array(0)),
  ]);
}
