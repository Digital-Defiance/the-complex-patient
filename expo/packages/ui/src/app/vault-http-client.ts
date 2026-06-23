/**
 * @complex-patient/ui — Authenticated blind vault HTTP client
 *
 * Implements the Sync_Engine {@link VaultHttpClient} seam against the WordPress
 * REST endpoint `\/wp-json\/complex-patient\/v1\/vault\/{vault_type}` (design.md →
 * Sync_Backend). Every request:
 *
 * - carries the WordPress credential as an `Authorization` header — JWT bearer
 *   or Application Password basic auth (Requirement 4.1). When no credential is
 *   set the client refuses to call the network (Requirement 4.3 client-side
 *   counterpart) so an unauthenticated request is never issued.
 * - sends ONLY the blind envelope `{ sync_version, iv, auth_tag, ciphertext }`
 *   on POST and reads back only `{ sync_version, iv, auth_tag, ciphertext }` on
 *   GET. No plaintext PHI, Master_Passphrase, or KEK ever crosses the boundary
 *   (Requirements 4.6, 4.8).
 *
 * The actual transport is the injected `fetch`-like function, so this client is
 * isomorphic (native `fetch` / web `window.fetch`) and fully testable under
 * vitest with a fake fetch.
 */

import type { VaultType } from '@complex-patient/domain';
import type { KdfParams } from '@complex-patient/crypto-engine';
import type {
  VaultGetResponse,
  VaultHttpClient,
  VaultPushPayload,
  VaultPushResponse,
} from '@complex-patient/sync-engine';
import { buildAuthorizationHeader, type AuthProvider } from './auth';

/** Synthetic status when fetch/auth fails before an HTTP response is received. */
export const VAULT_HTTP_TRANSPORT_ERROR = 0;

/** Minimal structural `Response` the client consumes (status + JSON body). */
export interface FetchLikeResponse {
  status: number;
  json(): Promise<unknown>;
}

/** Minimal structural `fetch` so the client is transport-agnostic. */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
  },
) => Promise<FetchLikeResponse>;

/** Dependencies for {@link createVaultHttpClient}. */
export interface VaultHttpClientDeps {
  /**
   * The Sync_Backend origin, e.g. `https://patient.example.com`. The web target
   * MUST use an HTTPS origin (Requirement 22.1); this is asserted at construction.
   */
  baseUrl: string;
  /** The current WordPress credential (Requirement 4.1). */
  auth: AuthProvider;
  /** Transport. Defaults to the global `fetch` when available. */
  fetch?: FetchLike;
  /** Optional device id included in vault POST JSON for push fan-out exclusion. */
  getDeviceId?: () => string | null;
}

/** The REST namespace for the blind vault endpoints (design.md → Sync_Backend). */
const API_PATH = 'wp-json/complex-patient/v1';
const VAULT_PATH = `${API_PATH}/vault`;
const DEVICES_PATH = `${API_PATH}/devices`;

/** Response from GET /vault/kdf-material. */
export interface KdfMaterialGetResponse {
  status: number;
  salt_base64?: string;
  params?: KdfParams;
}

/** Payload for PUT /vault/kdf-material. */
export interface KdfMaterialPutPayload {
  salt_base64: string;
  params: KdfParams;
}

/** Payload for PUT /devices. */
export interface DevicePushRegistration {
  device_id: string;
  platform: 'ios' | 'android' | 'web';
  push_token: string;
  push_provider: 'expo' | 'webpush';
}

/** Extended client surface including cross-device KDF material sync. */
export interface VaultHttpClientWithKdf extends VaultHttpClient {
  getKdfMaterial(): Promise<KdfMaterialGetResponse>;
  putKdfMaterial(payload: KdfMaterialPutPayload): Promise<{ status: number }>;
  registerDevice(registration: DevicePushRegistration): Promise<{ status: number }>;
  unregisterDevice(deviceId: string): Promise<{ status: number }>;
}

/** Resolve the default transport from the host, if any. */
function resolveFetch(provided?: FetchLike): FetchLike {
  if (provided) return provided;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  if (typeof g.fetch === 'function') {
    return (url, init) => g.fetch(url, init);
  }
  throw new Error('no fetch implementation available; inject one via VaultHttpClientDeps.fetch');
}

/**
 * Create an authenticated, blind {@link VaultHttpClient} for the Sync_Worker.
 *
 * @throws if `baseUrl` is not an absolute `https:` URL — the platform requires
 * HTTPS for all Sync_Backend traffic (Requirement 22.1). Loopback `http` and, in
 * development only, private LAN IPs (e.g. `http://172.16.0.14:8080`) are permitted.
 */
export function createVaultHttpClient(deps: VaultHttpClientDeps): VaultHttpClientWithKdf {
  const fetchImpl = resolveFetch(deps.fetch);
  const base = deps.baseUrl.replace(/\/+$/, '');
  assertSecureOrigin(base);

  function endpoint(vaultType: VaultType): string {
    return `${base}/${VAULT_PATH}/${encodeURIComponent(vaultType)}`;
  }

  function kdfEndpoint(): string {
    return `${base}/${VAULT_PATH}/kdf-material`;
  }

  function devicesEndpoint(deviceId?: string): string {
    if (deviceId) {
      return `${base}/${DEVICES_PATH}/${encodeURIComponent(deviceId)}`;
    }
    return `${base}/${DEVICES_PATH}`;
  }

  type TransportResult =
    | { ok: true; response: FetchLikeResponse }
    | { ok: false; message: string };

  async function performRequest(
    label: string,
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
  ): Promise<TransportResult> {
    try {
      const response = await fetchImpl(url, init);
      return { ok: true, response };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.warn(`[VaultHttp] ${label} ${init.method} ${url} failed: ${message}`);
      return { ok: false, message };
    }
  }

  function authHeadersOrError(): { headers: Record<string, string> } | { error: string } {
    const credential = deps.auth.getAuth();
    if (credential === null) {
      return {
        error: 'not authenticated: a Sync_Backend credential is required (Requirement 4.1)',
      };
    }
    try {
      return { headers: { Authorization: buildAuthorizationHeader(credential) } };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return { error: message };
    }
  }

  async function postVault(
    vaultType: VaultType,
    payload: VaultPushPayload,
  ): Promise<VaultPushResponse> {
    const auth = authHeadersOrError();
    if ('error' in auth) {
      console.warn(`[VaultHttp] POST ${endpoint(vaultType)} blocked: ${auth.error}`);
      return {
        status: VAULT_HTTP_TRANSPORT_ERROR,
        errorCode: 'transport_error',
        errorMessage: auth.error,
      };
    }

    // Only the blind envelope crosses the boundary (Requirements 4.6, 4.8).
    // device_id is included in the JSON body (not a custom header) so cross-origin
    // web clients do not fail CORS preflight on X-Device-Id.
    const bodyPayload: Record<string, unknown> = {
      sync_version: payload.sync_version,
      iv: payload.iv,
      auth_tag: payload.auth_tag,
      ciphertext: payload.ciphertext,
    };
    const deviceId = deps.getDeviceId?.() ?? null;
    if (deviceId !== null && deviceId !== '') {
      bodyPayload.device_id = deviceId;
    }

    const url = endpoint(vaultType);
    const transport = await performRequest(`vault/${vaultType}`, url, {
      method: 'POST',
      headers: { ...auth.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyPayload),
    });
    if (!transport.ok) {
      return {
        status: VAULT_HTTP_TRANSPORT_ERROR,
        errorCode: 'transport_error',
        errorMessage: transport.message,
      };
    }

    const json = await safeJson(transport.response);
    const error = readVaultApiError(json);
    return {
      status: transport.response.status,
      sync_version: readSyncVersion(json),
      ...error,
    };
  }

  async function getVault(vaultType: VaultType): Promise<VaultGetResponse> {
    const auth = authHeadersOrError();
    if ('error' in auth) {
      return { status: VAULT_HTTP_TRANSPORT_ERROR };
    }

    const transport = await performRequest(`vault/${vaultType}`, endpoint(vaultType), {
      method: 'GET',
      headers: auth.headers,
    });
    if (!transport.ok) {
      return { status: VAULT_HTTP_TRANSPORT_ERROR };
    }

    const json = await safeJson(transport.response);
    const record = isRecord(json) ? json : {};
    return {
      status: transport.response.status,
      sync_version: readSyncVersion(record),
      iv: readString(record, 'iv'),
      auth_tag: readString(record, 'auth_tag'),
      ciphertext: readString(record, 'ciphertext'),
    };
  }

  async function getKdfMaterial(): Promise<KdfMaterialGetResponse> {
    const auth = authHeadersOrError();
    if ('error' in auth) {
      return { status: VAULT_HTTP_TRANSPORT_ERROR };
    }

    const transport = await performRequest('kdf-material', kdfEndpoint(), {
      method: 'GET',
      headers: auth.headers,
    });
    if (!transport.ok) {
      return { status: VAULT_HTTP_TRANSPORT_ERROR };
    }

    const json = await safeJson(transport.response);
    const record = isRecord(json) ? json : {};
    const params = record.params;
    return {
      status: transport.response.status,
      salt_base64: readString(record, 'salt_base64'),
      params:
        isRecord(params) && typeof params.algorithm === 'string'
          ? (params as KdfParams)
          : undefined,
    };
  }

  async function putKdfMaterial(payload: KdfMaterialPutPayload): Promise<{ status: number }> {
    const auth = authHeadersOrError();
    if ('error' in auth) {
      return { status: VAULT_HTTP_TRANSPORT_ERROR };
    }

    const transport = await performRequest('kdf-material', kdfEndpoint(), {
      method: 'PUT',
      headers: { ...auth.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { status: transport.ok ? transport.response.status : VAULT_HTTP_TRANSPORT_ERROR };
  }

  async function registerDevice(registration: DevicePushRegistration): Promise<{ status: number }> {
    const auth = authHeadersOrError();
    if ('error' in auth) {
      return { status: VAULT_HTTP_TRANSPORT_ERROR };
    }

    const transport = await performRequest('devices', devicesEndpoint(), {
      method: 'PUT',
      headers: { ...auth.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(registration),
    });
    return { status: transport.ok ? transport.response.status : VAULT_HTTP_TRANSPORT_ERROR };
  }

  async function unregisterDevice(deviceId: string): Promise<{ status: number }> {
    const auth = authHeadersOrError();
    if ('error' in auth) {
      return { status: VAULT_HTTP_TRANSPORT_ERROR };
    }

    const transport = await performRequest('devices', devicesEndpoint(deviceId), {
      method: 'DELETE',
      headers: auth.headers,
    });
    return { status: transport.ok ? transport.response.status : VAULT_HTTP_TRANSPORT_ERROR };
  }

  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.info(`[VaultHttp] sync backend: ${base}`);
  }

  return { postVault, getVault, getKdfMaterial, putKdfMaterial, registerDevice, unregisterDevice };
}

/** Enforce HTTPS for the Sync_Backend origin (Requirement 22.1). */
function assertSecureOrigin(baseUrl: string): void {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(`invalid Sync_Backend baseUrl: ${baseUrl}`);
  }

  const allowHttp =
    isLoopbackHost(url.hostname) ||
    (typeof __DEV__ !== 'undefined' && __DEV__ && isPrivateLanHost(url.hostname));

  if (url.protocol !== 'https:' && !allowHttp) {
    throw new Error(
      `Sync_Backend baseUrl must use https (Requirement 22.1); got ${url.protocol}//${url.host}`,
    );
  }
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

/** RFC 1918 private IPv4 ranges used for on-LAN local WordPress during development. */
function isPrivateLanHost(hostname: string): boolean {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [first, second] = parts;
  if (first === 10) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  return false;
}

/** Tolerate empty / non-JSON bodies (e.g. a bare 401) without throwing. */
async function safeJson(response: FetchLikeResponse): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readSyncVersion(value: unknown): number | undefined {
  if (!isRecord(value)) return undefined;
  const v = value.sync_version;
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const v = record[key];
  return typeof v === 'string' ? v : undefined;
}

/** Parse WordPress REST API error bodies returned on failed vault writes. */
function readVaultApiError(value: unknown): {
  errorCode?: string;
  errorMessage?: string;
  errorField?: string;
} {
  if (!isRecord(value)) {
    return {};
  }
  const errorCode = readString(value, 'code');
  const errorMessage = readString(value, 'message');
  const data = isRecord(value.data) ? value.data : undefined;
  const errorField = data ? readString(data, 'field') : undefined;
  return { errorCode, errorMessage, errorField };
}
