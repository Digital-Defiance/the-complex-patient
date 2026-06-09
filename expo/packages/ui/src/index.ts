/**
 * @complex-patient/ui
 *
 * Shared components and hooks consumed by mobile + web apps.
 *
 * Includes the Zustand-style vault store that mirrors the decrypted
 * Local_Vault partitions (design.md → State Management): hydrated by decrypting
 * partitions on unlock, updated through the write-through commit path, and
 * cleared together with the KEK on lock/idle timeout (Requirements 5.1, 5.2,
 * 5.4, 3.6, 3.7).
 *
 * Also exposes the shared authenticated platform entry-point wiring (task 15.3,
 * Requirements 22.1, 22.2, 4.1) consumed by the mobile and web apps.
 */

export * from './store';
export * from './app';
export * from './app-shell';
