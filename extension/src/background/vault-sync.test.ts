// Connecting a vault to a server.
//
// The tests worth having here are the refusals. Each of them guards against
// an action that cannot be undone afterwards: an account registered under a
// mistyped password on a server that only accepts one, or a second vault
// quietly overwritten by the one the server holds.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { localStore } from "../test/setup.js";
import { cryptoFake, db, dbFake, resetFakes } from "../test/fakes.js";

vi.mock("../lib/crypto.js", () => cryptoFake);
vi.mock("../lib/vault-db.js", () => dbFake);

const vault = await import("./vault.js");

const PASSWORD = "correct horse battery staple";

/** Answers each call in order, so a whole flow can be scripted. */
function server(...bodies: unknown[]) {
  const calls: string[] = [];
  const sent: unknown[] = [];
  const fetched = vi.fn((url: URL | string, init?: RequestInit) => {
    calls.push(String(url));
    sent.push(typeof init?.body === "string" ? JSON.parse(init.body) : undefined);
    const body = bodies.shift() ?? {};
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);
  });
  vi.stubGlobal("fetch", fetched);
  return { calls, sent, fetched };
}

/**
 * The record `create` leaves behind, as the server would hand it back.
 *
 * Every sync re-reads the server's vault record, so a scripted flow has to
 * answer that call — and answering it with anything else is a *changed*
 * record, which the device would then adopt.
 */
const LOCAL_VAULT = {
  saltB64: "salt-b64",
  memoryKib: 65536,
  iterations: 3,
  parallelism: 4,
  wrappedVaultKey: { version: 1, ciphertext: [], nonce: [] },
};

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
    await expect(vault.connectServer("https://v.test", "reg-token", "Desktop", PASSWORD)).rejects.toThrow(
      /no vault/i,
    );
  });

  it("insists on https", async () => {
    await vault.create(PASSWORD);
    await expect(vault.connectServer("http://v.test", "reg-token", "Desktop", PASSWORD)).rejects.toThrow(
      /https/i,
    );
  });

  it("checks the master password before anything reaches the network", async () => {
    await vault.create(PASSWORD);
    cryptoFake.unwrapVaultKey.mockImplementation(() => {
      throw new Error("decryption failed");
    });
    const { fetched } = server();

    await expect(vault.connectServer("https://v.test", "reg-token", "Desktop", "wrong")).rejects.toThrow();

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
      LOCAL_VAULT,
      { items: [], cursor: "0", more: false },
      { accepted: [], conflicts: [], cursor: "0" },
    );

    await vault.connectServer("https://v.test", "reg-token", "Desktop", PASSWORD);

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
      LOCAL_VAULT,
      { items: [], cursor: "0", more: false },
      { accepted: [], conflicts: [], cursor: "0" },
    );
    await vault.connectServer("https://v.test", "reg-token", "Desktop", PASSWORD);

    await expect(vault.connectServer("https://v.test", "reg-token", "Desktop", PASSWORD)).rejects.toThrow(
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
      LOCAL_VAULT,
      { items: [], cursor: "0", more: false },
      { accepted: [], conflicts: [], cursor: "0" },
    );
    await vault.connectServer("https://v.test", "reg-token", "Desktop", PASSWORD);

    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network unreachable"))),
    );
    const id = await vault.addItem({ type: "login", username: "a", password: "b", url: "", notes: "" });

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
      LOCAL_VAULT,
      { items: [], cursor: "0", more: false },
      { accepted: [], conflicts: [], cursor: "0" },
    );
    await vault.connectServer("https://v.test", "reg-token", "Desktop", PASSWORD);

    await vault.disconnectServer();

    expect(await vault.syncStatus()).toEqual({ connected: false });
    expect(localStore.has("sync")).toBe(false);
    expect(await vault.status()).toBe("unlocked");
  });
});

describe("changing the master password", () => {
  const NEXT = "a completely different long phrase";

  /** A vault that has already registered with a server. */
  async function connected(): Promise<void> {
    await vault.create(PASSWORD);
    server(
      { deviceId: "dev-1", credential: "secret-value" },
      LOCAL_VAULT,
      { items: [], cursor: "0", more: false },
      { accepted: [], conflicts: [], cursor: "0" },
    );
    await vault.connectServer("https://v.test", "reg-token", "Desktop", PASSWORD);
  }

  it("proves the current password and uploads the new record", async () => {
    await connected();
    const { calls, sent } = server({ changed: true });
    // Registering derived one of each already; only the rotation's own calls
    // are of interest here.
    cryptoFake.deriveAuthKey.mockClear();
    cryptoFake.generateSalt.mockReturnValueOnce("rotated-salt");

    await vault.changeMasterPassword(PASSWORD, NEXT);

    expect(calls[0]).toContain("vault/master-password");
    expect(sent[0]).toMatchObject({
      vault: { saltB64: "rotated-salt", memoryKib: 65536, iterations: 3, parallelism: 4 },
    });

    // One auth key from each password: the current one is what the server
    // checks, and without it a stolen device credential could rotate the
    // password on its own.
    expect(cryptoFake.deriveAuthKey).toHaveBeenCalledTimes(2);
    expect(cryptoFake.deriveMasterKey.mock.calls.at(-2)).toEqual([PASSWORD, "salt-b64", 65536, 3, 4]);
    expect(cryptoFake.deriveMasterKey.mock.calls.at(-1)).toEqual([NEXT, "rotated-salt", 65536, 3, 4]);
  });

  it("keeps the old record when the server refuses", async () => {
    await connected();
    const before = db.vault;
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ message: "Password change refused." }),
        } as Response),
      ),
    );

    await expect(vault.changeMasterPassword(PASSWORD, NEXT)).rejects.toThrow(/refused/i);

    // Writing locally first would leave this device on a password the server
    // has never heard of — and the next sync would hand back the old record.
    expect(db.vault).toBe(before);
  });

  it("is adopted by the other devices on their next sync", async () => {
    await connected();
    const elsewhere = {
      ...LOCAL_VAULT,
      saltB64: "rotated-elsewhere",
      wrappedVaultKey: { version: 1, ciphertext: [7], nonce: [8] },
    };
    server(elsewhere, { items: [], cursor: "0", more: false }, { accepted: [], conflicts: [], cursor: "0" });

    await vault.syncNow();

    // Nothing else changes: the vault key is the same key, so this device
    // keeps syncing and simply needs the new password at its next unlock.
    expect(db.vault).toMatchObject({ saltB64: "rotated-elsewhere" });
  });

  it("refuses a record whose costs came back weakened", async () => {
    await connected();
    server({ ...LOCAL_VAULT, saltB64: "rotated-elsewhere", memoryKib: 8 });

    // A server cannot forge a record that opens, but it could serve one that
    // opens cheaply. This record replaces the only thing on the device that
    // can open the vault, so it is checked before it is stored.
    await expect(vault.syncNow()).rejects.toThrow(/will not accept/i);
    expect(db.vault).toMatchObject({ saltB64: "salt-b64", memoryKib: 65536 });
  });

  it("leaves an unchanged record alone, whatever order its fields arrive in", async () => {
    await connected();
    const before = db.vault;
    server(
      // The same record, out of a jsonb column, which does not preserve field
      // order. Treating this as a change would rewrite the record on every
      // single sync.
      { ...LOCAL_VAULT, wrappedVaultKey: { nonce: [], version: 1, ciphertext: [] } },
      { items: [], cursor: "0", more: false },
      { accepted: [], conflicts: [], cursor: "0" },
    );

    await vault.syncNow();

    expect(db.vault).toBe(before);
  });
});

describe("local-only mode", () => {
  it("is off by default", async () => {
    expect(await vault.isLocalOnly()).toBe(false);
  });

  it("can be turned on and off", async () => {
    await vault.setLocalOnly(true);
    expect(await vault.isLocalOnly()).toBe(true);

    await vault.setLocalOnly(false);
    expect(await vault.isLocalOnly()).toBe(false);
  });

  it("refuses to connect a server once set", async () => {
    await vault.create(PASSWORD);
    await vault.setLocalOnly(true);

    await expect(vault.connectServer("https://v.test", "reg-token", "Desktop", PASSWORD)).rejects.toThrow(
      /never sync/i,
    );
  });

  it("refuses to join a server once set", async () => {
    await vault.setLocalOnly(true);

    await expect(vault.enrollWithServer("https://v.test", "token", "Laptop", PASSWORD)).rejects.toThrow(
      /never sync/i,
    );
  });

  it("refuses to turn on while a server is connected", async () => {
    await vault.create(PASSWORD);
    server(
      { deviceId: "dev-1", credential: "secret-value" },
      LOCAL_VAULT,
      { items: [], cursor: "0", more: false },
      { accepted: [], conflicts: [], cursor: "0" },
    );
    await vault.connectServer("https://v.test", "reg-token", "Desktop", PASSWORD);

    await expect(vault.setLocalOnly(true)).rejects.toThrow(/disconnect/i);
    expect(await vault.isLocalOnly()).toBe(false);
  });
});
