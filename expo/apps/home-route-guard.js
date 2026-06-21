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
];
/** True when the current pathname is an authenticated home subtree route. */
export function isWithinHomeArea(pathname) {
    if (pathname === '/') {
        return true;
    }
    return HOME_AREA_PATH_SEGMENTS.some((segment) => pathname.includes(segment));
}
//# sourceMappingURL=home-route-guard.js.map