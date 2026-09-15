// Against a real Postgres, because half of what is being tested lives in SQL:
// the single-account constraint, the token lock, the revocation filter.
//
// Skipped when no database is reachable, so a checkout without Docker still
// runs the rest of the suite.

import { afterAll, beforeEach, describe, expect, it } from "vitest";

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

const VAULT = {
  saltB64: "c2FsdA==",
  memoryKib: 65536,
  iterations: 3,
  parallelism: 4,
  wrappedVaultKey: { version: 1, ciphertext: [1, 2, 3], nonce: [4, 5, 6] },
};

describeDb("auth", () => {
  let pool: typeof import("../db/pool.js").pool;
  let auth: import("./auth.service.js").AuthService;

  beforeEach(async () => {
    ({ pool } = await import("../db/pool.js"));
    const { migrate } = await import("../db/migrate.js");
    const { AuthService } = await import("./auth.service.js");

    await migrate();
    // Cascades to vaults, devices, tokens and items.
    await pool.query("delete from users");
    auth = new AuthService();
  });

  afterAll(async () => {
    await pool.end();
  });

  async function accountToken(grantsRole: "member" | "admin" = "admin"): Promise<string> {
    const { token } = await auth.mintAccountToken({ grantsRole, minutes: 15 });
    return token;
  }

  async function registered(): Promise<{ deviceId: string; credential: string }> {
    const token = await accountToken();
    return await auth.register({ token, authKey: "auth-key", vault: VAULT, deviceName: "First" });
  }

  describe("registration", () => {
    it("creates the account and its first device", async () => {
      const { deviceId, credential } = await registered();
      expect(deviceId).toMatch(/^[0-9a-f-]{36}$/);
      expect(credential.length).toBeGreaterThan(20);
    });

    it("refuses without a valid token", async () => {
      await expect(
        auth.register({ token: "made-up", authKey: "auth-key", vault: VAULT, deviceName: "x" }),
      ).rejects.toThrow(/refused/i);
    });

    it("refuses a token already spent", async () => {
      const token = await accountToken();
      await auth.register({ token, authKey: "auth-key", vault: VAULT, deviceName: "First" });

      await expect(
        auth.register({ token, authKey: "auth-key", vault: VAULT, deviceName: "Second" }),
      ).rejects.toThrow(/refused/i);
    });

    it("refuses an expired token", async () => {
      const token = await accountToken();
      await pool.query("update enrollment_tokens set expires_at = now() - interval '1 minute'");

      await expect(
        auth.register({ token, authKey: "auth-key", vault: VAULT, deviceName: "First" }),
      ).rejects.toThrow(/refused/i);
    });

    it("refuses a device-join token presented as a registration token", async () => {
      const { deviceId, credential } = await registered();
      const caller = (await auth.identify(deviceId, credential))!;
      const { token: joinToken } = await auth.createEnrollmentToken(caller);

      await expect(
        auth.register({ token: joinToken, authKey: "auth-key", vault: VAULT, deviceName: "x" }),
      ).rejects.toThrow(/refused/i);
    });

    it("leaves nothing behind when it refuses", async () => {
      const token = await accountToken();
      await auth.register({ token, authKey: "auth-key", vault: VAULT, deviceName: "First" });
      // The same token again: already spent.
      await expect(
        auth.register({ token, authKey: "auth-key", vault: VAULT, deviceName: "Second" }),
      ).rejects.toThrow();

      const { rows } = await pool.query<{ count: string }>(
        "select count(*)::text as count from devices",
      );
      // The rollback matters: a half-registered second account would leave an
      // orphan device credential that still authenticates.
      expect(rows[0]?.count).toBe("1");
    });

    it("grants the role the token specifies", async () => {
      const memberToken = await accountToken("member");
      await auth.register({
        token: memberToken,
        authKey: "auth-key",
        vault: VAULT,
        deviceName: "First",
      });

      const { rows } = await pool.query<{ role: string }>("select role from users");
      expect(rows[0]?.role).toBe("member");
    });

    it("stores no auth key, only a hash of one", async () => {
      await registered();
      const { rows } = await pool.query<{ auth_key_hash: string }>(
        "select auth_key_hash from users",
      );
      expect(rows[0]?.auth_key_hash).not.toContain("auth-key");
      expect(rows[0]?.auth_key_hash.startsWith("$argon2")).toBe(true);
    });

    it("stores no device credential, only a hash of one", async () => {
      const { credential } = await registered();
      const { rows } = await pool.query<{ credential_hash: string }>(
        "select credential_hash from devices",
      );
      expect(rows[0]?.credential_hash).not.toContain(credential);
      expect(rows[0]?.credential_hash.startsWith("$argon2")).toBe(true);
    });

    it("stores no token, only a fingerprint of one", async () => {
      const token = await accountToken();
      await auth.register({ token, authKey: "auth-key", vault: VAULT, deviceName: "First" });

      const { rows } = await pool.query<{ token_hash: string }>(
        "select token_hash from enrollment_tokens where kind = 'account_create'",
      );
      // A database dump must not yield working tokens.
      expect(rows[0]?.token_hash).not.toContain(token);
    });
  });

  describe("identifying a caller", () => {
    it("accepts an enrolled device", async () => {
      const { deviceId, credential } = await registered();
      await expect(auth.identify(deviceId, credential)).resolves.toMatchObject({ deviceId });
    });

    it("refuses a wrong credential", async () => {
      const { deviceId } = await registered();
      await expect(auth.identify(deviceId, "not-it")).resolves.toBeUndefined();
    });

    it("refuses an unknown device", async () => {
      await registered();
      const nowhere = "00000000-0000-4000-8000-000000000000";
      await expect(auth.identify(nowhere, "anything")).resolves.toBeUndefined();
    });

    it("refuses a revoked device", async () => {
      const first = await registered();
      const caller = (await auth.identify(first.deviceId, first.credential))!;

      const { token } = await auth.createEnrollmentToken(caller);
      const second = await auth.enroll({
        token,
        authKey: "auth-key",
        deviceName: "Second",
      });

      await auth.revokeDevice(caller, second.deviceId);
      // Revocation is the control here, so it has to actually bite.
      await expect(auth.identify(second.deviceId, second.credential)).resolves.toBeUndefined();
    });
  });

  describe("enrolling another device", () => {
    async function trusted(): Promise<import("./auth.service.js").Caller> {
      const { deviceId, credential } = await registered();
      return (await auth.identify(deviceId, credential))!;
    }

    it("needs a token and the auth key together", async () => {
      const caller = await trusted();
      const { token } = await auth.createEnrollmentToken(caller);

      // A token found on a screen is not enough on its own.
      await expect(
        auth.enroll({ token, authKey: "wrong", deviceName: "Impostor" }),
      ).rejects.toThrow(/refused/i);

      // Nor is the master password without a token.
      await expect(
        auth.enroll({ token: "made-up", authKey: "auth-key", deviceName: "Impostor" }),
      ).rejects.toThrow(/refused/i);
    });

    it("says the same thing however it failed", async () => {
      const caller = await trusted();
      const { token } = await auth.createEnrollmentToken(caller);

      const messages: string[] = [];
      for (const attempt of [
        { token, authKey: "wrong" },
        { token: "made-up", authKey: "auth-key" },
        { token: "made-up", authKey: "wrong" },
      ]) {
        await auth.enroll({ ...attempt, deviceName: "x" }).catch((error: Error) => {
          messages.push(error.message);
        });
      }

      // Telling them apart would say which half was right.
      expect(new Set(messages).size).toBe(1);
    });

    it("spends a token once", async () => {
      const caller = await trusted();
      const { token } = await auth.createEnrollmentToken(caller);

      await auth.enroll({ token, authKey: "auth-key", deviceName: "Second" });
      await expect(
        auth.enroll({ token, authKey: "auth-key", deviceName: "Third" }),
      ).rejects.toThrow(/refused/i);
    });

    it("refuses an expired token", async () => {
      const caller = await trusted();
      const { token } = await auth.createEnrollmentToken(caller);
      await pool.query("update enrollment_tokens set expires_at = now() - interval '1 minute'");

      await expect(
        auth.enroll({ token, authKey: "auth-key", deviceName: "Late" }),
      ).rejects.toThrow(/refused/i);
    });

    it("stores no token, only a fingerprint of one", async () => {
      const caller = await trusted();
      const { token } = await auth.createEnrollmentToken(caller);

      const { rows } = await pool.query<{ token_hash: string }>(
        "select token_hash from enrollment_tokens",
      );
      // A database dump must not yield working tokens.
      expect(rows[0]?.token_hash).not.toContain(token);
    });
  });

  describe("the enrolment parameters", () => {
    async function trusted(): Promise<import("./auth.service.js").Caller> {
      const { deviceId, credential } = await registered();
      return (await auth.identify(deviceId, credential))!;
    }

    it("gives a token holder what it needs to derive the auth key", async () => {
      const caller = await trusted();
      const { token } = await auth.createEnrollmentToken(caller);

      // Without this, enrolment cannot happen at all: deriving the auth key
      // needs the salt, and the salt used to sit behind the credential that
      // enrolment is trying to obtain.
      expect(await auth.enrollmentParams(token)).toEqual({
        saltB64: VAULT.saltB64,
        memoryKib: VAULT.memoryKib,
        iterations: VAULT.iterations,
        parallelism: VAULT.parallelism,
      });
    });

    it("never hands over the wrapped vault key", async () => {
      const caller = await trusted();
      const { token } = await auth.createEnrollmentToken(caller);

      // The security property of this endpoint. With the wrapped key, a token
      // holder could attack the master password offline, at their own pace,
      // with the throttle on enrol no longer in their way.
      const params = await auth.enrollmentParams(token);
      expect(Object.keys(params).sort()).toEqual([
        "iterations",
        "memoryKib",
        "parallelism",
        "saltB64",
      ]);
    });

    it("leaves the token usable afterwards", async () => {
      const caller = await trusted();
      const { token } = await auth.createEnrollmentToken(caller);

      await auth.enrollmentParams(token);

      // A mistyped password must not cost a walk back to the first device.
      const enrolled = await auth.enroll({
        token,
        authKey: "auth-key",
        deviceName: "Second",
      });
      expect(enrolled.deviceId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("refuses an unknown, spent or expired token alike", async () => {
      const caller = await trusted();

      const { token: unknown_ } = { token: "not-a-real-token" };
      await expect(auth.enrollmentParams(unknown_)).rejects.toThrow(/refused/i);

      const { token: spent } = await auth.createEnrollmentToken(caller);
      await auth.enroll({ token: spent, authKey: "auth-key", deviceName: "Second" });
      await expect(auth.enrollmentParams(spent)).rejects.toThrow(/refused/i);

      const { token: stale } = await auth.createEnrollmentToken(caller);
      await pool.query("update enrollment_tokens set expires_at = now() - interval '1 minute'");
      await expect(auth.enrollmentParams(stale)).rejects.toThrow(/refused/i);
    });
  });

  describe("revoking", () => {
    it("refuses to revoke the device asking", async () => {
      const { deviceId, credential } = await registered();
      const caller = (await auth.identify(deviceId, credential))!;

      // Locking yourself out of the last device is not a misclick.
      await expect(auth.revokeDevice(caller, deviceId)).rejects.toThrow(/another one/i);
    });

    it("marks which device is asking, in the list", async () => {
      const { deviceId, credential } = await registered();
      const caller = (await auth.identify(deviceId, credential))!;

      const devices = await auth.listDevices(caller);
      expect(devices).toHaveLength(1);
      expect(devices[0]?.current).toBe(true);
    });
  });

  describe("the vault bootstrap", () => {
    it("returns what a new device needs and nothing more", async () => {
      const { deviceId, credential } = await registered();
      const caller = (await auth.identify(deviceId, credential))!;

      const bootstrap = await auth.vaultBootstrap(caller);
      expect(bootstrap).toEqual(VAULT);
      // No auth key, no credential, no user id.
      expect(Object.keys(bootstrap).sort()).toEqual([
        "iterations",
        "memoryKib",
        "parallelism",
        "saltB64",
        "wrappedVaultKey",
      ]);
    });
  });

  describe("changing the master password", () => {
    // A different salt and a different wrapping of the *same* vault key —
    // which is the whole point of the indirection: no item is re-encrypted.
    const REWRAPPED = {
      saltB64: "bmV3c2FsdA==",
      memoryKib: 65536,
      iterations: 3,
      parallelism: 4,
      wrappedVaultKey: { version: 1, ciphertext: [9, 9, 9], nonce: [8, 8, 8] },
    };

    async function trusted(): Promise<import("./auth.service.js").Caller> {
      const { deviceId, credential } = await registered();
      return (await auth.identify(deviceId, credential))!;
    }

    it("re-wraps the vault and moves the auth key with it", async () => {
      const caller = await trusted();

      await auth.changeMasterPassword(caller, {
        currentAuthKey: "auth-key",
        newAuthKey: "new-auth-key",
        vault: REWRAPPED,
      });

      // What the other devices will read on their next sync.
      expect(await auth.vaultBootstrap(caller)).toEqual(REWRAPPED);

      // And the new password is the one that enrols from now on.
      const { token } = await auth.createEnrollmentToken(caller);
      await expect(
        auth.enroll({ token, authKey: "auth-key", deviceName: "Stale" }),
      ).rejects.toThrow(/refused/i);
      await expect(
        auth.enroll({ token, authKey: "new-auth-key", deviceName: "Second" }),
      ).resolves.toMatchObject({ deviceId: expect.stringMatching(/^[0-9a-f-]{36}$/) as string });
    });

    it("keeps the device credential working", async () => {
      const { deviceId, credential } = await registered();
      const caller = (await auth.identify(deviceId, credential))!;

      await auth.changeMasterPassword(caller, {
        currentAuthKey: "auth-key",
        newAuthKey: "new-auth-key",
        vault: REWRAPPED,
      });

      // Device credentials are unrelated to the password on purpose: a
      // rotation must not silently sign every device out.
      await expect(auth.identify(deviceId, credential)).resolves.toMatchObject({ deviceId });
    });

    it("refuses without the current auth key", async () => {
      const caller = await trusted();

      // The credential alone is not enough. A stolen laptop must not be able
      // to lock its owner out of their own vault.
      await expect(
        auth.changeMasterPassword(caller, {
          currentAuthKey: "wrong",
          newAuthKey: "new-auth-key",
          vault: REWRAPPED,
        }),
      ).rejects.toThrow(/refused/i);
    });

    it("changes nothing when it refuses", async () => {
      const caller = await trusted();

      await auth
        .changeMasterPassword(caller, {
          currentAuthKey: "wrong",
          newAuthKey: "new-auth-key",
          vault: REWRAPPED,
        })
        .catch(() => undefined);

      // A half-applied change is the worst outcome available here: the vault
      // re-wrapped but the auth key not moved would leave a vault nobody can
      // enrol against.
      expect(await auth.vaultBootstrap(caller)).toEqual(VAULT);
      const { token } = await auth.createEnrollmentToken(caller);
      await expect(
        auth.enroll({ token, authKey: "auth-key", deviceName: "Second" }),
      ).resolves.toMatchObject({ deviceId: expect.stringMatching(/^[0-9a-f-]{36}$/) as string });
    });

    it("spends outstanding enrolment tokens", async () => {
      const caller = await trusted();
      const { token } = await auth.createEnrollmentToken(caller);

      await auth.changeMasterPassword(caller, {
        currentAuthKey: "auth-key",
        newAuthKey: "new-auth-key",
        vault: REWRAPPED,
      });

      // An invitation minted under the old password should not outlive it.
      await expect(
        auth.enroll({ token, authKey: "new-auth-key", deviceName: "Second" }),
      ).rejects.toThrow(/refused/i);
    });

    it("stores no auth key, only a hash of one", async () => {
      const caller = await trusted();

      await auth.changeMasterPassword(caller, {
        currentAuthKey: "auth-key",
        newAuthKey: "new-auth-key",
        vault: REWRAPPED,
      });

      const { rows } = await pool.query<{ auth_key_hash: string }>(
        "select auth_key_hash from users",
      );
      expect(rows[0]?.auth_key_hash).not.toContain("new-auth-key");
      expect(rows[0]?.auth_key_hash.startsWith("$argon2")).toBe(true);
    });
  });
});
