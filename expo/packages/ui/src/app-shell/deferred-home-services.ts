/**
 * Delay home-only side effects (permissions, push registration, location watch)
 * until the vault has stayed unlocked briefly so Android system dialogs do not
 * trip lock-on-background during the first seconds after unlock.
 */

import { useEffect, useState } from 'react';
import type { HomeEntryController } from '../app/home-entry';

const DEFAULT_DEFER_MS = 6_000;

/**
 * Returns true once {@link home} has been `ready` continuously for `delayMs`.
 */
export function useDeferredHomeServicesReady(
  home: HomeEntryController | null,
  delayMs: number = DEFAULT_DEFER_MS,
): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!home) {
      setReady(false);
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }

      if (home.getStatus() !== 'ready') {
        setReady(false);
        return;
      }

      timer = setTimeout(() => {
        if (home.getStatus() === 'ready') {
          setReady(true);
        }
      }, delayMs);
    };

    schedule();
    const unsubscribe = home.subscribeStatus(schedule);

    return () => {
      unsubscribe();
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [home, delayMs]);

  return ready;
}
