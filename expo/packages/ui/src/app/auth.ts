/**
 * @complex-patient/ui — Sync_Backend authentication credentials (Requirement 4.1)
 *
 * The Client authenticates with the blind Sync_Backend via the WordPress REST
 * API using either a JWT token (Bearer) or a WordPress Application Password
 * (HTTP Basic) (Requirement 4.1). This module models that credential and builds
 * the `Authorization` header, with a small mutable provider so the entry points
 * can set/clear the session credential without rebuilding the HTTP client.
 *
 * Crucially, this credential is the ONLY thing that authenticates the user to
 * the server — the Master_Passphrase and KEK never leave the device and are
 * never placed in any header, body, or query parameter (Requirements 4.8, 1.3).
 */

/**
 * A WordPress REST API credential for the Sync_Backend (Requirement 4.1).
 *
 * - `jwt`: a bearer token issued by a JWT auth plugin; sent as
 *   `Authorization: Bearer <token>`.
 * - `application-password`: a WordPress Application Password paired with the
 *   account username; sent as HTTP Basic `Authorization: Basic <base64>`.
 */
export type WordPressAuth =
  | { kind: 'jwt'; token: string }
  | { kind: 'application-password'; username: string; applicationPassword: string };

/** Read-only access to the current Sync_Backend credential, if any. */
export interface AuthProvider {
  /** The active credential, or `null` when the user is not authenticated. */
  getAuth(): WordPressAuth | null;
}

/** A mutable {@link AuthProvider} the entry points use to sign in / out. */
export interface MutableAuthProvider extends AuthProvider {
  /** Set the active credential (sign in) or clear it with `null` (sign out). */
  setAuth(auth: WordPressAuth | null): void;
}

/**
 * Isomorphic Base64 encoder for the HTTP Basic credential. Uses `btoa` on web
 * and `Buffer` on native/Node, with a pure fallback so it compiles and runs
 * everywhere without a DOM or Node lib dependency.
 */
export function encodeBase64Utf8(input: string): string {
  const bytes = new TextEncoder().encode(input);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  if (typeof g.btoa === 'function') {
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return g.btoa(binary);
  }
  if (typeof g.Buffer !== 'undefined') {
    return g.Buffer.from(bytes).toString('base64');
  }
  return pureBase64(bytes);
}

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Pure Base64 fallback over raw bytes (no platform globals). */
function pureBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (b0 << 16) | (b1 << 8) | b2;
    out += B64_ALPHABET[(triple >> 18) & 0x3f];
    out += B64_ALPHABET[(triple >> 12) & 0x3f];
    out += i + 1 < bytes.length ? B64_ALPHABET[(triple >> 6) & 0x3f] : '=';
    out += i + 2 < bytes.length ? B64_ALPHABET[triple & 0x3f] : '=';
  }
  return out;
}

/**
 * Build the `Authorization` header value for a Sync_Backend request
 * (Requirement 4.1).
 *
 * @throws if a field is empty, since an empty credential must never be sent as
 * if it were valid — the caller should treat the absence of a credential as
 * "not authenticated" instead (Requirement 4.3).
 */
export function buildAuthorizationHeader(auth: WordPressAuth): string {
  if (auth.kind === 'jwt') {
    if (auth.token.length === 0) {
      throw new Error('JWT token must not be empty');
    }
    return `Bearer ${auth.token}`;
  }
  if (auth.username.length === 0 || auth.applicationPassword.length === 0) {
    throw new Error('Application Password credential requires username and password');
  }
  return `Basic ${encodeBase64Utf8(`${auth.username}:${auth.applicationPassword}`)}`;
}

/**
 * Create a mutable credential holder. The entry points call `setAuth` after a
 * successful WordPress sign-in and `setAuth(null)` on sign-out; the vault HTTP
 * client reads the current value per request.
 */
export function createAuthProvider(initial: WordPressAuth | null = null): MutableAuthProvider {
  let current = initial;
  return {
    getAuth: () => current,
    setAuth: (auth) => {
      current = auth;
    },
  };
}
