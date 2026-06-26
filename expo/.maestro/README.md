# Maestro UI tests

## Credentials (recommended)

```bash
# From repo root
yarn sync:plugin-local

cd expo
yarn maestro:provision   # creates maestro-e2e + writes .maestro/.env
yarn test:maestro:smoke
```

Manual fallback:

```bash
cp .maestro/.env.example .maestro/.env
# edit .maestro/.env, or run yarn maestro:provision
```

## Run

```bash
yarn test:maestro:smoke
yarn test:maestro .maestro/flows/drug-naming-confirm-advil.yaml
```

### Expo dev client overlays

Development builds may show the Expo **developer menu onboarding** sheet (`This is the developer menu` + **Continue**) on first launch or after `clearState`. `bootstrap-session.yaml` runs `subflows/dismiss-expo-dev-ui.yaml` right after `launchApp` to dismiss that sheet, the dev-launcher URL picker, or an open dev drawer when present.

To skip onboarding at the native level (requires `npx expo run:ios` rebuild):

```json
["expo-dev-client", { "skipOnboarding": true, "showMenuAtLaunch": false }]
```

### iOS keyboard

Number/decimal pads have no system dismiss key. Flows use `subflows/tap-keyboard-done.yaml` to tap the app’s **Done** accessory (`testID: keyboard-done`) instead of Maestro’s `hideKeyboard`, which fails on those keyboards.

### Auth screen detection

After the age gate, `wait-for-auth-screen.yaml` waits for `sign-in-screen` or `unlock-screen` before running credentials. Bootstrap uses those testIDs (not subtitle text + `notVisible` guards) so sign-in is not skipped during navigation.

Credentials: `yarn maestro:provision` writes `.maestro/.env` with `MAESTRO_WP_USERNAME` / `MAESTRO_WP_PASSWORD`.

See `scripts/maestro-provision-wp-user.sh` and `scripts/maestro-test.sh`.
