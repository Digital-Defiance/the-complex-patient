import { describe, it, expect, vi } from 'vitest';
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

    await expect(client.postVault('medications', ENVELOPE)).rejects.toThrow(/not authenticated/i);
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
});
