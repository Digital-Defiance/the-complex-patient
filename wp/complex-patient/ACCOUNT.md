# Account onboarding blocks

The plugin ships three dynamic blocks for registration and application password management.

## Pages (auto-created on activation)

| Page | Slug | Block |
|------|------|-------|
| Join | `/join/` | `complex-patient/register` |
| Finish setup | `/join/finish/` | `complex-patient/finish-setup` |
| Application passwords | `/account/application-passwords/` | `complex-patient/application-passwords` |

In the block editor, search **Application Passwords** or browse the **Complex Patient** block category. The block shows a placeholder in the editor; the full UI renders on the published page.

BuddyPress `/register` redirects to `/join/`.

## Flows

### Email registration (`/join/`)

1. User completes the registration form.
2. Optional **Create an application password** checkbox (default on).
3. Success screen shows the application password once (if created).
4. Links to groups and the secure app.

### WordPress.com (Jetpack SSO)

1. User clicks **Continue with WordPress.com** on `/join/`.
2. After SSO, new users are sent to `/join/finish/`.
3. User confirms display name, accepts privacy policy, optional app password checkbox.
4. Success screen + groups / password management links.

### Application passwords

Logged-in users manage **all** application passwords (not filtered by app) on `/account/application-passwords/`.

## Shortcodes

- `[complex_patient_register]`
- `[complex_patient_finish_setup]`
- `[complex_patient_application_passwords]`

## Styles

Scoped CSS: `assets/account.css` (enqueued when a page contains a block or shortcode).

## Local Studio

After updating the plugin in the monorepo, sync to WordPress Studio:

```bash
yarn sync:plugin-local
```

On activation or upgrade, pages are created on the next `init` (after rewrite rules load), not during `plugins_loaded`.

```bash
yarn sync:plugin-local
```

Re-activate the plugin or delete option `complex_patient_account_pages_ready` to force page recreation.
