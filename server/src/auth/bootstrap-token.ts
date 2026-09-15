// Reproduces today's single-user behaviour on a fresh server without a
// special case in `register` itself: registration always needs a live
// account-creation token, so a server with no accounts yet needs one to be
// usable at all. Minted once, here, rather than by relaxing the check it
// replaced.

import { pool } from "../db/pool.js";
import { AuthService } from "./auth.service.js";

/** A full day: long enough for whoever deployed the server to come back and read the log. */
const BOOTSTRAP_TOKEN_MINUTES = 24 * 60;

export async function ensureBootstrapToken(): Promise<void> {
  const { rows: userRows } = await pool.query<{ count: string }>(
    "select count(*)::text as count from users",
  );
  if (userRows[0]?.count !== "0") return;

  const { rows: tokenRows } = await pool.query<{ count: string }>(
    `select count(*)::text as count from enrollment_tokens
      where kind = 'account_create' and used_at is null and expires_at > now()`,
  );
  if (tokenRows[0]?.count !== "0") return;

  const auth = new AuthService();
  const { token, expiresAt } = await auth.mintAccountToken({
    grantsRole: "admin",
    minutes: BOOTSTRAP_TOKEN_MINUTES,
  });

  console.log(
    [
      "",
      `No account exists yet. Registration token (grants admin, expires ${expiresAt}):`,
      "",
      `  ${token}`,
      "",
    ].join("\n"),
  );
}
