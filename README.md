# The Complex Patient

An offline-first, zero-knowledge, end-to-end encrypted (E2EE) digital health platform. Users track medications, symptoms, conditions, flares, and associations on their device. Health data is encrypted before it leaves the client; the server stores only opaque encrypted blobs.

**Documentation:** [Architecture guide](https://source.thecomplexpatient.com/architecture/)

## Production

| Surface | URL |
|---------|-----|
| **Web app** (Expo) | [thecomplexpatient.com/secure](https://thecomplexpatient.com/secure) |
| **WordPress site + sync API** | [thecomplexpatient.com](https://thecomplexpatient.com/) |
| **Architecture docs** (GitHub Pages) | [source.thecomplexpatient.com](https://source.thecomplexpatient.com/) |

The web client is a static bundle under `/secure`. It syncs encrypted vault blobs to the WordPress REST API at the site root (`/wp-json/complex-patient/v1/vault/...`).

## Repository structure

```
the-complex-patient/
├── docs/                  # GitHub Pages site (Jekyll) + architecture guide
├── expo/                  # Universal client monorepo (iOS, Android, web)
│   ├── apps/mobile/       # Native app entry + Expo Router routes
│   ├── apps/web/          # React Native Web entry
│   └── packages/          # Shared crypto, sync, UI, domain engines
├── wp/complex-patient/    # WordPress blind-sync plugin (PHP)
└── dev.md                 # Local WordPress backend setup
```

## Architecture at a glance

| Layer | Location | Role |
|-------|----------|------|
| **Client** | `expo/` | Encrypt/decrypt locally; local vault is source of truth |
| **Sync backend** | `wp/complex-patient/` | Authenticates users; stores encrypted blobs in MySQL |
| **Trust boundary** | Network | Only `{ sync_version, iv, auth_tag, ciphertext }` crosses the wire |

Two credentials, two jobs:

- **WordPress credential** (JWT or Application Password) — sync authentication only
- **Master passphrase → KEK** — vault encryption; never sent to the server

Read the full guide: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (also published at the [docs site](https://source.thecomplexpatient.com/architecture/)).

## Getting started

### Prerequisites

- Node.js 20+ and Yarn (Expo client)
- PHP 8.1+ and Composer (WordPress plugin)
- A WordPress install with MySQL/MariaDB

### WordPress backend

See [`dev.md`](dev.md) for plugin installation, Application Password setup, and pointing the client at your backend URL.

### Expo client

```bash
cd expo
yarn install
yarn test          # run the test suite
yarn start:web     # start the web client locally
```

Configure the sync backend URL in `expo/apps/mobile/app/_layout.tsx` and `expo/apps/web/app/_layout.tsx` (`SYNC_BACKEND_BASE_URL`). Production value: `https://thecomplexpatient.com` (WordPress root, not the `/secure` app path).

Web deployment notes: [`expo/WEB_DEPLOY.md`](expo/WEB_DEPLOY.md) — deploy the built bundle to `/secure` on the WordPress host.

## GitHub Pages (local preview)

The documentation site lives in `docs/` and deploys automatically on push to `main`.

```bash
cd docs
bundle install
bundle exec jekyll serve --baseurl "" --livereload
```

Open [http://127.0.0.1:4000](http://127.0.0.1:4000). Production is served at [source.thecomplexpatient.com](https://source.thecomplexpatient.com/) (custom domain, no path prefix).

After the first deploy, enable **GitHub Pages → Source: GitHub Actions** in the repository settings if it is not already configured.

## License

MIT — see [LICENSE](LICENSE).
