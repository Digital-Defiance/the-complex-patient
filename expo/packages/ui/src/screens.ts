/**
 * Screen components — import from `@complex-patient/ui/screens` in route files.
 *
 * Kept separate from the main package entry so app startup does not eagerly
 * load heavy native modules (expo-camera) before the matching route mounts.
 */

export * from './app-shell/screens/index';
