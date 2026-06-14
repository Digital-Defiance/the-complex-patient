Here's how to set up the WordPress backend:

Prerequisites:

A WordPress installation (local or hosted) with PHP 8.1+
MySQL/MariaDB
Steps:

Install WordPress locally (if you don't have one running):

# Easiest option — use LocalWP (https://localwp.com) or Docker:
# Docker one-liner:
docker run -d --name wp-complex-patient \
  -p 8080:80 \
  -e WORDPRESS_DB_HOST=db \
  -e WORDPRESS_DB_USER=wp \
  -e WORDPRESS_DB_PASSWORD=wp \
  -e WORDPRESS_DB_NAME=wp \
  --link wp-db:db \
  wordpress:latest
Or just download LocalWP — it gives you a one-click WordPress with PHP 8.1+ on macOS.

Install the plugin:

# Symlink (or copy) the plugin into your WP install's plugins directory:
ln -s /Volumes/Code/thecomplexpatient/wp/complex-patient \
  /path/to/wordpress/wp-content/plugins/complex-patient
Install PHP dependencies:

cd /Volumes/Code/thecomplexpatient/wp/complex-patient
composer install
Activate the plugin in WP Admin → Plugins → "The Complex Patient" → Activate. This creates the wp_complex_patient_vault table.

Enable Application Passwords (WordPress 5.6+ has this built in):

Go to WP Admin → Users → your user → scroll to "Application Passwords"
Enter a name (e.g. "Complex Patient App") and click "Add New"
Copy the generated password
Update the app's backend URL:

# In apps/mobile/app/_layout.tsx and apps/web/app/_layout.tsx:
const SYNC_BACKEND_BASE_URL = 'https://thecomplexpatient.com';
# For local WordPress:
const SYNC_BACKEND_BASE_URL = 'http://your-local-wp.local';
Sign in with your WordPress username + the application password from step 5.

The plugin is a "blind sync" backend — it stores encrypted blobs and never sees plaintext. The REST API exposes POST/GET /wp-json/complex-patient/v1/vault/{partition} for each vault type (medications, symptoms, etc.).