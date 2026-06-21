/**
 * Helpers for RouteWatcher — keep subsystem navigation under the home area.
 */

export const HOME_AREA_PATH_SEGMENTS = [
  'home',
  'medications',
  'journal',
  'insights',
  'export',
  'import',
  'settings',
] as const;

/** True when the current pathname is an authenticated home subtree route. */
export function isWithinHomeArea(pathname: string): boolean {
  if (pathname === '/') {
    return true;
  }

  return HOME_AREA_PATH_SEGMENTS.some((segment) => pathname.includes(segment));
}
