// Registration, device enrolment, and deciding whether a caller may speak.

import { Injectable, UnauthorizedException, ConflictException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { pool } from "../db/pool.js";
import { equalSecrets, hashSecret, newSecret, secretMatches } from "./credentials.js";

/** How long an enrolment token is good for. Long enough to walk to a laptop. */
const TOKEN_MINUTES = 15;

export interface DeviceCredential {
  deviceId: string;
  credential: string;
}

export interface Caller {
  userId: string;
  vaultId: string;
  deviceId: string;
}

export interface VaultBootstrap {
  saltB64: string;
  memoryKib: number;
  iterations: number;
  parallelism: number;
  wrappedVaultKey: unknown;
}

/** Tokens are looked up by hash, so a database dump does not yield working ones. */
function tokenFingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

@Injectable()
export class AuthService {
  /**
   * Creates the one account this server will ever hold.
   *
   * Refuses once an account exists. This server is for one person, and a
   * registration endpoint that keeps answering is an open door — anyone who
   * finds the domain could otherwise create their own account on it.
   */
  async register(input: {
    authKey: string;
    vault: VaultBootstrap;
    deviceName: string;
  }): Promise<DeviceCredential> {
    const client = await pool.connect();
    try {
      await client.query("begin");

      const { rows: existing } = await client.query<{ count: string }>(
        "select count(*)::text as count from users",
      );
      if (existing[0]?.count !== "0") {
        throw new ConflictException("This server already has an account.");
      }

      const { rows: users } = await client.query<{ id: string }>(
        "insert into users (auth_key_hash) values ($1) returning id",
        [await hashSecret(input.authKey)],
      );
      const userId = users[0]?.id;
      if (!userId) throw new Error("user was not created");

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
      return credential;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
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
            and t.used_at is null
            and t.expires_at > now()
          for update of t`,
        [tokenFingerprint(input.token)],
      );

      const found = rows[0];
      // One message for an unknown token, a spent one, an expired one and a
      // wrong auth key. Telling them apart would say which half was right.
      const refuse = (): never => {
        throw new UnauthorizedException("Enrolment refused.");
      };

      if (!found || !equalSecrets(found.token_hash, tokenFingerprint(input.token))) refuse();
      if (!(await secretMatches(input.authKey, found!.auth_key_hash))) refuse();

      await client.query("update enrollment_tokens set used_at = now() where token_hash = $1", [
        found!.token_hash,
      ]);

      const credential = await this.attachDevice(client, found!.user_id, input.deviceName);
      await client.query("commit");
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
    await pool.query(
      "update devices set revoked_at = now() where id = $1 and user_id = $2 and revoked_at is null",
      [deviceId, caller.userId],
    );
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
}
