# Deploying the Web App alongside WordPress

The web app is the same client as the mobile app, rendered in a browser via React Native Web. It decrypts your vault data client-side using your passphrase — the server never sees plaintext.

## Build

```bash
cd expo
yarn build:web
```

This creates `dist/web/` with static HTML/JS/CSS files.

## Deploy to WordPress Server

Upload the `dist/web/` contents to a subdirectory on your WordPress host:

```bash
# Example: deploy to yoursite.com/app/
scp -r dist/web/* user@yourserver:/var/www/html/app/
```

Or use a subdomain like `app.thecomplexpatient.com` pointing to the same directory.

### WordPress .htaccess (Apache)

If using Apache, add this to the `/app/` directory's `.htaccess` for client-side routing:

```apache
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /app/
  RewriteRule ^index\.html$ - [L]
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule . /app/index.html [L]
</IfModule>
```

### Nginx config

```nginx
location /app/ {
  try_files $uri $uri/ /app/index.html;
}
```

## Configuration

Before building, update the `SYNC_BACKEND_BASE_URL` in `apps/web/app/_layout.tsx` to point to your WordPress site's REST API:

```typescript
const SYNC_BACKEND_BASE_URL = 'https://yoursite.com';
```

The web app calls `https://yoursite.com/wp-json/complex-patient/v1/vault/{partition}` for sync.

## HTTPS Required

The web app MUST be served over HTTPS (or localhost for dev). Client-side decryption uses `window.crypto.subtle` which browsers only expose in secure contexts.

## How it works

1. User visits `https://yoursite.com/app/`
2. Static JS bundle loads in their browser
3. User enters WordPress credentials → authenticates via Application Password
4. User enters their passphrase → browser derives KEK via PBKDF2
5. Browser fetches encrypted blobs from `/wp-json/complex-patient/v1/vault/*`
6. Browser decrypts blobs locally using AES-256-GCM with the derived KEK
7. Medications, symptoms, insights render in the browser
8. All writes encrypt locally then sync the ciphertext blob back to WordPress

The WordPress server never has the passphrase, KEK, or plaintext data.
