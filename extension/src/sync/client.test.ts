// The client is a thin thing, but two of its rules are load-bearing: the auth
// key must never travel unencrypted, and the server's refusals must reach the
// user unembellished.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertUsableServer, SyncClient } from "./client.js";

describe("the server address", () => {
  it("insists on https", () => {
    // TLS is the only thing between the auth key and the wire. An http://
    // address is not a preference, it is the protection gone.
    expect(() => assertUsableServer("http://vault.example")).toThrow(/https/i);
  });

  it("allows a local server, where there is no network to intercept", () => {
    expect(assertUsableServer("http://localhost:3000").hostname).toBe("localhost");
    expect(assertUsableServer("http://127.0.0.1:3000").hostname).toBe("127.0.0.1");
  });

  it("keeps a subpath, rather than resolving requests away from it", () => {
    // Without the trailing slash `new URL("auth/register", base)` discards
    // the last segment, and every request goes to the wrong place.
    expect(assertUsableServer("https://host.test/vaultiq").toString()).toBe(
      "https://host.test/vaultiq/",
    );
  });

  it("rejects something that is not a URL at all", () => {
    expect(() => assertUsableServer("vault.example")).toThrow(/valid/i);
  });
});

describe("talking to the server", () => {
  let fetched: { url: string; init: RequestInit }[];

  function answer(body: unknown, ok = true, status = 200) {
    return vi.fn((url: URL | string, init: RequestInit) => {
      fetched.push({ url: String(url), init });
      return Promise.resolve({
        ok,
        status,
        json: () => Promise.resolve(body),
      } as Response);
    });
  }

  beforeEach(() => {
    fetched = [];
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("addresses a server that lives under a subpath", async () => {
    vi.stubGlobal("fetch", answer({ items: [], cursor: "0", more: false }));

    await new SyncClient(assertUsableServer("https://host.test/vaultiq").toString()).pull("0");

    expect(fetched[0]?.url).toBe("https://host.test/vaultiq/sync?since=0");
  });

  it("presents the device credential as a bearer token", async () => {
    vi.stubGlobal("fetch", answer({ items: [], cursor: "0", more: false }));
    const client = new SyncClient("https://vault.example/", {
      deviceId: "dev-1",
      credential: "secret-value",
    });

    await client.pull("0");

    const headers = new Headers(fetched[0]?.init.headers);
    expect(headers.get("authorization")).toBe("Bearer dev-1.secret-value");
  });

  it("sends no credential before there is one", async () => {
    vi.stubGlobal("fetch", answer({ saltB64: "x", memoryKib: 1, iterations: 2, parallelism: 1 }));

    await new SyncClient("https://vault.example/").enrollmentParams("token");

    const headers = new Headers(fetched[0]?.init.headers);
    expect(headers.has("authorization")).toBe(false);
  });

  it("keeps the token out of the URL", async () => {
    vi.stubGlobal("fetch", answer({ saltB64: "x", memoryKib: 1, iterations: 2, parallelism: 1 }));

    await new SyncClient("https://vault.example/").enrollmentParams("a-real-token");

    // A query string ends up in proxy logs and history; this one is a bearer
    // secret for the next fifteen minutes.
    expect(fetched[0]?.url).not.toContain("a-real-token");
    expect(fetched[0]?.init.body as string).toContain("a-real-token");
  });

  it("repeats the server's refusal without adding to it", async () => {
    vi.stubGlobal("fetch", answer({ message: "Enrolment refused." }, false, 401));

    await expect(
      new SyncClient("https://vault.example/").enroll({
        token: "t",
        authKey: "k",
        deviceName: "Laptop",
      }),
    ).rejects.toThrow("Enrolment refused.");
  });

  it("still says something when the server says nothing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({ ok: false, status: 502, json: () => Promise.reject(new Error("html")) } as unknown as Response),
      ),
    );

    await expect(new SyncClient("https://vault.example/").vault()).rejects.toThrow(/502/);
  });
});
