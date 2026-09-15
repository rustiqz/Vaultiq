// Registration, device enrolment, and deciding whether a caller may speak.

import { Injectable, UnauthorizedException, ConflictException } from "@nestjs/common";
import { recordAuditEvent } from "../audit/audit-log.js";
import { pool } from "../db/pool.js";
import {
  equalSecrets,
  hashSecret,
  newSecret,
  secretMatches,
  tokenFingerprint,
} from "./credentials.js";

/** How long a device-join token is good for. Long enough to walk to a laptop. */
const TOKEN_MINUTES = 15;

export type Capability = "manage_invitations" | "manage_devices" | "view_audit_log";

export interface DeviceCredential {
  deviceId: string;
  credential: string;
}

export interface Caller {
  userId: string;
  vaultId: string;
  deviceId: string;
}

/**
 * What an enrolling device needs *before* it can authenticate.
 *
 * Deliberately not `VaultBootstrap`: no wrapped vault key. Handing that to a
 * token holder would give them an offline target for the master password,
 * which is the one thing the throttle on `enroll` exists to prevent.
 */
export interface KdfParams {
  saltB64: string;
  memoryKib: number;
  iterations: number;
  parallelism: number;
}

export interface VaultBootstrap {
  saltB64: string;
  memoryKib: number;
  iterations: number;
  parallelism: number;
  wrappedVaultKey: unknown;
}

@Injectable()
export class AuthService {
  /**
   * Creates a new vault, given a valid account-creation token.
   *
   * Always invite-only, in every deployment: a fresh personal server has one
   * token minted at boot (`ensureBootstrapToken`), spent once and never
   * reissued unless something explicitly mints another; an organisation's
   * admin mints more via the CLI as people are onboarded. Either way this
   * closes the same unauthenticated write the old "refuse once an account
   * exists" check did, rather than merely gating it once.
   *
   * The new account's capabilities come from the token, not from the caller
   * — a registering client has no identity yet for the server to trust with
   * that choice.
   */
  async register(input: {
    token: string;
    authKey: string;
    vault: VaultBootstrap;
    deviceName: string;
    sourceIp?: string;
  }): Promise<DeviceCredential> {
    const client = await pool.connect();
    try {
      await client.query("begin");

      // Locked for update so two registrations cannot spend one token into
      // two accounts.
      const { rows } = await client.query<{ token_hash: string; grants_capabilities: string[] }>(
        `select token_hash, grants_capabilities from enrollment_tokens
          where token_hash = $1
            and kind = 'account_create'
            and used_at is null
            and expires_at > now()
          for update`,
        [tokenFingerprint(input.token)],
      );

      const found = rows[0];
      // One message for an unknown token, a spent one, an expired one and a
      // device-join token presented here by mistake — telling them apart
      // would say which half was wrong.
      if (!found) {
        await recordAuditEvent({
          eventType: "registration_refused",
          ...(input.sourceIp !== undefined && { sourceIp: input.sourceIp }),
        });
        throw new UnauthorizedException("Registration refused.");
      }

      await client.query("update enrollment_tokens set used_at = now() where token_hash = $1", [
        found.token_hash,
      ]);

      const { rows: users } = await client.query<{ id: string }>(
        "insert into users (auth_key_hash) values ($1) returning id",
        [await hashSecret(input.authKey)],
      );
      const userId = users[0]?.id;
      if (!userId) throw new Error("user was not created");

      for (const capability of found.grants_capabilities) {
        await client.query(
          "insert into user_capabilities (user_id, capability) values ($1, $2)",
          [userId, capability],
        );
      }

      await client.query(
        `insert into vaults
           (user_id, salt_b64, kdf_memory_kib, kdf_iterations, kdf_parallelism, wrapped_vault_key)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          userId,
          input.vault.saltB64,
          input.vault.memoryKib,
          input.vault.iterations,
          input.vault.parallelism,
          JSON.stringify(input.vault.wrappedVaultKey),
        ],
      );

      const credential = await this.attachDevice(client, userId, input.deviceName);
      await client.query("commit");

      await recordAuditEvent({
        eventType: "account_registered",
        userId,
        deviceId: credential.deviceId,
        detail: { capabilities: found.grants_capabilities },
      });

      return credential;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * An invitation to create a brand-new vault, not join an existing one.
   *
   * Never minted through an HTTP route: nothing exists yet to authenticate a
   * caller as allowed to issue one. `ensureBootstrapToken` calls this at boot
   * on a fresh server; the admin CLI calls it for everyone after that.
   */
  async mintAccountToken(input: {
    grantsCapabilities: Capability[];
    minutes: number;
    createdBy?: string;
  }): Promise<{ token: string; expiresAt: string }> {
    const token = newSecret();
    const { rows } = await pool.query<{ expires_at: Date }>(
      `insert into enrollment_tokens (token_hash, kind, grants_capabilities, created_by, expires_at)
       values ($1, 'account_create', $2, $3, now() + ($4 || ' minutes')::interval)
       returning expires_at`,
      [
        tokenFingerprint(token),
        input.grantsCapabilities,
        input.createdBy ?? null,
        String(input.minutes),
      ],
    );
    const expiresAt = rows[0]?.expires_at;
    if (!expiresAt) throw new Error("token was not created");

    await recordAuditEvent({
      eventType: "invitation_issued",
      ...(input.createdBy !== undefined && { userId: input.createdBy }),
      detail: { capabilities: input.grantsCapabilities },
    });

    return { token, expiresAt: expiresAt.toISOString() };
  }

  private async attachDevice(
    client: { query: typeof pool.query },
    userId: string,
    name: string,
  ): Promise<DeviceCredential> {
    const credential = newSecret();
    const { rows } = await client.query<{ id: string }>(
      "insert into devices (user_id, name, credential_hash) values ($1, $2, $3) returning id",
      [userId, name, await hashSecret(credential)],
    );
    const deviceId = rows[0]?.id;
    if (!deviceId) throw new Error("device was not created");
    return { deviceId, credential };
  }

  /** Mints a token on an already-trusted device, for a new one to present. */
  async createEnrollmentToken(caller: Caller): Promise<{ token: string; expiresAt: string }> {
    const token = newSecret();
    const { rows } = await pool.query<{ expires_at: Date }>(
      `insert into enrollment_tokens (token_hash, user_id, expires_at)
       values ($1, $2, now() + ($3 || ' minutes')::interval)
       returning expires_at`,
      [tokenFingerprint(token), caller.userId, String(TOKEN_MINUTES)],
    );
    const expiresAt = rows[0]?.expires_at;
    if (!expiresAt) throw new Error("token was not created");
    return { token, expiresAt: expiresAt.toISOString() };
  }

  /**
   * The KDF parameters, for a device that holds a token but no credential yet.
   *
   * This exists because enrolment is otherwise impossible: `enroll` wants the
   * auth key, deriving it wants the salt and costs, and those live behind a
   * credential the device is still trying to obtain.
   *
   * A salt is not a secret — it exists so that one stolen hash does not break
   * every account, and it already sits in the clear on every enrolled device.
   * The costs are the published defaults. Neither helps an attacker who
   * cannot also produce the master password.
   *
   * The token is *not* consumed: a mistyped password should not cost a walk
   * back to the first device for a fresh one.
   */
  async enrollmentParams(token: string, sourceIp?: string): Promise<KdfParams> {
    const { rows } = await pool.query<{
      salt_b64: string;
      kdf_memory_kib: number;
      kdf_iterations: number;
      kdf_parallelism: number;
    }>(
      `select v.salt_b64, v.kdf_memory_kib, v.kdf_iterations, v.kdf_parallelism
         from enrollment_tokens t
         join vaults v on v.user_id = t.user_id
        where t.token_hash = $1
          and t.kind = 'device_join'
          and t.used_at is null
          and t.expires_at > now()`,
      [tokenFingerprint(token)],
    );

    const vault = rows[0];
    // The same words `enroll` uses. An unknown token, a spent one and an
    // expired one must not be distinguishable from each other here either.
    if (!vault) {
      await recordAuditEvent({
        eventType: "enrollment_refused",
        ...(sourceIp !== undefined && { sourceIp }),
      });
      throw new UnauthorizedException("Enrolment refused.");
    }

    return {
      saltB64: vault.salt_b64,
      memoryKib: vault.kdf_memory_kib,
      iterations: vault.kdf_iterations,
      parallelism: vault.kdf_parallelism,
    };
  }

  /**
   * Enrols a new device.
   *
   * Needs both an unused token from a trusted device *and* the auth key,
   * which only the master password can produce. Either alone is not enough:
   * a token found on a screen cannot pull ciphertext, and a master password
   * cannot add a device without one.
   */
  async enroll(input: {
    token: string;
    authKey: string;
    deviceName: string;
    sourceIp?: string;
  }): Promise<DeviceCredential> {
    const client = await pool.connect();
    try {
      await client.query("begin");

      // Locked for update so two devices cannot spend one token.
      const { rows } = await client.query<{
        token_hash: string;
        user_id: string;
        auth_key_hash: string;
      }>(
        `select t.token_hash, t.user_id, u.auth_key_hash
           from enrollment_tokens t
           join users u on u.id = t.user_id
          where t.token_hash = $1
            and t.kind = 'device_join'
            and t.used_at is null
            and t.expires_at > now()
          for update of t`,
        [tokenFingerprint(input.token)],
      );

      const found = rows[0];
      // One message for an unknown token, a spent one, an expired one and a
      // wrong auth key. Telling them apart would say which half was right.
      const refuse = async (): Promise<never> => {
        await recordAuditEvent({
          eventType: "enrollment_refused",
          ...(input.sourceIp !== undefined && { sourceIp: input.sourceIp }),
        });
        throw new UnauthorizedException("Enrolment refused.");
      };

      if (!found || !equalSecrets(found.token_hash, tokenFingerprint(input.token))) await refuse();
      if (!(await secretMatches(input.authKey, found!.auth_key_hash))) await refuse();

      await client.query("update enrollment_tokens set used_at = now() where token_hash = $1", [
        found!.token_hash,
      ]);

      const credential = await this.attachDevice(client, found!.user_id, input.deviceName);
      await client.query("commit");

      await recordAuditEvent({
        eventType: "device_enrolled",
        userId: found!.user_id,
        deviceId: credential.deviceId,
        detail: { deviceName: input.deviceName },
      });

      return credential;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  /** Who a bearer credential belongs to, or nothing. */
  async identify(deviceId: string, credential: string): Promise<Caller | undefined> {
    const { rows } = await pool.query<{
      credential_hash: string;
      user_id: string;
      vault_id: string;
    }>(
      `select d.credential_hash, d.user_id, v.id as vault_id
         from devices d
         join vaults v on v.user_id = d.user_id
        where d.id = $1 and d.revoked_at is null`,
      [deviceId],
    );

    const device = rows[0];
    if (!device) return undefined;
    if (!(await secretMatches(credential, device.credential_hash))) return undefined;

    return { userId: device.user_id, vaultId: device.vault_id, deviceId };
  }

  async listDevices(caller: Caller): Promise<
    { id: string; name: string; enrolledAt: string; revokedAt: string | null; current: boolean }[]
  > {
    const { rows } = await pool.query<{
      id: string;
      name: string;
      enrolled_at: Date;
      revoked_at: Date | null;
    }>(
      "select id, name, enrolled_at, revoked_at from devices where user_id = $1 order by enrolled_at",
      [caller.userId],
    );

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      enrolledAt: row.enrolled_at.toISOString(),
      revokedAt: row.revoked_at?.toISOString() ?? null,
      current: row.id === caller.deviceId,
    }));
  }

  /**
   * Revokes a device.
   *
   * Refuses to revoke the caller's own: locking yourself out of the last
   * device is not something to do by misclick.
   */
  async revokeDevice(caller: Caller, deviceId: string): Promise<void> {
    if (deviceId === caller.deviceId) {
      throw new ConflictException("Revoke this device from another one.");
    }
    const result = await pool.query(
      "update devices set revoked_at = now() where id = $1 and user_id = $2 and revoked_at is null",
      [deviceId, caller.userId],
    );

    if (result.rowCount) {
      await recordAuditEvent({
        eventType: "device_revoked",
        userId: caller.userId,
        deviceId,
      });
    }
  }

  /** What a device needs to rebuild the key hierarchy from the password. */
  async vaultBootstrap(caller: Caller): Promise<VaultBootstrap> {
    const { rows } = await pool.query<{
      salt_b64: string;
      kdf_memory_kib: number;
      kdf_iterations: number;
      kdf_parallelism: number;
      wrapped_vault_key: unknown;
    }>(
      `select salt_b64, kdf_memory_kib, kdf_iterations, kdf_parallelism, wrapped_vault_key
         from vaults where id = $1`,
      [caller.vaultId],
    );

    const vault = rows[0];
    if (!vault) throw new UnauthorizedException("No vault.");

    return {
      saltB64: vault.salt_b64,
      memoryKib: vault.kdf_memory_kib,
      iterations: vault.kdf_iterations,
      parallelism: vault.kdf_parallelism,
      wrappedVaultKey: vault.wrapped_vault_key,
    };
  }

  /**
   * Re-wraps the vault under a new master password.
   *
   * The vault key itself does not change — only the salt, the costs and the
   * wrapping around it — so not one item is re-encrypted and every device
   * keeps syncing uninterrupted. What the other devices must do is notice the
   * new record and adopt it, which they do on their next sync.
   *
   * Needs the current auth key as well as an enrolled device. A device
   * credential alone must not be able to change the password: a stolen laptop
   * would otherwise lock its owner out of their own vault, and the whole
   * point of the auth key is that only the master password produces it.
   *
   * The server learns nothing from any of this. It sees two opaque 256-bit
   * values and a blob it cannot open, exactly as it did at registration.
   */
  async changeMasterPassword(
    caller: Caller,
    input: { currentAuthKey: string; newAuthKey: string; vault: VaultBootstrap; sourceIp?: string },
  ): Promise<void> {
    const { rows } = await pool.query<{ auth_key_hash: string }>(
      "select auth_key_hash from users where id = $1",
      [caller.userId],
    );

    const stored = rows[0]?.auth_key_hash;
    // One message whether the user row is missing or the key is wrong. There
    // is nothing to tell apart here for a caller who is already authenticated,
    // and keeping the wording uniform costs nothing.
    const refuse = async (): Promise<never> => {
      await recordAuditEvent({
        eventType: "enrollment_refused",
        userId: caller.userId,
        detail: { action: "master_password_change" },
        ...(input.sourceIp !== undefined && { sourceIp: input.sourceIp }),
      });
      throw new UnauthorizedException("Password change refused.");
    };

    if (!stored) await refuse();
    if (!(await secretMatches(input.currentAuthKey, stored!))) await refuse();

    // Both Argon2 calls happen before the transaction opens, so no row lock is
    // held across them. The update is then a compare-and-swap on the hash we
    // verified: if anything changed the password in between, this writes
    // nothing rather than overwriting a newer change with an older one.
    const nextHash = await hashSecret(input.newAuthKey);

    const client = await pool.connect();
    try {
      await client.query("begin");

      const updated = await client.query(
        "update users set auth_key_hash = $1 where id = $2 and auth_key_hash = $3",
        [nextHash, caller.userId, stored],
      );
      if (updated.rowCount !== 1) await refuse();

      await client.query(
        `update vaults
            set salt_b64 = $1,
                kdf_memory_kib = $2,
                kdf_iterations = $3,
                kdf_parallelism = $4,
                wrapped_vault_key = $5
          where id = $6`,
        [
          input.vault.saltB64,
          input.vault.memoryKib,
          input.vault.iterations,
          input.vault.parallelism,
          JSON.stringify(input.vault.wrappedVaultKey),
          caller.vaultId,
        ],
      );

      // Outstanding invitations were minted under the old password, and a
      // password change is exactly the moment someone wants no loose ends. A
      // token is useless without the password in any case; spending them here
      // means an interrupted enrolment fails visibly rather than half-working.
      await client.query(
        "update enrollment_tokens set used_at = now() where user_id = $1 and used_at is null",
        [caller.userId],
      );

      await client.query("commit");

      await recordAuditEvent({
        eventType: "master_password_changed",
        userId: caller.userId,
      });
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}
