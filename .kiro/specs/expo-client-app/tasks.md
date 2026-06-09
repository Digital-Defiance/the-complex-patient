# Implementation Plan: Expo Client App

## Overview

This plan builds the runnable universal Expo client (iOS, Android, Web via React Native Web) on top of the already-implemented, fully-tested headless logic packages in `expo/packages/*` and the composition roots `apps/mobile/src/entry.ts` / `apps/web/src/entry.ts`, all treated as fixed dependencies. Only the UI / app-shell layer and the runtime/dependency setup are added here; no logic package or backend behavior is changed.

The build proceeds bottom-up so each layer is validated before the layer above depends on it: (1) runtime dependencies + SDK pin + `app.json`, (2) the pure navigation resolver and shell types, (3) platform adapters, (4) React reactivity hooks, (5) the root layout / app-host composition, (6) onboarding screens, (7) auth / passphrase / biometric screens, (8) authenticated home plus activity / idle / background wiring and the sync-status indicator, (9) the polypharmacy, symptom-journal, and insights subsystem screens, and (10) end-to-end smoke and integration verification that `yarn expo start` and `yarn expo start --web` reach a running state. Each prompt builds on the previous one and ends by wiring its output into the shell, leaving no orphaned code.

All implementation is in **TypeScript / React (React Native + React Native Web)** per the design's interface contracts. Property-based tests cover the 13 correctness properties the design defines for the new UI surface (navigation resolver, secure-context gate, age re-prompt, passphrase length gate, PHI-equals-projection, render-order preservation, failed-commit retention, field-error round-trip, sync-status mapping, no-network-block, no-PHI-after-lock, zero-knowledge network invariant, and adapter conformance), using `@fast-check/vitest` at ≥100 iterations and React Native Testing Library for component-level properties. The already-tested platform logic is not re-tested. Every task in this plan is required; nothing is optional.

## Tasks

- [x] 1. Set up runtime dependencies, SDK pin, and application configuration
  - [x] 1.1 Declare and install the shared Expo SDK 56 runtime dependencies under Yarn PnP
    - Add `expo`, `react`, `react-dom`, `react-native`, `react-native-web`, and `expo-router` to the root `expo/package.json` `dependencies` and pin them to exact versions (no `^`/`~`) using `yarn expo install` so the SDK-56 resolver selects the concrete patch
    - Add `expo-secure-store`, `expo-local-authentication`, and `expo-notifications` to `apps/mobile/package.json` `dependencies` at exact SDK-56 pins via `yarn expo install`
    - Run `yarn install` so Yarn regenerates `.pnp.cjs`, keeping `nodeLinker: pnp` and creating no root `node_modules`; surface native Expo modules through `pnpUnplugged` as needed
    - _Requirements: 1.1, 1.2, 1.3, 1.6_

  - [x] 1.2 Add Metro/Expo PnP resolution config if required and verify SDK resolution
    - If Metro cannot resolve modules under PnP, add a Metro `resolver` config hooking the PnP API (via `.pnp.loader.mjs`) rather than switching `nodeLinker`
    - Ensure the `expo` module resolves and the declared runtime deps report no unresolved-dependency error
    - _Requirements: 1.3, 1.4, 1.5_

  - [x] 1.3 Author a valid `app.json` Expo configuration
    - Create/overwrite `expo/app.json` with non-empty `name` and `slug`, `sdkVersion` whose major equals the installed `expo` major, `platforms: ["ios","android","web"]`, `plugins: ["expo-router"]`, a deep-link `scheme`, and `web.bundler: "metro"`
    - Preserve the existing `extra.eas.projectId` value `03afbce3-092b-4382-ba04-8a0b4b34eef9` verbatim
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 1.4 Write integration tests for dependency resolution and app.json schema load
    - Assert exact (non-range) version pins for all declared runtime deps and that PnP is preserved with no root `node_modules` (1.1, 1.2, 1.6)
    - Run `expo install --check` to assert SDK compatibility and that an incompatible dep is reported with its expected range (1.5)
    - Load `app.json` and assert required fields present, preserved `projectId`, and that a missing `name`/`slug`/`sdkVersion` is reported and blocks a running state (2.6, 2.7)
    - _Requirements: 1.3, 1.5, 1.6, 2.6, 2.7_

- [x] 2. Implement the pure navigation resolver and shell types
  - [x] 2.1 Implement the navigation resolver and shared route/state types
    - Create the shell `app-shell` module with `AppRoute`, `NavState` types and the pure `resolveRoute(s: NavState): AppRoute` function mapping `(onboarding, home, secureContextBlocked, compositionFailed)` to a route per the status→route table
    - Ensure authenticated routes (`sign-in`, `unlock`, `home`) are only reachable when `onboarding = eligible`, and that `checking`/null fall back to `loading`
    - _Requirements: 3.6, 3.7, 4.4, 5.2, 5.7, 6.1, 6.3, 7.1, 7.2, 7.6, 8.1, 8.2, 8.3_

  - [x] 2.2 Write property test for the navigation resolver
    - **Property 1: Navigation is a total, correct projection of controller status**
    - **Validates: Requirements 3.6, 3.7, 5.2, 5.7, 6.1, 6.3, 7.1, 7.2, 7.6, 8.1, 8.2, 8.3**

- [x] 3. Implement platform adapters over the fixed key-store / device-storage interfaces
  - [x] 3.1 Implement the native key-store adapters
    - Implement `createExpoSecureStoreAdapter()` (`SecureStoreAdapter` over `expo-secure-store` with `requireAuthentication` + `WHEN_UNLOCKED_THIS_DEVICE_ONLY`) and `createExpoBiometricAdapter()` (`BiometricAdapter` over `expo-local-authentication`)
    - _Requirements: 3.3, 3.4_

  - [x] 3.2 Implement the KEK codec and device ineligibility-flag storage
    - Implement `createKekCodec()` (`KekCodec`) that Base64-serializes the KEK inner bytes and re-`wrapKey`s on read so it round-trips exactly
    - Implement `nativeFlagStorage` (`expo-secure-store`) and `webFlagStorage` (`localStorage`) satisfying `DeviceFlagStorage`, kept outside the Local_Vault
    - _Requirements: 14.3_

  - [x] 3.3 Implement the web lifecycle adapter
    - Implement `createWebLifecycleAdapter()` (`LifecycleAdapter`) registering `beforeunload`/`pagehide` handlers that let `WebSessionKeyStore` discard the KEK
    - _Requirements: 13.4_

  - [x] 3.4 Write property test for platform adapter conformance
    - **Property 13: Platform adapters conform to the fixed key-store contracts**
    - **Validates: Requirements 3.3, 3.4, 14.3**

- [x] 4. Implement React reactivity hooks bridging the controller stores
  - [x] 4.1 Implement the useSyncExternalStore bridge hooks
    - Implement `useStore(store, selector)` over `useSyncExternalStore` (tear-free, with a web snapshot), plus `usePartition(home, vaultType)` reading exclusively through `Home_Controller.read` and `useSyncStatus(home, vaultType)` reading the coordinator `syncStatus` store
    - _Requirements: 8.6, 12.1, 14.1_

  - [x] 4.2 Write unit tests for the reactivity hooks
    - Assert a coordinator `setState` propagates to subscribers within one React commit and that `usePartition` re-reads via `home.read` on each store transition
    - _Requirements: 8.6, 12.1_

- [x] 5. Implement the root layout / app-host composition
  - [x] 5.1 Implement the AppHost and per-platform host factories
    - Implement the `AppHost` context, the mobile root layout factory calling `createMobileApp` once with the secure-store/biometric/KEK-codec/HTTPS base URL/ineligibility storage adapters and injecting `expo-notifications`, and the web root layout factory calling `createWebApp` once with the `localStorage` ineligibility adapter and web lifecycle adapter
    - Construct controllers exactly once per launch; expose `route` derived via `resolveRoute` on every controller notification; guard `enterHome()` so the Home_Controller is never built before `onboarding = eligible`
    - Add the Expo Router `app/` tree (`_layout.tsx`, `index.tsx` redirect) for both `apps/mobile` and `apps/web` consuming shared screen components
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.7, 4.1_

  - [x] 5.2 Implement the web secure-context gate and composition-failure handling
    - Wrap `createHome()` in try/catch: a `SecureContextRequiredError` sets `secureContextBlocked` (routes to the secure-context-required screen, no Local_Vault, no onboarding/auth screen); other composition failures set `compositionFailed` (routes to the composition-failed screen)
    - Render the `secure-context-required`, `composition-failed`, and `loading` screens
    - _Requirements: 3.8, 4.2, 4.3, 4.4, 4.5_

  - [x] 5.3 Write unit tests for composition and gating
    - Assert controllers constructed exactly once (3.1), adapters injected into `createMobileApp`/`createWebApp` (3.2–3.5), the no-vault-before-eligible guard (3.7), and the composition-failure / secure-context screens render with no onboarding/auth surface and no Local_Vault (3.8, 4.5)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.7, 3.8, 4.5_

  - [x] 5.4 Write property test for the web secure-context gate
    - **Property 2: Web secure-context gate blocks exactly when crypto would be refused**
    - **Validates: Requirements 4.2, 4.3, 4.4**

- [x] 6. Implement onboarding screens (age-gate and terminal ineligibility)
  - [x] 6.1 Implement the age-gate screen
    - Call `onboarding.start()` before rendering any step; render a loading indicator while `checking`; render the age-gate screen (birth-month input 1–12, four-digit birth-year input) while `age-gate`; route submission through `onboarding.submitAge`; on eligible dismiss and navigate to passphrase setup; on `INVALID_AGE_INPUT` show the re-prompt and stay; exclude birth month/year from all storage and requests; surface an onboarding-start-failure message on `start()` rejection
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.9_

  - [x] 6.2 Implement the terminal ineligibility screen
    - Render the ineligibility screen while `ineligible` (including when `start()` reports `ineligible` directly) with no control returning to the age-gate; fall back to rendering the age-gate screen if the ineligibility screen fails to render
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 6.3 Write unit tests for onboarding screens
    - Assert `start()` ordering and failure handling (5.1, 5.3), age inputs present and routed through `submitAge` (5.4, 5.5), ineligibility screen has no back control and renders without the age-gate (6.2, 6.3), and the render-failure fallback (6.4)
    - _Requirements: 5.1, 5.3, 5.4, 5.5, 6.2, 6.3, 6.4_

  - [x] 6.4 Write property test for the age re-prompt
    - **Property 3: Age re-prompt is shown exactly on invalid input**
    - **Validates: Requirements 5.6, 5.8**

- [x] 7. Implement authentication screens (sign-in, passphrase unlock, biometric, KEK derivation)
  - [x] 7.1 Implement the sign-in screen
    - Render the sign-in screen while `signed-out`; route sign-in through `home.signIn`
    - _Requirements: 7.1, 8.2_

  - [x] 7.2 Implement the passphrase setup/unlock flow with KEK derivation
    - Render the unlock screen while `locked`; implement `submitPassphrase` enforcing the 8–128 length bound before deriving (no KEK on out-of-bound), deriving the KEK through the Crypto_Engine (`generateSalt`/`deriveKEK`), persisting non-secret KDF material outside the vault, and calling `home.unlockWithKek`; on `ready` navigate to home; on non-ready (non-biometric) preserve locked state and stay
    - Exclude the Master_Passphrase and derived KEK from all Sync_Backend requests
    - _Requirements: 7.2, 7.3, 7.6, 7.7, 7.8, 7.9_

  - [x] 7.3 Implement the biometric unlock path (native)
    - Implement `submitBiometric` calling `home.unlock`; on `BIOMETRIC_FAILED`/`BIOMETRIC_LOCKED_OUT` present the passphrase re-entry path and stay on unlock; on other non-ready preserve locked state and stay; on `ready` navigate to home
    - _Requirements: 7.4, 7.5, 7.9_

  - [x] 7.4 Write unit tests for the auth/unlock screens
    - Assert KEK forwarded to `unlockWithKek` (7.3), biometric wiring and fallback (7.4, 7.5), and non-ready results preserve the locked state (7.9)
    - _Requirements: 7.3, 7.4, 7.5, 7.9_

  - [x] 7.5 Write property test for the passphrase length gate
    - **Property 4: Passphrase derivation occurs exactly within the length bound**
    - **Validates: Requirements 7.8**

- [x] 8. Implement the authenticated home, sync-status indicator, and activity/lock wiring
  - [x] 8.1 Implement the authenticated home screen
    - Render the home screen while `ready` (sign-in while `signed-out`, unlock while `locked`); present navigation entries for Polypharmacy, Symptom Journal, and Insights; read displayed data exclusively through `home.read`; wire sign-out through `home.signOut` then navigate to sign-in; navigate to a subsystem on entry selection; on `home.read` failure show a data-unavailable message and render no stale/partial PHI
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

  - [x] 8.2 Implement the sync-status indicator and connectivity wiring
    - Implement the indicator component mounted in the authenticated stack header rendering a pairwise-distinct visual state per `PartitionSyncStatus` (idle/syncing/pending/conflict) via `useSyncStatus`, updating within 1s of a coordinator change; add a network-state listener (native reachability / web `online`) calling `home.onConnectivityRestored()` within 5s; disable backend-only controls while unreachable while keeping all Local_Vault reads/writes/navigation enabled
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 14.5_

  - [x] 8.3 Implement the activity, idle auto-lock, and lock-on-background wiring
    - Wrap the authenticated stack in a responder forwarding touch/pointer/keyboard/navigation interactions to `home.notifyActivity()`; attach native `AppState` background → `home.lock.lock()` within 1s and web `visibilitychange → hidden` → lock; react to the `locked` status by routing to `/auth/unlock`; on lock (idle/background/explicit) clear rendered PHI within 1s, and on lock failure still clear PHI and route to unlock
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6_

  - [x] 8.4 Write unit tests for home, sync-status, and lock wiring
    - Assert home nav entries and sign-out (8.4, 8.5, 8.7), read-failure data-unavailable (8.8), connectivity-restored wiring (12.4), disabled backend-only controls (14.5), activity/idle/background/lifecycle wiring with fake timers (13.1–13.4), and lock-failure clears PHI (13.6)
    - _Requirements: 8.4, 8.5, 8.7, 8.8, 12.4, 13.1, 13.2, 13.3, 13.4, 13.6, 14.5_

  - [x] 8.5 Write property test for PHI-equals-projection
    - **Property 5: Rendered PHI equals the Home_Controller projection**
    - **Validates: Requirements 8.6, 11.6, 14.1**

  - [x] 8.6 Write property test for the sync-status indicator mapping
    - **Property 9: Sync-status indicator is a total, injective mapping**
    - **Validates: Requirements 12.1, 12.2, 12.3**

  - [x] 8.7 Write property test for no-PHI-after-lock
    - **Property 11: No PHI survives a lock**
    - **Validates: Requirements 13.5, 13.6**

  - [x] 8.8 Write property test for no-network-block reads and writes
    - **Property 10: Reads and writes never block on the network**
    - **Validates: Requirements 12.5, 12.6, 14.4**

- [x] 9. Implement subsystem screens (polypharmacy, symptom journal, insights)
  - [x] 9.1 Implement the polypharmacy list and adaptive-view screen
    - Render `buildPolypharmacyView(home.read('medications').records)` blocks in the exact returned order with no omission/reorder/insertion; render an empty-medication-list message with no rows when zero profiles; persist edits exclusively through `home.commit('medications', …)`; on commit failure show a "not saved" message and retain entered values
    - _Requirements: 9.1, 9.2, 9.3, 9.6, 9.7_

  - [x] 9.2 Implement the PRN quick-log screen
    - Route entries through the `PrnQuickLogEngine` path only (no other regimen mutation); render the `PrnQuickLogEvaluation` outcome including any safety-threshold-exceeded result before accepting another entry; persist through `home.commit` and retain values on commit failure
    - _Requirements: 9.4, 9.5, 9.6, 9.7_

  - [x] 9.3 Implement the symptom journal log and flare screens
    - Route symptom entries through `createSymptomJournal` and flare-ups through `createFlareJournal` (no other path); on a returned `FieldError` display it and retain entered values, clearing the error on a successful submission; persist exclusively through `home.commit` and retain values on commit failure
    - _Requirements: 10.1, 10.2, 10.5, 10.6, 10.7, 10.8_

  - [x] 9.4 Implement the condition timeline screen
    - Render `buildConditionTimeline(...)` entries ordered oldest-to-newest; render an empty-timeline message with no entries when zero
    - _Requirements: 10.3, 10.4_

  - [x] 9.5 Implement the insights cards and physician report screens
    - Render correlation insight cards from the Insights_Engine; on insufficient history show the insufficient-history message with no cards; on zero correlations without insufficiency show a no-correlations-found message; generate the physician report on-device through the insights report path without transmitting report-source PHI, showing a report-generation-failure message and staying on insights on failure; compute cards and reports only from `home.read` data; block insights with a data-unavailable message when the data source is unavailable
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7_

  - [x] 9.6 Write unit tests for subsystem routing and gating
    - Assert PRN routing and threshold display (9.4, 9.5), commit-only writers (9.6, 10.7), journal/flare routing (10.1, 10.2), and insights presence/gating/error branches (11.1–11.3, 11.5, 11.7)
    - _Requirements: 9.4, 9.5, 9.6, 10.1, 10.2, 10.7, 11.1, 11.2, 11.3, 11.5, 11.7_

  - [x] 9.7 Write property test for render order/structure preservation
    - **Property 6: Rendering preserves engine-produced order and structure**
    - **Validates: Requirements 9.1, 9.2, 9.3, 10.3, 10.4**

  - [x] 9.8 Write property test for failed-commit value retention
    - **Property 7: A failed commit retains entered values and reports non-persistence**
    - **Validates: Requirements 9.7, 10.8**

  - [x] 9.9 Write property test for field-error round-trip
    - **Property 8: Field-error display round-trips with submission outcome**
    - **Validates: Requirements 10.5, 10.6**

- [x] 10. End-to-end integration, zero-knowledge verification, and dev-server smoke
  - [x] 10.1 Wire the full route tree and extend the universal integration suites
    - Wire all screens into the `apps/mobile` and `apps/web` Expo Router `app/` trees through the shared screen components and the app host; extend the existing `universal-e2e.integration.test.ts` suites to cover the shell wiring (onboarding → eligible → unlock → home → subsystem) across mocked native and web runtimes
    - _Requirements: 3.6, 4.1, 8.1, 14.1_

  - [x] 10.2 Write property test for the zero-knowledge network invariant
    - **Property 12: Zero-knowledge network invariant holds for all UI-driven flows**
    - **Validates: Requirements 5.9, 7.7, 11.4, 14.2, 14.6**

  - [x] 10.3 Write smoke verification for the development server
    - Verify `yarn expo start` reaches a running development-server state and prints a reachable URL with no "Expo SDK version cannot be determined" error (1.4); verify `yarn expo start --web` serves over a secure context (HTTPS or a `localhost` origin treated as secure) (4.6)
    - _Requirements: 1.4, 4.6_

- [x] 11. Final checkpoint - ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Every task, including all unit, integration, property-based, and smoke sub-tasks, is required and will be implemented. There are no optional tasks.
- Each task references specific granular requirement clauses for traceability.
- Property-based tests cover all 13 correctness properties from the design, scoped to the new UI surface: Property 1 (navigation resolver), Property 2 (secure-context gate), Property 3 (age re-prompt), Property 4 (passphrase length gate), Property 5 (PHI-equals-projection), Property 6 (render-order preservation), Property 7 (failed-commit retention), Property 8 (field-error round-trip), Property 9 (sync-status mapping), Property 10 (no-network-block), Property 11 (no-PHI-after-lock), Property 12 (zero-knowledge network invariant), and Property 13 (adapter conformance). They use `@fast-check/vitest` at ≥100 iterations, with React Native Testing Library for component-level properties.
- The already-tested platform logic (crypto, sync/merge, age rule, adaptive view, timeline, PRN safety, insights gating) is consumed, not re-tested.
- Unit, integration, and smoke tests validate the example-classified criteria, dependency/config resolution, and the runnable dev-server states.
- The build is bottom-up so there is no orphaned code: runtime/config underpins the resolver and adapters, the hooks and host compose them, and the screens and end-to-end wiring integrate everything in the final waves.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "2.1", "3.1", "3.2", "3.3"] },
    { "id": 2, "tasks": ["1.4", "2.2", "3.4", "4.1"] },
    { "id": 3, "tasks": ["4.2", "5.1"] },
    { "id": 4, "tasks": ["5.2", "5.3", "5.4"] },
    { "id": 5, "tasks": ["6.1", "6.2", "7.1", "7.2", "7.3"] },
    { "id": 6, "tasks": ["6.3", "6.4", "7.4", "7.5", "8.1"] },
    { "id": 7, "tasks": ["8.2", "8.3"] },
    { "id": 8, "tasks": ["8.4", "8.5", "8.6", "8.7", "8.8", "9.1", "9.2", "9.3", "9.4", "9.5"] },
    { "id": 9, "tasks": ["9.6", "9.7", "9.8", "9.9", "10.1"] },
    { "id": 10, "tasks": ["10.2", "10.3"] }
  ]
}
```
