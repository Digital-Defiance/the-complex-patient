/**
 * Smoke tests for the Expo development server.
 *
 * Validates:
 * - Requirement 1.4: `yarn expo start` reaches a running dev-server state and prints
 *   a reachable URL with no "Expo SDK version cannot be determined" error.
 * - Requirement 4.6: `yarn expo start --web` serves over a secure context (HTTPS or
 *   a localhost origin treated as secure by browsers).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import { resolve } from 'path';

const WORKSPACE_ROOT = resolve(__dirname, '../../..');
const STARTUP_TIMEOUT_MS = 60_000;
const DEV_SERVER_PORT =
  32_100 + (Number(process.env.VITEST_POOL_ID ?? '0') % 100) * 10 + (process.pid % 7);
const DEV_SERVER_WEB_PORT = DEV_SERVER_PORT + 1;

/**
 * Spawns an Expo dev server process and collects output until a condition is met
 * or the timeout expires. Always kills the process on completion.
 */
function spawnAndWait(
  args: string[],
  opts: {
    /** Return true to resolve early with accumulated output */
    resolveWhen: (accumulated: string) => boolean;
    /** Return true to reject early with an error */
    rejectWhen?: (accumulated: string) => string | null;
    timeoutMs?: number;
  },
): Promise<string> {
  const timeout = opts.timeoutMs ?? STARTUP_TIMEOUT_MS;

  return new Promise<string>((resolvePromise, rejectPromise) => {
    let accumulated = '';
    let settled = false;
    let proc: ChildProcess | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (proc && !proc.killed) {
        proc.kill('SIGTERM');
        // Force kill after a grace period
        setTimeout(() => {
          if (proc && !proc.killed) {
            proc.kill('SIGKILL');
          }
        }, 3_000);
      }
    };

    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true;
        cleanup();
        fn();
      }
    };

    // Override NODE_ENV to 'development' so the React Native dev-middleware
    // doesn't trigger its "must be mocked in tests" assertion (which fires
    // when NODE_ENV === 'test' as set by vitest).
    const childEnv = { ...process.env, NODE_ENV: 'development', EXPO_NO_TELEMETRY: '1' };
    proc = spawn('yarn', ['expo', ...args], {
      cwd: WORKSPACE_ROOT,
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const onData = (chunk: Buffer) => {
      accumulated += chunk.toString();

      // Check reject condition first
      if (opts.rejectWhen) {
        const errorMsg = opts.rejectWhen(accumulated);
        if (errorMsg) {
          settle(() => rejectPromise(new Error(errorMsg)));
          return;
        }
      }

      // Check resolve condition
      if (opts.resolveWhen(accumulated)) {
        settle(() => resolvePromise(accumulated));
      }
    };

    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);

    proc.on('error', (err) => {
      settle(() => rejectPromise(err));
    });

    proc.on('close', (code) => {
      settle(() => {
        if (opts.resolveWhen(accumulated)) {
          resolvePromise(accumulated);
        } else {
          rejectPromise(
            new Error(
              `Process exited with code ${code} before reaching ready state.\nOutput:\n${accumulated.slice(-2000)}`,
            ),
          );
        }
      });
    });

    timer = setTimeout(() => {
      settle(() =>
        rejectPromise(
          new Error(
            `Timed out after ${timeout}ms waiting for dev server.\nOutput:\n${accumulated.slice(-2000)}`,
          ),
        ),
      );
    }, timeout);
  });
}

/** Matches the Metro "waiting on" line or an exp:// / http:// URL printed by Expo */
const SERVER_URL_PATTERN =
  /Metro waiting on|(?:exp|http|https):\/\/[\w.:]+/i;

const SDK_ERROR_PATTERN = /Expo SDK version cannot be determined/i;

describe('Development Server Smoke Tests', () => {
  // Track any processes we need to clean up
  let cleanupFns: Array<() => void> = [];

  afterEach(() => {
    for (const fn of cleanupFns) {
      try { fn(); } catch { /* best effort */ }
    }
    cleanupFns = [];
  });

  it(
    'yarn expo start reaches a running state and prints a reachable URL without SDK version error (Requirement 1.4)',
    async () => {
      const output = await spawnAndWait(['start', '--port', String(DEV_SERVER_PORT)], {
        resolveWhen: (acc) => SERVER_URL_PATTERN.test(acc),
        rejectWhen: (acc) => {
          if (SDK_ERROR_PATTERN.test(acc)) {
            return `Dev server output contains "Expo SDK version cannot be determined" error.\nOutput:\n${acc.slice(-2000)}`;
          }
          return null;
        },
        timeoutMs: STARTUP_TIMEOUT_MS,
      });

      // The output should contain a server URL
      expect(output).toMatch(SERVER_URL_PATTERN);
      // The output must NOT contain the SDK resolution error
      expect(output).not.toMatch(SDK_ERROR_PATTERN);
    },
    STARTUP_TIMEOUT_MS + 5_000,
  );

  it(
    'yarn expo start --web serves on localhost (secure context) (Requirement 4.6)',
    async () => {
      const output = await spawnAndWait(['start', '--web', '--port', String(DEV_SERVER_WEB_PORT)], {
        resolveWhen: (acc) => {
          // Expo web dev server outputs something like "Metro waiting on http://localhost:8081"
          // or the webpack/metro bundler URL for web
          return /(?:http|https):\/\/localhost[:\d]*/i.test(acc) ||
            /Metro waiting on/i.test(acc);
        },
        rejectWhen: (acc) => {
          if (SDK_ERROR_PATTERN.test(acc)) {
            return `Web dev server output contains SDK error.\nOutput:\n${acc.slice(-2000)}`;
          }
          return null;
        },
        timeoutMs: STARTUP_TIMEOUT_MS,
      });

      // The web server URL must be on localhost (which browsers treat as a secure context)
      // OR served over HTTPS. Either satisfies Requirement 4.6.
      const localhostPattern = /(?:http|https):\/\/localhost[:\d]*/i;
      const httpsPattern = /https:\/\/[\w.:]+/i;

      const isSecureContext =
        localhostPattern.test(output) || httpsPattern.test(output);

      expect(
        isSecureContext,
        `Web dev server must serve on localhost or HTTPS for secure context. Output:\n${output.slice(-1000)}`,
      ).toBe(true);

      // Should not have the SDK version error
      expect(output).not.toMatch(SDK_ERROR_PATTERN);
    },
    STARTUP_TIMEOUT_MS + 5_000,
  );
});
