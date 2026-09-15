// Against a real Postgres: what's being tested is the table itself and the
// fact that a write here survives a caller's own transaction rolling back.

import { afterAll, beforeEach, describe, expect, it } from "vitest";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb("audit log", () => {
  let pool: typeof import("../db/pool.js").pool;
  let recordAuditEvent: typeof import("./audit-log.js").recordAuditEvent;
  let listAuditLog: typeof import("./audit-log.js").listAuditLog;
  let pruneAuditLog: typeof import("./audit-log.js").pruneAuditLog;

  beforeEach(async () => {
    ({ pool } = await import("../db/pool.js"));
    const { migrate } = await import("../db/migrate.js");
    ({ recordAuditEvent, listAuditLog, pruneAuditLog } = await import("./audit-log.js"));

    await migrate();
    await pool.query("delete from audit_log");
  });

  afterAll(async () => {
    await pool.end();
  });

  it("records an event with its detail", async () => {
    await recordAuditEvent({
      eventType: "invitation_issued",
      detail: { capabilities: ["manage_invitations"] },
    });

    const entries = await listAuditLog(10);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      eventType: "invitation_issued",
      userId: null,
      detail: { capabilities: ["manage_invitations"] },
    });
  });

  it("records the source IP when given one", async () => {
    await recordAuditEvent({ eventType: "registration_refused", sourceIp: "203.0.113.5" });

    const [entry] = await listAuditLog(1);
    expect(entry?.sourceIp).toBe("203.0.113.5");
  });

  it("never throws, even for a user id that doesn't exist", async () => {
    // A foreign-key violation would otherwise crash whatever real operation
    // triggered the log write -- a degraded audit trail, not a failed
    // request, is the point of swallowing this.
    await expect(
      recordAuditEvent({
        eventType: "device_revoked",
        userId: "00000000-0000-4000-8000-000000000000",
      }),
    ).resolves.toBeUndefined();

    const entries = await listAuditLog(10);
    expect(entries).toHaveLength(0);
  });

  it("lists most recent first, respecting the limit", async () => {
    await recordAuditEvent({ eventType: "invitation_issued", detail: { n: 1 } });
    await recordAuditEvent({ eventType: "invitation_issued", detail: { n: 2 } });
    await recordAuditEvent({ eventType: "invitation_issued", detail: { n: 3 } });

    const entries = await listAuditLog(2);
    expect(entries.map((e) => e.detail.n)).toEqual([3, 2]);
  });

  it("prunes only what's older than the given window", async () => {
    await recordAuditEvent({ eventType: "invitation_issued" });
    await pool.query("update audit_log set occurred_at = now() - interval '100 days'");
    await recordAuditEvent({ eventType: "invitation_issued" });

    const deleted = await pruneAuditLog(90);
    expect(deleted).toBe(1);

    const remaining = await listAuditLog(10);
    expect(remaining).toHaveLength(1);
  });
});
