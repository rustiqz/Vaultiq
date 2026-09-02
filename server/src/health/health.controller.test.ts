// The health endpoint is what a load balancer, a container runtime and a
// person at 2am all trust. It has to be honest in both directions.

import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("../db/pool.js", () => ({ pool: { query } }));

const { HealthController } = await import("./health.controller.js");

beforeEach(() => {
  query.mockReset();
});

describe("health", () => {
  it("reports ok when the database answers", async () => {
    query.mockResolvedValue({ rows: [{ "?column?": 1 }] });
    await expect(new HealthController().check()).resolves.toEqual({
      status: "ok",
      database: "ok",
    });
  });

  it("actually asks the database rather than only reporting itself up", async () => {
    // A server that answers 200 while unable to read a vault is worse than
    // one that admits it is down.
    query.mockResolvedValue({ rows: [] });
    await new HealthController().check();
    expect(query).toHaveBeenCalled();
  });

  it("reports degraded rather than throwing when the database is gone", async () => {
    query.mockRejectedValue(new Error("ECONNREFUSED 10.0.0.5:5432"));
    await expect(new HealthController().check()).resolves.toEqual({
      status: "degraded",
      database: "unreachable",
    });
  });

  it("says nothing about why", async () => {
    // Unauthenticated, and connection strings and hostnames have a habit of
    // ending up in error text.
    query.mockRejectedValue(new Error("password authentication failed for user 'vaultiq'"));

    const body = JSON.stringify(await new HealthController().check());
    expect(body).not.toContain("password");
    expect(body).not.toContain("vaultiq");
  });
});
