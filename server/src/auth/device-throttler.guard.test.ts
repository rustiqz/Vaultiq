import type { ThrottlerModuleOptions, ThrottlerStorage } from "@nestjs/throttler";
import type { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { parseBearerCredential } from "./bearer-credential.js";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

function request(path: string, authorization?: string): Request {
  const headers = authorization === undefined ? {} : { authorization };
  return { path, headers } as Request;
}

describe("parseBearerCredential", () => {
  it("splits a well-formed bearer credential", () => {
    expect(parseBearerCredential("Bearer device-1.credential-1")).toEqual({
      deviceId: "device-1",
      credential: "credential-1",
    });
  });

  it("rejects a missing header", () => {
    expect(parseBearerCredential(undefined)).toBeUndefined();
  });

  it("rejects a header with no credential half", () => {
    expect(parseBearerCredential("Bearer no-dot-here")).toBeUndefined();
  });

  it("rejects a non-bearer scheme", () => {
    expect(parseBearerCredential("Basic device-1.credential-1")).toBeUndefined();
  });
});

// The routing decision itself needs a real, verified credential to trust --
// that's the whole point of this guard -- so it's exercised against a real
// Postgres the same way DeviceGuard's own checks are, rather than mocked.
describeDb("DeviceThrottlerGuard", () => {
  let pool: typeof import("../db/pool.js").pool;
  let guard: import("./device-throttler.guard.js").DeviceThrottlerGuard;
  let deviceId: string;
  let credential: string;

  beforeEach(async () => {
    ({ pool } = await import("../db/pool.js"));
    const { migrate } = await import("../db/migrate.js");
    const { AuthService } = await import("../auth/auth.service.js");
    const { DeviceThrottlerGuard } = await import("./device-throttler.guard.js");

    await migrate();
    await pool.query("delete from users");

    const auth = new AuthService();
    const { token } = await auth.mintAccountToken({ grantsCapabilities: ["manage_invitations", "manage_devices", "view_audit_log"], minutes: 15 });
    ({ deviceId, credential } = await auth.register({
      token,
      authKey: "auth-key",
      vault: {
        saltB64: "c2FsdA==",
        memoryKib: 65536,
        iterations: 3,
        parallelism: 4,
        wrappedVaultKey: { version: 1 },
      },
      deviceName: "First",
    }));

    // Only `getTracker` is under test, and it never reads `options`,
    // `storageService` or `reflector` -- those exist solely to satisfy
    // `ThrottlerGuard`'s own constructor.
    guard = new DeviceThrottlerGuard(
      {} as ThrottlerModuleOptions,
      {} as ThrottlerStorage,
      {} as Reflector,
      auth,
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  async function tracker(req: Request): Promise<string> {
    return await (guard as unknown as { getTracker: (req: Request) => Promise<string> }).getTracker(
      req,
    );
  }

  it("keys a request bearing a real device credential by that device", async () => {
    expect(await tracker(request("/sync", `Bearer ${deviceId}.${credential}`))).toBe(
      `device:${deviceId}`,
    );
  });

  it("falls back to IP for a credential that doesn't verify", async () => {
    const fake = request("/sync", `Bearer ${deviceId}.wrong-credential`);
    (fake as { ip?: string }).ip = "203.0.113.5";
    expect(await tracker(fake)).toBe("203.0.113.5");
  });

  it("falls back to IP for an unknown device id", async () => {
    const fake = request("/sync", "Bearer 00000000-0000-4000-8000-000000000000.anything");
    (fake as { ip?: string }).ip = "203.0.113.5";
    expect(await tracker(fake)).toBe("203.0.113.5");
  });

  it("stays IP-keyed on the bootstrap routes even with a genuine credential", async () => {
    // A registered device's real credential still doesn't earn a device
    // bucket here -- these routes are reachable before anyone is registered,
    // so the tracker can't special-case "but this caller happens to be real".
    const real = request("/auth/enroll", `Bearer ${deviceId}.${credential}`);
    (real as { ip?: string }).ip = "203.0.113.5";
    expect(await tracker(real)).toBe("203.0.113.5");
  });
});
