/**
 * @complex-patient/ui — Cross-device KDF material resolution
 *
 * Ensures every device for a WordPress user derives the same KEK by sharing
 * the non-secret salt + KDF params via the Sync_Backend. The Master_Passphrase
 * and KEK never cross the network (Requirements 1.3, 1.4).
 */

import { generateSalt, deriveKEK, type KdfParams, type CryptoKeyRef } from '@complex-patient/crypto-engine';

export interface KdfMaterial {
  salt: Uint8Array;
  params: KdfParams;
}

export interface ResolveKdfMaterialDeps {
  loadLocal(): Promise<KdfMaterial | null>;
  saveLocal(material: KdfMaterial): Promise<void>;
  fetchRemote?(): Promise<KdfMaterial | null>;
  publishRemote?(material: KdfMaterial): Promise<void>;
  /** When set, refuse to mint fresh KDF material if encrypted vault data already exists. */
  hasExistingVaultData?(): Promise<boolean>;
}

export class KdfMaterialMissingError extends Error {
  constructor() {
    super('KDF material is missing but encrypted vault data exists on this device.');
    this.name = 'KdfMaterialMissingError';
  }
}

const DEFAULT_PBKDF2_PARAMS: KdfParams = {
  algorithm: 'PBKDF2',
  pbkdf2Iterations: 600_000,
};

/** Normalize persisted KDF params so numeric fields are numbers, not strings. */
export function normalizeKdfParams(params: KdfParams): KdfParams {
  if (params.algorithm === 'PBKDF2') {
    const raw = params.pbkdf2Iterations;
    const pbkdf2Iterations =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string' && /^\d+$/.test(raw)
          ? Number.parseInt(raw, 10)
          : DEFAULT_PBKDF2_PARAMS.pbkdf2Iterations;
    return { algorithm: 'PBKDF2', pbkdf2Iterations };
  }
  return params;
}

function saltsEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) {
      return false;
    }
  }
  return true;
}

function kdfParamsEqual(left: KdfParams, right: KdfParams): boolean {
  const a = normalizeKdfParams(left);
  const b = normalizeKdfParams(right);
  if (a.algorithm !== b.algorithm) {
    return false;
  }
  if (a.algorithm === 'PBKDF2' && b.algorithm === 'PBKDF2') {
    return a.pbkdf2Iterations === b.pbkdf2Iterations;
  }
  return true;
}

function materialsEqual(left: KdfMaterial, right: KdfMaterial): boolean {
  return saltsEqual(left.salt, right.salt) && kdfParamsEqual(left.params, right.params);
}

function uniqueMaterials(materials: KdfMaterial[]): KdfMaterial[] {
  const seen = new Set<string>();
  const out: KdfMaterial[] = [];
  for (const material of materials) {
    const normalized = {
      salt: material.salt,
      params: normalizeKdfParams(material.params),
    };
    const key = `${base64FromBytes(normalized.salt)}|${JSON.stringify(normalized.params)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function orderKdfCandidates(
  candidates: KdfMaterial[],
  remote: KdfMaterial | null,
  local: KdfMaterial | null,
): KdfMaterial[] {
  const ordered: KdfMaterial[] = [];
  const pushUnique = (material: KdfMaterial | null) => {
    if (!material) {
      return;
    }
    if (!ordered.some((candidate) => materialsEqual(candidate, material))) {
      ordered.push(material);
    }
  };
  pushUnique(remote);
  pushUnique(local);
  for (const candidate of candidates) {
    pushUnique(candidate);
  }
  return ordered;
}

export interface ResolveKdfMaterialForUnlockDeps extends ResolveKdfMaterialDeps {
  passphrase: string;
  /** When set, prefer the KDF candidate whose derived KEK decrypts remote vault blobs. */
  verifyKekAgainstRemote?: (kek: CryptoKeyRef) => Promise<boolean>;
}

/**
 * Resolve KDF material for unlock, optionally proving against remote ciphertext.
 *
 * Server-published KDF metadata can drift from the key that actually encrypted
 * vault blobs (e.g. a device overwrote KDF settings but symptoms were encrypted
 * earlier on web). When that happens, try every local/remote candidate and
 * keep the one that decrypts server data.
 */
export async function resolveKdfMaterialForUnlock(
  deps: ResolveKdfMaterialForUnlockDeps,
): Promise<KdfMaterial> {
  const local = await deps.loadLocal();
  let remote: KdfMaterial | null = null;

  try {
    remote = (await deps.fetchRemote?.()) ?? null;
  } catch {
    // Offline or backend unavailable — fall back to standard resolution.
  }

  if (deps.verifyKekAgainstRemote) {
    const candidates = orderKdfCandidates(
      uniqueMaterials([local, remote].filter((material): material is KdfMaterial => material !== null)),
      remote,
      local,
    );

    for (const candidate of candidates) {
      const derived = await deriveKEK(deps.passphrase, candidate.salt, candidate.params);
      if (!derived.ok) {
        continue;
      }
      if (await deps.verifyKekAgainstRemote(derived.kek)) {
        if (!local || !materialsEqual(candidate, local)) {
          await deps.saveLocal(candidate);
        }
        if (remote && !materialsEqual(candidate, remote)) {
          try {
            await deps.publishRemote?.(candidate);
          } catch {
            // Best effort: repair server KDF metadata for other devices.
          }
        }
        console.log('[KdfMaterial] selected KDF that decrypts remote vault data');
        return candidate;
      }
    }

    console.warn(
      '[KdfMaterial] no KDF candidate decrypts remote vault; falling back to standard resolution',
    );
  }

  return resolveKdfMaterial(deps);
}

/**
 * Resolve the KDF material to use for this unlock attempt.
 *
 * Priority when local and remote disagree: **remote wins** so a new device picks
 * up the vault salt created on the first device.
 */
export async function resolveKdfMaterial(deps: ResolveKdfMaterialDeps): Promise<KdfMaterial> {
  const local = await deps.loadLocal();
  let remote: KdfMaterial | null = null;

  try {
    remote = (await deps.fetchRemote?.()) ?? null;
  } catch {
    // Offline or backend unavailable — fall back to local-only resolution.
  }

  if (remote && local && saltsEqual(local.salt, remote.salt)) {
    const params = normalizeKdfParams(remote.params);
    const merged = { salt: local.salt, params };
    if (!kdfParamsEqual(local.params, params)) {
      await deps.saveLocal(merged);
    }
    return merged;
  }

  if (remote && local && !saltsEqual(local.salt, remote.salt)) {
    if (deps.hasExistingVaultData && (await deps.hasExistingVaultData())) {
      // Keep the local salt that matches on-device blobs; never publish it over
      // the server copy (that orphans data encrypted on other devices).
      return local;
    }
    await deps.saveLocal(remote);
    return remote;
  }

  if (remote && !local) {
    await deps.saveLocal(remote);
    return remote;
  }

  if (local && !remote) {
    try {
      await deps.publishRemote?.(local);
    } catch {
      // Best effort: local unlock can proceed even if publish fails.
    }
    return local;
  }

  if (local) {
    return local;
  }

  if (deps.hasExistingVaultData && (await deps.hasExistingVaultData())) {
    throw new KdfMaterialMissingError();
  }

  const created: KdfMaterial = {
    salt: await generateSalt(),
    params: DEFAULT_PBKDF2_PARAMS,
  };
  await deps.saveLocal(created);
  try {
    await deps.publishRemote?.(created);
  } catch {
    // Best effort: first device can still unlock locally.
  }
  return created;
}

/** Encode bytes as standard Base64 (no Buffer dependency). */
export function base64FromBytes(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;

    out += alphabet[b0 >> 2];
    out += alphabet[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? alphabet[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? alphabet[b2 & 0x3f] : '=';
  }
  return out;
}

/** Decode standard Base64 into bytes (no Buffer dependency). */
export function bytesFromBase64(base64: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = base64.replace(/=+$/, '');
  const byteLength = Math.floor((clean.length * 6) / 8);
  const bytes = new Uint8Array(byteLength);

  let bitBuffer = 0;
  let bitCount = 0;
  let outIndex = 0;

  for (let i = 0; i < clean.length; i++) {
    const value = alphabet.indexOf(clean[i]);
    if (value === -1) {
      throw new Error('invalid Base64 input');
    }
    bitBuffer = (bitBuffer << 6) | value;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes[outIndex++] = (bitBuffer >> bitCount) & 0xff;
    }
  }

  return bytes;
}

export function kdfMaterialToPayload(material: KdfMaterial): {
  salt_base64: string;
  params: KdfParams;
} {
  return {
    salt_base64: base64FromBytes(material.salt),
    params: material.params,
  };
}

export function kdfMaterialFromPayload(payload: {
  salt_base64: string;
  params: KdfParams;
}): KdfMaterial {
  return {
    salt: bytesFromBase64(payload.salt_base64),
    params: normalizeKdfParams(payload.params),
  };
}
