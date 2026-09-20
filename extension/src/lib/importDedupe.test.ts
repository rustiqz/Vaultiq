import { describe, expect, it } from "vitest";
import { findMatch } from "./importDedupe.js";
import type {
  CardContent,
  DecryptedCard,
  DecryptedIdentity,
  DecryptedItem,
  DecryptedLogin,
  DecryptedNote,
  DecryptedTotp,
  IdentityContent,
  ItemFacts,
  LoginContent,
  NoteContent,
  TotpContent,
} from "./messages.js";

const facts: ItemFacts = { id: "existing-id", updatedAt: 0, deleted: false, usage: { useCount: 0, counts: {}, devices: [] } };

function login(fields: Partial<LoginContent>): DecryptedLogin {
  return {
    type: "login",
    username: "",
    password: "",
    url: "",
    notes: "",
    ...fields,
    ...facts,
    reusedBy: 0,
    strength: { bits: 0, level: "weak" },
  };
}

function note(fields: Partial<NoteContent>): DecryptedNote {
  return { type: "note", notes: "", ...fields, ...facts };
}

function card(fields: Partial<CardContent>): DecryptedCard {
  return {
    type: "card",
    cardholder: "",
    number: "",
    expiryMonth: "",
    expiryYear: "",
    securityCode: "",
    notes: "",
    ...fields,
    ...facts,
    brand: null,
    last4: "",
  };
}

function identity(fields: Partial<IdentityContent>): DecryptedIdentity {
  return {
    type: "identity",
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    street: "",
    city: "",
    state: "",
    postalCode: "",
    country: "",
    notes: "",
    ...fields,
    ...facts,
  };
}

function totp(fields: Partial<TotpContent>): DecryptedTotp {
  return {
    type: "totp",
    issuer: "",
    account: "",
    secret: "",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    notes: "",
    ...fields,
    ...facts,
    code: "",
    secondsRemaining: 0,
  };
}

describe("findMatch: login", () => {
  it("matches same username and site, case-insensitively", () => {
    const existing: DecryptedItem[] = [login({ username: "Alice@example.com", password: "old", url: "https://example.com/login" })];
    const match = findMatch({ type: "login", username: "alice@example.com", password: "new", url: "https://www.example.com", notes: "" }, existing);
    expect(match).not.toBeNull();
    expect(match?.identical).toBe(false);
  });

  it("reports identical when every field agrees", () => {
    const existing: DecryptedItem[] = [login({ username: "alice", password: "secret", url: "https://example.com", notes: "" })];
    const match = findMatch({ type: "login", username: "alice", password: "secret", url: "https://example.com", notes: "" }, existing);
    expect(match?.identical).toBe(true);
  });

  it("does not match a different username on the same site", () => {
    const existing: DecryptedItem[] = [login({ username: "alice", url: "https://example.com" })];
    const match = findMatch({ type: "login", username: "bob", password: "", url: "https://example.com", notes: "" }, existing);
    expect(match).toBeNull();
  });

  it("does not match an empty username", () => {
    const existing: DecryptedItem[] = [login({ username: "", url: "https://example.com" })];
    const match = findMatch({ type: "login", username: "", password: "", url: "https://example.com", notes: "" }, existing);
    expect(match).toBeNull();
  });

  it("falls back to username alone when either side has no url", () => {
    const existing: DecryptedItem[] = [login({ username: "alice", url: "" })];
    const match = findMatch({ type: "login", username: "alice", password: "", url: "https://example.com", notes: "" }, existing);
    expect(match).not.toBeNull();
  });

  it("never matches a trashed item", () => {
    const existing: DecryptedItem[] = [{ ...login({ username: "alice", url: "https://example.com" }), deleted: true }];
    const match = findMatch({ type: "login", username: "alice", password: "", url: "https://example.com", notes: "" }, existing);
    expect(match).toBeNull();
  });
});

describe("findMatch: card", () => {
  it("matches on digits alone, ignoring formatting", () => {
    const existing: DecryptedItem[] = [card({ number: "4242 4242 4242 4242" })];
    const match = findMatch(
      { type: "card", cardholder: "", number: "4242-4242-4242-4242", expiryMonth: "", expiryYear: "", securityCode: "", notes: "" },
      existing,
    );
    expect(match).not.toBeNull();
  });
});

describe("findMatch: identity", () => {
  it("matches on first and last name", () => {
    const existing: DecryptedItem[] = [identity({ firstName: "Ada", lastName: "Lovelace" })];
    const match = findMatch(
      { type: "identity", firstName: "ada", lastName: "lovelace", email: "", phone: "", street: "", city: "", state: "", postalCode: "", country: "", notes: "" },
      existing,
    );
    expect(match).not.toBeNull();
  });
});

describe("findMatch: totp", () => {
  it("matches on issuer and account", () => {
    const existing: DecryptedItem[] = [totp({ issuer: "GitHub", account: "alice" })];
    const match = findMatch({ type: "totp", issuer: "github", account: "alice", secret: "", algorithm: "SHA1", digits: 6, period: 30, notes: "" }, existing);
    expect(match).not.toBeNull();
  });
});

describe("findMatch: note", () => {
  it("matches on name when both have one", () => {
    const existing: DecryptedItem[] = [note({ name: "Wifi password", notes: "old body" })];
    const match = findMatch({ type: "note", name: "wifi password", notes: "new body" }, existing);
    expect(match?.identical).toBe(false);
  });

  it("falls back to matching the note body when neither has a name", () => {
    const existing: DecryptedItem[] = [note({ notes: "same body" })];
    const match = findMatch({ type: "note", notes: "same body" }, existing);
    expect(match?.identical).toBe(true);
  });
});

describe("findMatch: no match", () => {
  it("returns null when nothing lines up", () => {
    const existing: DecryptedItem[] = [login({ username: "alice", url: "https://example.com" })];
    const match = findMatch({ type: "login", username: "carol", password: "", url: "https://other.example", notes: "" }, existing);
    expect(match).toBeNull();
  });
});
