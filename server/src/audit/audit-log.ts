// A record of security-relevant events, for investigating an incident --
// never a place credentials, tokens, or key material can end up. The
// project's "never log" rule applies here exactly as it does anywhere else.
//
// Written through `pool` directly rather than whatever transaction a caller
// might be in: a refusal is logged and the caller then throws, which would
// otherwise roll the log entry back along with the operation that never
// happened. A success is logged after its own transaction has already
// committed, for the same reason in reverse -- the event is real by then.

import { pool } from "../db/pool.js";

export type AuditEventType =
  | "account_registered"
  | "device_enrolled"
  | "device_revoked"
  | "master_password_changed"
  | "registration_refused"
  | "enrollment_refused"
  | "invitation_issued";

export interface AuditEvent {
  eventType: AuditEventType;
  userId?: string;
  deviceId?: string;
  /** Only ever set for the auth-failure/refusal events — see SECURITY.md. */
  sourceIp?: string;
  detail?: Record<string, unknown>;
}

/**
 * Never throws. A failure to log is a degraded audit trail, not a reason to
 * fail the request that triggered it — the same "discard and carry on"
 * choice `pool.ts`'s own error handler makes for a lost connection.
 */
export async function recordAuditEvent(event: AuditEvent): Promise<void> {
  try {
    await pool.query(
      `insert into audit_log (event_type, user_id, device_id, source_ip, detail)
       values ($1, $2, $3, $4, $5)`,
      [
        event.eventType,
        event.userId ?? null,
        event.deviceId ?? null,
        event.sourceIp ?? null,
        JSON.stringify(event.detail ?? {}),
      ],
    );
  } catch (error) {
    console.error("audit log write failed:", error instanceof Error ? error.message : error);
  }
}

export interface AuditLogRow {
  id: string;
  occurredAt: string;
  eventType: string;
  userId: string | null;
  deviceId: string | null;
  sourceIp: string | null;
  detail: Record<string, unknown>;
}

/** Most recent first. Used by the admin CLI, not exposed over HTTP. */
export async function listAuditLog(limit: number): Promise<AuditLogRow[]> {
  const { rows } = await pool.query<{
    id: string;
    occurred_at: Date;
    event_type: string;
    user_id: string | null;
    device_id: string | null;
    source_ip: string | null;
    detail: Record<string, unknown>;
  }>(
    `select id, occurred_at, event_type, user_id, device_id, source_ip, detail
       from audit_log
      order by occurred_at desc
      limit $1`,
    [limit],
  );

  return rows.map((row) => ({
    id: row.id,
    occurredAt: row.occurred_at.toISOString(),
    eventType: row.event_type,
    userId: row.user_id,
    deviceId: row.device_id,
    sourceIp: row.source_ip,
    detail: row.detail,
  }));
}

/** Deletes entries older than `days`. Returns how many. Manual, from the CLI — no scheduler. */
export async function pruneAuditLog(days: number): Promise<number> {
  const { rowCount } = await pool.query(
    "delete from audit_log where occurred_at < now() - ($1 || ' days')::interval",
    [String(days)],
  );
  return rowCount ?? 0;
}
