// Connecting a vault to a server.
//
// The tests worth having here are the refusals. Each of them guards against
// an action that cannot be undone afterwards: an account registered under a
// mistyped password on a server that only accepts one, or a second vault
// quietly overwritten by the one the server holds.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { localStore } from "../test/setup.js";
import { cryptoFake, dbFake, resetFakes } from "../test/fakes.js";

vi.mock("../lib/crypto.js", () => cryptoFake);
vi.mock("../lib/vault-db.js", () => dbFake);

const vault = await import("./vault.js");

const PASSWORD = "correct horse battery staple";

/** Answers each call in order, so a whole flow can be scripted. */
function server(...bodies: unknown[]) {
  const calls: string[] = [];
  const fetched = vi.fn((url: URL | string) => {
    calls.push(String(url));
    const body = bodies.shift() ?? {};
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);
  });
  vi.stubGlobal("fetch", fetched);
  return { calls, fetched };
}

beforeEach(() => {
  resetFakes();
  vi.unstubAllGlobals();
});

describe("before connecting", () => {
  it("reports no server", async () => {
    expect(await vault.syncStatus()).toEqual({ connected: false });
  });

  it("refuses when there is no vault to upload", async () => {
    server();
    await expect(vault.connectServer("https://v.test", "Desktop", PASSWORD)).rejects.toThrow(
      /no vault/i,
    );
  });

  it("insists on https", async () => {
    await vault.create(PASSWORD);
    await expect(vault.connectServer("http://v.test", "Desktop", PASSWORD)).rejects.toThrow(
      /https/i,
    );
  });

  it("checks the master password before anything reaches the network", async () => {
    await vault.create(PASSWORD);
    cryptoFake.unwrapVaultKey.mockImplementation(() => {
      throw new Error("decryption failed");
    });
    const { fetched } = server();

    await expect(vault.connectServer("https://v.test", "Desktop", "wrong")).rejects.toThrow();

    // The server takes one account, ever. A typo registered as *the* auth key
    // would not be recoverable without wiping it.
    expect(fetched).not.toHaveBeenCalled();
  });
});

describe("registering the first device", () => {
  it("uploads the vault and keeps the credential encrypted", async () => {
    await vault.create(PASSWORD);
    server(
      { deviceId: "dev-1", credential: "secret-value" },
      { items: [], cursor: "0", more: false },
      { accepted: [], conflicts: [], cursor: "0" },
    );

    await vault.connectServer("https://v.test", "Desktop", PASSWORD);

    // The fake keeps plaintext so tests can read it; what is asserted here is
    // that the credential went through the encryption path at all, rather
    // than being written to disk as it arrived.
    const sealed = cryptoFake.encryptItem.mock.calls.find(
      ([, header]) => header.id === "sync:credential",
    );
    expect(sealed?.[0]).toContain("secret-value");
    expect(await vault.syncStatus()).toMatchObject({ connected: true, server: "https://v.test/" });
  });

  it("refuses a second connection", async () => {
    await vault.create(PASSWORD);
    server(
      { deviceId: "dev-1", credential: "secret-value" },
      { items: [], cursor: "0", more: false },
      { accepted: [], conflicts: [], cursor: "0" },
    );
    await vault.connectServer("https://v.test", "Desktop", PASSWORD);

    await expect(vault.connectServer("https://v.test", "Desktop", PASSWORD)).rejects.toThrow(
      /already connected/i,
    );
  });
});

describe("joining an existing server", () => {
  const REMOTE = { saltB64: "server-salt", memoryKib: 65536, iterations: 3, parallelism: 4 };

  it("asks for the parameters before deriving anything", async () => {
    const { calls } = server(
      REMOTE,
      { deviceId: "dev-2", credential: "secret-value" },
      { ...REMOTE, wrappedVaultKey: { version: 1 } },
      { items: [], cursor: "0", more: false },
      { accepted: [], conflicts: [], cursor: "0" },
    );

    await vault.enrollWithServer("https://v.test", "token", "Laptop", PASSWORD);

    // The order is the whole reason `enrollment-params` exists: the auth key
    // cannot be derived until the salt and costs are known.
    expect(calls[0]).toContain("auth/enrollment-params");
    expect(calls[1]).toContain("auth/enroll");
  });

  it("adopts the server's vault record", async () => {
    server(
      REMOTE,
      { deviceId: "dev-2", credential: "secret-value" },
      { ...REMOTE, wrappedVaultKey: { version: 1 } },
      { items: [], cursor: "0", more: false },
      { accepted: [], conflicts: [], cursor: "0" },
    );

    await vault.enrollWithServer("https://v.test", "token", "Laptop", PASSWORD);

    expect(await vault.status()).toBe("unlocked");
  });

  it("refuses to join when this device already holds a different vault", async () => {
    // `create` uses the fake's salt, which is not the server's.
    await vault.create(PASSWORD);
    server(REMOTE);

    // Merging two independently created vaults would need both master
    // passwords; overwriting one would destroy it. Neither is ours to choose.
    await expect(
      vault.enrollWithServer("https://v.test", "token", "Laptop", PASSWORD),
    ).rejects.toThrow(/different vault/i);
  });
});

describe("after a failure", () => {
  it("records why, and keeps the local write", async () => {
    await vault.create(PASSWORD);
    server(
      { deviceId: "dev-1", credential: "secret-value" },
      { items: [], cursor: "0", more: false },
      { accepted: [], conflicts: [], cursor: "0" },
    );
    await vault.connectServer("https://v.test", "Desktop", PASSWORD);

    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network unreachable"))),
    );
    const id = await vault.addItem({ username: "a", password: "b", url: "", notes: "" });

    await expect(vault.syncNow()).rejects.toThrow(/unreachable/);

    // The edit is saved either way; what a failed sync changes is only what
    // the popup reports.
    expect((await vault.listItems()).map((each) => each.id)).toContain(id);
    expect(await vault.syncStatus()).toMatchObject({ lastError: "network unreachable" });
  });

  it("forgets the server without touching the vault", async () => {
    await vault.create(PASSWORD);
    server(
      { deviceId: "dev-1", credential: "secret-value" },
      { items: [], cursor: "0", more: false },
      { accepted: [], conflicts: [], cursor: "0" },
    );
    await vault.connectServer("https://v.test", "Desktop", PASSWORD);

    await vault.disconnectServer();

    expect(await vault.syncStatus()).toEqual({ connected: false });
    expect(localStore.has("sync")).toBe(false);
    expect(await vault.status()).toBe("unlocked");
  });
});
