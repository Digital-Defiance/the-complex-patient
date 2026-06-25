# Deploying the Web App alongside WordPress

The web app is the same client as the mobile app, rendered in a browser via React Native Web. It decrypts vault data client-side using your passphrase — the server never sees plaintext.

## Production layout

| Surface | URL |
|---------|-----|
| WordPress site + sync API | `https://thecomplexpatient.com` |
| Web app (static bundle) | `https://thecomplexpatient.com/secure` |

The web client and WordPress share one domain. The app lives under `/secure`; sync calls go to the WordPress REST API at the site root:

```
https://thecomplexpatient.com/wp-json/complex-patient/v1/vault/{vault_type}
```

The Expo web build is configured with `baseUrl: /secure` in `expo/app.json` so assets and client-side routing resolve correctly under that path.

## Build

```bash
cd expo
yarn build:web
```

This creates `dist/web/` with static HTML/JS/CSS files.

## Deploy to the WordPress host

From `expo/`, with the `complex` host defined in your SSH config:

```bash
yarn build:web
yarn sync:complex
```

Or build and upload in one step:

```bash
yarn deploy:web
```

`sync:complex` rsyncs `dist/web/` to `complex:/home/thecompl/domains/thecomplexpatient.com/public_html/secure/`. Both sync scripts use `--checksum` (`-c`) so rsync compares file content (not just size/mtime), `--delete` removes stale assets on the destination, and only changed files are transferred. Run `yarn build:web` first if `dist/web/` does not exist.

**This deploys only the browser app.** Features that call new WordPress REST routes (for example paper backups at `/vault/paper-backups`) require the PHP plugin separately — see [Deploy the WordPress plugin](#deploy-the-wordpress-plugin) below.

For local WordPress Studio:

```bash
./sync-complex-local.sh
```

From `expo/`:

```bash
yarn sync:plugin-local
```

This copies the plugin into Studio **and** calls `POST /system/schema/repair` on `http://localhost:8881` to create any missing database tables (for example `paper_backup`). WordPress Studio must be running when you sync; if repair fails, open `http://localhost:8881` once and run the sync again.

The web app deploy is separate:

```bash
yarn build:web
yarn sync:complex-local
```

This copies to `/Users/jessica/Studio/the-complex-patient/secure/`.

## Deploy the WordPress plugin

The sync API lives in `wp/complex-patient/` at the **repo root**, not in `expo/`. `yarn deploy:web` does **not** upload it.

From the repository root:

```bash
./sync-complex.sh
```

For local WordPress Studio:

```bash
./sync-complex-local.sh
```

From `expo/` you can run the same scripts via Yarn:

```bash
yarn sync:plugin        # production (SSH rsync + schema repair via server loopback)
yarn sync:plugin-local  # local Studio plugins directory + schema repair
```

Both commands rsync PHP files **and** repair missing database tables (for example `paper_backup`). Local repair uses the REST endpoint on `http://localhost:8881`. Production repair SSHes in and runs `wp-load.php` with a **PHP 8.1+** CLI binary (DirectAdmin hosts often use `/usr/local/php82/bin/php`; default `php` may still be 7.4). Override with `COMPLEX_PATIENT_REMOTE_PHP_BIN` if needed.

The plugin runs `ensureSchema()` on load, so new tables (for example `wp_complex_patient_paper_backup`) are created without re-activating the plugin. After syncing, paper-backup routes are available at:

```
POST /wp-json/complex-patient/v1/vault/paper-backups
```

### WordPress .htaccess (Apache)

Add or merge this into the `/secure/` directory's `.htaccess` for client-side routing:

```apache
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /secure/
  RewriteRule ^index\.html$ - [L]
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule . /secure/index.html [L]
</IfModule>
```

### Nginx config

```nginx
location /secure/ {
  try_files $uri $uri/ /secure/index.html;
}
```

## Configuration

`SYNC_BACKEND_BASE_URL` in `apps/web/app/_layout.tsx` and `apps/mobile/app/_layout.tsx` must point at the **WordPress site root**, not the `/secure` app path:

```typescript
const SYNC_BACKEND_BASE_URL = 'https://thecomplexpatient.com';
```

The web app calls `https://thecomplexpatient.com/wp-json/complex-patient/v1/vault/{partition}` for sync.

For local web development (`yarn expo start` on port 8081), the sync backend resolves to **the same Metro origin** (`http://localhost:8081`). Metro proxies `/wp-json/*` to WordPress Studio on port 8881 (`metro.config.js`), so the browser does not make cross-origin requests. Confirm in the console:

```
[ComplexPatient] sync backend: http://localhost:8081
```

WordPress Studio must still be running on port 8881. Restart Metro after changing `metro.config.js`.

## HTTPS required

The web app must be served over HTTPS (or localhost for dev). Client-side decryption uses `window.crypto.subtle`, which browsers only expose in secure contexts.

## How it works

1. User visits `https://thecomplexpatient.com/secure`
2. Static JS bundle loads in their browser
3. User enters WordPress credentials → authenticates via Application Password or JWT
4. User enters their passphrase → browser derives KEK via PBKDF2
5. Browser fetches encrypted blobs from `/wp-json/complex-patient/v1/vault/*` on the same origin
6. Browser decrypts blobs locally using AES-256-GCM with the derived KEK
7. Medications, symptoms, insights render in the browser
8. All writes encrypt locally, then sync the ciphertext blob back to WordPress

The WordPress server never has the passphrase, KEK, or plaintext data.
