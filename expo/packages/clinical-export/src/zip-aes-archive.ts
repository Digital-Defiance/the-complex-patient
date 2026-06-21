/**
 * Minimal WinZip AES zip writer (STORE inside AES wrapper).
 */

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_FILE_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIR_SIGNATURE = 0x06054b50;

const COMPRESSION_METHOD_AES = 0x63;
const COMPRESSION_METHOD_STORE = 0x00;
const BITFLAG_ENCRYPTED = 0x01;
const VERSION_AES = 0x33;

function dosDateTime(date: Date): number {
  const dosTime =
    (((date.getHours() << 6) | date.getMinutes()) << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate =
    ((((date.getFullYear() - 1980) << 4) | (date.getMonth() + 1)) << 5) | date.getDate();
  return (dosDate << 16) | dosTime;
}

function encodeFilename(filename: string): Uint8Array {
  return new TextEncoder().encode(filename);
}

function buildAesExtraField(): Uint8Array {
  const extra = new Uint8Array(11);
  const view = new DataView(extra.buffer);
  view.setUint16(0, 0x9901, true);
  view.setUint16(2, 7, true);
  extra[4] = 0x02; // vendor version
  extra[5] = 0x00;
  extra[6] = 0x41; // 'AE'
  extra[7] = 0x45;
  extra[8] = 0x03; // AES-256 strength
  extra[9] = COMPRESSION_METHOD_STORE;
  extra[10] = 0x00;
  return extra;
}

export interface WinZipAesArchiveEntry {
  filename: string;
  /** salt + verifier + ciphertext + auth from encryptWinZipAes256 */
  encryptedPayload: Uint8Array;
  uncompressedSize: number;
  lastModified?: Date;
}

/** @deprecated Prefer {@link buildWinZipAesMultiArchive} with a single entry. */
export interface BuildWinZipAesArchiveOptions extends WinZipAesArchiveEntry {}

/**
 * Build a complete zip archive containing one WinZip AES-256 encrypted entry.
 */
export function buildWinZipAesArchive(options: BuildWinZipAesArchiveOptions): Uint8Array {
  return buildWinZipAesMultiArchive([options]);
}

/**
 * Build a complete zip archive with one or more WinZip AES-256 encrypted entries.
 */
export function buildWinZipAesMultiArchive(entries: readonly WinZipAesArchiveEntry[]): Uint8Array {
  if (entries.length === 0) {
    throw new Error('At least one archive entry is required.');
  }

  const defaultModified = new Date();
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const lastModified = entry.lastModified ?? defaultModified;
    const filenameBytes = encodeFilename(entry.filename);
    const aesExtra = buildAesExtraField();
    const encryptedSize = entry.encryptedPayload.length;
    const dosStamp = dosDateTime(lastModified);

    const localHeader = new Uint8Array(30 + filenameBytes.length + aesExtra.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, LOCAL_FILE_HEADER_SIGNATURE, true);
    localView.setUint16(4, VERSION_AES, true);
    localView.setUint16(6, BITFLAG_ENCRYPTED, true);
    localView.setUint16(8, COMPRESSION_METHOD_AES, true);
    localView.setUint32(10, dosStamp, true);
    localView.setUint32(14, 0, true);
    localView.setUint32(18, encryptedSize, true);
    localView.setUint32(22, entry.uncompressedSize, true);
    localView.setUint16(26, filenameBytes.length, true);
    localView.setUint16(28, aesExtra.length, true);
    localHeader.set(filenameBytes, 30);
    localHeader.set(aesExtra, 30 + filenameBytes.length);

    const centralHeader = new Uint8Array(46 + filenameBytes.length + aesExtra.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, CENTRAL_FILE_HEADER_SIGNATURE, true);
    centralView.setUint16(4, VERSION_AES, true);
    centralView.setUint16(6, VERSION_AES, true);
    centralView.setUint16(8, BITFLAG_ENCRYPTED, true);
    centralView.setUint16(10, COMPRESSION_METHOD_AES, true);
    centralView.setUint32(12, dosStamp, true);
    centralView.setUint32(16, 0, true);
    centralView.setUint32(20, encryptedSize, true);
    centralView.setUint32(24, entry.uncompressedSize, true);
    centralView.setUint16(28, filenameBytes.length, true);
    centralView.setUint16(30, aesExtra.length, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, localOffset, true);
    centralHeader.set(filenameBytes, 46);
    centralHeader.set(aesExtra, 46 + filenameBytes.length);

    localChunks.push(localHeader, entry.encryptedPayload);
    centralChunks.push(centralHeader);
    localOffset += localHeader.length + encryptedSize;
  }

  const centralDirectorySize = centralChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const localDataSize = localChunks.reduce((sum, chunk) => sum + chunk.length, 0);

  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  endView.setUint32(0, END_OF_CENTRAL_DIR_SIGNATURE, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralDirectorySize, true);
  endView.setUint32(16, localDataSize, true);

  const total = localDataSize + centralDirectorySize + endRecord.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of localChunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  for (const chunk of centralChunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  out.set(endRecord, offset);
  return out;
}
