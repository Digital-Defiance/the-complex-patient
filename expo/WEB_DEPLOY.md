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

Upload the `dist/web/` contents to the `/secure/` directory on your WordPress server:

```bash
scp -r dist/web/* user@yourserver:/var/www/html/secure/
```

Adjust the remote path to match your host's document root.

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

For local development, point this at your local WordPress URL instead.

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
