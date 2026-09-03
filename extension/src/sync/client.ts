// Talking to the server.
//
// Every call carries the device credential and nothing else. The server has
// no session to keep, so there is no token to refresh and nothing to expire.

import type { WireItem } from "./wire.js";

export interface ServerVault {
  saltB64: string;
  memoryKib: number;
  iterations: number;
  parallelism: number;
  wrappedVaultKey: unknown;
}

export interface DeviceCredential {
  deviceId: string;
  credential: string;
}

export interface KdfParams {
  saltB64: string;
  memoryKib: number;
  iterations: number;
  parallelism: number;
}

export interface PullResult {
  items: WireItem[];
  cursor: string;
  more: boolean;
}

export interface PushResult {
  accepted: string[];
  conflicts: WireItem[];
  cursor: string;
}

export interface RemoteDevice {
  id: string;
  name: string;
  enrolledAt: string;
  revokedAt: string | null;
  current: boolean;
}

/**
 * Rejects anything that is not HTTPS.
 *
 * TLS is the only thing between the auth key and the wire, so an `http://`
 * server address is not a configuration choice — it is the whole protection
 * gone. `localhost` is allowed, because there is no network to intercept.
 */
export function assertUsableServer(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("That is not a valid server address.");
  }

  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !local) {
    throw new Error("The server address must start with https://");
  }

  // A trailing slash, or `new URL(path, base)` throws the last path segment
  // away: a server at https://host/vaultiq would silently be addressed at
  // https://host/auth/register.
  if (!parsed.pathname.endsWith("/")) parsed.pathname += "/";
  return parsed;
}

export class SyncClient {
  constructor(
    private readonly base: string,
    private readonly device?: DeviceCredential,
  ) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("content-type", "application/json");
    if (this.device) {
      headers.set("authorization", `Bearer ${this.device.deviceId}.${this.device.credential}`);
    }

    const response = await fetch(new URL(path, this.base), { ...init, headers });

    if (!response.ok) {
      // The server's own words where it gave any, since it is deliberately
      // vague about auth failures. Nothing is added here.
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      throw new Error(body.message ?? `Server refused the request (${String(response.status)}).`);
    }
    return (await response.json()) as T;
  }

  async register(input: {
    authKey: string;
    vault: ServerVault;
    deviceName: string;
  }): Promise<DeviceCredential> {
    return await this.request("auth/register", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  /**
   * The salt and costs, for a device that has a token but no credential.
   *
   * Enrolment is impossible without this: the auth key it must present is
   * derived from the master password *and* these parameters, and until the
   * device is enrolled it has no way to read them from the vault.
   */
  async enrollmentParams(token: string): Promise<KdfParams> {
    return await this.request("auth/enrollment-params", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
  }

  async enroll(input: {
    token: string;
    authKey: string;
    deviceName: string;
  }): Promise<DeviceCredential> {
    return await this.request("auth/enroll", { method: "POST", body: JSON.stringify(input) });
  }

  async vault(): Promise<ServerVault> {
    return await this.request("vault");
  }

  /**
   * Re-wraps the vault on the server under a new master password.
   *
   * Carries the current auth key as well as the new one: the server checks it
   * before accepting the change, so a stolen device credential cannot rotate
   * the password on its own.
   */
  async changeMasterPassword(input: {
    currentAuthKey: string;
    newAuthKey: string;
    vault: ServerVault;
  }): Promise<void> {
    await this.request("vault/master-password", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async pull(since: string): Promise<PullResult> {
    return await this.request(`sync?since=${encodeURIComponent(since)}`);
  }

  async push(items: WireItem[]): Promise<PushResult> {
    return await this.request("sync", { method: "POST", body: JSON.stringify({ items }) });
  }

  async devices(): Promise<RemoteDevice[]> {
    return await this.request("devices");
  }

  async enrollmentToken(): Promise<{ token: string; expiresAt: string }> {
    return await this.request("devices/enrollment-token", { method: "POST" });
  }

  async revoke(deviceId: string): Promise<void> {
    await this.request(`devices/${encodeURIComponent(deviceId)}`, { method: "DELETE" });
  }
}
