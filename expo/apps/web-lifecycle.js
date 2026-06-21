/**
 * Web tab lifecycle hooks for {@link WebSessionKeyStore}.
 *
 * Shared by the dedicated web app and mobile-on-web (Expo default router root).
 */
export function createWebTabLifecycleAdapter() {
    return {
        onTabClose(handler) {
            if (typeof window === 'undefined') {
                return;
            }
            window.addEventListener('beforeunload', handler);
            window.addEventListener('pagehide', handler);
        },
    };
}
//# sourceMappingURL=web-lifecycle.js.map