/**
 * @complex-patient/web
 *
 * React Native Web entry point.
 * Requires HTTPS and uses window.crypto.subtle for cryptographic operations.
 *
 * The authenticated home interface is composed from the shared
 * `@complex-patient/ui` codebase with identical feature parity to native
 * (Requirements 22.1, 22.2), connected to the web Session Key Store (volatile
 * RAM only) and the blind Sync_Backend authenticated via WordPress JWT /
 * Application Passwords (Requirement 4.1).
 */

export type { WebEntryOptions } from './entry';
export { createWebHome, SecureContextRequiredError } from './entry';
export { webFlagStorage } from './adapters';
export { createWebLifecycleAdapter } from './lifecycle-adapter';
