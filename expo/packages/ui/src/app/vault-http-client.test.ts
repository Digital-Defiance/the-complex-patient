import { describe, it, expect, vi, afterEach } from 'vitest';
import { createVaultHttpClient, type FetchLike } from './vault-http-client';
import { createAuthProvider } from './auth';

/**
 * Tests for the authenticated blind vault HTTP client (Requirements 4.1, 4.6,
 * 4.8, 22.1). The client must:
 * - attach the WordPress Authorization header (4.1),
 * - send ONLY the blind envelope on POST and read only it on GET (4.6, 4.8),
 * - refuse to call the network when unauthenticated (4.3 client side),
 * - require an HTTPS origin (22.1).
 */
const ENVELOPE = {
  sync_version: 3,
  iv: 'aXY=',
  auth_tag: 'dGFn',
  ciphertext: 'Y2lwaGVy',
};

function okFetch(body: unknown, status = 200): FetchLike {
  return vi.fn(async () => ({
    status,
    json: async () => body,
  }));
}

describe('createVaultHttpClient — HTTPS enforcement (22.1)', () => {
  const auth = createAuthProvider({ kind: 'jwt', token: 't' });
  const originalDev = (globalThis as { __DEV__?: boolean }).__DEV__;

  afterEach(() => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = originalDev;
  });

  it('rejects a non-HTTPS Sync_Backend origin', () => {
    expect(() =>
      createVaultHttpClient({ baseUrl: 'http://patient.example.com', auth, fetch: okFetch({}) }),
    ).toThrow(/https/i);
  });

  it('accepts an HTTPS origin', () => {
    expect(() =>
      createVaultHttpClient({ baseUrl: 'https://patient.example.com', auth, fetch: okFetch({}) }),
    ).not.toThrow();
  });

  it('permits http localhost for development', () => {
    expect(() =>
      createVaultHttpClient({ baseUrl: 'http://localhost:8080', auth, fetch: okFetch({}) }),
    ).not.toThrow();
  });

  it('permits http private LAN origins in development', () => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = true;
    expect(() =>
      createVaultHttpClient({ baseUrl: 'http://172.16.0.14:8080', auth, fetch: okFetch({}) }),
    ).not.toThrow();
  });

  it('rejects http private LAN origins outside development', () => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    expect(() =>
      createVaultHttpClient({ baseUrl: 'http://172.16.0.14:8080', auth, fetch: okFetch({}) }),
    ).toThrow(/https/i);
  });
});

describe('createVaultHttpClient — authentication (4.1, 4.3)', () => {
  it('attaches a Bearer Authorization header on POST', async () => {
    const fetchImpl = okFetch({ sync_version: 4 });
    const auth = createAuthProvider({ kind: 'jwt', token: 'jwt-token' });
    const client = createVaultHttpClient({
      baseUrl: 'https://patient.example.com',
      auth,
      fetch: fetchImpl,
    });

    await client.postVault('medications', ENVELOPE);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://patient.example.com/wp-json/complex-patient/v1/vault/medications');
    expect(init.headers.Authorization).toBe('Bearer jwt-token');
  });

  it('refuses to call the network when unauthenticated (4.3)', async () => {
    const fetchImpl = okFetch({});
    const auth = createAuthProvider(null);
    const client = createVaultHttpClient({
      baseUrl: 'https://patient.example.com',
      auth,
      fetch: fetchImpl,
    });

    const res = await client.postVault('medications', ENVELOPE);
    expect(res.status).toBe(0);
    expect(res.errorMessage).toMatch(/not authenticated/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('createVaultHttpClient — blind envelope only (4.6, 4.8)', () => {
  it('POST body contains ONLY the blind envelope fields', async () => {
    const fetchImpl = okFetch({ sync_version: 4 });
    const auth = createAuthProvider({ kind: 'jwt', token: 't' });
    const client = createVaultHttpClient({
      baseUrl: 'https://patient.example.com',
      auth,
      fetch: fetchImpl,
    });

    await client.postVault('symptoms', ENVELOPE);

    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    const parsed = JSON.parse(init.body as string);
    expect(Object.keys(parsed).sort()).toEqual(['auth_tag', 'ciphertext', 'iv', 'sync_version']);
    expect(parsed).toEqual(ENVELOPE);
    expect(init.headers['X-Device-Id']).toBeUndefined();
  });

  it('includes device_id in the POST body when getDeviceId is set', async () => {
    const fetchImpl = okFetch({ sync_version: 4 });
    const auth = createAuthProvider({ kind: 'jwt', token: 't' });
    const client = createVaultHttpClient({
      baseUrl: 'https://patient.example.com',
      auth,
      fetch: fetchImpl,
      getDeviceId: () => 'device-abc',
    });

    await client.postVault('symptoms', ENVELOPE);

    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    const parsed = JSON.parse(init.body as string);
    expect(parsed.device_id).toBe('device-abc');
    expect(init.headers['X-Device-Id']).toBeUndefined();
  });

  it('returns the server sync_version from a 200 POST', async () => {
    const auth = createAuthProvider({ kind: 'jwt', token: 't' });
    const client = createVaultHttpClient({
      baseUrl: 'https://patient.example.com',
      auth,
      fetch: okFetch({ sync_version: 9 }),
    });
    const res = await client.postVault('flares', ENVELOPE);
    expect(res).toEqual({ status: 200, sync_version: 9 });
  });

  it('surfaces a 409 with the current stored version for conflict resolution', async () => {
    const auth = createAuthProvider({ kind: 'jwt', token: 't' });
    const client = createVaultHttpClient({
      baseUrl: 'https://patient.example.com',
      auth,
      fetch: okFetch({ sync_version: 12 }, 409),
    });
    const res = await client.postVault('conditions', ENVELOPE);
    expect(res).toEqual({ status: 409, sync_version: 12 });
  });

  it('GET reads back only the blind envelope fields', async () => {
    const auth = createAuthProvider({ kind: 'jwt', token: 't' });
    const client = createVaultHttpClient({
      baseUrl: 'https://patient.example.com',
      auth,
      fetch: okFetch({ ...ENVELOPE, leaked: 'should-be-ignored' }),
    });
    const res = await client.getVault!('associations');
    expect(res).toEqual({
      status: 200,
      sync_version: 3,
      iv: 'aXY=',
      auth_tag: 'dGFn',
      ciphertext: 'Y2lwaGVy',
    });
    expect((res as Record<string, unknown>).leaked).toBeUndefined();
  });

  it('tolerates an empty / non-JSON body (e.g. a bare 401)', async () => {
    const auth = createAuthProvider({ kind: 'jwt', token: 't' });
    const client = createVaultHttpClient({
      baseUrl: 'https://patient.example.com',
      auth,
      fetch: vi.fn(async () => ({
        status: 401,
        json: async () => {
          throw new Error('no body');
        },
      })),
    });
    const res = await client.postVault('medications', ENVELOPE);
    expect(res.status).toBe(401);
    expect(res.sync_version).toBeUndefined();
  });

  it('validates WordPress credentials against kdf-material', async () => {
    const auth = createAuthProvider({
      kind: 'application-password',
      username: 'alice',
      applicationPassword: 'abcd efgh',
    });
    const fetch = vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
      expect(url).toBe('http://localhost:8881/wp-json/complex-patient/v1/vault/kdf-material');
      expect(init.headers.Authorization).toBe(
        `Basic ${Buffer.from('alice:abcdefgh', 'utf8').toString('base64')}`,
      );
      return {
        status: 200,
        json: async () => ({ salt_base64: 'c2FsdA==', params: { algorithm: 'PBKDF2' } }),
      };
    });
    const client = createVaultHttpClient({
      baseUrl: 'http://localhost:8881',
      auth,
      fetch,
    });
    const res = await client.validateWordPressAuth();
    expect(res.status).toBe(200);
  });

  it('paper backups use the same Sync_Backend base URL as vault partitions', async () => {
    const auth = createAuthProvider({ kind: 'jwt', token: 't' });
    const fetch = vi.fn(async (url: string) => {
      expect(url).toBe('http://localhost:8881/wp-json/complex-patient/v1/vault/paper-backups');
      return { status: 201, json: async () => ({}) };
    });
    const client = createVaultHttpClient({
      baseUrl: 'http://localhost:8881',
      auth,
      fetch,
    });
    const res = await client.createPaperBackup!({
      backup_id: '11111111-1111-4111-8111-111111111111',
      iv: 'aXY=',
      auth_tag: 'dGFn',
      ciphertext: 'Y2lwaGVy',
    });
    expect(res.status).toBe(201);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
