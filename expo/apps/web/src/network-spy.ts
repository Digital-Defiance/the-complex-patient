/**
 * @complex-patient/web — Test-scoped network spy
 *
 * A {@link FetchLike} transport wrapper that records EVERY outbound request the
 * vault HTTP client (and therefore the Sync_Worker) issues — its method, URL,
 * headers, query string, and body — so a test can assert the zero-knowledge
 * network invariant (design.md → "Testing the Zero-Knowledge Invariant",
 * Property 12). On web the same wrapper conceptually wraps `window.fetch` /
 * `XMLHttpRequest`; here it wraps the injectable transport, which is the single
 * network seam exercised under vitest.
 *
 * This helper is test-scoped (it lives in the app's test sources) and contains
 * no production wiring; it only observes traffic and returns a benign success
 * envelope so sync runs complete.
 */

import type { FetchLike, FetchLikeResponse } from '@complex-patient/ui';

/** A single captured outbound request. */
export interface CapturedRequest {
  method: string;
  url: string;
  /** The query-string portion of the URL (including leading `?`), or ''. */
  search: string;
  /** A shallow copy of the request headers. */
  headers: Record<string, string>;
  /** The serialized request body, if any. */
  body?: string;
}

/** A network spy plus its captured request log. */
export interface NetworkSpy {
  /** The {@link FetchLike} transport to inject into the vault HTTP client. */
  readonly fetch: FetchLike;
  /** Every outbound request captured, in order. */
  readonly requests: CapturedRequest[];
  /**
   * A single string that concatenates the method, URL, headers, and body of a
   * captured request — convenient for substring leak assertions.
   */
  serialize(request: CapturedRequest): string;
}

/**
 * Create a {@link NetworkSpy}. Every call is recorded and answered with a
 * `200 { sync_version }` envelope so the Sync_Worker treats the push as
 * accepted (no retries, no 409). The spy never inspects, decrypts, or persists
 * anything — it only records what crossed the boundary.
 */
export function createNetworkSpy(): NetworkSpy {
  const requests: CapturedRequest[] = [];

  const fetch: FetchLike = async (url, init): Promise<FetchLikeResponse> => {
    let search = '';
    try {
      search = new URL(url).search;
    } catch {
      // Non-absolute URL — leave search empty; the raw url is still captured.
    }
    requests.push({
      method: init.method,
      url,
      search,
      headers: { ...init.headers },
      body: init.body,
    });

    // Echo back a freshly incremented version so a POST is accepted (200).
    let nextVersion = 1;
    if (typeof init.body === 'string') {
      try {
        const parsed = JSON.parse(init.body) as { sync_version?: number };
        if (typeof parsed.sync_version === 'number') {
          nextVersion = parsed.sync_version + 1;
        }
      } catch {
        // Non-JSON body; default version is fine.
      }
    }

    return {
      status: 200,
      json: async () => ({ sync_version: nextVersion }),
    };
  };

  function serialize(request: CapturedRequest): string {
    return [
      request.method,
      request.url,
      JSON.stringify(request.headers),
      request.body ?? '',
    ].join('\n');
  }

  return { fetch, requests, serialize };
}
