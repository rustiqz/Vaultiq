/**
 * Local dev defaults for the Join Vault form. Copy to `devConfig.ts`
 * (gitignored) and fill in what's convenient -- App.tsx imports that file
 * directly, so it must exist locally, same as `cp .env.example .env` at the
 * repo root.
 *
 * No default for the enrollment token: tokens are single-use and expire in
 * 15 minutes, so nothing here would still be valid by the time it's read.
 */
export const DEV_SERVER_URL = '';
export const DEV_DEVICE_NAME = '';
