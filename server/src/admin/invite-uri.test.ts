// Pure URL-building logic, no database and no interactive prompt involved.

import { describe, expect, it } from "vitest";
import { inviteUri } from "./invite-uri.js";

describe("inviteUri", () => {
  it("carries the server, token and account kind", () => {
    const uri = new URL(inviteUri("https://vault.example.com", "the-token"));
    expect(uri.protocol).toBe("vaultiq:");
    expect(uri.searchParams.get("server")).toBe("https://vault.example.com");
    expect(uri.searchParams.get("token")).toBe("the-token");
    expect(uri.searchParams.get("kind")).toBe("account");
  });

  it("trims a trailing slash from the server URL", () => {
    const uri = new URL(inviteUri("https://vault.example.com/", "t"));
    expect(uri.searchParams.get("server")).toBe("https://vault.example.com");
  });
});
