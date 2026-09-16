// An interactive console for issuing invitations and reviewing who has
// access -- the operator-facing half of always-invite-only registration.
//
// Talks to the database directly rather than through an authenticated HTTP
// route. Whoever can run this already has the same trust level as the
// server process itself: shell access to the host, or `docker compose exec`
// into the running container. There is nothing left here to authenticate.
//
// Run locally with `pnpm run admin` (needs DATABASE_URL, same as `migrate`);
// against a real deployment with `docker compose exec server node
// dist/admin/cli.js`, since the database is deliberately not reachable from
// the host any other way.

import * as p from "@clack/prompts";
import { toString as qrToString } from "qrcode";
import { fileURLToPath } from "node:url";
import { listAuditLog, pruneAuditLog } from "../audit/audit-log.js";
import { AuthService, type Capability } from "../auth/auth.service.js";
import { pool } from "../db/pool.js";
import { inviteUri } from "./invite-uri.js";

const EXPIRIES = [
  { label: "1 hour", minutes: 60 },
  { label: "24 hours", minutes: 24 * 60 },
  { label: "7 days", minutes: 7 * 24 * 60 },
] as const;

const CAPABILITIES: { value: Capability; label: string; hint: string }[] = [
  { value: "manage_invitations", label: "Manage invitations", hint: "issue and revoke registration tokens" },
  { value: "manage_devices", label: "Manage devices", hint: "revoke any account's devices" },
  { value: "view_audit_log", label: "View audit log", hint: "read the security event history" },
];

async function invite(auth: AuthService): Promise<void> {
  const capabilities = await p.multiselect<Capability>({
    message: "What should this invitation grant? (none = plain member)",
    options: CAPABILITIES,
    required: false,
  });
  if (p.isCancel(capabilities)) return;

  const minutes = await p.select<number>({
    message: "Expires in?",
    options: EXPIRIES.map((e) => ({ value: e.minutes, label: e.label })),
  });
  if (p.isCancel(minutes)) return;

  const server = await p.text({
    message: "Server URL (shown to whoever redeems this, via the QR)",
    placeholder: "https://vault.example.com",
    validate: (value) => (value?.trim() ? undefined : "Required for the QR to be useful."),
  });
  if (p.isCancel(server)) return;

  const { token, expiresAt } = await auth.mintAccountToken({
    grantsCapabilities: capabilities,
    minutes,
  });
  const qr = await qrToString(inviteUri(server, token), { type: "terminal", small: true });

  const what = capabilities.length > 0 ? capabilities.join(", ") : "member";
  p.note([qr, "", token, "", `Expires ${expiresAt}`].join("\n"), `Invitation (${what})`);
}

interface UserRow {
  id: string;
  created_at: Date;
  capabilities: string[];
}

interface DeviceRow {
  id: string;
  user_id: string;
  name: string;
  enrolled_at: Date;
  revoked_at: Date | null;
}

function describeUser(user: UserRow): string {
  const what = user.capabilities.length > 0 ? user.capabilities.join(", ") : "member";
  return `${user.id} (${what}, joined ${user.created_at.toISOString()})`;
}

async function listedUsers(): Promise<UserRow[]> {
  const { rows } = await pool.query<UserRow>(
    `select u.id, u.created_at,
            coalesce(array_agg(c.capability) filter (where c.capability is not null), '{}') as capabilities
       from users u
       left join user_capabilities c on c.user_id = u.id
      group by u.id, u.created_at
      order by u.created_at`,
  );
  return rows;
}

async function listUsers(): Promise<void> {
  const users = await listedUsers();
  if (users.length === 0) {
    p.note("No accounts yet.");
    return;
  }

  const { rows: devices } = await pool.query<DeviceRow>(
    "select id, user_id, name, enrolled_at, revoked_at from devices order by enrolled_at",
  );

  const lines: string[] = [];
  for (const user of users) {
    lines.push(describeUser(user));
    const theirs = devices.filter((d) => d.user_id === user.id);
    if (theirs.length === 0) lines.push("  no devices");
    for (const device of theirs) {
      const status = device.revoked_at ? `revoked ${device.revoked_at.toISOString()}` : "active";
      lines.push(`  - ${device.name} (${status})`);
    }
  }
  p.note(lines.join("\n"), `${String(users.length)} account(s)`);
}

interface TokenRow {
  kind: string;
  grants_capabilities: string[];
  created_at: Date;
  expires_at: Date;
}

async function listTokens(): Promise<void> {
  const { rows } = await pool.query<TokenRow>(
    `select kind, grants_capabilities, created_at, expires_at from enrollment_tokens
      where used_at is null and expires_at > now()
      order by created_at`,
  );
  if (rows.length === 0) {
    p.note("No live invitations.");
    return;
  }

  const lines = rows.map((row) => {
    const what =
      row.kind === "account_create"
        ? `account (${row.grants_capabilities.length > 0 ? row.grants_capabilities.join(", ") : "member"})`
        : "device";
    return `${what} -- expires ${row.expires_at.toISOString()}`;
  });
  p.note(lines.join("\n"), `${String(rows.length)} outstanding invitation(s)`);
}

async function revokeUser(): Promise<void> {
  const users = await listedUsers();
  if (users.length === 0) {
    p.note("No accounts yet.");
    return;
  }

  const userId = await p.select<string>({
    message: "Revoke every device for which account?",
    options: users.map((u) => ({ value: u.id, label: describeUser(u) })),
  });
  if (p.isCancel(userId)) return;

  const sure = await p.confirm({
    message: "This locks the account out permanently -- there is no recovery. Continue?",
    initialValue: false,
  });
  if (p.isCancel(sure) || !sure) return;

  await pool.query("update devices set revoked_at = now() where user_id = $1 and revoked_at is null", [
    userId,
  ]);
  // Outstanding device-join invitations from this account are useless
  // without a trusted device left to redeem them against.
  await pool.query(
    "update enrollment_tokens set used_at = now() where user_id = $1 and used_at is null and kind = 'device_join'",
    [userId],
  );

  p.note("All devices revoked.");
}

async function viewAuditLog(): Promise<void> {
  const entries = await listAuditLog(50);
  if (entries.length === 0) {
    p.note("Nothing logged yet.");
    return;
  }

  const lines = entries.map((entry) => {
    const who = entry.userId ?? "-";
    const where = entry.sourceIp ? ` from ${entry.sourceIp}` : "";
    const detail = Object.keys(entry.detail).length > 0 ? ` ${JSON.stringify(entry.detail)}` : "";
    return `${entry.occurredAt}  ${entry.eventType}  user=${who}${where}${detail}`;
  });
  p.note(lines.join("\n"), `Last ${String(entries.length)} event(s)`);
}

async function pruneAudit(): Promise<void> {
  const daysInput = await p.text({
    message: "Delete audit entries older than how many days?",
    placeholder: "90",
    validate: (value) => (value && /^\d+$/.test(value) ? undefined : "Enter a whole number of days."),
  });
  if (p.isCancel(daysInput)) return;

  const deleted = await pruneAuditLog(Number(daysInput));
  p.note(`Deleted ${String(deleted)} entr${deleted === 1 ? "y" : "ies"}.`);
}

async function main(): Promise<void> {
  p.intro("Vaultiq admin");
  const auth = new AuthService();

  for (;;) {
    const action = await p.select<
      "invite" | "list" | "tokens" | "revoke" | "audit" | "prune" | "recovery" | "exit"
    >({
      message: "What would you like to do?",
      options: [
        { value: "invite", label: "Invite someone" },
        { value: "list", label: "List users and devices" },
        { value: "tokens", label: "List outstanding invitations" },
        { value: "revoke", label: "Revoke a user" },
        { value: "audit", label: "View audit log" },
        { value: "prune", label: "Prune audit log" },
        { value: "recovery", label: "Recover a locked-out account" },
        { value: "exit", label: "Exit" },
      ],
    });
    if (p.isCancel(action) || action === "exit") break;

    if (action === "invite") await invite(auth);
    else if (action === "list") await listUsers();
    else if (action === "tokens") await listTokens();
    else if (action === "revoke") await revokeUser();
    else if (action === "audit") await viewAuditLog();
    else if (action === "prune") await pruneAudit();
    else if (action === "recovery") {
      // Decided, not pending: Path A (MULTI-TENANCY.md's "Recovery and
      // escrow") means this stays permanently inert, on purpose -- shown so
      // an operator finds an explicit "not available" rather than no
      // mention of recovery at all, as if it had been overlooked.
      p.note(
        "Not available, permanently -- a forgotten master password loses " +
          "the vault in every deployment, by design. See MULTI-TENANCY.md's " +
          '"Recovery and escrow" section for the decision and why.',
        "Recovery",
      );
    }
  }

  p.outro("Done.");
  await pool.end();
}

// Guarded the same way migrate.ts is: importing this module (from a test,
// say) must not launch an interactive prompt loop as a side effect.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
